// Route-free capture transport: connects to the content script over a pinned
// tab/frame port, injects once if there is no receiving end, validates the
// provenance reported by the content script against the target tab, and never
// persists anything (the caller decides what to do with the session).
import type { Session } from '../shared/types';

export interface CaptureProgress {
  current: number;
  total: number;
  step: string;
}

export type CapturedSession = Session & {
  sourceUrl: string;
  sourceTitle?: string;
};

export type OnCaptureProgress = (progress: CaptureProgress) => void;

export interface CaptureOptions {
  /** Overall timeout in milliseconds. */
  timeoutMs?: number;
}

const PORT_NAME = 'movechat-scrape';
const CONTENT_SCRIPT_FILE = 'content.js';
const DEFAULT_TIMEOUT_MS = 180_000;
// Bounded: at most one injection across the whole capture.
const MAX_INJECTS = 1;

const HOST_PLATFORM: Record<string, Session['platform']> = {
  'chatgpt.com': 'chatgpt',
  'claude.ai': 'claude',
  'gemini.google.com': 'gemini',
  'perplexity.ai': 'perplexity',
  'www.perplexity.ai': 'perplexity',
  'deepseek.com': 'deepseek',
  'chat.deepseek.com': 'deepseek',
};

export class CaptureError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'CaptureError';
  }
}

const generateSessionId = (): string => {
  const cryptoRef = globalThis.crypto;
  if (cryptoRef && typeof cryptoRef.randomUUID === 'function') return cryptoRef.randomUUID();
  return `session_${Date.now()}_${Math.random().toString(36).slice(2, 12)}`;
};

/** Exact supported hostname via URL parsing — substring matches never count. */
const supportedPlatform = (url: string): boolean => {
  try {
    const parsed = new URL(url);
    return parsed.protocol === 'https:' && !parsed.username && !parsed.password && Boolean(HOST_PLATFORM[parsed.hostname]);
  } catch {
    return false;
  }
};

/** Same page ignores the fragment only (origin + pathname + search). */
const samePage = (a: string, b: string): boolean => {
  try {
    const ua = new URL(a);
    const ub = new URL(b);
    return ua.origin === ub.origin && ua.pathname === ub.pathname && ua.search === ub.search;
  } catch {
    return false;
  }
};

const isNonEmptyString = (value: unknown): value is string =>
  typeof value === 'string' && value.length > 0;

