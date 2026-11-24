import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { injectChatGPT } from '../src/content/injectors/chatgpt';
import { getStorage } from '../src/content/storage';
import type { PendingHandoff } from '../src/shared/types';

vi.mock('../src/content/storage', () => ({ getStorage: vi.fn() }));

class TestDataTransfer {
  files: File[] = [];
  items = { add: (file: File) => this.files.push(file) };
}

class FileEvent extends Event {
  files: File[];
  constructor(name: string, options: EventInit & { clipboardData?: TestDataTransfer; dataTransfer?: TestDataTransfer }) {
    super(name, options);
    this.files = (options.clipboardData || options.dataTransfer)!.files;
  }
}

const pending: PendingHandoff = {
  targetPlatform: 'chatgpt',
  handoffText: 'Continue this test conversation.',
  fileName: 'transcript.md',
  mimeType: 'text/markdown',
  fileContent: '# Transcript\n\nTest conversation.',
  attachments: [
    { name: 'picture.png', type: 'image/png', content: 'data:image/png;base64,AA==' },
    { name: 'debug_log.txt', type: 'text/plain', content: 'debug information' },
  ],
};

function showFiles(form: HTMLFormElement, files: File[]) {
  for (const file of files) {
    const chip = document.createElement('div');
    chip.setAttribute('role', 'group');
    chip.setAttribute('aria-label', file.name);
    form.appendChild(chip);
  }
}

function setup(inputs = '<input id="upload-files" type="file" multiple>', textarea = false) {
  document.body.innerHTML = `<div id="history"></div><form>
    ${textarea ? '<textarea id="prompt-textarea"></textarea>' : '<div id="prompt-textarea" contenteditable="true"></div>'}
    ${inputs}<button type="button" data-testid="send-button">Send</button></form>`;
  const received: Array<{ input: string; files: File[] }> = [];
  for (const input of document.querySelectorAll<HTMLInputElement>('input')) {
    let files: File[] = [];
    Object.defineProperty(input, 'files', { configurable: true, get: () => files, set: value => { files = value; } });
    input.addEventListener('change', () => received.push({ input: input.id, files }));
  }
  return {
    received,
    form: document.querySelector('form')!,
    editor: document.querySelector<HTMLElement>('#prompt-textarea')!,
    button: document.querySelector<HTMLButtonElement>('button')!,
  };
}

async function completeTime(job: Promise<void>, ms = 21_000) {
  await vi.advanceTimersByTimeAsync(ms);
  await job;
}

