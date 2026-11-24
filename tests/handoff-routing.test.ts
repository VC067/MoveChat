import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { PendingHandoff } from '../src/shared/types';

vi.mock('../src/background/session-jobs', () => ({}));

const popupUrl = 'chrome-extension://movechat/index.html';
const pending: PendingHandoff = {
  targetPlatform: 'chatgpt',
  fileName: 'movechat-history.md',
  mimeType: 'text/markdown',
  fileContent: 'Original conversation',
  handoffText: 'Please continue this chat.',
};
type Handler = (request: object, sender: chrome.runtime.MessageSender, reply: (value: unknown) => void) => unknown;

let handleMessage: Handler;
let store: Record<string, unknown>;
let removeTab: (id: number) => void;
const update = vi.fn();
const setHandoff = vi.fn();

function send(request: object, sender: chrome.runtime.MessageSender) {
  return new Promise(resolve => {
    if (handleMessage(request, sender, resolve) !== true) resolve(undefined);
  });
}

const content = (id: number, url = 'https://chatgpt.com/', frameId = 0) => ({
  tab: { id } as chrome.tabs.Tab, url, frameId,
});

beforeEach(async () => {
  vi.resetModules();
  store = {};
  update.mockReset().mockResolvedValue(undefined);
  setHandoff.mockReset().mockImplementation(async (data: object) => { Object.assign(store, data); });
  vi.stubGlobal('chrome', {
    runtime: {
      getURL: () => popupUrl,
      getPlatformInfo: vi.fn(),
      onMessage: { addListener: (listener: Handler) => { handleMessage = listener; } },
    },
    tabs: {
      create: vi.fn().mockResolvedValue({ id: 34 }),
      update,
      onRemoved: { addListener: (listener: typeof removeTab) => { removeTab = listener; } },
    },
    storage: {
      session: {
        set: setHandoff,
        get: async (key: string) => ({ [key]: store[key] }),
        remove: async (key: string) => { delete store[key]; },
      },
    },
  });
  await import('../src/background/index');
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe('handoff routing', () => {
  it('delivers a handoff that exceeds the storage quota only to its destination tab', async () => {
    vi.useFakeTimers();
    setHandoff.mockRejectedValueOnce(new Error('QuotaExceededError: storage.session API call exceeded its quota limitations.'));
    await expect(send({ action: 'RESUME_CHAT', pending, temporary: true }, { url: popupUrl })).resolves.toEqual({ success: true });
    expect(store).toEqual({});
    await vi.advanceTimersByTimeAsync(30_000);
    expect(chrome.runtime.getPlatformInfo).toHaveBeenCalledTimes(2);
    await expect(send({ action: 'CLAIM_HANDOFF' }, content(12))).resolves.toBeNull();
    await expect(send({ action: 'CLAIM_HANDOFF' }, content(34))).resolves.toEqual(pending);
    await expect(send({ action: 'CLAIM_HANDOFF' }, content(34))).resolves.toBeNull();
    expect(vi.getTimerCount()).toBe(0);
  });

  it('opens Temporary Chat and hands the saved conversation only to that new main frame, once', async () => {
    await expect(send({ action: 'RESUME_CHAT', pending, temporary: true }, { url: popupUrl })).resolves.toEqual({ success: true });
    expect(update).toHaveBeenCalledWith(34, { url: 'https://chatgpt.com/?temporary-chat=true' });
    await expect(send({ action: 'CLAIM_HANDOFF' }, content(12))).resolves.toBeNull();
    await expect(send({ action: 'CLAIM_HANDOFF' }, content(34, 'https://chatgpt.com/c/old-chat'))).resolves.toBeNull();
    await expect(send({ action: 'CLAIM_HANDOFF' }, content(34, 'https://chatgpt.com/', 1))).resolves.toBeNull();
    const claim = { action: 'CLAIM_HANDOFF' };
    const destination = content(34, 'https://chatgpt.com/?temporary-chat=true');
    await expect(Promise.all([send(claim, destination), send(claim, destination)])).resolves.toEqual([pending, null]);
    await expect(send(claim, destination)).resolves.toBeNull();
    expect(store).toEqual({});
  });

  it('clears temporary handoff data when the destination closes', async () => {
    await send({ action: 'RESUME_CHAT', pending }, { url: popupUrl });
    removeTab(34);
    await expect(send({ action: 'CLAIM_HANDOFF' }, content(34))).resolves.toBeNull();
    expect(store).toEqual({});
  });

  it('clears temporary handoff data if destination navigation fails', async () => {
    update.mockRejectedValue(new Error('Tab closed'));
    await expect(send({ action: 'RESUME_CHAT', pending }, { url: popupUrl })).resolves.toEqual({ error: 'Error: Tab closed' });
    expect(store).toEqual({});
  });

  it('encodes fetched image bytes in a service-worker-compatible way', async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(Uint8Array.of(1, 2, 3, 255), { headers: { 'Content-Type': 'image/png' } }));
    vi.stubGlobal('fetch', fetchMock);
    await expect(send({ action: 'FETCH_IMAGE_BASE64', url: 'https://images.oaiusercontent.com/test.png' }, content(34)))
      .resolves.toEqual({ base64: 'data:image/png;base64,AQID/w==' });
  });
});
