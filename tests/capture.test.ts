// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { captureTab, captureCurrentTab } from '../src/popup/capture';
import type { Session } from '../src/shared/types';

type Listener = (arg?: unknown) => void;

interface FakePort {
  name: string;
  onMessage: { addListener: (l: Listener) => void; removeListener: (l: Listener) => void };
  onDisconnect: { addListener: (l: Listener) => void; removeListener: (l: Listener) => void };
  postMessage: ReturnType<typeof vi.fn>;
  disconnect: ReturnType<typeof vi.fn>;
  __emitMessage: (msg: unknown) => void;
  __emitDisconnect: (lastError?: string) => void;
}

const makeFakePort = (name = 'movechat-scrape'): FakePort => {
  const messageListeners = new Set<Listener>();
  const disconnectListeners = new Set<Listener>();
  return {
    name,
    onMessage: {
      addListener: l => messageListeners.add(l),
      removeListener: l => messageListeners.delete(l),
    },
    onDisconnect: {
      addListener: l => disconnectListeners.add(l),
      removeListener: l => disconnectListeners.delete(l),
    },
    postMessage: vi.fn(),
    disconnect: vi.fn(),
    __emitMessage: msg => {
      for (const l of [...messageListeners]) l(msg);
    },
    __emitDisconnect: (lastError?: string) => {
      setLastError(lastError ? { message: lastError } : undefined);
      try {
        for (const l of [...disconnectListeners]) l();
      } finally {
        setLastError(undefined);
      }
    },
  };
};

const TARGET_URL = 'https://chatgpt.com/c/abc123?q=y';
const OTHER_URL = 'https://chatgpt.com/c/other?q=z';

const baseSession = (): Session => ({
  id: 'content-side-id',
  title: 'Why is the sky blue?',
  platform: 'chatgpt',
  messageCount: 2,
  imageCount: 0,
  fileCount: 0,
  startedAt: new Date().toISOString(),
  savedAt: new Date().toISOString(),
  messages: [
    { role: 'user', content: 'Why is the sky blue?' },
    { role: 'assistant', content: 'Rayleigh scattering.' },
  ],
});

const resultMsg = (url: string = TARGET_URL, overrides: Partial<Record<string, unknown>> = {}) => ({
  type: 'result',
  session: baseSession(),
  sourceUrl: url,
  sourceTitle: 'Why is the sky blue?',
  ...overrides,
});

// Accessor so module-level evaluation doesn't need `chrome` defined yet.
// All code below runs only while the mocks are installed.
type LastError = { message: string } | undefined;
const lastErrorRef = (): { lastError?: LastError } =>
  ((globalThis as unknown as { chrome?: { runtime?: { lastError?: LastError } } }).chrome?.runtime ?? {}) as {
    lastError?: LastError;
  };
const setLastError = (value: LastError): void => {
  lastErrorRef().lastError = value;
};
const injectCalls: unknown[] = [];
const connectCalls: Array<{ tabId: number; connectInfo: unknown }> = [];
const state = {
  portQueue: [] as FakePort[],
  activeTab: undefined as unknown,
  getError: false,
  injectError: false,
};

const resetMocks = (initialTab: unknown) => {
  injectCalls.length = 0;
  connectCalls.length = 0;
  state.portQueue = [];
  state.activeTab = initialTab;
  state.getError = false;
  state.injectError = false;
  setLastError(undefined);

  (globalThis as unknown as { chrome?: unknown }).chrome = {
    runtime: {},
    tabs: {
      query: (_query: unknown, cb: (tabs: chrome.tabs.Tab[]) => void) => cb([initialTab as chrome.tabs.Tab]),
      connect: (tabId: number, connectInfo: unknown) => {
        connectCalls.push({ tabId, connectInfo });
        const port = state.portQueue.shift();
        if (!port) throw new Error('Receiving end does not exist');
        return port as unknown as chrome.runtime.Port;
      },
      get: (tabId: number, cb: (tab?: chrome.tabs.Tab) => void) => {
        setTimeout(() => {
          if (state.getError) {
            setLastError({ message: 'No tab with id: 42.' });
            cb(undefined);
            setLastError(undefined);
            return;
          }
          cb(state.activeTab as chrome.tabs.Tab);
        }, 0);
      },
    },
    scripting: {
      executeScript: (_injection: unknown, cb: () => void) => {
        injectCalls.push(_injection);
        setTimeout(() => {
          if (state.injectError) {
            setLastError({ message: 'Cannot access contents of the page.' });
            cb();
            setLastError(undefined);
            return;
          }
          cb();
        }, 0);
      },
    },
  };
};

