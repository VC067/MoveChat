import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { scrapeChatGPT } from '../src/content/scrapers/chatgpt';

const oldChat = '<div data-message-author-role="user"><div class="whitespace-pre-wrap">OTHER CHAT — NEVER EXPORT</div></div>';
const pythonChat = '<div data-user-message-bubble>Explain Python.</div><div data-assistant-markdown-root><p>Python answer.</p><pre><code class="language-python">def test():\n    return 1</code></pre></div>';
const path = window.location.pathname;

beforeEach(() => {
  document.title = 'Python conversation';
  document.body.innerHTML = '';
  window.history.replaceState({}, '', '/c/python-test');
});

afterEach(() => {
  document.body.innerHTML = '';
  window.history.replaceState({}, '', path);
});

describe('active ChatGPT conversation isolation', () => {
  it('ignores a hidden previous main and captures the current roleless layout', async () => {
    document.body.innerHTML = `<main style="display:none">${oldChat.repeat(5)}</main><main>${pythonChat}<div id="prompt-textarea" contenteditable="true"></div></main>`;
    const result = await scrapeChatGPT();
    expect(result.title).toBe('Python conversation');
    expect(result.messages.map(message => message.role)).toEqual(['user', 'assistant']);
    expect(result.messages[0].content).toBe('Explain Python.');
    expect(result.messages[1].content).toContain('    return 1');
    expect(JSON.stringify(result)).not.toContain('OTHER CHAT');
  });

  it('never falls back outside a visible main just because its layout is unrecognized', async () => {
    document.body.innerHTML = `${oldChat}<main><p>Unrecognized current layout.</p></main>`;
    await expect(scrapeChatGPT()).rejects.toThrow('No messages found');
  });

  it.each(['hidden', 'inert', 'aria-hidden="true"', 'style="display:none"', 'style="visibility:hidden"', 'style="content-visibility:hidden"'])('ignores previous conversations marked %s', async attribute => {
    document.body.innerHTML = `<main><section ${attribute}>${oldChat}</section>${pythonChat}</main>`;
    const result = await scrapeChatGPT();
    expect(result.messageCount).toBe(2);
    expect(JSON.stringify(result)).not.toContain('OTHER CHAT');
  });

  it('ignores sidebar and dialog results in older pages without a main landmark', async () => {
    document.body.innerHTML = `<aside>${oldChat}</aside><nav>${oldChat}</nav><div role="dialog">${oldChat}</div><section>${pythonChat}</section>`;
    const result = await scrapeChatGPT();
    expect(result.messageCount).toBe(2);
    expect(JSON.stringify(result)).not.toContain('OTHER CHAT');
  });

  it('ignores the composer, including draft text with message-like classes', async () => {
    document.body.innerHTML = `<main>${pythonChat}<div id="prompt-textarea" contenteditable="true"><div class="whitespace-pre-wrap">UNSENT DRAFT</div></div></main>`;
    const result = await scrapeChatGPT();
    expect(result.messageCount).toBe(2);
    expect(JSON.stringify(result)).not.toContain('UNSENT DRAFT');
  });

  it('keeps off-screen earlier turns from the same visible conversation', async () => {
    document.body.innerHTML = `<main><section style="position:relative;top:-20000px"><div data-message-role="user">Earlier Python question.</div></section>${pythonChat}</main>`;
    const result = await scrapeChatGPT();
    expect(result.messageCount).toBe(3);
    expect(result.messages[0].content).toBe('Earlier Python question.');
  });

  it('refuses ambiguous visible main roots rather than combining chats', async () => {
    document.body.innerHTML = `<main>${oldChat}</main><main>${pythonChat}</main>`;
    await expect(scrapeChatGPT()).rejects.toThrow('Cannot identify the active');
  });

  it('does not export a hidden-only page', async () => {
    document.body.innerHTML = `<main hidden>${oldChat}</main>`;
    await expect(scrapeChatGPT()).rejects.toThrow('Cannot identify the active');
  });

  it('rejects a chat navigation during capture', async () => {
    document.body.innerHTML = `<main>${pythonChat}</main>`;
    await expect(scrapeChatGPT((_current, _total, step) => {
      if (step.startsWith('Processing')) window.history.replaceState({}, '', '/c/different-chat');
    })).rejects.toThrow('changed conversations');
  });

  it('rejects title changes rather than attaching the new title to old messages', async () => {
    document.body.innerHTML = `<main>${pythonChat}</main>`;
    await expect(scrapeChatGPT((_current, _total, step) => {
      if (step.startsWith('Processing')) document.title = 'Different conversation';
    })).rejects.toThrow('changed conversations');
  });

  it('rejects DOM replacement even if the title and address did not change yet', async () => {
    document.body.innerHTML = `<main>${pythonChat}</main>`;
    await expect(scrapeChatGPT((_current, _total, step) => {
      if (step.startsWith('Processing')) document.querySelector('main')!.innerHTML = oldChat;
    })).rejects.toThrow('replaced the conversation');
  });

  it('rejects reused message elements whose text changes before the route/title updates', async () => {
    document.body.innerHTML = '<main><div data-message-role="user">Python question</div><div data-message-role="assistant"><div class="markdown">Python answer</div></div></main>';
    await expect(scrapeChatGPT((_current, _total, step) => {
      if (step.startsWith('Processing')) document.querySelector('.markdown')!.textContent = 'OTHER CHAT — NEVER EXPORT';
    })).rejects.toThrow('Nothing was saved');
  });

  it('allows fragment-only changes within the same conversation', async () => {
    document.body.innerHTML = `<main>${pythonChat}</main>`;
    const result = await scrapeChatGPT((_current, _total, step) => {
      if (step.startsWith('Processing')) window.history.replaceState({}, '', '/c/python-test#message');
    });
    expect(result.messageCount).toBe(2);
  });
});
