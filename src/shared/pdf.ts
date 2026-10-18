import { jsPDF } from 'jspdf';
import type { Session } from './types';

const getImageDimensions = (base64Data: string): Promise<{ width: number; height: number }> => {
  return new Promise((resolve) => {
    const img = new Image();
    img.onload = () => {
      resolve({ width: img.naturalWidth, height: img.naturalHeight });
    };
    img.onerror = () => {
      resolve({ width: 0, height: 0 });
    };
    img.src = base64Data;
  });
};

const checkPageOverflow = (
  doc: jsPDF,
  y: number,
  neededHeight: number,
  pageHeight: number,
  margin: number
): number => {
  if (y + neededHeight > pageHeight - margin) {
    doc.addPage();
    return 20;
  }
  return y;
};

interface TextToken {
  text: string;
  isBold: boolean;
  isItalic: boolean;
  isCode: boolean;
}

interface WordToken {
  text: string;
  isBold: boolean;
  isItalic: boolean;
  isCode: boolean;
}

const sanitizeTextForPdf = (text: string): string => {
  return text
    // Replace LaTeX fraction macros \frac{a}{b} with (a / b)
    .replace(/\\frac\{([^{}]+)\}\{([^{}]+)\}/g, '($1 / $2)')
    // Replace \text{...} with plain text
    .replace(/\\text\{([^{}]+)\}/g, '$1')
    // Common LaTeX symbols
    .replace(/\\approx/g, '~=')
    .replace(/\\times/g, 'x')
    .replace(/\\cdot/g, '*')
    .replace(/\\div/g, '/')
    .replace(/\\le(q)?\b/g, '<=')
    .replace(/\\ge(q)?\b/g, '>=')
    .replace(/\\neq\b/g, '!=')
    .replace(/\\pm\b/g, '+/-')
    // Strip display and inline dollar delimiters
    .replace(/\$\$/g, '')
    .replace(/\$([^$]+)\$/g, '$1')
    // Remove leftover backslashes on commands
    .replace(/\\([a-zA-Z]+)/g, '$1')
    // Replace non-ASCII characters that jsPDF Helvetica fails on
    .replace(/≈/g, '~=')
    .replace(/≠/g, '!=')
    .replace(/≤/g, '<=')
    .replace(/≥/g, '>=')
    .replace(/±/g, '+/-')
    .replace(/×/g, 'x')
    .replace(/÷/g, '/')
    .replace(/—/g, '--')
    .replace(/–/g, '-')
    .replace(/[“”]/g, '"')
    .replace(/[‘’]/g, "'");
};

const sanitizeCodeTextForPdf = (text: string): string => {
  // Inline code keeps its contents literally — no LaTeX/underscore rewriting —
  // but non-ASCII glyphs are still mapped so standard PDF fonts can encode them.
  return text
    .replace(/≈/g, '~=')
    .replace(/≠/g, '!=')
    .replace(/≤/g, '<=')
    .replace(/≥/g, '>=')
    .replace(/±/g, '+/-')
    .replace(/×/g, 'x')
    .replace(/÷/g, '/')
    .replace(/—/g, '--')
    .replace(/–/g, '-')
    .replace(/[“”]/g, '"')
    .replace(/[‘’]/g, "'");
};

