import type { Message, AttachedFile } from '../../shared/types';
import { elementToMarkdown } from '../dom';

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

async function imageToBase64(img: HTMLImageElement): Promise<string> {
  const src = img.getAttribute('src') || '';
  if (!src) return '';
  if (src.startsWith('data:')) return src;

  if (img.naturalWidth > 0 && img.naturalHeight > 0 && img.naturalWidth < 48 && img.naturalHeight < 48) {
    return '';
  }

  await waitForImageLoad(img);

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
      // Tainted canvas
    }
  }

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
    // Cross-origin blocked
  }

  return new Promise((resolve) => {
    const timer = setTimeout(() => resolve(''), 5000);
    chrome.runtime.sendMessage({ action: 'FETCH_IMAGE_BASE64', url: src }, (resp) => {
      clearTimeout(timer);
      resolve(resp?.base64 || '');
    });
  });
}

function waitForRender(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

export const scrapeDeepSeek = async (
  onProgress?: (current: number, total: number, step: string) => void
): Promise<any> => {
  onProgress?.(0, 1, 'Finding scroll container...');

  const scrollContainer = document.querySelector('div.ds-virtual-list') as HTMLElement | null;
  if (!scrollContainer) {
    throw new Error('Could not find the DeepSeek conversation container. Are you in a chat?');
  }

  const collectedMessages = new Map<string, { element: HTMLElement; index: number }>();
  let messageIndex = 0;

  const collectVisible = () => {
    const items = document.querySelectorAll('div[data-virtual-list-item-key]');
    items.forEach(item => {
      const key = item.getAttribute('data-virtual-list-item-key');
      if (!key) return;
      if (collectedMessages.has(key)) return;

      const findMessageEl = (): HTMLElement | null =>
        (item.querySelector('div.ds-message') as HTMLElement | null) ||
        (item.querySelector('.ds-assistant-message-main-content') as HTMLElement | null) ||
        (item.querySelector('div.ds-collapsible-text') as HTMLElement | null) ||
        (item.querySelector('div.ds-markdown') as HTMLElement | null) ||
        ((item as HTMLElement)?.classList.contains('ds-message') ? (item as HTMLElement) : null);

      const msgEl = findMessageEl();
      if (!msgEl) return;

      collectedMessages.set(key, { element: msgEl, index: messageIndex });
      messageIndex++;
    });
  };

  const savedScrollTop = scrollContainer.scrollTop;
  const savedScrollBehavior = scrollContainer.style.scrollBehavior;

  onProgress?.(0, 1, 'Scrolling to top...');
  scrollContainer.scrollTop = 0;
  await waitForRender(400);
  collectVisible();

  const viewportHeight = scrollContainer.clientHeight;

  onProgress?.(0, 1, 'Scrolling through conversation...');

  let scrollStep = 0;
  let lastCount = -1;
  let stagnantPasses = 0;
  const MAX_STAGNANT_PASSES = 3;
  const MAX_STEPS = 2000;

  while (scrollStep < MAX_STEPS) {
    scrollStep++;
    scrollContainer.scrollTop += viewportHeight;
    if (scrollContainer.scrollTop + viewportHeight >= scrollContainer.scrollHeight) {
      scrollContainer.scrollTop = scrollContainer.scrollHeight;
    }
    await waitForRender(300);
    collectVisible();

    const totalMessages = collectedMessages.size;
    if (totalMessages === lastCount) {
      stagnantPasses++;
    } else {
      stagnantPasses = 0;
      lastCount = totalMessages;
    }

    const totalHeight = scrollContainer.scrollHeight;
    const steps = Math.max(1, Math.ceil(totalHeight / Math.max(viewportHeight, 1)));
    onProgress?.(Math.min(scrollStep, steps), steps, `Found ${totalMessages} messages so far...`);

    const atBottom = scrollContainer.scrollTop + scrollContainer.clientHeight >= scrollContainer.scrollHeight - 10;
    if (atBottom && stagnantPasses >= MAX_STAGNANT_PASSES) break;
  }

  for (let k = 0; k < 4; k++) {
    scrollContainer.scrollTop = scrollContainer.scrollHeight;
    await waitForRender(400);
    collectVisible();
  }

  scrollContainer.scrollTop = savedScrollTop;
  if (savedScrollBehavior) {
    scrollContainer.style.scrollBehavior = savedScrollBehavior;
  }

  const totalFound = collectedMessages.size;
  if (totalFound === 0) {
    throw new Error('No messages found. Are you inside an active DeepSeek conversation?');
  }

  onProgress?.(0, totalFound, 'Loading images...');

  const allPageImages = Array.from(document.querySelectorAll('img')) as HTMLImageElement[];
  await Promise.all(allPageImages.map(img => waitForImageLoad(img, 2000)));

  const sortedEntries = Array.from(collectedMessages.entries())
    .sort((a, b) => {
      const ka = parseInt(a[0], 10);
      const kb = parseInt(b[0], 10);
      if (!isNaN(ka) && !isNaN(kb)) return ka - kb;
      return a[1].index - b[1].index;
    });

  const messages: Message[] = [];
  let imageCount = 0;
  let fileCount = 0;

  for (let i = 0; i < sortedEntries.length; i++) {
    const { element: msgEl } = sortedEntries[i][1];
    onProgress?.(i + 1, sortedEntries.length, `Processing message ${i + 1}/${sortedEntries.length}...`);

    const isAssistant = msgEl.querySelector('.ds-assistant-message-main-content') !== null ||
      msgEl.querySelector('.ds-markdown.ds-assistant-message-main-content') !== null;
    const role: 'user' | 'assistant' = isAssistant ? 'assistant' : 'user';

    let thinking = '';
    if (isAssistant) {
      const thinkBlocks = msgEl.querySelectorAll('div.ds-think-content');
      thinkBlocks.forEach((block, bi) => {
        const part = elementToMarkdown(block as HTMLElement).trim();
        if (!part) return;
        thinking += (bi > 0 ? '\n\n' : '') + part;
      });
    }

    let contentNode: HTMLElement | null = null;
    if (isAssistant) {
      contentNode = msgEl.querySelector('.ds-assistant-message-main-content') as HTMLElement | null;
    }
    if (!contentNode) {
      contentNode = msgEl.querySelector('.ds-markdown') as HTMLElement | null;
    }
    if (!contentNode) {
      contentNode = msgEl.querySelector('.ds-collapsible-text') as HTMLElement | null;
    }
    if (!contentNode) {
      contentNode = msgEl;
    }

    const text = elementToMarkdown(contentNode);

    const files: AttachedFile[] = [];

    let current = msgEl.parentElement;
    let messageContainer = msgEl as HTMLElement;
    while (current && current !== document.body) {
      const isMessageWrapper = current.hasAttribute('data-virtual-list-item-key');
      if (isMessageWrapper && current !== msgEl.closest('[data-virtual-list-item-key]')) break;
      if (current.classList.contains('ds-virtual-list')) break;
      messageContainer = current;
      current = current.parentElement;
    }

    const imgSet = new Set<HTMLImageElement>();
    messageContainer.querySelectorAll('img').forEach(img => {
      const htmlImg = img as HTMLImageElement;
      imgSet.add(htmlImg);
    });

    for (const img of Array.from(imgSet)) {
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
              name: alt || `deepseek-image-${imageCount + 1}.png`,
              type: 'image/png',
              content: base64
            });
            imageCount++;
          }
        }
      }
    }

    const filePills = messageContainer.querySelectorAll('[class*="attachment"], [class*="file-pill"], a[download]');
    for (const pill of Array.from(filePills)) {
      const fileName = pill.textContent || 'attachment';
      const cleanedName = fileName.trim();
      if (cleanedName && !files.some(f => f.name === cleanedName)) {
        files.push({
          name: cleanedName,
          type: 'application/octet-stream',
        });
        fileCount++;
      }
    }

    if (text.trim() || files.length > 0) {
      const msg: Message = {
        role,
        content: text.trim(),
        files: files.length > 0 ? files : undefined
      };
      if (thinking) {
        msg.thinking = thinking;
      }
      messages.push(msg);
    }
  }

  let title = document.title || 'DeepSeek Handoff';
  if (title === 'DeepSeek' || title === 'DeepSeek Chat' || title.trim() === '') {
    const firstUserMsg = messages.find(m => m.role === 'user');
    title = firstUserMsg ? firstUserMsg.content.substring(0, 40) + '...' : 'DeepSeek Handoff';
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