const initialTab = (): chrome.tabs.Tab =>
  ({ id: 42, url: TARGET_URL }) as unknown as chrome.tabs.Tab;

const tick = () => new Promise<void>(r => setTimeout(r, 10));

describe('captureCurrentTab transport', () => {
  beforeEach(() => {
    delete (globalThis as unknown as { chrome?: unknown }).chrome;
  });
  afterEach(() => {
    delete (globalThis as unknown as { chrome?: unknown }).chrome;
  });

  it('pins the target tab id with frameId 0 and no lookahead handshake', async () => {
    resetMocks(initialTab());
    const port = makeFakePort();
    state.portQueue.push(port);

    const promise = captureTab(initialTab());
    await tick();
    port.__emitMessage(resultMsg());
    const session = await promise;
    expect(session.id).toBeTypeOf('string');

    expect(injectCalls).toHaveLength(0);
    expect(connectCalls).toHaveLength(1);
    expect(connectCalls[0]).toEqual({ tabId: 42, connectInfo: { name: 'movechat-scrape', frameId: 0 } });
    expect(port.postMessage).not.toHaveBeenCalled();
  });

  it('resolves with provenance and a unique generated id per capture', async () => {
    resetMocks(initialTab());
    const first = makeFakePort();
    state.portQueue.push(first);
    const p1 = captureTab(initialTab());
    await tick();
    first.__emitMessage(resultMsg());
    const session1 = await p1;
    expect(session1.id).not.toBe('content-side-id');
    expect(session1.sourceUrl).toBe(TARGET_URL);
    expect(session1.sourceTitle).toBe('Why is the sky blue?');
    expect(session1.title).toBe('Why is the sky blue?');
    expect(session1.messages).toHaveLength(2);

    resetMocks(initialTab());
    const second = makeFakePort();
    state.portQueue.push(second);
    const p2 = captureTab(initialTab());
    await tick();
    second.__emitMessage(resultMsg());
    const session2 = await p2;
    expect(session2.id).not.toBe(session1.id);
  });

  it('rejects when the content reports a mismatched source URL', async () => {
    resetMocks(initialTab());
    const port = makeFakePort();
    state.portQueue.push(port);
    const promise = captureTab(initialTab());
    await tick();
    port.__emitMessage(resultMsg(OTHER_URL));
    await expect(promise).rejects.toThrow(/different page/i);
    expect(port.disconnect).toHaveBeenCalled();
  });

  it('rejects and does not save when the target tab navigated during the fetch', async () => {
    resetMocks(initialTab());
    const port = makeFakePort();
    state.portQueue.push(port);
    const promise = captureTab(initialTab());
    await tick();
    const navigated = initialTab() as chrome.tabs.Tab & { url: string };
    navigated.url = OTHER_URL;
    state.activeTab = navigated;
    port.__emitMessage(resultMsg());
    await expect(promise).rejects.toThrow(/navigated/i);
  });

  it('on missing provenance (legacy script) reinjects once bounded, else fails clear', async () => {
    // Pass one in two attempts: legacy script is refreshed by injection.
    resetMocks(initialTab());
    const oldPort = makeFakePort();
    const newPort = makeFakePort();
    state.portQueue.push(oldPort, newPort);
    const promise = captureTab(initialTab());
    await tick();
    oldPort.__emitMessage({ type: 'result', session: baseSession() }); // no sourceUrl
    await tick(); // injection callback
    expect(injectCalls).toHaveLength(1);
    const target = (injectCalls[0] as { target: { tabId: number; frameIds: number[] } }).target;
    expect(target).toEqual({ tabId: 42, frameIds: [0] });
    newPort.__emitMessage(resultMsg());
    const handled = await promise;
    expect(handled.sourceUrl).toBe(TARGET_URL);
    expect(connectCalls).toHaveLength(2);

    // Pass two: still no provenance after the single allowed inject → clear error.
    resetMocks(initialTab());
    const old2 = makeFakePort();
    const new2 = makeFakePort();
    state.portQueue.push(old2, new2);
    const promise2 = captureTab(initialTab());
    await tick();
    old2.__emitMessage({ type: 'result', session: baseSession() });
    await tick();
    new2.__emitMessage({ type: 'result', session: baseSession() });
    await expect(promise2).rejects.toThrow(/refresh/i);
    expect(injectCalls).toHaveLength(1); // bounded: never reinjects a second time
  });

  it('after disconnect with no receiver, injects once and the retry succeeds', async () => {
    resetMocks(initialTab());
    const deadPort = makeFakePort();
    const livePort = makeFakePort();
    state.portQueue.push(deadPort, livePort);
    const promise = captureTab(initialTab());
    await tick();
    deadPort.__emitDisconnect('Could not establish connection. Receiving end does not exist.');
    await tick();
    expect(injectCalls).toHaveLength(1);
    livePort.__emitMessage(resultMsg());
    const session = await promise;
    expect(session.messages).toHaveLength(2);
    expect(connectCalls).toHaveLength(2);
  });

  it('ignores late results from the old port and settles once', async () => {
    resetMocks(initialTab());
    const oldPort = makeFakePort();
    const newPort = makeFakePort();
    state.portQueue.push(oldPort, newPort);
    const promise = captureTab(initialTab());
    const guarded = promise.then(s => s, e => Promise.reject(e));
    await tick();
    oldPort.__emitDisconnect('Receiving end does not exist.');
    await tick();
    newPort.__emitMessage(resultMsg());
    const session = await promise;
    // Late traffic on the stale port must be ignored entirely.
    oldPort.__emitMessage({ type: 'result', session: baseSession(), sourceUrl: OTHER_URL });
    oldPort.__emitMessage({ type: 'error', error: 'late failure' });
    const settled = await guarded;
    expect(settled.sourceUrl).toBe(TARGET_URL);
    expect(session.messages).toHaveLength(2);
  });

  it('rejects unsupported lookalike hostnames', async () => {
    resetMocks(initialTab());
    const lookalike = ({ id: 42, url: 'https://chatgpt.com.evil.example/chat/abc' }) as unknown as chrome.tabs.Tab;
    await expect(captureTab(lookalike)).rejects.toThrow(/unsupported/i);
    const notGpt = ({ id: 42, url: 'https://notchatgpt.com/c/abc' }) as unknown as chrome.tabs.Tab;
    await expect(captureTab(notGpt)).rejects.toThrow(/unsupported/i);
    expect(injectCalls).toHaveLength(0);
    expect(connectCalls).toHaveLength(0);
  });

  it.each([
    ['https://chatgpt.com/c/test', 'chatgpt'],
    ['https://claude.ai/chat/test', 'claude'],
    ['https://gemini.google.com/app/test', 'gemini'],
    ['https://www.perplexity.ai/search/test', 'perplexity'],
    ['https://chat.deepseek.com/a/chat/s/test', 'deepseek'],
  ] as const)('accepts the actual supported provider host %s', async (url, platform) => {
    const tab = { ...initialTab(), url };
    resetMocks(tab);
    const port = makeFakePort();
    state.portQueue.push(port);
    const promise = captureTab(tab);
    port.__emitMessage(resultMsg(url, { session: { ...baseSession(), platform } }));
    expect((await promise).platform).toBe(platform);
  });

  it('rejects insecure or credential-bearing URLs', async () => {
    resetMocks(initialTab());
    await expect(captureTab({ ...initialTab(), url: 'http://chatgpt.com/c/test' })).rejects.toThrow(/unsupported/i);
    await expect(captureTab({ ...initialTab(), url: 'https://name:secret@chatgpt.com/c/test' })).rejects.toThrow(/unsupported/i);
    expect(connectCalls).toHaveLength(0);
  });

  it('ignores old results while the replacement script is still being injected', async () => {
    resetMocks(initialTab());
    const oldPort = makeFakePort();
    const newPort = makeFakePort();
    state.portQueue.push(oldPort, newPort);
    const promise = captureTab(initialTab());
    oldPort.__emitMessage({ type: 'result', session: baseSession() });
    oldPort.__emitMessage(resultMsg(OTHER_URL));
    oldPort.__emitMessage({ type: 'error', error: 'Old receiver error' });
    await tick();
    newPort.__emitMessage(resultMsg());
    expect((await promise).sourceUrl).toBe(TARGET_URL);
    expect(injectCalls).toHaveLength(1);
  });

  it('does not reinject when a valid result is already being verified', async () => {
    resetMocks(initialTab());
    const port = makeFakePort();
    state.portQueue.push(port);
    const promise = captureTab(initialTab());
    port.__emitMessage(resultMsg());
    port.__emitDisconnect('Port closed after result.');
    expect((await promise).sourceUrl).toBe(TARGET_URL);
    expect(injectCalls).toHaveLength(0);
  });

  it('rejects invalid or wrong-provider session payloads', async () => {
    for (const session of [{ ...baseSession(), platform: 'claude' }, { title: 'Bad', platform: 'chatgpt', messages: null }]) {
      resetMocks(initialTab());
      const port = makeFakePort();
      state.portQueue.push(port);
      const promise = captureTab(initialTab());
      port.__emitMessage(resultMsg(TARGET_URL, { session }));
      await expect(promise).rejects.toThrow(/invalid session/i);
    }
  });

  it('times out, cleans up the port, and stops injecting attempts', async () => {
    resetMocks(initialTab());
    const silentPort = makeFakePort();
    state.portQueue.push(silentPort);
    const promise = captureTab(initialTab(), undefined, { timeoutMs: 25 });
    await expect(promise).rejects.toThrow(/timed out/i);
    expect(silentPort.disconnect).toHaveBeenCalled();
    expect(injectCalls).toHaveLength(0);
  });

  it('captureCurrentTab queries the active tab and reuses the pinned flow', async () => {
    resetMocks(initialTab());
    const port = makeFakePort();
    state.portQueue.push(port);
    const promise = captureCurrentTab();
    await tick();
    port.__emitMessage(resultMsg());
    const session = await promise;
    expect(session.sourceUrl).toBe(TARGET_URL);
  });

  it('rejects logical content errors immediately without retrying', async () => {
    resetMocks(initialTab());
    const port = makeFakePort();
    state.portQueue.push(port);
    const promise = captureTab(initialTab());
    await tick();
    port.__emitMessage({ type: 'error', error: 'Page changed during scrape.' });
    await expect(promise).rejects.toThrow(/Page changed during scrape\./);
    expect(connectCalls).toHaveLength(1);
    expect(injectCalls).toHaveLength(0);
  });

  it('surfaces chrome.runtime.lastError from tabs.get when the tab is gone', async () => {
    resetMocks(initialTab());
    const port = makeFakePort();
    state.portQueue.push(port);
    const promise = captureTab(initialTab());
    const rejection = expect(promise).rejects.toThrow(/no longer available/i);
    state.getError = true;
    await tick();
    port.__emitMessage(resultMsg());
    await tick();
    await rejection;
  });
});