const tokenizeParagraph = (text: string): TextToken[] => {
  const tokens: TextToken[] = [];
  let isBold = false;
  let isItalic = false;
  let currentText = '';

  const flush = () => {
    if (currentText) {
      tokens.push({ text: currentText, isBold, isItalic, isCode: false });
      currentText = '';
    }
  };

  const processPlainChunk = (chunk: string): void => {
    for (let j = 0; j < chunk.length; ) {
      // CommonMark does not interpret underscores inside words as emphasis.
      // Table cells and ordinary prose can contain identifiers too.
      if (chunk[j] === '_') {
        const length = chunk.startsWith('__', j) ? 2 : 1;
        if (/[\p{L}\p{N}]/u.test(chunk[j - 1] || '') && /[\p{L}\p{N}]/u.test(chunk[j + length] || '')) {
          currentText += '_'.repeat(length);
          j += length;
          continue;
        }
      }
      if (chunk.startsWith('**', j) || chunk.startsWith('__', j)) {
        flush();
        isBold = !isBold;
        j += 2;
      } else if (chunk.startsWith('*', j) || chunk.startsWith('_', j)) {
        flush();
        isItalic = !isItalic;
        j += 1;
      } else {
        currentText += chunk[j];
        j += 1;
      }
    }
  };

  let i = 0;
  while (i < text.length) {
    if (text[i] === '`') {
      const marker = text.slice(i).match(/^`+/)![0];
      const runs = /`+/g;
      runs.lastIndex = i + marker.length;
      let closing: RegExpExecArray | null = null;
      for (let match = runs.exec(text); match; match = runs.exec(text)) {
        if (match[0].length === marker.length) { closing = match; break; }
      }
      if (!closing) {
        // Unmatched backtick — treat the remainder as literal text.
        processPlainChunk(sanitizeTextForPdf(text.slice(i)));
        break;
      }

      flush();
      let codeContent = text.slice(i + marker.length, closing.index).replace(/\n/g, ' ');
      if (codeContent.startsWith(' ') && codeContent.endsWith(' ') && codeContent.trim()) {
        codeContent = codeContent.slice(1, -1);
      }
      if (codeContent) {
        // Inside inline code, underscore/asterisk delimiters must never toggle:
        // identifiers like summarize_groups() keep their underscores.
        tokens.push({ text: sanitizeCodeTextForPdf(codeContent), isBold: false, isItalic: false, isCode: true });
      }
      i = closing.index + marker.length;
      continue;
    }

    const nextTick = text.indexOf('`', i);
    processPlainChunk(sanitizeTextForPdf(text.slice(i, nextTick === -1 ? text.length : nextTick)));
    i = nextTick === -1 ? text.length : nextTick;
  }
  flush();
  return tokens;
};

export interface FencedContentPart {
  type: 'text' | 'code';
  content: string;
  lang: string;
}

export const splitFencedContent = (raw: string): FencedContentPart[] => {
  const parts: FencedContentPart[] = [];
  const lines = raw.replace(/\r\n?/g, '\n').split('\n');
  let text: string[] = [];
  const flushText = () => {
    if (text.join('\n').trim()) parts.push({ type: 'text', content: text.join('\n'), lang: '' });
    text = [];
  };
  for (let i = 0; i < lines.length; i++) {
    const opening = lines[i].match(/^ {0,3}(`{3,}|~{3,})(.*)$/);
    if (!opening || (opening[1][0] === '`' && opening[2].includes('`'))) {
      text.push(lines[i]);
      continue;
    }
    flushText();
    const body: string[] = [];
    let closed = false;
    for (i++; i < lines.length; i++) {
      const closing = lines[i].match(/^ {0,3}(`{3,}|~{3,})[ \t]*$/);
      if (closing && closing[1][0] === opening[1][0] && closing[1].length >= opening[1].length) {
        closed = true;
        break;
      }
      body.push(lines[i]);
    }
    const content = body.join('\n') + (closed && body.length ? '\n' : '');
    if (content.trim()) parts.push({ type: 'code', content, lang: opening[2].trim().split(/\s+/)[0] || '' });
  }
  flushText();
  return parts;
};

const getWordTokens = (paragraph: string): WordToken[] => {
  const textTokens = tokenizeParagraph(paragraph);
  const wordTokens: WordToken[] = [];
  
  textTokens.forEach(token => {
    // Split by whitespace but keep spaces and newlines
    const parts = token.text.split(/(\s+)/);
    parts.forEach(part => {
      if (part) {
        if (part.includes('\n')) {
          const lines = part.split(/(\n)/);
          lines.forEach(line => {
            if (line === '\n') {
              wordTokens.push({
                text: '\n',
                isBold: token.isBold,
                isItalic: token.isItalic,
                isCode: token.isCode
              });
            } else if (line) {
              wordTokens.push({
                text: line,
                isBold: token.isBold,
                isItalic: token.isItalic,
                isCode: token.isCode
              });
            }
          });
        } else {
          wordTokens.push({
            text: part,
            isBold: token.isBold,
            isItalic: token.isItalic,
            isCode: token.isCode
          });
        }
      }
    });
  });
  
  return wordTokens;
};

