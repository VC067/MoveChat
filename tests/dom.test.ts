import { describe, expect, it } from 'vitest';
import { elementToMarkdown } from '../src/content/dom';

const convert = (html: string): string => {
  const root = document.createElement('main');
  root.innerHTML = html;
  return elementToMarkdown(root);
};

describe('prose and inline formatting', () => {
  it('preserves whitespace at nested span boundaries', () => {
    expect(convert('<p><span>The </span><span>function </span><span>works.</span></p>')).toBe('The function works.');
    expect(convert('<h2><span>What </span><span>the code </span><span>does</span></h2>')).toBe('## What the code does');
  });

  it('does not invent spaces inside split words, punctuation, or non-Latin text', () => {
    expect(convert('<span>sum</span><span>marize</span><span>_groups()</span>')).toBe('summarize_groups()');
    expect(convert('<span>Hello</span><span>,</span> <span>world!</span>')).toBe('Hello, world!');
    expect(convert('<span>你</span><span>好</span> café 👋')).toBe('你好 café 👋');
  });

  it('preserves spaces surrounding emphasis', () => {
    expect(convert('<strong>Hello </strong><span>world</span>')).toBe('**Hello** world');
    expect(convert('<span>Hello </span><em>world</em>!')).toBe('Hello *world*!');
  });

  it('retains line breaks and paragraph boundaries', () => {
    expect(convert('<p>first<br>second</p><p>third</p>')).toBe('first\nsecond\n\nthird');
    expect(convert('<div>first</div><div>second</div>')).toBe('first\n\nsecond');
  });

  it('preserves multiline user prompts verbatim', () => {
    const prompt = 'Please explain:\n\n```python\ndef test():\n    return 1\n```\n\nThen continue.';
    const root = document.createElement('div');
    root.className = 'whitespace-pre-wrap';
    root.textContent = prompt;
    expect(elementToMarkdown(root)).toBe(prompt);
  });

  it('retains link targets without introducing spaces', () => {
    expect(convert('<p>Visit <a href="https://example.com">this page</a>.</p>')).toBe('Visit [this page](https://example.com).');
  });

  it('ignores executable content and UI buttons', () => {
    expect(convert('<p>Safe</p><script>alert(1)</script><style>p{}</style><button>Copy</button>')).toBe('Safe');
  });
});

