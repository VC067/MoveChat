import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { captureFromPage } from '../src/content/capture-context';

const originalPath = window.location.pathname;
beforeEach(() => {
  document.title = 'Conversation A';
  window.history.replaceState({}, '', '/c/conversation-a');
});
afterEach(() => window.history.replaceState({}, '', originalPath));

describe('capture provenance', () => {
  it('returns the starting page identity alongside the captured payload', async () => {
    const result = await captureFromPage(async () => ({ messages: ['Test A'] }));
    expect(result.sourceUrl).toBe(window.location.href);
    expect(result.sourceTitle).toBe('Conversation A');
    expect(result.result.messages).toEqual(['Test A']);
  });

  it('rejects navigation before an async capture completes', async () => {
    await expect(captureFromPage(async () => {
      window.history.replaceState({}, '', '/c/conversation-b');
      return { messages: ['Test A'] };
    })).rejects.toThrow('Nothing was saved');
  });

  it('rejects a title change even when the route has not caught up', async () => {
    await expect(captureFromPage(async () => {
      document.title = 'Conversation B';
      return { messages: ['Test A'] };
    })).rejects.toThrow('page changed');
  });

  it('does not mistake a fragment-only change for a different conversation', async () => {
    const result = await captureFromPage(async () => {
      window.history.replaceState({}, '', '/c/conversation-a#message');
      return { messages: ['Test A'] };
    });
    expect(result.sourceUrl).not.toContain('#message');
  });
});