export const captureTab = (
  tab: chrome.tabs.Tab,
  onProgress?: OnCaptureProgress,
  options?: CaptureOptions
): Promise<CapturedSession> =>
  new Promise<CapturedSession>((resolve, reject) => {
    const fail = (message: string): void => reject(new CaptureError(message));

    const tabId = typeof (tab as { id?: number }).id === 'number' ? tab.id : null;
    const tabUrl = typeof tab.url === 'string' ? tab.url : '';
    if (!tabUrl || !supportedPlatform(tabUrl)) {
      fail(
        'Unsupported page. MoveChat captures conversations on Claude, ChatGPT, Gemini, Perplexity, and DeepSeek.'
      );
      return;
    }
    if (typeof chrome === 'undefined' || !chrome.tabs || typeof tabId !== 'number') {
      fail('No active browser tab found.');
      return;
    }

    const timeoutMs = options?.timeoutMs ?? DEFAULT_TIMEOUT_MS;
    let settled = false;
    let timer: ReturnType<typeof setTimeout> | null = null;
    let injectsUsed = 0;
    let generation = 0;
    interface Attempt {
      gen: number;
      port: chrome.runtime.Port;
      detached: boolean;
      finalizing: boolean;
      onMessage: (msg: unknown) => void;
      onDisconnect: () => void;
    }
    let attempt: Attempt | null = null;

    const detachAttempt = (a: Attempt): void => {
      if (a.detached) return;
      a.detached = true;
      try {
        a.port.onMessage.removeListener(a.onMessage);
      } catch {
        /* mock ports may lack removal */
      }
      try {
        a.port.onDisconnect.removeListener(a.onDisconnect);
      } catch {
        /* mock ports may lack removal */
      }
      try {
        a.port.disconnect();
      } catch {
        /* already disconnected */
      }
    };

    const settle = (error: Error | null, result?: CapturedSession): void => {
      if (settled) return;
      settled = true;
      if (timer) {
        clearTimeout(timer);
        timer = null;
      }
      if (attempt) {
        detachAttempt(attempt);
        attempt = null;
      }
      if (error) reject(error);
      else resolve(result!);
    };

    timer = setTimeout(() => {
      settle(new CaptureError('Capture timed out. Please refresh the page and try again.'));
    }, timeoutMs);

    const finalize = (msg: Record<string, unknown>, gen: number): void => {
      const payload = msg.session;
      const data = payload as Partial<Session> | undefined;
      if (!data || typeof data !== 'object' || typeof data.title !== 'string' || !Array.isArray(data.messages) ||
          data.platform !== HOST_PLATFORM[new URL(tabUrl).hostname] ||
          !data.messages.every(message => message && (message.role === 'user' || message.role === 'assistant') && typeof message.content === 'string')) {
        settle(new CaptureError('Capture returned an invalid session payload.'));
        return;
      }
      try { chrome.tabs.get(tabId as number, (updatedTab) => {
        const lastError = chrome.runtime.lastError;
        if (settled || attempt?.gen !== gen || attempt.detached) return;
        if (lastError) {
          settle(new CaptureError('Target tab is no longer available. Nothing was saved — retry from the conversation tab.'));
          return;
        }
        if (!updatedTab || typeof updatedTab.url !== 'string' || !samePage(updatedTab.url, tabUrl)) {
          settle(new CaptureError('Target tab navigated away during capture. Nothing was saved — retry from the conversation tab.'));
          return;
        }
        const session: CapturedSession = {
          ...(payload as Session),
          id: generateSessionId(),
          sourceUrl: msg.sourceUrl as string,
        };
        if (isNonEmptyString(msg.sourceTitle)) session.sourceTitle = msg.sourceTitle;
        settle(null, session);
      }); } catch {
        settle(new CaptureError('Unable to verify the target tab. Nothing was saved. Please refresh the conversation and try again.'));
      }
    };

    const handleMessage = (msg: Record<string, unknown>, gen: number): void => {
      if (!msg || typeof msg.type !== 'string') return;
      if (msg.type === 'progress') {
        onProgress?.({
          current: typeof msg.current === 'number' ? msg.current : 0,
          total: typeof msg.total === 'number' ? msg.total : 0,
          step: isNonEmptyString(msg.step) ? msg.step : '',
        });
        return;
      }
      if (msg.type === 'error') {
        settle(new CaptureError(isNonEmptyString(msg.error) ? msg.error : 'Capture failed.'));
        return;
      }
      if (msg.type !== 'result') return;

      if (!isNonEmptyString(msg.sourceUrl)) {
        // Legacy content script without provenance: reinject once, then fail clearly.
        if (injectsUsed < MAX_INJECTS) {
          injectThenRetry();
          return;
        }
        settle(new CaptureError('Outdated MoveChat content script. Please refresh the page and try again.'));
        return;
      }
      if (!samePage(msg.sourceUrl, tabUrl)) {
        settle(new CaptureError('Captured conversation came from a different page than the target tab. Nothing was saved.'));
        return;
      }
      if (attempt) attempt.finalizing = true;
      finalize(msg, gen);
    };

    const injectThenRetry = (): void => {
      if (settled) return;
      if (injectsUsed >= MAX_INJECTS) {
        settle(new CaptureError('Unable to reach the page. Please refresh the tab and try again.'));
        return;
      }
      injectsUsed += 1;
      // Detach before asynchronous injection. An old receiver must not race the
      // replacement with another result/error while executeScript is pending.
      if (attempt) {
        detachAttempt(attempt);
        attempt = null;
      }
      if (!chrome.scripting || typeof tabId !== 'number') {
        settle(
          new CaptureError(
            'Unable to capture. Make sure you are on a supported AI platform and the page is fully loaded.'
          )
        );
        return;
      }
      try { chrome.scripting.executeScript(
        { target: { tabId, frameIds: [0] }, files: [CONTENT_SCRIPT_FILE] },
        () => {
          const lastError = chrome.runtime.lastError;
          if (settled) return;
          if (lastError) {
            settle(
              new CaptureError(
                `Unable to capture. Please refresh this page to capture the chat. (${lastError.message})`
              )
            );
            return;
          }
          if (attempt) {
            detachAttempt(attempt);
            attempt = null;
          }
          startAttempt();
        }
      ); } catch {
        settle(new CaptureError('Unable to refresh the capture script. Please refresh the conversation tab and try again.'));
      }
    };

    const startAttempt = (): void => {
      generation += 1;
      const gen = generation;
      let port: chrome.runtime.Port;
      try {
        port = chrome.tabs.connect(tabId as number, { name: PORT_NAME, frameId: 0 });
      } catch {
        // Synchronous connect failure means there is no receiving end yet.
        if (injectsUsed < MAX_INJECTS) injectThenRetry();
        else
          settle(
            new CaptureError(
              'Unable to connect to the page. Please refresh the tab and try again.'
            )
          );
        return;
      }

      const onMessage = (raw: unknown): void => {
        if (settled || attempt?.gen !== gen || attempt.detached || attempt.finalizing) return; // ignore late/old port traffic
        handleMessage(raw as Record<string, unknown>, gen);
      };
      const onDisconnect = (): void => {
        // Read lastError in its callback even when the attempt is already stale.
        void chrome.runtime.lastError;
        if (settled || attempt?.gen !== gen || attempt.detached || attempt.finalizing) return;
        detachAttempt(attempt!);
        attempt = null;
        onNoReceivingEnd();
      };

      attempt = { gen, port, detached: false, finalizing: false, onMessage, onDisconnect };
      port.onMessage.addListener(onMessage);
      port.onDisconnect.addListener(onDisconnect);
    };

    const onNoReceivingEnd = (): void => {
      if (injectsUsed < MAX_INJECTS) {
        injectThenRetry();
        return;
      }
      settle(
        new CaptureError('Unable to reach the page. Please refresh the tab and try again.')
      );
    };

    startAttempt();
  });

export const captureCurrentTab = (
  onProgress?: OnCaptureProgress,
  options?: CaptureOptions
): Promise<CapturedSession> =>
  new Promise<CapturedSession>((resolve, reject) => {
    if (typeof chrome === 'undefined' || !chrome.tabs) {
      reject(new CaptureError('No active browser tab found.'));
      return;
    }
    chrome.tabs.query({ active: true, currentWindow: true }, (tabs: chrome.tabs.Tab[]) => {
      const lastError = chrome.runtime.lastError;
      if (lastError) {
        reject(new CaptureError(lastError.message || 'Failed to query tabs.'));
        return;
      }
      const activeTab = Array.isArray(tabs) ? tabs[0] : undefined;
      if (!activeTab || typeof activeTab.id !== 'number') {
        reject(new CaptureError('No active browser tab found.'));
        return;
      }
      captureTab(activeTab, onProgress, options).then(resolve, reject);
    });
  });