const renderLineWithInlineStyles = (
  doc: jsPDF,
  text: string,
  leftMargin: number,
  width: number,
  startY: number,
  lineHeight: number,
  pageHeight: number,
  margin: number,
  baseFontSize = 9.5,
  baseFontStyle = 'normal',
  baseTextColor = [71, 85, 105] // Slate-600 default body
): number => {
  let y = startY;
  let x = leftMargin;
  
  const tokens = getWordTokens(text);
  
  tokens.forEach(token => {
    let fontStyle: string;
    let fontSize: number;
    let textColor: number[];
    let fontName = 'Helvetica';
    
    if (token.isCode) {
      fontName = 'Courier';
      fontStyle = 'normal';
      fontSize = baseFontSize * 0.9;
      textColor = [51, 65, 85]; // Slate-700
    } else if (token.isBold && token.isItalic) {
      fontStyle = 'bolditalic';
      fontSize = baseFontSize;
      textColor = [15, 23, 42]; // Slate-900
    } else if (token.isBold) {
      fontStyle = 'bold';
      fontSize = baseFontSize;
      textColor = [15, 23, 42]; // Slate-900
    } else if (token.isItalic) {
      fontStyle = 'italic';
      fontSize = baseFontSize;
      textColor = [71, 85, 105];
    } else {
      fontStyle = baseFontStyle;
      fontSize = baseFontSize;
      textColor = baseTextColor;
    }
    
    doc.setFont(fontName, fontStyle);
    doc.setFontSize(fontSize);
    doc.setTextColor(textColor[0], textColor[1], textColor[2]);
    
    const wordWidth = doc.getTextWidth(token.text);
    
    if (x === leftMargin && token.text.trim() === '') {
      return;
    }
    
    if (x + wordWidth > leftMargin + width) {
      y += lineHeight;
      y = checkPageOverflow(doc, y, 0, pageHeight, margin);
      x = leftMargin;
      
      // Re-apply styles in case a new page reset defaults
      doc.setFont(fontName, fontStyle);
      doc.setFontSize(fontSize);
      doc.setTextColor(textColor[0], textColor[1], textColor[2]);
      
      if (token.text.trim() === '') {
        return;
      }
    }
    
    if (token.isCode) {
      doc.setFillColor(241, 245, 249); // slate-100 background
      doc.rect(x - 0.3, y - 3.2, wordWidth + 0.6, 4.2, 'F');
      
      // Restore styles after background drawing
      doc.setFont(fontName, fontStyle);
      doc.setFontSize(fontSize);
      doc.setTextColor(textColor[0], textColor[1], textColor[2]);
    }
    
    doc.text(token.text, x, y);
    x += wordWidth;
  });
  
  return y;
};

interface ParsedTable {
  rows: string[][];
  consumedLines: number;
}

const splitTableCells = (line: string): string[] | null => {
  const trimmed = line.trim();
  if (!trimmed.includes('|')) {
    return null;
  }

  // Drop one optional leading/trailing pipe, treat `\|` as an escaped pipe.
  const inner = trimmed.replace(/^\|/, '').replace(/\|$/, '');
  const cells: string[] = [];
  let current = '';
  let escaping = false;

  for (const ch of inner) {
    if (escaping) {
      if (ch === '|') {
        current += '|';
      } else {
        current += '\\' + ch;
      }
      escaping = false;
    } else if (ch === '\\') {
      escaping = true;
    } else if (ch === '|') {
      cells.push(current.trim());
      current = '';
    } else {
      current += ch;
    }
  }
  if (escaping) {
    current += '\\';
  }
  cells.push(current.trim());

  return cells;
};

const isTableDelimiterRow = (cells: string[]): boolean =>
  cells.length > 0 && cells.every((cell) => /^:?-+:?$/.test(cell));

