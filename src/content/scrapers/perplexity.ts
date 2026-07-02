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

  return src;
}

// Convert an image to base64: canvas → direct fetch → background CORS proxy
async function imageToBase64(img: HTMLImageElement): Promise<string> {
  const src = getImageSrc(img);
  if (!src) return '';

  // Already base64
  if (src.startsWith('data:')) return src;

  // Wait until the image is loaded
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

export const scrapePerplexity = async (): Promise<any> => {
  const messages: Message[] = [];
  let imageCount = 0;
  let fileCount = 0;

  // Pre-load all images on the page before scraping
  const allPageImages = Array.from(document.querySelectorAll('img')) as HTMLImageElement[];
  await Promise.all(allPageImages.map(img => waitForImageLoad(img, 3000)));

  // Try modern Perplexity DOM structure first:
  //   - User queries:     span.select-text (inside a query container)
  //   - Assistant answers: div[id^="markdown-content-"] > .prose
  let userQuerySpans = document.querySelectorAll('span.select-text');
  let answerContainers = document.querySelectorAll('div[id^="markdown-content-"]');

  if (userQuerySpans.length === 0 && answerContainers.length === 0) {
    // Fallback to older selectors
    const rawBlocks = document.querySelectorAll(
      'div[class*="UserPrompt"], div[class*="Answer"], div[class*="query"], div[class*="response"], div.prose, div.font-display'
    );
    if (rawBlocks.length === 0) {
      throw new Error('No messages found. Are you in a Perplexity thread?');
    }

    for (const block of Array.from(rawBlocks)) {
      const text = elementToMarkdown(block);
      if (!text.trim()) continue;

      let role: 'user' | 'assistant' = 'user';
      const cls = block.getAttribute('class') || '';
      if (cls.includes('Answer') || cls.includes('response') || block.classList.contains('prose') || block.querySelector('[class*="source-"]') !== null) {
        role = 'assistant';
      }

      if (role === 'assistant' && messages.length > 0 && messages[messages.length - 1].role === 'assistant') {
        continue;
      }

      const files: AttachedFile[] = [];
      const images = block.querySelectorAll('img');

      for (const img of Array.from(images)) {
        const src = getImageSrc(img);
        const alt = img.getAttribute('alt') || '';

        const isAvatarOrProfile = 
          src.includes('profile') || 
          src.includes('avatar') || 
          src.includes('logo') ||
          alt.toLowerCase().includes('avatar') ||
          alt.toLowerCase().includes('profile') ||
          img.closest('[class*="avatar"], [class*="profile"], [class*="user-icon"]') !== null;

        if (isAvatarOrProfile) continue;

        if (src) {
          let base64 = await imageToBase64(img);
          if (!base64 || base64.length <= 100) {
            await new Promise(r => setTimeout(r, 2000));
            base64 = await imageToBase64(img);
          }
          if (base64 && base64.length > 100) {
            files.push({
              name: alt || `perplexity-image-${imageCount + 1}.png`,
              type: 'image/png',
              content: base64
            });
            imageCount++;
          } else if (src && !src.startsWith('data:')) {
            files.push({
              name: alt || `perplexity-image-${imageCount + 1}.png`,
              type: 'image/url',
              content: src,
              size: 0
            });
            imageCount++;
          }
        }
      }

      messages.push({
        role,
        content: text.trim(),
        files: files.length > 0 ? files : undefined
      });
    }
  } else {
    // Pair user queries with assistant responses by index
    const pairCount = Math.max(userQuerySpans.length, answerContainers.length);

    for (let i = 0; i < pairCount; i++) {
      // User message
      if (i < userQuerySpans.length) {
        const userEl = userQuerySpans[i];
        const text = elementToMarkdown(userEl).trim();

        // Walk up to find the broadest user message container
        let userContainer = userEl as HTMLElement;
        let current = userEl.parentElement;
        while (current && current !== document.body) {
          const hasOtherMessage = Array.from(userQuerySpans).some(s => s !== userEl && current!.contains(s)) ||
                                   Array.from(answerContainers).some(a => current!.contains(a));
          if (hasOtherMessage) break;
          userContainer = current;
          current = current.parentElement;
        }

        const userFiles: AttachedFile[] = [];
        const userImages = userContainer.querySelectorAll('img');
        for (const img of Array.from(userImages)) {
          const src = getImageSrc(img);
          const alt = img.getAttribute('alt') || '';

          const isAvatarOrProfile = 
            src.includes('profile') || 
            src.includes('avatar') || 
            src.includes('logo') ||
            alt.toLowerCase().includes('avatar') ||
            alt.toLowerCase().includes('profile') ||
            img.closest('[class*="avatar"], [class*="profile"], [class*="user-icon"]') !== null;

          if (isAvatarOrProfile) continue;

          if (src) {
            let base64 = await imageToBase64(img);
            if (!base64 || base64.length <= 100) {
              await new Promise(r => setTimeout(r, 2000));
              base64 = await imageToBase64(img);
            }
            if (base64 && base64.length > 100) {
              userFiles.push({
                name: alt || `perplexity-image-${imageCount + 1}.png`,
                type: 'image/png',
                content: base64
              });
              imageCount++;
            } else if (src && !src.startsWith('data:')) {
              userFiles.push({
                name: alt || `perplexity-image-${imageCount + 1}.png`,
                type: 'image/url',
                content: src,
                size: 0
              });
              imageCount++;
            }
          }
        }

        if (text) {
          messages.push({ 
            role: 'user', 
            content: text,
            files: userFiles.length > 0 ? userFiles : undefined
          });
        }
      }

      // Assistant message
      if (i < answerContainers.length) {
        const answerEl = answerContainers[i];
        const prose = answerEl.querySelector('.prose');
        const contentEl = prose || answerEl;
        const text = elementToMarkdown(contentEl).trim();

        const files: AttachedFile[] = [];
        const images = answerEl.querySelectorAll('img');

        for (const img of Array.from(images)) {
          const src = getImageSrc(img);
          const alt = img.getAttribute('alt') || '';

          const isAvatarOrProfile = 
            src.includes('profile') || 
            src.includes('avatar') || 
            src.includes('logo') ||
            alt.toLowerCase().includes('avatar') ||
            alt.toLowerCase().includes('profile') ||
            img.closest('[class*="avatar"], [class*="profile"], [class*="user-icon"]') !== null;

          if (isAvatarOrProfile) continue;

          if (src) {
            let base64 = await imageToBase64(img);
            if (!base64 || base64.length <= 100) {
              await new Promise(r => setTimeout(r, 2000));
              base64 = await imageToBase64(img);
            }
            if (base64 && base64.length > 100) {
              files.push({
                name: alt || `perplexity-image-${imageCount + 1}.png`,
                type: 'image/png',
                content: base64
              });
              imageCount++;
            } else if (src && !src.startsWith('data:')) {
              files.push({
                name: alt || `perplexity-image-${imageCount + 1}.png`,
                type: 'image/url',
                content: src,
                size: 0
              });
              imageCount++;
            }
          }
        }

        if (text) {
          messages.push({
            role: 'assistant',
            content: text,
            files: files.length > 0 ? files : undefined
          });
        }
      }
    }
  }

  // Deduplicate consecutive messages with identical role + content
  const filteredMessages: Message[] = [];
  let prevRole: string | null = null;
  let prevContent = '';

  for (const msg of messages) {
    if (msg.role === prevRole && msg.content === prevContent) {
      continue;
    }
    filteredMessages.push(msg);
    prevRole = msg.role;
    prevContent = msg.content;
  }

  let title = document.title || 'Perplexity Handoff';
  if (title.toLowerCase().includes('perplexity') || title.trim() === '') {
    const firstUserMsg = filteredMessages.find(m => m.role === 'user');
    title = firstUserMsg ? firstUserMsg.content.substring(0, 40) + '...' : 'Perplexity Handoff';
  }

  return {
    title,
    messages: filteredMessages,
    messageCount: filteredMessages.length,
    imageCount,
    fileCount,
    savedAt: new Date().toISOString(),
    startedAt: new Date().toISOString()
  };
};
