// @vitest-environment jsdom
import { describe, expect, it, beforeEach } from 'vitest';
import { scrapeChatGPT } from '../src/content/scrapers/chatgpt';

const dataUrl = (label: string): string =>
  `data:image/png;base64,AA${label}${'A'.repeat(160)}`;

const mount = (html: string): void => {
  document.body.innerHTML = html;
  document.title = 'ChatGPT';
  // jsdom never finishes loading images; the scraper's dataURL path only
  // needs img.complete to be true (canvas is skipped in that path).
  for (const img of document.querySelectorAll('img')) {
    Object.defineProperty(img, 'complete', {
      value: true,
      configurable: true,
    });
  }
};

beforeEach(() => {
  document.body.innerHTML = '';
  document.title = '';
});

describe('scrapeChatGPT', () => {
  it('scrapes the legacy data-message-author-role layout', async () => {
    mount(`
      <div data-testid="conversation-turn-1">
        <div data-message-author-role="user">
          <div class="whitespace-pre-wrap">Hello there</div>
        </div>
      </div>
      <div data-testid="conversation-turn-2">
        <div data-message-author-role="assistant">
          <div class="markdown"><p>General greeting</p></div>
        </div>
      </div>
    `);

    const result = await scrapeChatGPT();
    expect(result.messages).toHaveLength(2);
    expect(result.messages.map(m => m.role)).toEqual(['user', 'assistant']);
    expect(result.messages[0].content).toBe('Hello there');
    expect(result.messages[1].content).toBe('General greeting');
  });

  it('scrapes the newer data-message-role list layout', async () => {
    mount(`
      <ul>
        <li data-message-role="user">
          <div><div class="whitespace-pre-wrap">What is MoveChat?</div></div>
        </li>
        <li data-message-role="assistant">
          <div><div class="markdown"><p>A browser extension for handoff.</p></div></div>
        </li>
      </ul>
    `);

    const result = await scrapeChatGPT();
    expect(result.messages).toHaveLength(2);
    expect(result.messages.map(m => m.role)).toEqual(['user', 'assistant']);
    expect(result.messages[0].content).toBe('What is MoveChat?');
    expect(result.messages[1].content).toBe('A browser extension for handoff.');
  });

  it('scrapes the data-content-search-unit-key layout with role suffix', async () => {
    mount(`
      <main>
        <div data-content-search-unit-key="turn-0:1:user">First question</div>
        <div data-content-search-unit-key="turn-0:2:assistant">First answer</div>
      </main>
    `);

    const result = await scrapeChatGPT();
    expect(result.messages).toHaveLength(2);
    expect(result.messages.map(m => m.role)).toEqual(['user', 'assistant']);
    expect(result.messages[0].content).toBe('First question');
    expect(result.messages[1].content).toBe('First answer');
  });

  it('deduplicates nested role containers into a single message', async () => {
    mount(`
      <li data-message-role="user">
        <div data-message-author-role="user">
          <div class="whitespace-pre-wrap">Hello there</div>
        </div>
      </li>
    `);

    const result = await scrapeChatGPT();
    expect(result.messages).toHaveLength(1);
    expect(result.messages[0].role).toBe('user');
    expect(result.messages[0].content).toBe('Hello there');
  });

  it('ignores unrelated status/tool/system metadata without suppressing roles', async () => {
    mount(`
      <ul>
        <li data-message-role="user">Using the tool list?</li>
        <li data-message-role="status">Searching the web…</li>
        <li data-message-role="tool">len(sites) = 5</li>
        <li data-message-role="assistant">Here is the answer.</li>
      </ul>
      <div data-message-author-role="system">You are a helpful assistant.</div>
      <div data-message-author-role="user">Do the thing.</div>
    `);

    const result = await scrapeChatGPT();
    expect(result.messages.map(m => m.role)).toEqual(['user', 'assistant', 'user']);
    expect(result.messages.map(m => m.content))
      .toEqual(['Using the tool list?', 'Here is the answer.', 'Do the thing.']);
    expect(result.messageCount).toBe(3);
  });

  it('keeps mixed layouts (legacy turn + new li on one page) in order', async () => {
    mount(`
      <main>
        <div data-testid="conversation-turn-1">
          <div data-message-author-role="user">
            <div class="whitespace-pre-wrap">Legacy style</div>
          </div>
        </div>
        <ul>
          <li data-message-role="assistant">
            <div><div class="markdown"><p>New style</p></div></div>
          </li>
        </ul>
      </main>
    `);

    const result = await scrapeChatGPT();
    expect(result.messages.map(m => m.role)).toEqual(['user', 'assistant']);
    expect(result.messages[0].content).toBe('Legacy style');
    expect(result.messages[1].content).toBe('New style');
  });

  it('preserves the conversation order of alternating roles', async () => {
    mount(`
      <ul>
        <li data-message-role="user">One</li>
        <li data-message-role="assistant">Two</li>
        <li data-message-role="user">Three</li>
      </ul>
    `);

    const result = await scrapeChatGPT();
    expect(result.messages.map(m => m.role)).toEqual(['user', 'assistant', 'user']);
    expect(result.messages.map(m => m.content)).toEqual(['One', 'Two', 'Three']);
  });

  it('keeps image-only messages that have no text', async () => {
    mount(`
      <li data-message-role="user">
        <div><img src="${dataUrl('img1')}" alt=""></div>
      </li>
    `);

    const result = await scrapeChatGPT();
    expect(result.messages).toHaveLength(1);
    expect(result.messages[0].role).toBe('user');
    expect(result.messages[0].content).toBe('');
    expect(result.messages[0].files).toHaveLength(1);
    expect(result.messages[0].files[0].content).toBe(dataUrl('img1'));
    expect(result.messages[0].files[0].name).toBe('image-1.png');
    expect(result.imageCount).toBe(1);
  });

  it('includes attachment images adjacent inside the same list item', async () => {
    mount(`
      <li data-message-role="user">
        <div data-message-author-role="user">
          <div class="whitespace-pre-wrap">Check this screenshot</div>
        </div>
        <div><img src="${dataUrl('adj')}" alt="screenshot.png"></div>
      </li>
    `);

    const result = await scrapeChatGPT();
    expect(result.messages).toHaveLength(1);
    expect(result.messages[0].content).toBe('Check this screenshot');
    expect(result.messages[0].files).toHaveLength(1);
    expect(result.messages[0].files[0].name).toBe('screenshot.png');
    expect(result.messages[0].files[0].content).toBe(dataUrl('adj'));
  });

  it('does not assign attachments from a neighbouring list item', async () => {
    mount(`
      <ul>
        <li data-message-role="user">
          <div class="whitespace-pre-wrap">Neighbor check</div>
        </li>
        <li>
          <div class="attachment"><img src="${dataUrl('orphan')}" alt="orphan.png"></div>
        </li>
      </ul>
    `);

    const result = await scrapeChatGPT();
    expect(result.messages).toHaveLength(1);
    expect(result.messages[0].content).toBe('Neighbor check');
    expect(result.messages[0].files).toBeUndefined();
    expect(result.imageCount).toBe(0);
  });

  it('captures document-only attachments via file pills', async () => {
    mount(`
      <li data-message-role="user">
        <div class="whitespace-pre-wrap">See attachment</div>
        <div class="file-pill"><a download href="#">report.pdf</a></div>
      </li>
    `);

    const result = await scrapeChatGPT();
    expect(result.messages).toHaveLength(1);
    expect(result.messages[0].role).toBe('user');
    expect(result.messages[0].content).toBe('See attachment');
    expect(result.messages[0].files).toHaveLength(1);
    expect(result.messages[0].files[0].name).toBe('report.pdf');
    expect(result.messages[0].files[0].type).toBe('application/octet-stream');
    expect(result.messages[0].files[0].content).toBeUndefined();
    expect(result.fileCount).toBe(1);
    expect(result.imageCount).toBe(0);
  });

  it('prefers the broad assistant markdown root over a tiny nested .markdown', async () => {
    mount(`
      <li data-message-role="assistant">
        <div data-assistant-markdown-root>
          <p>Alpha</p>
          <div class="markdown">Beta</div>
        </div>
      </li>
    `);

    const result = await scrapeChatGPT();
    expect(result.messages).toHaveLength(1);
    expect(result.messages[0].role).toBe('assistant');
    expect(result.messages[0].content).toContain('Alpha');
    expect(result.messages[0].content).toContain('Beta');
  });

  it('falls back to conversation-turn test IDs when no role attribute exists', async () => {
    mount(`
      <div data-testid="conversation-turn-1">
        <div class="markdown"><p>Assistant text</p></div>
      </div>
      <div data-testid="conversation-turn-2">
        <div class="whitespace-pre-wrap">User text</div>
      </div>
    `);

    const result = await scrapeChatGPT();
    expect(result.messages).toHaveLength(2);
    expect(result.messages.map(m => m.role)).toEqual(['assistant', 'user']);
    expect(result.messages[0].content).toBe('Assistant text');
    expect(result.messages[1].content).toBe('User text');
  });

  it('throws a clear error when no messages are present', async () => {
    mount('<div><p>not a chat session</p></div>');
    await expect(scrapeChatGPT()).rejects.toThrow('No messages found. Are you in a chat session?');
  });

  it('includes unlabelled turns alongside role-bearing messages', async () => {
    mount('<main><article data-testid="conversation-turn-0"><div data-message-role="user"><div class="whitespace-pre-wrap">Question</div></div></article><article data-testid="conversation-turn-1"><div class="markdown">Answer</div></article></main>');
    const result = await scrapeChatGPT();
    expect(result.messages.map(m => [m.role, m.content])).toEqual([['user', 'Question'], ['assistant', 'Answer']]);
  });

  it('does not mistake status metadata for a fallback message', async () => {
    mount('<aside data-message-role="status">Online</aside><article data-testid="conversation-turn-0"><div class="whitespace-pre-wrap">Question</div></article><article data-testid="conversation-turn-1"><div class="markdown">Answer</div></article>');
    const result = await scrapeChatGPT();
    expect(result.messages.map(m => [m.role, m.content])).toEqual([['user', 'Question'], ['assistant', 'Answer']]);
  });

  it('retains multiple independent assistant Markdown sections', async () => {
    mount('<div data-message-role="assistant"><div class="markdown">Introduction</div><div class="markdown"><pre><code class="language-python">print(1)</code></pre></div><div class="markdown">Conclusion</div></div>');
    const result = await scrapeChatGPT();
    expect(result.messages[0].content).toContain('Introduction');
    expect(result.messages[0].content).toContain('```python\nprint(1)\n```');
    expect(result.messages[0].content).toContain('Conclusion');
  });

  it('does not invent a document for an empty image attachment wrapper', async () => {
    mount(`<li data-message-role="user"><div class="attachment"><img src="${dataUrl('only')}" alt="screenshot.png"></div></li>`);
    const result = await scrapeChatGPT();
    expect(result.imageCount).toBe(1);
    expect(result.fileCount).toBe(0);
    expect(result.messages[0].files).toHaveLength(1);
  });

  it('retains lazy image URLs and gives repeated image names unique export paths', async () => {
    mount(`<li data-message-role="user"><img data-src="${dataUrl('first')}" alt="screenshot.png"></li><li data-message-role="user"><img src="${dataUrl('second')}" alt="screenshot.png"></li>`);
    const result = await scrapeChatGPT();
    expect(result.imageCount).toBe(2);
    expect(result.messages[0].files?.[0].name).toBe('screenshot.png');
    expect(result.messages[1].files?.[0].name).toBe('screenshot-2.png');
  });

  it('does not duplicate sibling attachments when two roles share a turn', async () => {
    mount(`<article data-testid="conversation-turn-0"><img src="${dataUrl('shared')}" alt="screenshot.png"><div data-message-role="user"><div class="whitespace-pre-wrap">Question</div></div><div data-message-role="assistant"><div class="markdown">Answer</div></div></article>`);
    const result = await scrapeChatGPT();
    expect(result.imageCount).toBe(1);
    expect(result.messages[0].files?.[0].name).toBe('screenshot.png');
    expect(result.messages[1].files).toBeUndefined();
  });
});