const looksLikeTable = (lines: string[]): ParsedTable | null => {
  if (lines.length < 2) {
    return null;
  }

  const headerCells = splitTableCells(lines[0]);
  const delimiterCells = splitTableCells(lines[1]);
  if (!headerCells || !delimiterCells) {
    return null;
  }
  if (headerCells.length === 0 || delimiterCells.length !== headerCells.length) {
    return null;
  }
  if (!isTableDelimiterRow(delimiterCells)) {
    return null;
  }
  const rows: string[][] = [headerCells];
  let consumedLines = 2;

  for (let idx = 2; idx < lines.length; idx++) {
    const cells = splitTableCells(lines[idx]);
    if (!cells) {
      break;
    }
    const normalized = cells.slice(0, headerCells.length);
    while (normalized.length < headerCells.length) {
      normalized.push('');
    }
    if (cells.length > headerCells.length) {
      normalized[normalized.length - 1] = [normalized[normalized.length - 1], ...cells.slice(headerCells.length)]
        .filter(Boolean)
        .join(' | ');
    }
    rows.push(normalized);
    consumedLines = idx + 1;
  }

  return { rows, consumedLines };
};

const renderTableBlock = (
  doc: jsPDF,
  table: ParsedTable,
  margin: number,
  contentWidth: number,
  startY: number,
  pageHeight: number
): number => {
  const plain = (cell: string): string => tokenizeParagraph(cell.replace(/<br\s*\/?>/gi, '\n')).map(token => token.text).join('');
  table = { ...table, rows: table.rows.map(row => row.map(plain)) };
  // Extremely wide tables are more readable as labelled records than tiny,
  // overlapping columns. Keep every field instead of clipping it off the page.
  if (table.rows[0].length > 12) {
    let y = startY;
    const rows = table.rows.length > 1 ? table.rows.slice(1) : [table.rows[0]];
    for (const row of rows) {
      for (let col = 0; col < row.length; col++) {
        y = renderTextBlock(doc, `${table.rows[0][col] || `Column ${col + 1}`}: ${row[col]}`, margin, contentWidth, y, pageHeight);
      }
      y += 3;
    }
    return y;
  }
  const fontSize = 8.0;
  const padX = 1.6;
  const gutter = 1.8;
  const rowGap = 4.0;

  doc.setFont('Helvetica', 'normal');
  doc.setFontSize(fontSize);

  const colCount = table.rows[0].length;
  const widths: number[] = [];

  for (let col = 0; col < colCount; col++) {
    let maxCellWidth = 0;
    table.rows.forEach((row) => {
      const cell = row[col] ?? '';
      const cellWidth = doc.getTextWidth(cell);
      if (cellWidth > maxCellWidth) {
        maxCellWidth = cellWidth;
      }
    });
    widths.push(Math.max(12, maxCellWidth + padX * 2));
  }

  const guttersTotal = gutter * (colCount - 1);
  const naturalTotal = widths.reduce((sum, w) => sum + w, 0) + guttersTotal;

  // Shrink columns proportionally so wide tables never overflow the page.
  const columnWidths =
    naturalTotal > contentWidth
      ? widths.map((w) => (w / widths.reduce((s, v) => s + v, 0)) * (contentWidth - guttersTotal))
      : widths;
  const tableWidth = columnWidths.reduce((sum, w) => sum + w, 0) + guttersTotal;

  const measureRow = (row: string[], isHeader = false): { lines: string[][]; height: number } => {
    doc.setFont('Helvetica', isHeader ? 'bold' : 'normal');
    doc.setFontSize(fontSize);
    const cellLines = row.map((cell, col) => {
      const wrapped: string[] = doc.splitTextToSize(cell || '', Math.max(2, columnWidths[col] - padX * 2));
      return wrapped.length ? wrapped : [''];
    });
    const height = cellLines.reduce((max, lines) => Math.max(max, lines.length), 1) * rowGap;
    return { lines: cellLines, height };
  };

  const paintRow = (row: string[], layouts: string[][], height: number, rowY: number, isHeader: boolean): void => {
    // Row background (header shading / zebra stripes) is painted BEFORE text
    // so a fill can never obscure cell contents.
    doc.setFillColor(
      isHeader ? 241 : 248,
      isHeader ? 245 : 250,
      isHeader ? 249 : 252
    );
    doc.rect(margin, rowY - 3, tableWidth, height + 1.2, 'F');

    doc.setFont('Helvetica', isHeader ? 'bold' : 'normal');
    doc.setFontSize(fontSize);
    doc.setTextColor(51, 65, 85); // slate-700

    row.forEach((_, col) => {
      const lines = layouts[col] ?? [''];
      const x = margin + columnWidths.slice(0, col).reduce((sum, w) => sum + w + gutter, 0) + padX;
      lines.forEach((lineText, lineIdx) => {
        if (lineText) {
          doc.text(lineText, x, rowY + lineIdx * rowGap);
        }
      });
    });

    doc.setDrawColor(226, 232, 240); // slate-200
    doc.setLineWidth(0.2);
    doc.line(margin, rowY - 3 + height + 1.2, margin + tableWidth, rowY - 3 + height + 1.2);
  };

  const headerRow = table.rows[0];
  let y = startY;

  table.rows.forEach((row, rowIdx) => {
    const isHeader = rowIdx === 0;
    const { lines } = measureRow(row, isHeader);
    const lineCount = lines.reduce((max, cell) => Math.max(max, cell.length), 1);
    const nextPage = () => {
      doc.addPage();
      y = 20;
      if (!isHeader) {
        // Repeat a compact header; the original full header is never dropped.
        const headerLines = measureRow(headerRow, true).lines.map(cell => cell.slice(0, 2));
        const headerHeight = headerLines.reduce((max, cell) => Math.max(max, cell.length), 1) * rowGap;
        paintRow(headerRow, headerLines, headerHeight, y, true);
        y += headerHeight + 1.2;
      }
    };
    let offset = 0;
    while (offset < lineCount) {
      let available = Math.floor((pageHeight - 20 - y - 1.2) / rowGap);
      if (available < 1) {
        nextPage();
        available = Math.floor((pageHeight - 20 - y - 1.2) / rowGap);
      }
      const count = Math.min(Math.max(1, available), lineCount - offset);
      paintRow(row, lines.map(cell => cell.slice(offset, offset + count)), count * rowGap, y, isHeader);
      y += count * rowGap + 1.2;
      offset += count;
      if (offset < lineCount) nextPage();
    }
  });

  return y + 2.5;
};

