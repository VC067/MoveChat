import { scrapeChatGPT } from './scrapers/chatgpt';
import { scrapeClaude } from './scrapers/claude';
import { scrapeGemini } from './scrapers/gemini';
import { scrapePerplexity } from './scrapers/perplexity';
import { injectChatGPT } from './injectors/chatgpt';
import { injectClaude } from './injectors/claude';
import { injectGemini } from './injectors/gemini';
import { injectPerplexity } from './injectors/perplexity';
import { getStorage, setStorage } from './storage';
import type { PendingHandoff } from '../shared/types';

const getPlatform = (): 'chatgpt' | 'claude' | 'gemini' | 'perplexity' | null => {
  const host = window.location.hostname;
  if (host.includes('chatgpt.com')) return 'chatgpt';
  if (host.includes('claude.ai')) return 'claude';
  if (host.includes('gemini.google.com')) return 'gemini';
  if (host.includes('perplexity.ai')) return 'perplexity';
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
  } catch (err) {
    console.error('[MoveChat] Injection failed:', err);
  }
};

const runScrape = async (platform: string, onProgress?: (cur: number, total: number, step: string) => void) => {
  if (platform === 'chatgpt') return await scrapeChatGPT(onProgress);
  if (platform === 'claude') return await scrapeClaude();
  if (platform === 'gemini') return await scrapeGemini();
  if (platform === 'perplexity') return await scrapePerplexity();
  throw new Error('Unsupported platform');
};

chrome.runtime.onConnect.addListener((port: chrome.runtime.Port) => {
  if (port.name !== 'movechat-scrape') return;

  const platform = getPlatform();
  if (!platform) {
    port.postMessage({ type: 'error', error: 'Unsupported platform' });
    return;
  }

  runScrape(platform, (cur, total, step) => {
    port.postMessage({ type: 'progress', current: cur, total, step });
  })
    .then(sessionData => {
      port.postMessage({ type: 'result', session: { ...sessionData, platform } });
    })
    .catch(err => {
      port.postMessage({ type: 'error', error: err.toString() });
    });
});

chrome.runtime.onMessage.addListener(
  (request: any, _sender: chrome.runtime.MessageSender, sendResponse: (response?: any) => void) => {
    if (request.action === 'SCRAPE_SESSION') {
      const platform = getPlatform();
      if (!platform) {
        sendResponse({ error: 'Unsupported platform' });
        return true;
      }

      runScrape(platform)
        .then(sessionData => {
          sendResponse({ session: { ...sessionData, platform } });
        })
        .catch(err => {
          sendResponse({ error: err.toString() });
        });

      return true; // keep channel open
    }
  }
);

// Run DOM check
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', checkPendingHandoff);
} else {
  checkPendingHandoff();
}
