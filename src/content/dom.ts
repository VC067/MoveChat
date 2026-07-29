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
      } else if (tag === 'ul') {
        md += `\n${elementToMarkdown(el)}\n`;
      } else if (tag === 'ol') {
        md += `\n${elementToMarkdown(el)}\n`;
      } else if (tag === 'li') {
        md += `\n* ${elementToMarkdown(el).trim()}`;
      } else if (tag === 'h1' || tag === 'h2' || tag === 'h3' || tag === 'h4') {
        const level = tag[1];
        const hash = '#'.repeat(Number(level));
        md += `\n\n${hash} ${elementToMarkdown(el).trim()}\n\n`;
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

  // Normalize multi-newlines and whitespace
  return md
    .replace(/\n{3,}/g, '\n\n')
    .replace(/ +/g, ' ')
    .trim();
};
