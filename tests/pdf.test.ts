import { beforeEach, describe, expect, it, vi } from 'vitest';
import { generatePdf, splitFencedContent } from '../src/shared/pdf';
import type { Session } from '../src/shared/types';

interface Operation {
  kind: string;
  page: number;
  text?: string;
  font?: string;
  y?: number;
  height?: number;
}
const { operations } = vi.hoisted(() => ({ operations: [] as Operation[] }));

vi.mock('jspdf', () => ({
  jsPDF: class {
    page = 1;
    font = 'Helvetica';
    internal = { pageSize: { getWidth: () => 210, getHeight: () => 297 } };
    setProperties() {}
    setFont(font: string) { this.font = font; }
    setFontSize() {}
    setTextColor() {}
    setFillColor() {}
    setDrawColor() {}
    setLineWidth() {}
    getTextWidth(text: string) { return text.length * 1.5; }
    splitTextToSize(text: string, width: number) {
      const size = Math.max(1, Math.floor(width / 1.5));
      return text.split('\n').flatMap(line => {
        if (!line) return [''];
        const chunks = [];
        for (let i = 0; i < line.length; i += size) chunks.push(line.slice(i, i + size));
        return chunks;
      });
    }
    text(text: string | string[], _x: number, y: number) {
      for (const line of Array.isArray(text) ? text : [text]) operations.push({ kind: 'text', page: this.page, text: line, font: this.font, y });
    }
    roundedRect(_x: number, y: number, _w: number, height: number, _rx: number, _ry: number, style: string) {
      operations.push({ kind: style.includes('F') ? 'fill' : 'stroke', page: this.page, y, height });
    }
    rect(_x: number, y: number, _w: number, height: number, style: string) {
      operations.push({ kind: style.includes('F') ? 'fill' : 'stroke', page: this.page, y, height });
    }
    line() {}
    addPage() { this.page++; operations.push({ kind: 'page', page: this.page }); }
    output() { return new Blob(['%PDF-mocked']); }
  },
}));

const session = (content: string, thinking?: string): Session => ({
  id: 'pdf-fixture', title: 'PDF regression', platform: 'chatgpt', messageCount: 1,
  imageCount: 0, fileCount: 0, savedAt: '2026-10-18T00:00:00Z', startedAt: '2026-10-18T00:00:00Z',
  messages: [{ role: 'assistant', content, thinking }],
});

beforeEach(() => { operations.length = 0; });

describe('fenced-code parsing', () => {
  it('preserves first-line indentation and blank lines', () => {
    expect(splitFencedContent('Before\n\n```python\n    first\n\n        second\n```\n\nAfter')).toEqual([
      { type: 'text', content: 'Before\n', lang: '' },
      { type: 'code', content: '    first\n\n        second\n', lang: 'python' },
      { type: 'text', content: '\nAfter', lang: '' },
    ]);
  });

  it('keeps literal triple backticks inside a longer outer fence', () => {
    const parts = splitFencedContent('````python\nmarker = "```"\n    keep = True\n````');
    expect(parts).toEqual([{ type: 'code', content: 'marker = "```"\n    keep = True\n', lang: 'python' }]);
  });

  it('does not treat inline backtick runs as block fences', () => {
    expect(splitFencedContent('Use ```literal``` here.')).toEqual([{ type: 'text', content: 'Use ```literal``` here.', lang: '' }]);
  });

  it('supports tilde, unlabelled and unclosed fences', () => {
    expect(splitFencedContent('~~~js\nconst value = 1;\n~~~')[0].content).toBe('const value = 1;\n');
    expect(splitFencedContent('```\n    literal\n```')[0]).toEqual({ type: 'code', content: '    literal\n', lang: '' });
    expect(splitFencedContent('```python\n    unfinished')[0].content).toBe('    unfinished');
  });
});