const renderTextBlock = (
  doc: jsPDF,
  textBlock: string,
  margin: number,
  contentWidth: number,
  startY: number,
  pageHeight: number
): number => {
  let y = startY;
  
  const paragraphs = textBlock.split('\n\n');
  
  paragraphs.forEach((p, pIdx) => {
    const trimmed = p.trim();
    if (!trimmed) return;
    
    const lines = trimmed.split('\n');
    let lineIdx = 0;

    while (lineIdx < lines.length) {
      const table = looksLikeTable(lines.slice(lineIdx));
      if (table) {
        y = renderTableBlock(doc, table, margin, contentWidth, y, pageHeight);
        lineIdx += table.consumedLines;
        continue;
      }

      const line = lines[lineIdx];
      lineIdx += 1;

      const lineTrimmed = line.trim();
      if (!lineTrimmed) continue;
      
      let isListItem = false;
      let indent = 0;
      let lineText = lineTrimmed;
      
      if (lineTrimmed.startsWith('* ') || lineTrimmed.startsWith('- ')) {
        isListItem = true;
        indent = 5;
        lineText = lineTrimmed.substring(2);
      }
      
      // Check if it is a header
      let isHeader = false;
      let headerLevel = 0;
      if (lineTrimmed.startsWith('#')) {
        let hashes = 0;
        while (hashes < lineTrimmed.length && lineTrimmed[hashes] === '#') {
          hashes++;
        }
        if (hashes > 0 && hashes < 6 && lineTrimmed[hashes] === ' ') {
          isHeader = true;
          headerLevel = hashes;
          lineText = lineTrimmed.substring(hashes + 1).trim();
        }
      }
      
      if (isHeader) {
        let fontSize: number;
        let lHeight: number;
        
        if (headerLevel === 1) {
          fontSize = 14;
          lHeight = 6.5;
        } else if (headerLevel === 2) {
          fontSize = 12.5;
          lHeight = 5.8;
        } else if (headerLevel === 3) {
          fontSize = 11;
          lHeight = 5.2;
        } else {
          fontSize = 10;
          lHeight = 4.8;
        }
        
        y = checkPageOverflow(doc, y, lHeight + 2, pageHeight, margin);
        
        y = renderLineWithInlineStyles(
          doc,
          lineText,
          margin,
          contentWidth,
          y,
          lHeight,
          pageHeight,
          margin,
          fontSize,
          'bold',
          [15, 23, 42] // Slate-900
        );
        
        y += lHeight + 1.0;
      } else {
        if (isListItem) {
          y = checkPageOverflow(doc, y, 5, pageHeight, margin);
          doc.setFont('Helvetica', 'bold');
          doc.setFontSize(10);
          doc.setTextColor(79, 70, 229); // Indigo-600 bullet
          doc.text('•', margin + 1.5, y);
        }
        
        y = renderLineWithInlineStyles(
          doc,
          lineText,
          margin + indent,
          contentWidth - indent,
          y,
          5.0, // Line height
          pageHeight,
          margin
        );
        
        y += 5.0; // Advance by line height!
      }
    }
    
    if (pIdx < paragraphs.length - 1) {
      y += 2.5;
    }
  });
  
  return y;
};

