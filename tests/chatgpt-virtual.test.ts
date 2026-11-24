import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { scrapeChatGPT } from '../src/content/scrapers/chatgpt';

const png = 'data:image/png;base64,' + btoa('synthetic photo contents');
const webp = 'data:image/webp;base64,' + btoa('a different synthetic photo');
const placeholder = 'data:image/svg+xml;base64,' + btoa('<svg/>');

const renderTurn = (index: number) => {
  const role = index % 2 === 0 ? 'user' : 'assistant';
  const image = index === 0
    ? `<picture><source srcset="${png} 1x"><img src="${placeholder}" alt="profile photo.png"></picture>`
    : index === 10 ? `<img data-lazy-src="${webp}" alt="second.webp">` : '';
  return `<div data-message-author-role="${role}"><p>Message ${index + 1}</p></div>${image}`;
};

function mountVirtualizedChat(start: 'top' | 'bottom', unavailable?: number) {
  document.body.innerHTML = `<main><aside><section data-turn-id="sidebar" data-turn="user">Sidebar</section></aside>
    <div data-scroll-root id="thread">${Array.from({ length: 12 }, (_, i) =>
      `<section data-turn-id="turn-${i}" data-turn="${i % 2 === 0 ? 'user' : 'assistant'}" data-testid="conversation-turn-${i + 1}"></section>`
    ).join('')}</div></main>`;
  const scroller = document.querySelector<HTMLElement>('#thread')!;
  const shells = Array.from(scroller.querySelectorAll<HTMLElement>('section'));
  const renderRange = (start: number, count: number) => {
    shells.forEach((shell, i) => {
      shell.innerHTML = i >= start && i < start + count && i !== unavailable ? renderTurn(i) : '';
      for (const img of shell.querySelectorAll('img')) Object.defineProperty(img, 'complete', { value: true });
    });
  };
  const startingPosition = start === 'top' ? 0 : 800;
  scroller.scrollTop = startingPosition;
  renderRange(start === 'top' ? 0 : 4, start === 'top' ? 2 : 8);

  for (const [i, shell] of shells.entries()) {
    shell.scrollIntoView = vi.fn(() => {
      scroller.scrollTop = i * 100;
      setTimeout(() => renderRange(i, 2), 125);
    });
  }
  return { scroller, startingPosition };
}

beforeEach(() => {
  vi.useFakeTimers();
  document.title = 'ChatGPT test conversation';
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
  document.body.innerHTML = '';
});

describe('virtualized ChatGPT conversations', () => {
  it.each(['top', 'bottom'] as const)('saves all 12 messages and two images when starting at the %s', async start => {
    const { scroller, startingPosition } = mountVirtualizedChat(start);
    const job = scrapeChatGPT();
    await vi.runAllTimersAsync();
    const result = await job;
    expect(result.messages.map(message => message.content)).toEqual(Array.from({ length: 12 }, (_, i) => `Message ${i + 1}`));
    expect(result.imageCount).toBe(2);
    expect(result.messages[0].files).toEqual([{ name: 'profile photo.png', type: 'image/png', content: png }]);
    expect(result.messages[10].files).toEqual([{ name: 'second.webp', type: 'image/webp', content: webp }]);
    expect(scroller.scrollTop).toBe(startingPosition);
  });

  it('reports a missing message and restores the scroll position instead of returning a partial chat', async () => {
    const { scroller, startingPosition } = mountVirtualizedChat('bottom', 1);
    const job = scrapeChatGPT();
    const assertion = expect(job).rejects.toThrow('ChatGPT did not load message 2 of 12. Nothing was saved.');
    await vi.runAllTimersAsync();
    await assertion;
    expect(scroller.scrollTop).toBe(startingPosition);
  });

  it('stops if the active conversation changes during a scroll', async () => {
    mountVirtualizedChat('bottom');
    const job = scrapeChatGPT();
    const assertion = expect(job).rejects.toThrow('changed conversations');
    document.title = 'A different conversation';
    await vi.runAllTimersAsync();
    await assertion;
  });
});

describe('ChatGPT image capture', () => {
  it('keeps the transcript and flags an unavailable image when its URL returns HTML', async () => {
    document.body.innerHTML = '<main><div data-message-author-role="user">A picture <img src="https://example.test/photo.png" alt="photo.png"></div></main>';
    Object.defineProperty(document.querySelector('img'), 'complete', { value: true });
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('<html>Sign in</html>', { headers: { 'Content-Type': 'text/html' } })));
    const save = await scrapeChatGPT();
    expect(save.messages.map(message => message.content)).toEqual(['A picture']);
    expect(save.imageCount).toBe(0);
    expect(save.missingImageCount).toBe(1);
  });
});
