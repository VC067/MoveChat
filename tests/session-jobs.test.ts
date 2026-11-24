import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { CaptureStatus, Session, SessionEdit } from '../src/shared/types';

const { captureTab } = vi.hoisted(() => ({ captureTab: vi.fn() }));
vi.mock('../src/background/capture', () => ({ captureTab }));

const popupUrl = 'chrome-extension://movechat/index.html';
const tab = { id: 1, url: 'https://chatgpt.com/c/test' };
const saved: Session = {
  id: 'saved', title: 'Test conversation', platform: 'chatgpt', sourceUrl: tab.url,
  savedAt: '2026-10-18T00:00:00Z', startedAt: '2026-10-18T00:00:00Z',
  messageCount: 1, imageCount: 0, fileCount: 0, messages: [{ role: 'user', content: 'Saved message' }],
};
const event = <T,>() => {
  const listeners: Array<(event: T) => void> = [];
  return {
    addListener: (listener: (event: T) => void) => listeners.push(listener),
    dispatch: (value: T) => listeners.forEach(listener => listener(value)),
  };
};

function popup() {
  return {
    name: 'movechat-capture-status',
    sender: { url: popupUrl },
    postMessage: vi.fn<(status: CaptureStatus) => void>(),
    onDisconnect: event<void>(),
    onMessage: event<{ tab: typeof tab }>(),
  };
}

let sessions: Session[];
let onConnect: ReturnType<typeof event<ReturnType<typeof popup>>>;
let editListener: (request: SessionEdit, sender: { url: string }, reply: (value: object) => void) => void;
const storageWrite = vi.fn();
const platformInfo = vi.fn();

beforeEach(async () => {
  vi.resetModules();
  captureTab.mockReset();
  platformInfo.mockClear();
  storageWrite.mockReset().mockImplementation(async (value: { sessions: Session[] }) => { sessions = value.sessions; });
  sessions = [{ ...saved, id: 'old', title: 'Old save' }];
  onConnect = event();
  vi.stubGlobal('chrome', {
    runtime: {
      getURL: () => popupUrl,
      onConnect,
      onMessage: { addListener: (listener: typeof editListener) => { editListener = listener; } },
      getPlatformInfo: platformInfo,
    },
    storage: { local: { get: async () => ({ sessions }), set: storageWrite } },
  });
  await import('../src/background/session-jobs');
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe('background-owned saves', () => {
  it('restores progress after the popup closes and saves exactly once', async () => {
    vi.useFakeTimers();
    let finish!: (session: Session) => void;
    captureTab.mockImplementation(() => new Promise<Session>(resolve => { finish = resolve; }));
    const original = popup();
    onConnect.dispatch(original);
    original.onMessage.dispatch({ tab });
    original.onDisconnect.dispatch();
    const reopened = popup();
    onConnect.dispatch(reopened);
    expect(reopened.postMessage).toHaveBeenLastCalledWith({ progress: expect.any(Object) });
    reopened.onMessage.dispatch({ tab });
    expect(captureTab).toHaveBeenCalledExactlyOnceWith(tab, expect.any(Function));

    await vi.advanceTimersByTimeAsync(31_000);
    expect(platformInfo).toHaveBeenCalledTimes(2);
    reopened.onDisconnect.dispatch();
    finish(saved);
    await vi.advanceTimersByTimeAsync(0);
    expect(storageWrite).toHaveBeenCalledOnce();
    expect(sessions.map(session => session.id)).toEqual(['saved', 'old']);
    const completed = popup();
    onConnect.dispatch(completed);
    expect(completed.postMessage).toHaveBeenLastCalledWith({ sessionId: 'saved' });
    await vi.advanceTimersByTimeAsync(31_000);
    expect(platformInfo).toHaveBeenCalledTimes(2);
  });

  it('reports verification errors and saves nothing', async () => {
    captureTab.mockRejectedValue(new Error('Target tab navigated away during capture.'));
    const observer = popup();
    onConnect.dispatch(observer);
    observer.onMessage.dispatch({ tab });
    await vi.waitFor(() => expect(observer.postMessage).toHaveBeenLastCalledWith({ error: 'Target tab navigated away during capture.' }));
    expect(storageWrite).not.toHaveBeenCalled();
  });

  it('serializes capture writes with library edits', async () => {
    captureTab.mockResolvedValue(saved);
    let releaseWrite!: () => void;
    storageWrite.mockImplementationOnce((value: { sessions: Session[] }) => new Promise<void>(resolve => {
      releaseWrite = () => { sessions = value.sessions; resolve(); };
    }));
    const observer = popup();
    onConnect.dispatch(observer);
    observer.onMessage.dispatch({ tab });
    await vi.waitFor(() => expect(storageWrite).toHaveBeenCalledOnce());
    const edit = new Promise(resolve => editListener({
      action: 'EDIT_SESSIONS', edit: { type: 'rename', id: 'old', title: 'Renamed' },
    }, { url: popupUrl }, resolve));
    expect(storageWrite).toHaveBeenCalledOnce();
    releaseWrite();
    await edit;
    expect(sessions.map(session => session.title)).toEqual(['Test conversation', 'Renamed']);
  });

  it('reports write failure and can save again on retry', async () => {
    captureTab.mockResolvedValue(saved);
    storageWrite.mockRejectedValueOnce(new Error('Storage quota exceeded.'));
    const observer = popup();
    onConnect.dispatch(observer);
    observer.onMessage.dispatch({ tab });
    await vi.waitFor(() => expect(observer.postMessage).toHaveBeenLastCalledWith({
      error: 'Your browser could not save this conversation because its local storage is full.',
    }));
    expect(sessions.map(session => session.id)).toEqual(['old']);
    observer.onMessage.dispatch({ tab });
    await vi.waitFor(() => expect(observer.postMessage).toHaveBeenLastCalledWith({ sessionId: 'saved' }));
    expect(sessions.map(session => session.id)).toEqual(['saved', 'old']);
  });

  it('keeps all messages when Chrome rejects the image payload for its storage quota', async () => {
    const messages: Session['messages'] = Array.from({ length: 60 }, (_, i) => ({
      role: 'user',
      content: `Message ${i + 1}`,
    }));
    messages[0].files = [{ name: 'large.png', type: 'image/png', content: 'data:image/png;base64,AA==' }];
    captureTab.mockResolvedValue({ ...saved, messages, messageCount: 60, imageCount: 1 });
    storageWrite.mockRejectedValueOnce(new Error('Resource::kQuotaBytes quota exceeded'));
    const observer = popup();
    onConnect.dispatch(observer);
    observer.onMessage.dispatch({ tab });

    await vi.waitFor(() => expect(observer.postMessage).toHaveBeenLastCalledWith({ sessionId: 'saved' }));
    expect(storageWrite).toHaveBeenCalledTimes(2);
    expect(sessions.map(session => session.id)).toEqual(['saved', 'old']);
    expect(sessions[0]).toMatchObject({ messageCount: 60, imageCount: 0, missingImageCount: 1 });
    expect(sessions[0].messages.map(message => message.content)).toEqual(messages.map(message => message.content));
  });
});
