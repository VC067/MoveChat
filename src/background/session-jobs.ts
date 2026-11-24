import { captureTab } from './capture';
import type { CaptureStatus, Session, SessionEdit } from '../shared/types';

const popupUrl = chrome.runtime.getURL('index.html');
const observers = new Set<chrome.runtime.Port>();
let status: CaptureStatus = {};
let sessionWrites = Promise.resolve();

function updateSessions(edit: (sessions: Session[]) => Session[]): Promise<void> {
  const write = sessionWrites.then(async () => {
    const { sessions = [] } = await chrome.storage.local.get<{ sessions?: Session[] }>('sessions');
    await chrome.storage.local.set({ sessions: edit(sessions) });
  });
  sessionWrites = write.catch(() => undefined);
  return write;
}

function updateStatus(next: CaptureStatus): void {
  status = next;
  for (const port of observers) {
    try { port.postMessage(status); } catch { observers.delete(port); }
  }
}

function withoutImageBytes(session: Session): Session {
  let dropped = 0;
  const messages = session.messages.map(message => {
    const files = message.files?.filter(file => {
      if (!file.type.startsWith('image/') || !file.content?.startsWith('data:')) return true;
      dropped++;
      return false;
    });
    return { ...message, files: files?.length ? files : undefined };
  });
  return dropped ? {
    ...session,
    messages,
    imageCount: Math.max(0, session.imageCount - dropped),
    missingImageCount: (session.missingImageCount ?? 0) + dropped,
  } : session;
}

async function saveCapture(tab: chrome.tabs.Tab): Promise<void> {
  updateStatus({ progress: { current: 0, total: 1, step: 'Starting capture...' } });
  // A quiet scrape can outlast the MV3 worker's idle timeout after the popup closes.
  const keepAlive = setInterval(() => chrome.runtime.getPlatformInfo(() => { void chrome.runtime.lastError; }), 15_000);
  try {
    const session = await captureTab(tab, progress => updateStatus({ progress }));
    updateStatus({ progress: { current: 1, total: 1, step: 'Saving conversation to your library…' } });
    try {
      await updateSessions(sessions => [session, ...sessions]);
    } catch (error) {
      if (!/quota|disk (?:space|full)/i.test(String(error))) throw error;
      const transcript = withoutImageBytes(session);
      if (transcript === session) throw error;
      await updateSessions(sessions => [transcript, ...sessions]);
    }
    updateStatus({ sessionId: session.id });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Capture failed.';
    updateStatus({ error: /quota|disk (?:space|full)/i.test(message)
      ? 'Your browser could not save this conversation because its local storage is full.'
      : message });
  } finally {
    clearInterval(keepAlive);
  }
}

chrome.runtime.onConnect.addListener(port => {
  if (port.name !== 'movechat-capture-status' || port.sender?.url !== popupUrl) return;
  observers.add(port);
  port.onDisconnect.addListener(() => { observers.delete(port); });
  port.onMessage.addListener((request: { tab?: chrome.tabs.Tab }) => {
    if (!status.progress && request.tab) void saveCapture(request.tab);
  });
  port.postMessage(status);
});

chrome.runtime.onMessage.addListener((request: SessionEdit, sender, reply) => {
  if (sender.url !== popupUrl || request.action !== 'EDIT_SESSIONS') return;
  const { edit } = request;
  updateSessions(sessions => edit.type === 'delete'
    ? sessions.filter(session => !edit.ids.includes(session.id))
    : sessions.map(session => session.id === edit.id ? { ...session, title: edit.title } : session)
  ).then(() => reply({}), error => reply({ error: String(error) }));
  return true;
});
