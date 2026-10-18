import { scrapeChatGPT } from './scrapers/chatgpt';
import { scrapeClaude } from './scrapers/claude';
import { scrapeGemini } from './scrapers/gemini';
import { scrapePerplexity } from './scrapers/perplexity';
import { scrapeDeepSeek } from './scrapers/deepseek';
import { injectChatGPT } from './injectors/chatgpt';
import { injectClaude } from './injectors/claude';
import { injectGemini } from './injectors/gemini';
import { injectPerplexity } from './injectors/perplexity';
import { injectDeepSeek } from './injectors/deepseek';
import { getStorage, setStorage } from './storage';
import type { PendingHandoff } from '../shared/types';
import { captureFromPage } from './capture-context';

// An injection retry must replace this build's listeners, not leave multiple
// captures racing to answer the same popup connection.
const lifecycle = globalThis as typeof globalThis & { __movechatDisposeContent?: () => void };
try { lifecycle.__movechatDisposeContent?.(); } catch { /* An older extension context may already be invalid. */ }
let active = true;
const cancelCaptures = new Set<() => void>();

const getPlatform = (): 'chatgpt' | 'claude' | 'gemini' | 'perplexity' | 'deepseek' | null => {
  const host = window.location.hostname;
  if (host.includes('chatgpt.com')) return 'chatgpt';
  if (host.includes('claude.ai')) return 'claude';
  if (host.includes('gemini.google.com')) return 'gemini';
  if (host.includes('perplexity.ai')) return 'perplexity';
  if (host.includes('deepseek.com')) return 'deepseek';
  return null;
};

const checkPendingHandoff = async () => {
  const platform = getPlatform();
  if (!platform) return;

  const pending = await getStorage<PendingHandoff | null>('pending_handoff', null);
  if (!pending || pending.targetPlatform !== platform) return;

  // Clear immediately to prevent multiple triggers
  await setStorage('pending_handoff', null);

  console.log('[MoveChat] Found pending handoff, running injection...', pending);
  
  try {
    if (platform === 'chatgpt') await injectChatGPT(pending);
    else if (platform === 'claude') await injectClaude(pending);
    else if (platform === 'gemini') await injectGemini(pending);
    else if (platform === 'perplexity') await injectPerplexity(pending);
    else if (platform === 'deepseek') await injectDeepSeek(pending);
  } catch (err) {
    console.error('[MoveChat] Injection failed:', err);
  }
};

const runScrape = async (platform: string, onProgress?: (cur: number, total: number, step: string) => void) => {
  if (platform === 'chatgpt') return await scrapeChatGPT(onProgress);
  if (platform === 'claude') return await scrapeClaude();
  if (platform === 'gemini') return await scrapeGemini();
  if (platform === 'perplexity') return await scrapePerplexity();
  if (platform === 'deepseek') return await scrapeDeepSeek(onProgress);
  throw new Error('Unsupported platform');
};

const onConnect = (port: chrome.runtime.Port) => {
  if (!active || port.name !== 'movechat-scrape') return;

  let connected = true;
  const cancel = () => { connected = false; };
  cancelCaptures.add(cancel);
  port.onDisconnect.addListener(cancel);
  const post = (message: unknown) => {
    if (!active || !connected) return;
    try { port.postMessage(message); } catch { connected = false; }
  };
  const finish = () => {
    cancelCaptures.delete(cancel);
    port.onDisconnect.removeListener(cancel);
  };

  const platform = getPlatform();
  if (!platform) {
    post({ type: 'error', error: 'Unsupported platform' });
    finish();
    return;
  }

  captureFromPage(() => runScrape(platform, (cur, total, step) => {
    post({ type: 'progress', current: cur, total, step });
  }))
    .then(({ result: sessionData, sourceUrl, sourceTitle }) => {
      post({ type: 'result', sourceUrl, sourceTitle, session: { ...sessionData, platform, sourceUrl } });
    })
    .catch(err => {
      post({ type: 'error', error: err instanceof Error ? err.message : String(err) });
    })
    .finally(finish);
};
chrome.runtime.onConnect.addListener(onConnect);

const onMessage = (
  request: { action?: string },
  _sender: chrome.runtime.MessageSender,
  sendResponse: (response: unknown) => void
) => {
    if (!active) return;
    if (request.action === 'SCRAPE_SESSION') {
      const platform = getPlatform();
      if (!platform) {
        sendResponse({ error: 'Unsupported platform' });
        return true;
      }

      captureFromPage(() => runScrape(platform))
        .then(({ result: sessionData, sourceUrl, sourceTitle }) => {
          if (active) sendResponse({ sourceUrl, sourceTitle, session: { ...sessionData, platform, sourceUrl } });
        })
        .catch(err => {
          if (active) sendResponse({ error: err instanceof Error ? err.message : String(err) });
        });

      return true; // keep channel open
    }
};
chrome.runtime.onMessage.addListener(onMessage);

// Run DOM check
const onReady = () => { if (active) void checkPendingHandoff(); };
lifecycle.__movechatDisposeContent = () => {
  active = false;
  cancelCaptures.forEach(cancel => cancel());
  cancelCaptures.clear();
  chrome.runtime.onConnect.removeListener(onConnect);
  chrome.runtime.onMessage.removeListener(onMessage);
  document.removeEventListener('DOMContentLoaded', onReady);
};
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', onReady);
} else {
  onReady();
}
