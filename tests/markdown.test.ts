import { describe, expect, it } from 'vitest';
import { generateMarkdown } from '../src/shared/markdown';
import { elementToMarkdown } from '../src/content/dom';
import type { Session } from '../src/shared/types';

describe('captured Markdown export', () => {
  it('records the source conversation URL for newly verified captures', () => {
    const session: Session = {
      id: 'source-fixture', platform: 'chatgpt', title: 'Test', sourceUrl: 'https://chatgpt.com/c/python-test',
      savedAt: '2026-10-18T00:00:00Z', startedAt: '2026-10-18T00:00:00Z', messageCount: 1, imageCount: 0, fileCount: 0,
      messages: [{ role: 'user', content: 'Python question' }],
    };
    expect(generateMarkdown(session)).toContain('Source: <https://chatgpt.com/c/python-test>');
  });
  it('preserves code, spaces, tables and conversation roles through export', () => {
    const root = document.createElement('div');
    root.innerHTML = '<h2><span>What </span><span>changed?</span></h2><p><span>The </span><span>function </span>works.</p><div data-code-block><div data-markdown-copy="exclude"><span>Python</span><button>Run</button></div><pre><code class="language-python">def summarize_groups(groups):\n    return groups\n\n</code></pre></div><table><tr><th>Group</th><th>Total</th></tr><tr><td>alpha</td><td>4</td></tr></table>';
    const session: Session = {
      id: 'test', platform: 'chatgpt', title: 'Format Python Explanation',
      savedAt: '2026-10-18T00:00:00.000Z', startedAt: '2026-10-18T00:00:00.000Z',
      messageCount: 2, imageCount: 0, fileCount: 0,
      messages: [{ role: 'user', content: 'Explain the function.' }, { role: 'assistant', content: elementToMarkdown(root) }],
    };
    const exported = generateMarkdown(session);
    expect(exported).toContain('## User\n\nExplain the function.');
    expect(exported).toContain('## Assistant');
    expect(exported).toContain('## What changed?');
    expect(exported).toContain('The function works.');
    expect(exported).toContain('```python\ndef summarize_groups(groups):\n    return groups\n\n```');
    expect(exported).toContain('| alpha | 4 |');
    expect(exported).not.toContain('pythonrun');
  });
});