describe('PDF drawing', () => {
  it('records the verified source URL in the metadata card', async () => {
    await generatePdf({ ...session('Python question'), sourceUrl: 'https://chatgpt.com/c/python-test' });
    expect(operations.filter(op => op.kind === 'text').map(op => op.text).join('')).toContain('Source: https://chatgpt.com/c/python-test');
  });
  it('paints code backgrounds before code text, never over it', async () => {
    await generatePdf(session('```python\ndef test():\n    return 1\n```'));
    const code = operations.filter(op => op.kind === 'text' && op.font === 'Courier');
    expect(code.map(op => op.text)).toContain('    return 1');
    for (const line of code) {
      const index = operations.indexOf(line);
      expect(operations.slice(0, index).some(op => op.kind === 'fill' && op.page === line.page && op.y! <= line.y! && op.y! + op.height! >= line.y!)).toBe(true);
      expect(operations.slice(index + 1).some(op => op.kind === 'fill' && op.page === line.page && op.y! <= line.y! && op.y! + op.height! >= line.y!)).toBe(false);
    }
  });

  it('retains code on every page of a long block', async () => {
    const lines = Array.from({ length: 160 }, (_, i) => `    code_line_${i}`);
    await generatePdf(session(`\`\`\`python\n${lines.join('\n')}\n\`\`\``));
    const rendered = operations.filter(op => op.kind === 'text' && op.font === 'Courier');
    expect(rendered.map(op => op.text)).toEqual(lines);
    expect(new Set(rendered.map(op => op.page)).size).toBeGreaterThan(2);
    expect(rendered.every(op => op.y! <= 277)).toBe(true);
  });

  it('moves a short code block together rather than splitting two lines across pages', async () => {
    const prose = Array.from({ length: 26 }, () => 'Paragraph.').join('\n\n');
    await generatePdf(session(`${prose}\n\n\`\`\`python\nfirst_line\n    second_line\n\`\`\``));
    const code = operations.filter(op => op.kind === 'text' && op.font === 'Courier');
    expect(code.map(op => op.text)).toEqual(['first_line', '    second_line']);
    expect(new Set(code.map(op => op.page)).size).toBe(1);
    expect(code[0].page).toBeGreaterThan(1);
  });

  it('preserves inline identifiers, asterisks and literal backticks', async () => {
    await generatePdf(session('Use `summarize_groups()` and ``a`b_*``.'));
    const inline = operations.filter(op => op.kind === 'text' && op.font === 'Courier').map(op => op.text).join('');
    expect(inline).toBe('summarize_groups()a`b_*');
  });

  it('uses longer fences in both message content and thinking', async () => {
    await generatePdf(session('````python\nmarker = "```"\n    keep = True\n````', '````python\nreason_marker = "```"\n    reason = True\n````'));
    const rendered = operations.filter(op => op.kind === 'text' && op.font === 'Courier').map(op => op.text);
    expect(rendered).toContain('marker = "```"');
    expect(rendered).toContain('    keep = True');
    expect(rendered).toContain('reason_marker = "```"');
  });

  it('renders table cells without leaking Markdown emphasis markers', async () => {
    await generatePdf(session('| Group | Total |\n| --- | --- |\n| alpha | **4** |\n| beta | `count_total` |'));
    const text = operations.filter(op => op.kind === 'text').map(op => op.text);
    expect(text).toContain('alpha');
    expect(text).toContain('4');
    expect(text).toContain('count_total');
    expect(text).not.toContain('**4**');
  });

  it('splits very tall table rows across pages without clipping cell data', async () => {
    const value = Array.from({ length: 150 }, (_, i) => `cell_${i}`).join('<br>');
    await generatePdf(session(`| Field | Value |\n| --- | --- |\n| data | ${value} |`));
    const text = operations.filter(op => op.kind === 'text');
    expect(text.map(op => op.text)).toContain('cell_149');
    expect(text.every(op => op.y! <= 277)).toBe(true);
  });
});
