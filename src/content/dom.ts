const codeLanguages = new Set([
  'bash', 'c', 'c#', 'c++', 'clojure', 'cpp', 'csharp', 'css', 'csv', 'dart', 'diff',
  'dockerfile', 'elixir', 'erlang', 'go', 'graphql', 'groovy', 'haskell', 'html', 'ini',
  'java', 'javascript', 'js', 'json', 'jsx', 'julia', 'kotlin', 'latex', 'lua', 'makefile',
  'markdown', 'matlab', 'md', 'mermaid', 'objective-c', 'perl', 'php', 'plaintext',
  'powershell', 'protobuf', 'python', 'r', 'regex', 'ruby', 'rust', 'sass', 'scala',
  'scheme', 'scss', 'sh', 'shell', 'solidity', 'sql', 'svelte', 'swift', 'text', 'toml',
  'ts', 'tsx', 'typescript', 'vue', 'xml', 'yaml', 'yml', 'zsh',
]);

const languageToken = (text: string): string => text.trim().toLowerCase().replace(/^plain\s+text$/, 'plaintext');

const explicitLanguage = (element: Element): string => {
  const code = element.matches('code') ? element : element.querySelector('code');
  const classLanguage = code?.getAttribute('class')?.match(/\blanguage-([\w+#.-]+)/)?.[1];
  const attributeLanguage = element.getAttribute('data-language') || code?.getAttribute('data-language');
  const language = languageToken(classLanguage || attributeLanguage || '');
  return /^[\w+#.-]+$/.test(language) ? language : '';
};

// Only recognize a bare label when it names a language and agrees with any explicit one.
// Unknown prose ("Example", "Note", etc.) must never be silently removed.
const bareLanguageLabel = (element: Element | null): string => {
  if (!element || element.tagName !== 'SPAN' || element.children.length || element.nextElementSibling?.tagName !== 'PRE') return '';
  const language = languageToken(element.textContent || '');
  const explicit = explicitLanguage(element.nextElementSibling);
  return codeLanguages.has(language) && (!explicit || explicit === language) ? language : '';
};

const headerLanguage = (element: Element): string => {
  const explicit = explicitLanguage(element);
  if (explicit) return explicit;
  const header = element.querySelector('[data-markdown-copy="exclude"], header, [class*="header"]');
  if (!header) return '';
  const clone = header.cloneNode(true) as Element;
  clone.querySelectorAll('button, svg, [role="button"]').forEach(node => node.remove());
  // Prefer a leaf label to a concatenation of toolbar controls.
  for (const label of [...Array.from(clone.querySelectorAll('span')), clone]) {
    const language = languageToken(label.textContent || '');
    if (codeLanguages.has(language)) return language;
  }
  return '';
};

const codeText = (element: Element): string => {
  if (element.tagName === 'TEXTAREA') return (element as HTMLTextAreaElement).value;
  const read = (node: Node): string => {
    if (node.nodeType === Node.TEXT_NODE) return node.textContent || '';
    if (node.nodeType !== Node.ELEMENT_NODE) return '';
    const el = node as Element;
    if (el.tagName === 'BR') return '\n';
    const text = Array.from(el.childNodes).map(read).join('');
    return /^(DIV|P)$/.test(el.tagName) ? `${text}\n` : text;
  };
  return Array.from(element.childNodes).map(read).join('').replace(/\r\n?/g, '\n');
};

const codeFence = (text: string, language: string): string => {
  // A code example can itself contain Markdown fences. Use a longer outer fence.
  const longest = (text.match(/`+/g) || []).reduce((max, run) => Math.max(max, run.length), 0);
  const fence = '`'.repeat(Math.max(3, longest + 1));
  return `${fence}${language || 'plaintext'}\n${text}${text.endsWith('\n') ? '' : '\n'}${fence}`;
};

interface RenderContext {
  preserveWhitespace?: boolean;
}

export const elementToMarkdown = (element: Element): string => {
  // Keep code/math out of prose cleanup altogether, including code containing ```.
  const prefix = `\u0000movechat-${Math.random().toString(36).slice(2)}-`;
  const protectedText: string[] = [];
  const tokenPattern = new RegExp(`${prefix}(\\d+)\u0000`, 'g');
  const protect = (text: string): string => `${prefix}${protectedText.push(text) - 1}\u0000`;
  const restore = (text: string): string => text.replace(tokenPattern, (token, index: string) => protectedText[Number(index)] ?? token);
  const children = (el: Element, context: RenderContext = {}): string => Array.from(el.childNodes).map(node => render(node, context)).join('');
  const inline = (text: string, marker: string): string => {
    const content = text.trim();
    if (!content) return text;
    return `${text.match(/^\s*/)?.[0] || ''}${marker}${content}${marker}${text.match(/\s*$/)?.[0] || ''}`;
  };

  const renderList = (el: Element, context: RenderContext): string => {
    const ordered = el.tagName === 'OL';
    const items = Array.from(el.children).filter(child => child.tagName === 'LI');
    const step = el.hasAttribute('reversed') ? -1 : 1;
    let number = Number(el.getAttribute('start') || (step < 0 ? items.length : 1));
    if (!Number.isFinite(number)) number = 1;
    const lines = items.map(item => {
      if (ordered && item.hasAttribute('value')) {
        const value = Number(item.getAttribute('value'));
        if (Number.isFinite(value)) number = value;
      }
      const marker = ordered ? `${number}. ` : '* ';
      number += step;
      const content = restore(children(item, context)).trim();
      return marker + content.replace(/\n/g, `\n${' '.repeat(marker.length)}`);
    });
    return `\n\n${protect(lines.join('\n'))}\n\n`;
  };

  const renderTable = (el: Element, context: RenderContext): string => {
    const rows = Array.from(el.querySelectorAll('tr')).filter(row => row.closest('table') === el);
    if (!rows.length) return children(el, context);
    const cells = rows.map(row => Array.from(row.children).filter(cell => /^(TH|TD)$/.test(cell.tagName)));
    const values = cells.map(row => row.flatMap(cell => {
      const value = restore(children(cell, context)).trim().replace(/\|/g, '\\|').replace(/\n+/g, '<br>');
      const span = Math.min(100, Math.max(1, Number(cell.getAttribute('colspan')) || 1));
      return [value, ...Array.from({ length: span - 1 }, () => '')];
    }));
    const width = values.reduce((max, row) => Math.max(max, row.length), 0);
    if (!width) return children(el, context);
    const hasHeader = cells[0].some(cell => cell.tagName === 'TH') || rows[0].parentElement?.tagName === 'THEAD';
    const header = hasHeader ? values.shift()! : Array.from({ length: width }, () => '');
    const row = (values: string[]) => `| ${Array.from({ length: width }, (_, i) => values[i] || '').join(' | ')} |`;
    const table = [row(header), row(Array.from({ length: width }, () => '---')), ...values.map(row)].join('\n');
    return `\n\n${protect(table)}\n\n`;
  };

  const render = (node: Node, context: RenderContext = {}): string => {
    if (node.nodeType === Node.TEXT_NODE) {
      const text = node.textContent || '';
      return context.preserveWhitespace ? protect(text) : text.replace(/\s+/g, ' ');
    }
    if (node.nodeType !== Node.ELEMENT_NODE) return '';
    const el = node as HTMLElement;
    const tag = el.tagName.toLowerCase();
    if (['script', 'style', 'noscript', 'button', 'svg'].includes(tag)) return '';
    const nextContext = {
      ...context,
      preserveWhitespace: context.preserveWhitespace || el.classList.contains('whitespace-pre-wrap') ||
        el.hasAttribute('data-user-message-bubble') || el.getAttribute('data-markdown-text-tone') === 'user-message' ||
        ['pre-wrap', 'break-spaces'].includes(el.style?.whiteSpace),
    };

    // Read math once from its source annotation, not duplicated visual/accessibility trees.
    if (el.classList.contains('katex-display') || (tag === 'mjx-container' && el.getAttribute('display') === 'true')) {
      const tex = (el.querySelector('annotation')?.textContent || el.querySelector('.katex-html')?.textContent || el.textContent || '').trim();
      return `\n\n${protect(`$$\n${tex}\n$$`)}\n\n`;
    }
    if (el.classList.contains('katex') || tag === 'mjx-container' || tag === 'math') {
      const tex = (el.querySelector('annotation')?.textContent || el.querySelector('.katex-html')?.textContent || el.textContent || '').trim();
      return protect(`$${tex}$`);
    }

    if (tag === 'pre') {
      const source = el.querySelector('code') || el;
      const language = explicitLanguage(el) || bareLanguageLabel(el.previousElementSibling);
      return `\n${protect(codeFence(codeText(source), language))}\n`;
    }
    if (el.hasAttribute('data-code-block') || el.classList.contains('code-block-container') || el.classList.contains('code-block')) {
      const source = el.querySelector('[data-code-block-source]');
      const pre = el.querySelector('pre');
      if (source && codeText(source).length) {
        return `\n${protect(codeFence(codeText(source), headerLanguage(el)))}\n`;
      }
      if (pre) {
        const source = pre.querySelector('code') || pre;
        return `\n${protect(codeFence(codeText(source), explicitLanguage(pre) || headerLanguage(el)))}\n`;
      }
      // Unknown wrappers must retain their content, never become an empty replacement block.
      return children(el, nextContext);
    }
    if (bareLanguageLabel(el)) return '';
    if (tag === 'code') {
      const text = el.textContent || '';
      if (!text) return '';
      const longest = (text.match(/`+/g) || []).reduce((max, run) => Math.max(max, run.length), 0);
      const marker = '`'.repeat(longest + 1);
      const padding = /^`|`$|^ .* $/.test(text) ? ' ' : '';
      return protect(`${marker}${padding}${text}${padding}${marker}`);
    }
    if (tag === 'br') return '\n';
    if (tag === 'hr') return '\n\n---\n\n';
    if (tag === 'ul' || tag === 'ol') return renderList(el, nextContext);
    if (tag === 'table') return renderTable(el, nextContext);
    if (tag === 'blockquote') {
      const content = restore(children(el, nextContext)).trim();
      return `\n\n${protect(content.split('\n').map(line => `> ${line}`).join('\n'))}\n\n`;
    }
    const content = children(el, nextContext);
    if (tag === 'strong' || tag === 'b') return inline(content, '**');
    if (tag === 'em' || tag === 'i') return inline(content, '*');
    if (tag === 'a') {
      const href = el.getAttribute('href') || '';
      return href ? `[${content.trim()}](${href})` : content;
    }
    if (/^h[1-6]$/.test(tag)) return `\n\n${'#'.repeat(Number(tag[1]))} ${content.trim()}\n\n`;
    if (['p', 'div', 'section', 'article', 'header', 'footer'].includes(tag)) return `\n\n${content}\n\n`;
    return content;
  };

  // Normalize prose only once. Recursive trimming would join "The " + "function".
  const markdown = render(element)
    .replace(/[ \t]+\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .replace(/ ([.,;:?!])/g, '$1')
    .trim();
  return restore(markdown);
};
