import { afterEach, describe, expect, it, vi } from 'vitest';
import { scrapeClaude } from '../src/content/scrapers/claude';
import { scrapeGemini } from '../src/content/scrapers/gemini';
import { scrapePerplexity } from '../src/content/scrapers/perplexity';
import { scrapeDeepSeek } from '../src/content/scrapers/deepseek';
import type { Message } from '../src/shared/types';

const code = '<pre><code class="language-python">def test():\n    return 1</code></pre>';
const answer = `<p><span>Hello </span><span>there</span></p>${code}`;
const providers = [
  { name: 'Claude', scrape: scrapeClaude, html: `<div data-testid="user-message">Question</div><div data-testid="assistant-message"><div class="prose">${answer}</div></div>` },
  { name: 'Gemini', scrape: scrapeGemini, html: `<user-query>Question</user-query><model-response>${answer}</model-response>` },
  { name: 'Perplexity', scrape: scrapePerplexity, html: `<span class="select-text">Question</span><div id="markdown-content-0"><div class="prose">${answer}</div></div>` },
  { name: 'DeepSeek', scrape: scrapeDeepSeek, html: `<div class="ds-virtual-list"><div data-virtual-list-item-key="0"><div class="ds-message"><div class="ds-collapsible-text">Question</div></div></div><div data-virtual-list-item-key="1"><div class="ds-message"><div class="ds-markdown ds-assistant-message-main-content">${answer}</div></div></div></div>` },
];

afterEach(() => vi.useRealTimers());

describe('shared converter compatibility', () => {
  it.each(providers)('$name keeps roles, text spacing and code', async ({ name, scrape, html }) => {
    document.body.innerHTML = html;
    document.title = 'Provider fixture';
    vi.spyOn(console, 'log').mockImplementation(() => {});
    if (name === 'DeepSeek') vi.useFakeTimers();
    const capture = scrape();
    if (name === 'DeepSeek') await vi.runAllTimersAsync();
    const result = await capture;
    expect(result.messages.map((message: Message) => message.role)).toEqual(['user', 'assistant']);
    expect(result.messages[1].content).toContain('Hello there');
    expect(result.messages[1].content).toContain('```python\ndef test():\n    return 1\n```');
  });
});
