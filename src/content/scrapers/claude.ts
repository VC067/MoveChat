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
async function imageToBase64(img: HTMLImageElement, log: (s:string)=>void): Promise<string> {
  const src = img.getAttribute('src') || '';
  if (!src) return '';
  if (src.startsWith('data:')) {
    log('Image is already data URI');
    return src;
  }

  log(`Wait over. complete=${img.complete}, w=${img.naturalWidth}, h=${img.naturalHeight}`);

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
          log('Success: Canvas drawImage worked.');
          return dataUrl;
        } else {
          log('Canvas returned empty dataUrl.');
        }
      }
    } catch (e: any) {
      log(`Canvas tainted/failed: ${e.message}`);
    }
  } else {
    log('Skipped canvas due to 0x0 size');
  }

  // 2. Try direct fetch from content script
  try {
    const resp = await fetch(src, { credentials: 'include' });
    if (resp.ok) {
      const blob = await resp.blob();
      log(`Success: Content script fetch worked. Blob size=${blob.size}`);
      return await new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onloadend = () => resolve(reader.result as string);
        reader.onerror = reject;
        reader.readAsDataURL(blob);
      });
    } else {
      log(`Content script fetch failed with HTTP ${resp.status}`);
    }
  } catch (e: any) {
    log(`Content script fetch failed: ${e.message}`);
  }

  // 3. Background CORS proxy (with timeout)
  log('Trying Background CORS Proxy...');
  return new Promise((resolve) => {
    const timer = setTimeout(() => {
      log('Background proxy timed out after 5s');
      resolve('');
    }, 5000);
    chrome.runtime.sendMessage({ action: 'FETCH_IMAGE_BASE64', url: src }, (resp) => {
      clearTimeout(timer);
      if (resp && resp.base64 && resp.base64.length > 100) {
        log(`Success: Background proxy worked (len ${resp.base64.length})`);
        resolve(resp.base64);
      } else {
        log(`Failed: Background proxy returned empty or short base64`);
        resolve('');
      }
    });
  });
}

export const scrapeClaude = async (): Promise<any> => {
  const debugLogs: string[] = [];
  const log = (msg: string) => {
    const line = `[${new Date().toISOString()}] ${msg}`;
    debugLogs.push(line);
    console.log('[MoveChatDebug]', line);
  };

  log('Starting Claude scrape...');

  let rawMessageBlocks = document.querySelectorAll(
    '.font-user, .font-claude, [data-testid="user-message"], [data-testid="assistant-message"], .font-claude-response, .font-claude-message, .font-user-message'
  );

  if (rawMessageBlocks.length === 0) {
    const fallbackBlocks = document.querySelectorAll('.grid.grid-cols-1');
    if (fallbackBlocks.length === 0) {
      throw new Error('No messages found. Open a Claude chat and try again.');
    }
    rawMessageBlocks = fallbackBlocks;
  }

  // Deduplicate overlapping blocks: keep only the innermost blocks
  const uniqueBlocks = Array.from(rawMessageBlocks).filter(block => {
    const containsAnother = Array.from(rawMessageBlocks).some(other => other !== block && block.contains(other));
    return !containsAnother;
  });

  log(`Found ${rawMessageBlocks.length} raw blocks, reduced to ${uniqueBlocks.length} unique blocks`);

  // Pre-load all images in the page before scraping
  const allPageImages = Array.from(document.querySelectorAll('img')) as HTMLImageElement[];
  log(`Found ${allPageImages.length} <img> tags on page. Waiting for them to load...`);
  await Promise.all(allPageImages.map(img => waitForImageLoad(img, 3000)));
  log(`Finished waiting for images.`);

  const messages: Message[] = [];
  let imageCount = 0;
  let fileCount = 0;

  for (let i = 0; i < uniqueBlocks.length; i++) {
    const block = uniqueBlocks[i];
    let role: 'user' | 'assistant' = 'user';
    const isAssistant = block.classList.contains('font-claude') || 
                        block.classList.contains('font-claude-response') ||
                        block.classList.contains('font-claude-message') ||
                        block.getAttribute('data-testid') === 'assistant-message' ||
                        block.querySelector('[class*="claude-avatar"]') !== null;
    if (isAssistant) {
      role = 'assistant';
    }

    const contentNode = block.querySelector('.prose') || block;
    const text = elementToMarkdown(contentNode);

    const files: AttachedFile[] = [];

    // Find the highest container that only contains THIS message block
    let current = block.parentElement;
    let messageContainer = block as HTMLElement;
    while (current && current !== document.body) {
      const containsOther = uniqueBlocks.some(b => b !== block && current!.contains(b));
      if (containsOther) break;
      messageContainer = current;
      current = current.parentElement;
    }

    // Collect images from the robust message container
    const imgSet = new Set<HTMLImageElement>();
    messageContainer.querySelectorAll('img').forEach(img => imgSet.add(img as HTMLImageElement));

    log(`Block ${i} (${role}): Found ${imgSet.size} images in robust container`);

    for (const img of Array.from(imgSet)) {
      const src = img.getAttribute('src') || '';
      const alt = img.getAttribute('alt') || '';
      log(`  Checking img: src=${src.substring(0, 80)}... alt=${alt}`);

      // Skip avatars/profile icons
      const isAvatarOrProfile =
        src.includes('profile') ||
        src.includes('avatar') ||
        src.includes('logo') ||
        alt.toLowerCase().includes('avatar') ||
        alt.toLowerCase().includes('profile') ||
        img.closest('[class*="avatar"]') !== null;

      if (isAvatarOrProfile) {
        log(`  -> Skipped as avatar`);
        continue;
      }

      if (src) {
        const base64 = await imageToBase64(img, log);
        if (base64 && base64.length > 100) {
          const isDup = files.some(f => f.content === base64);
          if (!isDup) {
            log(`  -> ADDED IMAGE to payload`);
            files.push({
              name: alt || `claude-image-${imageCount + 1}.png`,
              type: 'image/png',
              content: base64
            });
            imageCount++;
          } else {
            log(`  -> Skipped as duplicate`);
          }
        } else {
          log(`  -> FAILED to get valid base64`);
        }
      }
    }

    // Collect document/file pills
    const pillSet = new Set<HTMLElement>();
    messageContainer.querySelectorAll('[class*="file"], [class*="attachment"], [class*="UploadPill"]')
      .forEach(p => pillSet.add(p as HTMLElement));

    for (const pill of Array.from(pillSet)) {
      const fileName = pill.textContent || 'Uploaded Document';
      const cleanedName = fileName.replace(/[\n\r]+/g, ' ').trim();
      if (cleanedName && !files.some(f => f.name === cleanedName)) {
        files.push({
          name: cleanedName,
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

  let title = document.title || 'Claude Handoff';
  if (title === 'Claude' || title.trim() === '') {
    const firstUserMsg = messages.find(m => m.role === 'user');
    title = firstUserMsg ? firstUserMsg.content.substring(0, 40) + '...' : 'Claude Handoff';
  }

  // Inject debug log as a file attachment to the first message
  if (messages.length > 0) {
    if (!messages[0].files) messages[0].files = [];
    const btoaSafe = (str: string) => btoa(encodeURIComponent(str).replace(/%([0-9A-F]{2})/g, (_, p1) => String.fromCharCode(parseInt(p1, 16))));
    messages[0].files.push({
      name: 'debug_log.txt',
      type: 'text/plain',
      content: 'data:text/plain;base64,' + btoaSafe(debugLogs.join('\n'))
    });
    fileCount++;
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
