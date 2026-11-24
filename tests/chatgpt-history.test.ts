import { afterEach, describe, expect, it, vi } from 'vitest';
import { readChatGPTHistory } from '../src/content/scrapers/chatgpt-history';
import type { Message } from '../src/shared/types';

const id = '12345678-1234-1234-1234-123456789abc';
const url = `https://chatgpt.com/c/${id}`;
const base = `/backend-api/conversation/${id}`;
const auth = 'synthetic-test-credential';
const json = (data: unknown, status = 200) => new Response(JSON.stringify(data), { status });
const photo = 'photo fixture bytes';
const visible = new Map<string, Message>([['last', { role: 'assistant', content: 'Formatted **last**' }]]);

const mapping = {
  root: { parent: null },
  system: { parent: 'root', message: { author: { role: 'system' }, content: { parts: ['System prompt'] } } },
  first: {
    parent: 'system',
    message: {
      author: { role: 'user' },
      metadata: { attachments: [{ id: 'file_123', name: 'ticket.png', mime_type: 'image/png' }] },
      content: { parts: ['First question', { content_type: 'image_asset_pointer', asset_pointer: 'sediment://file_123' }] },
    },
  },
  intermediate: { parent: 'first', message: { author: { role: 'assistant' }, content: { parts: ['Earlier answer'] } } },
  last: { parent: 'intermediate', message: { author: { role: 'assistant' }, content: { parts: ['Last answer'] } } },
  alternate: { parent: 'intermediate', message: { author: { role: 'assistant' }, content: { parts: ['Regenerated branch'] } } },
};

afterEach(() => vi.unstubAllGlobals());

describe('complete ChatGPT history', () => {
  it('saves unseen turns and downloads each uploaded image once from the active branch', async () => {
    const fetchMock = vi.fn(async (request: URL, options: RequestInit) => {
      const header = new Headers(options.headers).get('Authorization');
      if (request.pathname === '/api/auth/session') {
        expect(request.origin).toBe('https://chatgpt.com');
        expect(header).toBeNull();
        return json({ accessToken: auth });
      }
      if (request.pathname === base) {
        return header ? json({ conversation_id: id, mapping, current_node: 'last' }) : json({}, 401);
      }
      if (request.pathname === `${base}/attachment/file_123/download`) {
        expect(header).toBe(`Bearer ${auth}`);
        return json({ download_url: '/backend-api/estuary/content?id=file_123' });
      }
      if (request.pathname === '/backend-api/estuary/content') {
        expect(header).toBe(`Bearer ${auth}`);
        expect(options.redirect).toBe('error');
        return { ok: true, blob: async () => new Blob([photo], { type: 'image/png' }) };
      }
      throw new Error('Unexpected request');
    });
    vi.stubGlobal('fetch', fetchMock);
    const result = await readChatGPTHistory(url, visible, () => {});
    expect(result).toEqual({
      missingImageCount: 0,
      messages: [
        { role: 'user', content: 'First question', files: [{ name: 'ticket.png', type: 'image/png', content: `data:image/png;base64,${btoa(photo)}` }] },
        { role: 'assistant', content: 'Earlier answer' },
        { role: 'assistant', content: 'Formatted **last**' },
      ],
    });
    expect(fetchMock).toHaveBeenCalledTimes(5);
  });

  it('keeps the complete text and reports an expired image instead of aborting the save', async () => {
    vi.stubGlobal('fetch', vi.fn(async (request: URL) => {
      if (request.pathname === base) return json({ mapping, current_node: 'last' });
      return json({}, 404);
    }));
    const result = await readChatGPTHistory(url, visible, () => {});
    expect(result?.messages.map(message => message.content))
      .toEqual(['First question', 'Earlier answer', 'Formatted **last**']);
    expect(result?.messages[0].files).toBeUndefined();
    expect(result?.missingImageCount).toBe(1);
  });

  it('does not send credentials or fetch a download URL on an unrelated domain', async () => {
    const fetchMock = vi.fn(async (request: URL) => {
      expect(request.origin).toBe('https://chatgpt.com');
      return request.pathname === base
        ? json({ mapping, current_node: 'last' })
        : json({ download_url: 'https://example.test/fake-photo.png' });
    });
    vi.stubGlobal('fetch', fetchMock);
    const result = await readChatGPTHistory(url, visible, () => {});
    expect(result?.missingImageCount).toBe(1);
    expect(fetchMock).toHaveBeenCalledTimes(3);
  });

  it('falls back to the active page if the server returns a different visible branch', async () => {
    const fetchMock = vi.fn(async () => json({ mapping, current_node: 'alternate' }));
    vi.stubGlobal('fetch', fetchMock);
    await expect(readChatGPTHistory(url, visible, () => {})).resolves.toBeNull();
    expect(fetchMock).toHaveBeenCalledOnce();
  });

  it('falls back if part of the conversation’s parent chain is missing', async () => {
    const broken = { ...mapping, intermediate: { parent: 'missing' } };
    vi.stubGlobal('fetch', vi.fn(async () => json({ mapping: broken, current_node: 'last' })));
    await expect(readChatGPTHistory(url, visible, () => {})).resolves.toBeNull();
  });
});
