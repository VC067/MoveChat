import './session-jobs';
import type { PendingHandoff, Session } from '../shared/types';

const resumeUrls: Record<Session['platform'], string> = {
  chatgpt: 'https://chatgpt.com/',
  claude: 'https://claude.ai/new',
  gemini: 'https://gemini.google.com/app',
  perplexity: 'https://www.perplexity.ai/',
  deepseek: 'https://chat.deepseek.com/',
};

const handoffKey = (tabId: number) => `pending_handoff:${tabId}`;
const claimedTabs = new Set<number>();
const handoffStorage = chrome.storage.session ?? chrome.storage.local;
const handoffLifetimeMs = 120_000;
type HandoffRecord = { pending: PendingHandoff; expires: number };
const inMemoryHandoffs = new Map<number, {
  record: HandoffRecord;
  expiry: ReturnType<typeof setTimeout>;
  keepAlive: ReturnType<typeof setInterval>;
}>();

function dropInMemoryHandoff(id: number): void {
  const entry = inMemoryHandoffs.get(id);
  if (!entry) return;
  clearTimeout(entry.expiry);
  clearInterval(entry.keepAlive);
  inMemoryHandoffs.delete(id);
}

async function openHandoff(pending: PendingHandoff, temporary: boolean): Promise<void> {
  const url = new URL(resumeUrls[pending.targetPlatform]);
  if (temporary && pending.targetPlatform === 'chatgpt') url.searchParams.set('temporary-chat', 'true');
  const { id } = await chrome.tabs.create({ url: 'about:blank' });
  if (id === undefined) throw new Error('Unable to open the destination tab.');

  const key = handoffKey(id);
  const record: HandoffRecord = { pending, expires: Date.now() + handoffLifetimeMs };
  try {
    try {
      await handoffStorage.set({ [key]: record });
    } catch (error) {
      if (!/quota/i.test(String(error))) throw error;
      // Keep large drafts in the extension worker until the destination claims
      // them. The session-storage quota is separate from the local library.
      const keepAlive = setInterval(() => chrome.runtime.getPlatformInfo(() => { void chrome.runtime.lastError; }), 15_000);
      const expiry = setTimeout(() => dropInMemoryHandoff(id), Math.max(0, record.expires - Date.now()));
      inMemoryHandoffs.set(id, { record, expiry, keepAlive });
    }
    await chrome.tabs.update(id, { url: url.href });
  } catch (error) {
    dropInMemoryHandoff(id);
    await handoffStorage.remove(key);
    throw error;
  }
}

async function claimHandoff({ tab, url, frameId }: chrome.runtime.MessageSender): Promise<PendingHandoff | null> {
  const tabId = tab?.id;
  if (tabId === undefined || frameId !== 0 || !url || claimedTabs.has(tabId)) return null;
  claimedTabs.add(tabId);
  const key = handoffKey(tabId);
  try {
    const memory = inMemoryHandoffs.get(tabId);
    const record = memory?.record ?? (await handoffStorage.get<Record<string, HandoffRecord>>(key))[key];
    if (!record) return null;
    const destination = new URL(resumeUrls[record.pending.targetPlatform]);
    const caller = new URL(url);
    if (record.expires <= Date.now()) {
      if (memory) dropInMemoryHandoff(tabId);
      else await handoffStorage.remove(key);
      return null;
    }
    if (caller.origin !== destination.origin) return null;
    if (record.pending.targetPlatform === 'chatgpt' && caller.pathname !== destination.pathname) return null;
    if (memory) dropInMemoryHandoff(tabId);
    else await handoffStorage.remove(key);
    return record.pending;
  } finally {
    claimedTabs.delete(tabId);
  }
}

chrome.tabs.onRemoved.addListener(id => {
  dropInMemoryHandoff(id);
  void handoffStorage.remove(handoffKey(id)).catch(() => undefined);
});

async function fetchImage(url: string): Promise<{ base64: string }> {
  const response = await fetch(url);
  if (!response.ok) throw new Error(`HTTP ${response.status}`);
  const blob = await response.blob();
  const bytes = new Uint8Array(await blob.arrayBuffer());
  let binary = '';
  for (let offset = 0; offset < bytes.length; offset += 8_192) {
    binary += String.fromCharCode(...bytes.subarray(offset, offset + 8_192));
  }
  return { base64: `data:${blob.type};base64,${btoa(binary)}` };
}

type Request =
  | { action: 'RESUME_CHAT'; pending: PendingHandoff; temporary?: boolean }
  | { action: 'CLAIM_HANDOFF' }
  | { action: 'FETCH_IMAGE_BASE64'; url: string };

chrome.runtime.onMessage.addListener((request: Request, sender, reply) => {
  if (request.action === 'RESUME_CHAT' && sender.url === chrome.runtime.getURL('index.html')) {
    openHandoff(request.pending, request.temporary === true)
      .then(() => reply({ success: true }), error => reply({ error: String(error) }));
    return true;
  }
  if (request.action === 'CLAIM_HANDOFF') {
    claimHandoff(sender).then(reply, () => reply(null));
    return true;
  }
  if (request.action === 'FETCH_IMAGE_BASE64') {
    fetchImage(request.url).then(reply, error => {
      console.error('[MoveChat] Background image fetch failed:', error);
      reply({ base64: '' });
    });
    return true;
  }
});
