import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const { scrape, storage } = vi.hoisted(() => ({ scrape: vi.fn(), storage: vi.fn() }));
vi.mock('../src/content/scrapers/chatgpt', () => ({ scrapeChatGPT: scrape }));
vi.mock('../src/content/scrapers/claude', () => ({ scrapeClaude: vi.fn() }));
vi.mock('../src/content/scrapers/gemini', () => ({ scrapeGemini: vi.fn() }));
vi.mock('../src/content/scrapers/perplexity', () => ({ scrapePerplexity: vi.fn() }));
vi.mock('../src/content/scrapers/deepseek', () => ({ scrapeDeepSeek: vi.fn() }));
vi.mock('../src/content/injectors/chatgpt', () => ({ injectChatGPT: vi.fn() }));
vi.mock('../src/content/injectors/claude', () => ({ injectClaude: vi.fn() }));
vi.mock('../src/content/injectors/gemini', () => ({ injectGemini: vi.fn() }));
vi.mock('../src/content/injectors/perplexity', () => ({ injectPerplexity: vi.fn() }));
vi.mock('../src/content/injectors/deepseek', () => ({ injectDeepSeek: vi.fn() }));
vi.mock('../src/content/storage', () => ({ getStorage: storage, setStorage: vi.fn() }));

const connectListeners = new Set<(port: chrome.runtime.Port) => void>();
const messageListeners = new Set<unknown>();
const lifecycle = globalThis as typeof globalThis & { __movechatDisposeContent?: () => void };
let pageUrl = { href: 'https://chatgpt.com/c/test-a', hostname: 'chatgpt.com' };
const payload = { title: 'Test A', messages: [{ role: 'user', content: 'Test A marker' }], messageCount: 1, imageCount: 0, fileCount: 0 };

const makePort = () => {
  const disconnect = new Set<() => void>();
  return {
    name: 'movechat-scrape',
    postMessage: vi.fn(),
    onDisconnect: { addListener: (listener: () => void) => disconnect.add(listener), removeListener: (listener: () => void) => disconnect.delete(listener) },
    fireDisconnect: () => disconnect.forEach(listener => listener()),
  };
};
const connect = (port: ReturnType<typeof makePort>) => connectListeners.forEach(listener => listener(port as unknown as chrome.runtime.Port));

beforeEach(() => {
  lifecycle.__movechatDisposeContent?.();
  delete lifecycle.__movechatDisposeContent;
  vi.resetModules();
  connectListeners.clear();
  messageListeners.clear();
  scrape.mockReset().mockResolvedValue(payload);
  storage.mockReset().mockResolvedValue(null);
  document.title = 'Test A';
  pageUrl = { href: 'https://chatgpt.com/c/test-a', hostname: 'chatgpt.com' };
  vi.stubGlobal('window', { location: pageUrl });
  vi.stubGlobal('chrome', {
    runtime: {
      onConnect: { addListener: (listener: (port: chrome.runtime.Port) => void) => connectListeners.add(listener), removeListener: (listener: (port: chrome.runtime.Port) => void) => connectListeners.delete(listener) },
      onMessage: { addListener: (listener: unknown) => messageListeners.add(listener), removeListener: (listener: unknown) => messageListeners.delete(listener) },
    },
  });
});

afterEach(() => {
  lifecycle.__movechatDisposeContent?.();
  delete lifecycle.__movechatDisposeContent;
  vi.unstubAllGlobals();
});

describe('content capture protocol', () => {
  it('includes the source page identity in the result', async () => {
    await import('../src/content/index');
    const port = makePort();
    connect(port);
    await vi.waitFor(() => expect(port.postMessage).toHaveBeenCalled());
    expect(port.postMessage).toHaveBeenCalledWith({
      type: 'result', sourceUrl: 'https://chatgpt.com/c/test-a', sourceTitle: 'Test A',
      session: { ...payload, platform: 'chatgpt', sourceUrl: 'https://chatgpt.com/c/test-a' },
    });
  });

  it('returns an error instead of relabelling results after navigation', async () => {
    let finish!: (value: typeof payload) => void;
    scrape.mockImplementation(() => new Promise(resolve => { finish = resolve; }));
    await import('../src/content/index');
    const port = makePort();
    connect(port);
    pageUrl.href = 'https://chatgpt.com/c/test-b';
    document.title = 'Test B';
    finish(payload);
    await vi.waitFor(() => expect(port.postMessage).toHaveBeenCalled());
    expect(port.postMessage).toHaveBeenCalledWith(expect.objectContaining({ type: 'error', error: expect.stringContaining('Nothing was saved') }));
    expect(port.postMessage).not.toHaveBeenCalledWith(expect.objectContaining({ type: 'result' }));
  });

  it('replaces listeners when injected twice, instead of running two captures', async () => {
    await import('../src/content/index');
    vi.resetModules();
    await import('../src/content/index');
    expect(connectListeners.size).toBe(1);
    expect(messageListeners.size).toBe(1);
    const port = makePort();
    connect(port);
    await vi.waitFor(() => expect(port.postMessage).toHaveBeenCalled());
    expect(scrape).toHaveBeenCalledOnce();
    expect(port.postMessage).toHaveBeenCalledOnce();
  });

  it('does not post a late result to a disconnected popup', async () => {
    let finish!: (value: typeof payload) => void;
    scrape.mockImplementation(() => new Promise(resolve => { finish = resolve; }));
    await import('../src/content/index');
    const port = makePort();
    connect(port);
    port.fireDisconnect();
    finish(payload);
    await Promise.resolve();
    await Promise.resolve();
    await Promise.resolve();
    expect(port.postMessage).not.toHaveBeenCalled();
  });
});