describe('code extraction', () => {
  const code = 'def summarize_groups(groups):\n    results = {}\n\n    for name, numbers in groups.items():\n        total = 0\n\n        for number in numbers:\n            if number > 0:\n                total += number\n\n        results[name] = total\n\n    return results';

  it('retains full code, indentation and blank lines through nested wrappers', () => {
    expect(convert(`<div><div><pre><code class="language-python">${code}</code></pre></div></div>`)).toBe(`\`\`\`python\n${code}\n\`\`\``);
  });

  it('preserves indentation on the first line and trailing blank lines', () => {
    const source = '    return 1\n\n';
    expect(convert(`<pre><code class="language-python">${source}</code></pre>`)).toBe(`\`\`\`python\n${source}\`\`\``);
  });

  it('converts a pre supplied as the root element', () => {
    const root = document.createElement('pre');
    root.innerHTML = '<code class="language-python">print(1)</code>';
    expect(elementToMarkdown(root)).toBe('```python\nprint(1)\n```');
  });

  it('reads new source-backed code blocks without copy controls', () => {
    expect(convert(`<div data-code-block><div data-markdown-copy="exclude"><span>Python</span><button>Run</button><button>Copy</button></div><div data-code-block-source>${code}</div></div>`)).toBe(`\`\`\`python\n${code}\n\`\`\``);
  });

  it('falls back to pre instead of emitting an empty pythonrun block', () => {
    const result = convert(`<div data-code-block><div data-markdown-copy="exclude"><span>Python</span><button>Run</button></div><pre><code class="language-python">${code}</code></pre></div>`);
    expect(result).toBe(`\`\`\`python\n${code}\n\`\`\``);
    expect(result).not.toContain('pythonrun');
  });

  it('falls back when the preferred code source is empty', () => {
    expect(convert('<div data-code-block><div data-code-block-source></div><pre><code class="language-python">print(1)</code></pre></div>')).toBe('```python\nprint(1)\n```');
  });

  it('preserves content of unknown code wrappers', () => {
    expect(convert('<div data-code-block><span>Important code text</span></div>')).toBe('Important code text');
  });

  it.each(['code-block', 'code-block-container'])('handles %s class wrappers as fenced code', className => {
    expect(convert(`<div class="${className}"><div>Python</div><pre><code class="language-python">${code}</code></pre></div>`)).toBe(`\`\`\`python\n${code}\n\`\`\``);
  });

  it('reads code rendered as separate lines or br elements', () => {
    expect(convert('<div data-code-block data-language="python"><div data-code-block-source><div>def test():</div><div>    return 1</div></div></div>')).toBe('```python\ndef test():\n    return 1\n```');
    expect(convert('<pre><code>a<br>    b</code></pre>')).toBe('```plaintext\na\n    b\n```');
  });

  it.each(['c++', 'c#', 'objective-c', 'typescript'])('retains language %s', language => {
    expect(convert(`<pre><code class="language-${language}">test</code></pre>`)).toBe(`\`\`\`${language}\ntest\n\`\`\``);
  });

  it('retains ordinary text before code', () => {
    expect(convert('<span>Example</span><pre><code class="language-python">print(1)</code></pre>')).toBe('Example\n```python\nprint(1)\n```');
    expect(convert('<span>Note</span><pre>print(1)</pre>')).toBe('Note\n```plaintext\nprint(1)\n```');
    expect(convert('<span>go</span><pre><code class="language-python">print(1)</code></pre>')).toBe('go\n```python\nprint(1)\n```');
  });

  it('infers recognized bare language labels', () => {
    expect(convert('<span>python</span><pre>print(1)</pre>')).toBe('```python\nprint(1)\n```');
    expect(convert('<span>Plain text</span><pre>example</pre>')).toBe('```plaintext\nexample\n```');
  });

  it('uses a longer outer fence when code contains backticks', () => {
    expect(convert('<pre><code class="language-python">marker = "```"\n    keep = True</code></pre>')).toBe('````python\nmarker = "```"\n    keep = True\n````');
  });

  it('preserves inline code underscores and literal backticks', () => {
    expect(convert('<p>Use <code>summarize_groups()</code>.</p>')).toBe('Use `summarize_groups()`.');
    expect(convert('<code>a`b</code>')).toBe('``a`b``');
  });
});

describe('structured content', () => {
  it('preserves table headers, rows and inline formatting', () => {
    expect(convert('<table><thead><tr><th>Group</th><th>Total</th></tr></thead><tbody><tr><td>alpha</td><td><strong>4</strong></td></tr><tr><td>beta</td><td>4</td></tr></tbody></table>')).toBe('| Group | Total |\n| --- | --- |\n| alpha | **4** |\n| beta | 4 |');
  });

  it('preserves headerless table data and escapes pipes', () => {
    expect(convert('<table><tr><td>a|b</td><td>4</td></tr></table>')).toBe('|  |  |\n| --- | --- |\n| a\\|b | 4 |');
  });

  it('preserves ordered list numbers, starts, and nested lists', () => {
    expect(convert('<ol><li>First</li><li>Second</li></ol>')).toBe('1. First\n2. Second');
    expect(convert('<ol start="3"><li>Third</li><li value="7">Seventh</li></ol>')).toBe('3. Third\n7. Seventh');
    expect(convert('<ul><li>Parent<ul><li>Child</li></ul></li><li>Next</li></ul>')).toContain('  * Child');
  });

  it('preserves code in blockquotes and list items', () => {
    const quote = convert('<blockquote><p>Example</p><pre><code class="language-python">def test():\n    return 1</code></pre></blockquote>');
    expect(quote).toContain('>     return 1');
    const list = convert('<ul><li>Example<pre><code class="language-python">def test():\n    return 1</code></pre></li></ul>');
    expect(list).toContain('      return 1');
  });

  it('emits math source once, not its duplicated visual content', () => {
    expect(convert('<p><span class="katex"><span class="katex-html">visual</span><annotation>x^2</annotation></span></p><div class="katex-display"><span class="katex"><annotation>y = 2x</annotation></span></div>')).toBe('$x^2$\n\n$$\ny = 2x\n$$');
  });
});