interface CodeLinePosition {
  text: string;
  y: number;
}

type CodePlanAction =
  | { kind: 'page' }
  | { kind: 'langHeader'; text: string; y: number }
  | { kind: 'segment'; startY: number; endY: number; lines: CodeLinePosition[] };

const renderCodeBlock = (
  doc: jsPDF,
  codeText: string,
  lang: string,
  margin: number,
  contentWidth: number,
  startY: number,
  pageHeight: number
): number => {
  doc.setFont('Courier', 'normal');
  doc.setFontSize(8.0);
  const splitCode: string[] = doc.splitTextToSize(codeText, contentWidth - 4);

  const lineGap = 4.2;
  const headerHeight = lang ? 5 : 0;

  // Simulate the layout first. Each page segment's background must be painted
  // BEFORE its text lines — painting it after would blank out the code.
  const plan: CodePlanAction[] = [];
  let simY = startY;
  const blockHeight = headerHeight + splitCode.length * lineGap + 3;
  if (blockHeight <= pageHeight - 40 && simY + blockHeight > pageHeight - 20) {
    // Keep a short example together when it fits on a fresh page.
    plan.push({ kind: 'page' });
    simY = 20;
  }

  if (lang) {
    if (simY + headerHeight + 2 > pageHeight - margin) {
      plan.push({ kind: 'page' });
      simY = 20;
    }
    plan.push({ kind: 'langHeader', text: lang.toUpperCase(), y: simY });
    simY += 4;
  }

  let segmentStartY = simY - 3;
  let segmentLines: CodeLinePosition[] = [];

  splitCode.forEach((line: string) => {
    if (simY + lineGap > pageHeight - 20) {
      plan.push({ kind: 'segment', startY: segmentStartY, endY: simY - 1, lines: segmentLines });
      plan.push({ kind: 'page' });
      simY = 20;
      segmentStartY = simY - 3;
      segmentLines = [];
    }
    segmentLines.push({ text: line, y: simY });
    simY += lineGap;
  });

  plan.push({ kind: 'segment', startY: segmentStartY, endY: simY - 1, lines: segmentLines });

  const drawPageCodeBackground = (startYPos: number, endYPos: number) => {
    doc.setFillColor(248, 250, 252); // slate-50
    doc.setDrawColor(226, 232, 240); // slate-200
    doc.setLineWidth(0.3);
    doc.roundedRect(margin - 2, startYPos, contentWidth + 4, endYPos - startYPos, 1.5, 1.5, 'FD');
    doc.setFillColor(148, 163, 184); // Slate-400 Left accent bar
    doc.rect(margin - 2, startYPos, 1.5, endYPos - startYPos, 'F');
  };

  plan.forEach((action) => {
    if (action.kind === 'page') {
      doc.addPage();
    } else if (action.kind === 'langHeader') {
      doc.setFont('Helvetica', 'bold');
      doc.setFontSize(7.5);
      doc.setTextColor(100, 116, 139); // slate-500
      doc.text(action.text, margin, action.y);
    } else {
      // Paint this page segment's background first, then write its code lines.
      drawPageCodeBackground(action.startY, action.endY);
      doc.setFont('Courier', 'normal');
      doc.setFontSize(8.0);
      doc.setTextColor(51, 65, 85); // slate-700
      action.lines.forEach((line) => {
        if (line.text) {
          doc.text(line.text, margin + 2, line.y);
        }
      });
    }
  });
  
  return simY + 3;
};

