import type { Message, AttachedFile } from '../../shared/types';
import { elementToMarkdown } from '../dom';

// Wait for an image element to complete loading
function waitForImageLoad(img: HTMLImageElement, timeoutMs = 5000): Promise<void> {
  return new Promise((resolve) => {
    if (img.complete) {
      resolve();
      return;
    }
    const onLoad = () => { cleanup(); resolve(); };
    const onError = () => { cleanup(); resolve(); };
    const timer = setTimeout(() => { cleanup(); resolve(); }, timeoutMs);
    const cleanup = () => {
      img.removeEventListener('load', onLoad);
      img.removeEventListener('error', onError);
      clearTimeout(timer);
    };
    img.addEventListener('load', onLoad);
    img.addEventListener('error', onError);
  });
}

// Convert an image to base64 using Canvas first, then background CORS proxy
async function imageToBase64(img: HTMLImageElement): Promise<string> {
  const src = img.getAttribute('src') || '';
  if (!src) return '';

  // Already base64
  if (src.startsWith('data:')) return src;

  // Wait until the image is loaded into the DOM
  await waitForImageLoad(img);

  // 1. Try canvas (works for same-origin)
  if (img.naturalWidth > 0 && img.naturalHeight > 0) {
    try {
      const canvas = document.createElement('canvas');
      canvas.width = img.naturalWidth;
      canvas.height = img.naturalHeight;
      const ctx = canvas.getContext('2d');
      if (ctx) {
        ctx.drawImage(img, 0, 0);
        const dataUrl = canvas.toDataURL('image/png');
        if (dataUrl && dataUrl !== 'data:,' && dataUrl.length > 100) {
          return dataUrl;
        }
      }
    } catch (_) {
      // Tainted canvas — fall through
    }
  }

  // 2. Try direct fetch from content script
  try {
    const resp = await fetch(src, { credentials: 'include' });
    if (resp.ok) {
      const blob = await resp.blob();
      return await new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onloadend = () => resolve(reader.result as string);
        reader.onerror = reject;
        reader.readAsDataURL(blob);
      });
    }
  } catch (_) {
    // Cross-origin blocked — fall through
  }

  // 3. Background CORS proxy (with timeout)
  return new Promise((resolve) => {
    const timer = setTimeout(() => {
      resolve('');
    }, 5000);
    chrome.runtime.sendMessage({ action: 'FETCH_IMAGE_BASE64', url: src }, (resp) => {
      clearTimeout(timer);
      resolve(resp?.base64 || '');
    });
  });
}

export const scrapeGemini = async (): Promise<any> => {
  const messageBlocks = document.querySelectorAll('.query-content, message-content, .message-content');
  if (messageBlocks.length === 0) {
    throw new Error('No messages found. Are you inside a Gemini conversation?');
  }

  // Pre-load all images on the page
  const allPageImages = Array.from(document.querySelectorAll('img')) as HTMLImageElement[];
  await Promise.all(allPageImages.map(img => waitForImageLoad(img, 3000)));

  const messages: Message[] = [];
  let imageCount = 0;
  let fileCount = 0;

  for (const block of Array.from(messageBlocks)) {
    let role: 'user' | 'assistant' = 'user';
    const isAssistant = block.tagName.toLowerCase() === 'message-content' || 
                        block.classList.contains('message-content') ||
                        block.closest('message-content') !== null;
    if (isAssistant) {
      role = 'assistant';
    }

    // Convert HTML elements recursively into clean markdown format
    const text = elementToMarkdown(block);

    const files: AttachedFile[] = [];

    const images = block.querySelectorAll('img');
    for (const img of Array.from(images)) {
      const src = img.getAttribute('src') || '';
      const alt = img.getAttribute('alt') || '';

      const isAvatarOrProfile = 
        src.includes('profile') || 
        src.includes('avatar') || 
        src.includes('logo') ||
        alt.toLowerCase().includes('avatar') ||
        alt.toLowerCase().includes('profile') ||
        img.closest('[class*="avatar"]') !== null;

      if (isAvatarOrProfile) continue;

      if (src) {
        const base64 = await imageToBase64(img);
        if (base64 && base64.length > 100) {
          const isDup = files.some(f => f.content === base64);
          if (!isDup) {
            files.push({
              name: alt || `gemini-image-${imageCount + 1}.png`,
              type: 'image/png',
              content: base64
            });
            imageCount++;
          }
        }
      }
    }

    const filePills = block.querySelectorAll('[class*="attachment"], [class*="chip"], [class*="file"]');
    for (const pill of Array.from(filePills)) {
      const fileName = pill.textContent || 'File';
      const cleaned = fileName.trim();
      if (cleaned && !files.some(f => f.name === cleaned)) {
        files.push({
          name: cleaned,
          type: 'application/octet-stream'
        });
        fileCount++;
      }
    }

    messages.push({
      role,
      content: text.trim(),
      files: files.length > 0 ? files : undefined
    });
  }

  let title = document.title || 'Gemini Handoff';
  if (title === 'Gemini' || title.trim() === '') {
    const firstUserMsg = messages.find(m => m.role === 'user');
    title = firstUserMsg ? firstUserMsg.content.substring(0, 40) + '...' : 'Gemini Handoff';
  }

  return {
    title,
    messages,
    messageCount: messages.length,
    imageCount,
    fileCount,
    savedAt: new Date().toISOString(),
    startedAt: new Date().toISOString()
  };
};
