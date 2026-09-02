export const elementToMarkdown = (element: Element): string => {
  let md = '';
  const children = Array.from(element.childNodes);

  if (children.length === 0) {
    return element.textContent || '';
  }

  for (const node of children) {
    if (node.nodeType === Node.TEXT_NODE) {
      md += node.textContent;
    } else if (node.nodeType === Node.ELEMENT_NODE) {
      const el = node as HTMLElement;
      const tag = el.tagName.toLowerCase();

      // 1. Math formulas (KaTeX / MathJax / MathML)
      if (el.classList.contains('katex-display') || (tag === 'mjx-container' && el.getAttribute('display') === 'true')) {
        const annotation = el.querySelector('annotation');
        const tex = annotation ? (annotation.textContent || '').trim() : '';
        if (tex) {
          md += `\n\n$$\n${tex}\n$$\n\n`;
        } else {
          const fallback = el.querySelector('.katex-html')?.textContent || el.textContent || '';
          md += `\n\n$$\n${fallback.trim()}\n$$\n\n`;
        }
        continue;
      }

      if (el.classList.contains('katex') || tag === 'mjx-container' || tag === 'math') {
        // If it's already inside a display math container, skip separate inline processing
        if (el.closest('.katex-display') || (el.parentElement && el.parentElement.getAttribute('display') === 'true')) {
          continue;
        }

        const annotation = el.querySelector('annotation');
        const tex = annotation ? (annotation.textContent || '').trim() : '';
        if (tex) {
          md += ` $${tex}$ `;
        } else {
          const fallback = el.querySelector('.katex-html')?.textContent || el.textContent || '';
          md += ` $${fallback.trim()}$ `;
        }
        continue;
      }

      // Check if it's a code block container
      if (tag === 'pre') {
        const codeEl = el.querySelector('code');
        const codeText = codeEl ? codeEl.textContent : el.textContent;
        
        let lang = 'plaintext';
        if (codeEl) {
          const cls = codeEl.getAttribute('class') || '';
          const match = cls.match(/language-(\w+)/);
          if (match) {
            lang = match[1];
          }
        }
        md += `\n\`\`\`${lang}\n${(codeText || '').trim()}\n\`\`\`\n`;
      } else if (tag === 'code') {
        // Inline code
        md += ` \`${(el.textContent || '').trim()}\` `;
      } else if (tag === 'p') {
        md += `\n\n${elementToMarkdown(el)}\n\n`;
      } else if (tag === 'strong' || tag === 'b') {
        md += ` **${elementToMarkdown(el).trim()}** `;
      } else if (tag === 'em' || tag === 'i') {
        md += ` *${elementToMarkdown(el).trim()}* `;
      } else if (tag === 'blockquote') {
        const inner = elementToMarkdown(el).trim();
        md += `\n\n> ${inner.replace(/\n/g, '\n> ')}\n\n`;
      } else if (tag === 'ul') {
        md += `\n${elementToMarkdown(el)}\n`;
      } else if (tag === 'ol') {
        md += `\n${elementToMarkdown(el)}\n`;
      } else if (tag === 'li') {
        md += `\n* ${elementToMarkdown(el).trim()}`;
      } else if (tag === 'h1' || tag === 'h2' || tag === 'h3' || tag === 'h4' || tag === 'h5' || tag === 'h6') {
        const level = tag[1];
        const hash = '#'.repeat(Number(level));
        md += `\n\n${hash} ${elementToMarkdown(el).trim()}\n\n`;
      } else if (tag === 'a') {
        const href = el.getAttribute('href') || '';
        const linkText = elementToMarkdown(el).trim();
        md += href ? ` [${linkText}](${href}) ` : ` ${linkText} `;
      } else if (el.classList.contains('code-block-container') || el.classList.contains('code-block')) {
        // Skip code block headers or wrapper metadata to prevent duplicate rendering
        const codePre = el.querySelector('pre');
        if (codePre) {
          md += elementToMarkdown(codePre);
        } else {
          md += elementToMarkdown(el);
        }
      } else {
        md += elementToMarkdown(el);
      }
    }
  }

  // Normalize multi-newlines, whitespace, and spaces before punctuation
  return md
    .replace(/\n{3,}/g, '\n\n')
    .replace(/[ \t]+/g, ' ')
    .replace(/ ([\.\,\;\:\?\!])/g, '$1')
    .trim();
};
