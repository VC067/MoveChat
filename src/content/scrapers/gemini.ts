import type { Message, AttachedFile } from '../../shared/types';
import { elementToMarkdown } from '../dom';

// Wait for an image element to complete loading
function waitForImageLoad(img: HTMLImageElement, timeoutMs = 5000): Promise<void> {
  return new Promise((resolve) => {
    if (img.complete && img.naturalWidth > 0) {
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

// Wait for an image to have valid dimensions (loaded and rendered)
function waitForImageReady(img: HTMLImageElement, timeoutMs = 8000): Promise<void> {
  return new Promise((resolve) => {
    if (img.naturalWidth > 0 && img.naturalHeight > 0) {
      resolve();
      return;
    }
    const start = Date.now();
    const check = () => {
      if (img.naturalWidth > 0 && img.naturalHeight > 0) {
        resolve();
      } else if (Date.now() - start > timeoutMs) {
        resolve();
      } else {
        requestAnimationFrame(check);
      }
    };
    requestAnimationFrame(check);
  });
}

// Wait for new images to appear in a container (Gemini renders images asynchronously)
function waitForNewImages(container: Element, existingCount: number, timeoutMs = 10000): Promise<void> {
  return new Promise((resolve) => {
    const currentImages = container.querySelectorAll('img');
    if (currentImages.length > existingCount) {
      resolve();
      return;
    }
    const start = Date.now();
    const observer = new MutationObserver(() => {
      const newImages = container.querySelectorAll('img');
      if (newImages.length > existingCount) {
        observer.disconnect();
        resolve();
      }
    });
    observer.observe(container, { childList: true, subtree: true });
    const check = setInterval(() => {
      const newImages = container.querySelectorAll('img');
      if (newImages.length > existingCount || Date.now() - start > timeoutMs) {
        observer.disconnect();
        clearInterval(check);
        resolve();
      }
    }, 500);
  });
}

// Get the effective image URL, handling lazy-loaded images
function getImageSrc(img: HTMLImageElement): string {
  const src = img.getAttribute('src') || '';
  if (src && !src.startsWith('data:image/svg') && src !== 'data:,') return src;

  const dataSrc = img.getAttribute('data-src') || img.getAttribute('data-lazy-src') || '';
  if (dataSrc) return dataSrc;

  const srcset = img.getAttribute('srcset') || '';
  if (srcset) {
    const firstEntry = srcset.split(',')[0].trim().split(/\s+/)[0];
    if (firstEntry) return firstEntry;
  }

  const bgImage = getComputedStyle(img).backgroundImage;
  if (bgImage && bgImage !== 'none') {
    const match = bgImage.match(/url\(["']?([^"')]+)["']?\)/);
    if (match) return match[1];
  }

  return src;
}

// Convert an image to base64 using Canvas first, then direct fetch, then background CORS proxy
async function imageToBase64(img: HTMLImageElement): Promise<string> {
  const src = getImageSrc(img);
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

  // 2. Try direct fetch from content script (with timeout)
  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 5000);
    const resp = await fetch(src, { signal: controller.signal, credentials: 'include' });
    clearTimeout(timer);
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
    // Cross-origin blocked / timeout — fall through
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
  const allBlocks = document.querySelectorAll('.query-content, .response-content, message-content, .message-content');
  if (allBlocks.length === 0) {
    throw new Error('No messages found. Are you inside a Gemini conversation?');
  }

  // Deduplicate: remove blocks that are children of other selected blocks
  const messageBlocks = Array.from(allBlocks).filter(block => {
    return !Array.from(allBlocks).some(other => other !== block && other.contains(block));
  });

  // Gemini renders AI-generated images asynchronously — wait for them to appear
  for (const block of messageBlocks) {
    const isAssistant = block.classList.contains('response-content') ||
                        block.tagName.toLowerCase() === 'message-content' || 
                        block.classList.contains('message-content') ||
                        block.closest('message-content') !== null;
    if (!isAssistant) continue;

    // Walk up to find the broadest assistant container
    let current = block.parentElement;
    let container = block as HTMLElement;
    while (current && current !== document.body) {
      const containsOther = messageBlocks.some(b => b !== block && current!.contains(b));
      if (containsOther) break;
      container = current;
      current = current.parentElement;
    }

    const existingCount = container.querySelectorAll('img').length;
    await waitForNewImages(container, existingCount, 10000);
  }

  // Pre-load all images on the page (with longer timeout for generated images)
  const allPageImages = Array.from(document.querySelectorAll('img')) as HTMLImageElement[];
  await Promise.all(allPageImages.map(img => waitForImageLoad(img, 8000)));

  const messages: Message[] = [];
  let imageCount = 0;
  let fileCount = 0;

  for (const block of messageBlocks) {
    let role: 'user' | 'assistant' = 'user';
    const isAssistant = block.classList.contains('response-content') ||
                        block.tagName.toLowerCase() === 'message-content' || 
                        block.classList.contains('message-content') ||
                        block.closest('message-content') !== null;
    if (isAssistant) {
      role = 'assistant';
    }

    // Convert HTML elements recursively into clean markdown format
    const text = elementToMarkdown(block);

    const files: AttachedFile[] = [];

    // Walk up to find the broadest container that only contains this block
    let current = block.parentElement;
    let messageContainer = block as HTMLElement;
    while (current && current !== document.body) {
      const containsOther = messageBlocks.some(b => b !== block && current!.contains(b));
      if (containsOther) break;
      messageContainer = current;
      current = current.parentElement;
    }

    // Collect images from the broadest container, including lazy-loaded and background images
    const imgSet = new Set<HTMLImageElement>();
    messageContainer.querySelectorAll('img').forEach(img => imgSet.add(img as HTMLImageElement));
    messageContainer.querySelectorAll('[style*="background-image"]').forEach(el => {
      const bg = getComputedStyle(el).backgroundImage;
      if (bg && bg !== 'none') {
        const match = bg.match(/url\(["']?([^"')]+)["']?\)/);
        if (match && match[1]) {
          const syntheticImg = new Image();
          syntheticImg.src = match[1];
          imgSet.add(syntheticImg);
        }
      }
    });

    for (const img of Array.from(imgSet)) {
      const src = getImageSrc(img);
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
        // Wait for this specific image to be fully ready
        await waitForImageReady(img, 8000);

        let base64 = await imageToBase64(img);
        
        // Retry 1: wait 2s for async image loading
        if (!base64 || base64.length <= 100) {
          await new Promise(r => setTimeout(r, 2000));
          await waitForImageReady(img, 5000);
          base64 = await imageToBase64(img);
        }

        // Retry 2: wait 3 more seconds (Gemini images can be slow to render)
        if (!base64 || base64.length <= 100) {
          await new Promise(r => setTimeout(r, 3000));
          await waitForImageReady(img, 5000);
          base64 = await imageToBase64(img);
        }

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
        } else if (src && !src.startsWith('data:')) {
          // All conversion attempts failed — store the URL as a reference
          console.warn('[MoveChat] Image conversion failed, storing URL:', src.substring(0, 100));
          files.push({
            name: alt || `gemini-image-${imageCount + 1}.png`,
            type: 'image/url',
            content: src,
            size: 0
          });
          imageCount++;
        }
      }
    }

    const filePills = messageContainer.querySelectorAll('[class*="attachment"], [class*="chip"], [class*="file"]');
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