beforeEach(() => {
  vi.useFakeTimers();
  vi.mocked(getStorage).mockResolvedValue({ autoSend: false });
  vi.stubGlobal('DataTransfer', TestDataTransfer);
  vi.stubGlobal('ClipboardEvent', FileEvent);
  vi.stubGlobal('DragEvent', FileEvent);
  vi.spyOn(console, 'warn').mockImplementation(() => undefined);
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe('ChatGPT handoff', () => {
  it('prefers the file input and detects image chip labels without sending when Auto-send is off', async () => {
    const { received, editor, form, button } = setup('<input id="camera" type="file" capture accept="image/*"><input id="upload-files" type="file" multiple>');
    const click = vi.spyOn(button, 'click');
    form.addEventListener('change', () => showFiles(form, received[0].files));
    await completeTime(injectChatGPT(pending));
    expect(received.map(entry => entry.input)).toEqual(['upload-files']);
    expect(received[0].files.map(file => file.name)).toEqual(['transcript.md', 'picture.png']);
    expect(editor.textContent).toBe(pending.handoffText);
    expect(click).not.toHaveBeenCalled();
  });

  it('waits for the complete upload and for the textarea composer to enable Send', async () => {
    const { received, editor, form, button } = setup(undefined, true);
    vi.mocked(getStorage).mockResolvedValue({ autoSend: true });
    button.disabled = true;
    const click = vi.spyOn(button, 'click');
    form.addEventListener('change', () => {
      setTimeout(() => showFiles(form, received[0].files), 2_100);
    });
    const paste = vi.fn();
    editor.addEventListener('paste', paste);
    const job = injectChatGPT(pending);
    await vi.advanceTimersByTimeAsync(6_000);
    expect(click).not.toHaveBeenCalled();
    expect((editor as HTMLTextAreaElement).value).toBe(pending.handoffText);
    expect(received).toHaveLength(1);
    expect(paste).not.toHaveBeenCalled();
    button.disabled = false;
    await completeTime(job);
    expect(click).toHaveBeenCalledOnce();
  });

  it('ignores past filenames outside the composer and retries only missing files', async () => {
    const { received, editor, form, button } = setup();
    vi.mocked(getStorage).mockResolvedValue({ autoSend: true });
    document.querySelector('#history')!.textContent = pending.fileName;
    form.addEventListener('change', () => showFiles(form, received[0].files.slice(1)));
    const paste = vi.fn((event: Event) => {
      const files = (event as FileEvent).files;
      expect(files.map(file => file.name)).toEqual(['transcript.md']);
      showFiles(form, files);
    });
    editor.addEventListener('paste', paste);
    const click = vi.spyOn(button, 'click');
    const job = injectChatGPT(pending);
    await vi.advanceTimersByTimeAsync(3_000);
    expect(click).not.toHaveBeenCalled();
    await completeTime(job);
    expect(paste).toHaveBeenCalledOnce();
    expect(click).toHaveBeenCalledOnce();
  });

  it('reattaches to a replacement composer before clicking its Send button', async () => {
    const first = setup();
    vi.mocked(getStorage).mockResolvedValue({ autoSend: true });
    const firstClick = vi.spyOn(first.button, 'click');
    first.form.addEventListener('change', () => showFiles(first.form, first.received[0].files));
    const job = injectChatGPT(pending);
    await vi.advanceTimersByTimeAsync(600);
    const second = setup();
    second.form.addEventListener('change', () => showFiles(second.form, second.received[0].files));
    const secondClick = vi.spyOn(second.button, 'click');
    await completeTime(job);
    expect(firstClick).not.toHaveBeenCalled();
    expect(second.received.map(entry => entry.input)).toEqual(['upload-files']);
    expect(secondClick).toHaveBeenCalledOnce();
  });

  it('tries drop when paste does not work and skips camera or disabled inputs', async () => {
    const { received, editor, form, button } = setup('<input type="file" id="upload-photos" accept="image/*"><input type="file" id="upload-files" disabled>');
    const paste = vi.fn();
    const drop = vi.fn((event: Event) => showFiles(form, (event as FileEvent).files));
    editor.addEventListener('paste', paste);
    form.addEventListener('drop', drop);
    await completeTime(injectChatGPT(pending));
    expect(received).toEqual([]);
    expect(paste).toHaveBeenCalledOnce();
    expect(drop).toHaveBeenCalledOnce();
    expect(vi.spyOn(button, 'click')).not.toHaveBeenCalled();
  });

  it('leaves a user-edited draft alone and never sends a partial upload', async () => {
    const { editor, button } = setup();
    vi.mocked(getStorage).mockResolvedValue({ autoSend: true });
    const click = vi.spyOn(button, 'click');
    const job = injectChatGPT(pending);
    await vi.advanceTimersByTimeAsync(1_000);
    editor.textContent = 'My own draft';
    await completeTime(job);
    expect(editor.textContent).toBe('My own draft');
    expect(click).not.toHaveBeenCalled();
  });

  it('does not send when a file never appears', async () => {
    const { received, form, button } = setup();
    form.addEventListener('change', () => showFiles(form, received[0].files.slice(1)));
    vi.mocked(getStorage).mockResolvedValue({ autoSend: true });
    const click = vi.spyOn(button, 'click');
    await completeTime(injectChatGPT(pending));
    expect(click).not.toHaveBeenCalled();
    expect(console.warn).toHaveBeenCalledOnce();
  });
});
