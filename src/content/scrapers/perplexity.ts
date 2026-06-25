import type { Message, AttachedFile } from '../../shared/types';
import { elementToMarkdown } from '../dom';

async function toBase64(url: string): Promise<string> {
  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 5000);
    const resp = await fetch(url, { signal: controller.signal });
    clearTimeout(timer);
    const blob = await resp.blob();
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onloadend = () => resolve(reader.result as string);
      reader.onerror = reject;
      reader.readAsDataURL(blob);
    });
  } catch (err) {
    console.error('[MoveChat] Image conversion failed:', err);
    return '';
  }
}

export const scrapePerplexity = async (): Promise<any> => {
  const messages: Message[] = [];
  let imageCount = 0;
  let fileCount = 0;

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
        const src = img.getAttribute('src') || '';
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
          if (src.startsWith('data:')) {
            files.push({
              name: alt || `perplexity-image-${imageCount + 1}.png`,
              type: 'image/png',
              content: src
            });
            imageCount++;
          } else {
            const base64 = await toBase64(src);
            if (base64) {
              files.push({
                name: alt || `perplexity-image-${imageCount + 1}.png`,
                type: 'image/png',
                content: base64
              });
              imageCount++;
            }
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
        if (text) {
          messages.push({ role: 'user', content: text });
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
          const src = img.getAttribute('src') || '';
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
            if (src.startsWith('data:')) {
              files.push({
                name: alt || `perplexity-image-${imageCount + 1}.png`,
                type: 'image/png',
                content: src
              });
              imageCount++;
            } else {
              const base64 = await toBase64(src);
              if (base64) {
                files.push({
                  name: alt || `perplexity-image-${imageCount + 1}.png`,
                  type: 'image/png',
                  content: base64
                });
                imageCount++;
              }
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
