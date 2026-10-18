import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { injectChatGPT } from '../src/content/injectors/chatgpt';
import { getStorage } from '../src/content/storage';
import type { PendingHandoff } from '../src/shared/types';

vi.mock('../src/content/storage', () => ({ getStorage: vi.fn() }));

class TestDataTransfer {
  files: File[] = [];
  items = { add: (file: File) => this.files.push(file) };
}

const pending: PendingHandoff = {
  targetPlatform: 'chatgpt',
  handoffText: 'Continue this test conversation.',
  fileName: 'transcript.md',
  mimeType: 'text/markdown',
  fileContent: '# Transcript\n\nTest conversation.',
  attachments: [
    { name: 'notes.txt', type: 'text/plain', content: 'test notes' },
    { name: 'debug_log.txt', type: 'text/plain', content: 'debug information' },
  ],
};

const setup = (inputs: string) => {
  document.body.innerHTML = `<form><div id="prompt-textarea" contenteditable="true"></div>${inputs}<button type="button" data-testid="send-button">Send</button></form>`;
  const changes: string[] = [];
  document.querySelectorAll<HTMLInputElement>('input').forEach(input => {
    let files: File[] = [];
    Object.defineProperty(input, 'files', { configurable: true, get: () => files, set: value => { files = value; } });
    input.addEventListener('change', () => changes.push(input.id));
  });
  return { changes, button: document.querySelector<HTMLButtonElement>('button')! };
};

beforeEach(() => {
  vi.useFakeTimers();
  vi.mocked(getStorage).mockResolvedValue({ autoSend: false });
  vi.stubGlobal('DataTransfer', TestDataTransfer);
  vi.stubGlobal('ClipboardEvent', Event);
  vi.stubGlobal('DragEvent', Event);
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe('ChatGPT resume file input selection', () => {
  it('uses unrestricted Attach files rather than the camera', async () => {
    const { changes, button } = setup('<input id="camera" type="file" accept="image/*"><input id="files" type="file" multiple>');
    const click = vi.spyOn(button, 'click');
    await injectChatGPT(pending);
    await vi.advanceTimersByTimeAsync(3000);
    expect(changes).toEqual(['files']);
    expect(Array.from(document.querySelector<HTMLInputElement>('#files')!.files!).map(file => file.name)).toEqual(['transcript.md', 'notes.txt']);
    expect(document.querySelector('#prompt-textarea')!.textContent).toContain(pending.handoffText);
    expect(click).not.toHaveBeenCalled();
  });

  it('retains the single restricted file input fallback', async () => {
    const { changes } = setup('<input id="files" type="file" accept=".md,.pdf" multiple>');
    await injectChatGPT(pending);
    await vi.advanceTimersByTimeAsync(1000);
    expect(changes).toEqual(['files']);
  });

  it('ignores disabled inputs before choosing the attachment input', async () => {
    const { changes } = setup('<input id="disabled" type="file" disabled><input id="files" type="file" multiple>');
    await injectChatGPT(pending);
    await vi.advanceTimersByTimeAsync(1000);
    expect(changes).toEqual(['files']);
  });

  it('uses paste/drop fallbacks when no file input is available', async () => {
    setup('');
    const paste = vi.fn();
    const drop = vi.fn();
    document.querySelector('#prompt-textarea')!.addEventListener('paste', paste);
    document.querySelector('form')!.addEventListener('drop', drop);
    await injectChatGPT(pending);
    await vi.advanceTimersByTimeAsync(1000);
    expect(paste).toHaveBeenCalledOnce();
    expect(drop).toHaveBeenCalledOnce();
  });

  it('does not auto-send unless the saved setting explicitly enables it', async () => {
    const { button } = setup('<input id="files" type="file" multiple>');
    const click = vi.spyOn(button, 'click');
    vi.mocked(getStorage).mockResolvedValue({ autoSend: true });
    await injectChatGPT(pending);
    await vi.advanceTimersByTimeAsync(2499);
    expect(click).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1);
    expect(click).toHaveBeenCalledOnce();
  });
});