export const generatePdf = async (session: Session): Promise<Blob> => {
  const doc = new jsPDF({
    orientation: 'portrait',
    unit: 'mm',
    format: 'a4'
  });
  
  doc.setProperties({
    title: `MoveChat - ${session.title}`,
    subject: 'Conversation Handoff Transcript',
    creator: 'MoveChat Extension',
  });

  const pageWidth = doc.internal.pageSize.getWidth();
  const pageHeight = doc.internal.pageSize.getHeight();
  const margin = 20;
  const contentWidth = pageWidth - (margin * 2);
  let y = 20;

  // Pre-load all image dimensions in parallel
  const imageDimensionsMap = new Map<string, { width: number; height: number }>();
  const imagePromises: Promise<void>[] = [];

  session.messages.forEach(msg => {
    if (msg.files) {
      msg.files.forEach(file => {
        if (file.type.startsWith('image/') && file.content && file.content.startsWith('data:image/')) {
          const content = file.content;
          const promise = getImageDimensions(content).then(dims => {
            imageDimensionsMap.set(content, dims);
          });
          imagePromises.push(promise);
        }
      });
    }
  });

  await Promise.all(imagePromises);

  // Title Header
  doc.setFont('Helvetica', 'bold');
  doc.setFontSize(16);
  doc.setTextColor(15, 23, 42); // Slate-900
  doc.text('MoveChat - Conversation Handoff', margin, y);
  y += 8;

  // Metadata Info Card
  doc.setFontSize(8.5);
  const sourceLines: string[] = session.sourceUrl ? doc.splitTextToSize(`Source: ${session.sourceUrl}`, contentWidth - 8) : [];
  const cardHeight = 24 + sourceLines.length * 4;
  doc.setFillColor(248, 250, 252); // slate-50 background
  doc.setDrawColor(241, 245, 249); // slate-100 border
  doc.setLineWidth(0.3);
  doc.roundedRect(margin, y, contentWidth, cardHeight, 2, 2, 'FD');
  
  // Card Contents
  let cardY = y + 5;
  doc.setFont('Helvetica', 'bold');
  doc.setFontSize(9.5);
  doc.setTextColor(51, 65, 85); // slate-700
  
  const titleText = `Title: ${session.title}`;
  const splitTitle = doc.splitTextToSize(titleText, contentWidth - 8);
  doc.text(splitTitle[0] + (splitTitle.length > 1 ? '...' : ''), margin + 4, cardY);
  cardY += 5;
  
  doc.setFont('Helvetica', 'normal');
  doc.setFontSize(8.5);
  doc.setTextColor(100, 116, 139); // slate-500
  doc.text(`Platform: ${(session.platform || 'unknown').toUpperCase()}    |    Saved: ${new Date(session.savedAt).toLocaleString()}`, margin + 4, cardY);
  cardY += 5;
  
  doc.text(`Stats: ${session.messageCount} messages    |    ${session.imageCount} images    |    ${session.fileCount} files`, margin + 4, cardY);
  sourceLines.forEach(line => {
    cardY += 4;
    doc.text(line, margin + 4, cardY);
  });
  
  y += cardHeight + 8;

  session.messages.forEach((msg) => {
    // Message header (role)
    y = checkPageOverflow(doc, y, 15, pageHeight, margin);
    
    // Draw left accent vertical bar
    if (msg.role === 'user') {
      doc.setFillColor(148, 163, 184); // Slate-400
    } else {
      doc.setFillColor(79, 70, 229); // Indigo-600
    }
    doc.rect(margin, y - 4, 1.5, 5, 'F'); // 1.5mm wide, 5mm tall bar
    
    doc.setFont('Helvetica', 'bold');
    doc.setFontSize(11);
    doc.setTextColor(15, 23, 42); // Slate-900
    doc.text(msg.role === 'user' ? 'User' : 'Assistant', margin + 4, y);
    y += 8;

    if (msg.thinking) {
      y = checkPageOverflow(doc, y, 10, pageHeight, margin);
      doc.setFont('Helvetica', 'bold');
      doc.setFontSize(8);
      doc.setTextColor(100, 116, 139);
      doc.text('Thinking', margin + 2, y);
      y += 5;
      for (const part of splitFencedContent(msg.thinking)) {
        if (part.type === 'code') {
          y = renderCodeBlock(doc, part.content, part.lang, margin + 2, contentWidth - 4, y, pageHeight);
        } else {
          y = renderTextBlock(doc, part.content, margin + 2, contentWidth - 4, y, pageHeight);
        }
      }
      y += 6;
    }

    // List any attachments in this message (ignoring base64 inline images)
    if (msg.files && msg.files.length > 0) {
      const nonImageFiles = msg.files.filter(file => !(file.type.startsWith('image/') && file.content));
      if (nonImageFiles.length > 0) {
        doc.setFont('Helvetica', 'italic');
        doc.setFontSize(8.5);
        doc.setTextColor(148, 163, 184); // Slate-400
        nonImageFiles.forEach(file => {
          y = checkPageOverflow(doc, y, 5, pageHeight, margin);
          doc.text(`Attachment: ${file.name} (${file.type})${file.size ? ` - ${Math.round(file.size / 1024)}KB` : ''}`, margin + 4, y);
          y += 5;
        });
        y += 2;
      }
    }

    // Parse message body into normal text blocks and code blocks
    splitFencedContent(msg.content).forEach(part => {
      if (part.type === 'code') {
        y = renderCodeBlock(doc, part.content, part.lang, margin, contentWidth, y, pageHeight);
      } else {
        y = renderTextBlock(doc, part.content, margin, contentWidth, y, pageHeight);
      }
    });

    y += 3;

    // Embed any image attachments
    if (msg.files) {
      msg.files.forEach(file => {
        if (file.type === 'image/url' && file.content) {
          // Image conversion failed — show a placeholder with the URL
          y = checkPageOverflow(doc, y, 15, pageHeight, margin);
          doc.setFont('Helvetica', 'italic');
          doc.setFontSize(8.5);
          doc.setTextColor(148, 163, 184); // Slate-400
          doc.text(`[Image: ${file.name}]`, margin + 4, y);
          y += 4;
          doc.setTextColor(100, 116, 139); // Slate-500
          const urlText = doc.splitTextToSize(`Source: ${file.content}`, contentWidth - 8);
          urlText.forEach((line: string) => {
            doc.text(line, margin + 4, y);
            y += 4;
          });
          y += 4;
        } else if (file.type.startsWith('image/') && file.content && file.content.startsWith('data:image/')) {
          try {
            const formatMatch = file.content.match(/^data:image\/(\w+);base64,/);
            const format = formatMatch ? formatMatch[1].toUpperCase() : 'JPEG';
            
            const dims = imageDimensionsMap.get(file.content) || { width: 0, height: 0 };
            
            let imgWidth = Math.min(120, contentWidth);
            let imgHeight = 70;
            
            if (dims.width > 0 && dims.height > 0) {
              const ratio = dims.width / dims.height;
              const naturalWidthMm = dims.width * 0.264583;
              const naturalHeightMm = dims.height * 0.264583;
              
              const maxWidth = Math.min(140, contentWidth);
              const maxDisplayHeight = pageHeight - (margin * 2) - 10;
              
              imgWidth = naturalWidthMm;
              imgHeight = naturalHeightMm;
              
              if (imgWidth > maxWidth) {
                imgWidth = maxWidth;
                imgHeight = imgWidth / ratio;
              }
              if (imgHeight > maxDisplayHeight) {
                imgHeight = maxDisplayHeight;
                imgWidth = imgHeight * ratio;
              }
            }
            
            y = checkPageOverflow(doc, y, imgHeight + 10, pageHeight, margin);
            doc.addImage(file.content, format, margin, y, imgWidth, imgHeight);
            y += imgHeight + 8;
          } catch (e) {
            console.error("Failed to embed base64 image in PDF:", e);
          }
        }
      });
    }

    // End of message turn divider
    y = checkPageOverflow(doc, y, 10, pageHeight, margin);
    doc.setDrawColor(241, 245, 249); // slate-100
    doc.line(margin, y, pageWidth - margin, y);
    y += 8;
  });

  return doc.output('blob');
};
