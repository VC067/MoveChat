import type { PendingHandoff, Settings, AttachedFile } from '../../shared/types';
import { getStorage } from '../storage';

function attachedFileToFile(attached: AttachedFile): File {
  const content = attached.content || '';
  if (!content.startsWith('data:')) {
    return new File([content], attached.name, { type: attached.type });
  }
  const bytes = Uint8Array.from(atob(content.slice(content.indexOf(',') + 1)), char => char.charCodeAt(0));
  return new File([bytes], attached.name, { type: attached.type });
}

function buildFiles(pending: PendingHandoff): File[] {
  const main = attachedFileToFile({
    name: pending.fileName,
    type: pending.mimeType,
    content: pending.mimeType !== 'text/markdown' && !pending.fileContent.startsWith('data:')
      ? `data:${pending.mimeType};base64,${pending.fileContent}`
      : pending.fileContent,
  });
  const files = [main];
  const usedNames = new Set([main.name]);
  for (const attachment of pending.attachments || []) {
    if (attachment.name === 'debug_log.txt') continue;
    const file = attachedFileToFile(attachment);
    const dot = file.name.lastIndexOf('.');
    const stem = dot > 0 ? file.name.slice(0, dot) : file.name;
    const extension = dot > 0 ? file.name.slice(dot) : '';
    let name = file.name;
    for (let suffix = 2; usedNames.has(name); suffix++) name = `${stem} (${suffix})${extension}`;
    usedNames.add(name);
    files.push(name === file.name ? file : new File([file], name, { type: file.type }));
  }
  return files;
}

function findComposer() {
  const findVisible = (selector: string) => Array.from(document.querySelectorAll<HTMLElement>(selector))
    .find(element => !element.closest('[hidden], [inert], [aria-hidden="true"], [role="dialog"]') &&
      getComputedStyle(element).display !== 'none' && getComputedStyle(element).visibility !== 'hidden');
  const editor = findVisible('#prompt-textarea')
    ?? findVisible('form .ProseMirror[contenteditable="true"], form textarea')
    ?? findVisible('form [contenteditable="true"]');
  if (!editor) return null;
  const root = editor.closest('form') ?? editor.closest('[data-testid="composer"], #thread-bottom-container');
  return { editor, root };
}

function findFileInput(root: Element | null, files: File[]): HTMLInputElement | undefined {
  const knownInput = document.querySelector<HTMLInputElement>('input[type="file"]#upload-files');
  const inputs = [
    ...(knownInput ? [knownInput] : []),
    ...Array.from(root?.querySelectorAll<HTMLInputElement>('input[type="file"]') ?? []),
  ];
  return inputs.find(input => {
    if (input.disabled || input.hasAttribute('capture') || input.id === 'upload-photos') return false;
    const accept = input.accept.toLowerCase().split(',').map(token => token.trim()).filter(Boolean);
    if (!accept.length) return true;
    return accept.some(token => !/^(image|video|audio)\//.test(token)) && files.every(file =>
      accept.some(token => token.startsWith('.') ? file.name.toLowerCase().endsWith(token)
        : token.endsWith('/*') ? file.type.startsWith(token.slice(0, -1))
        : token === file.type)
    );
  });
}

const normalize = (text: string): string => text.replace(/\s+/g, ' ').trim();

function readEditor(editor: HTMLElement): string {
  return normalize(editor instanceof HTMLTextAreaElement ? editor.value : editor.innerText ?? editor.textContent ?? '');
}

function insertText(editor: HTMLElement, text: string): void {
  editor.focus();
  if (editor instanceof HTMLTextAreaElement) {
    const setter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')?.set;
    setter?.call(editor, text);
  } else {
    try {
      if (document.execCommand('insertText', false, text) && readEditor(editor) === normalize(text)) return;
    } catch { /* Fall back to updating the editor directly. */ }
    const paragraph = document.createElement('p');
    paragraph.textContent = text;
    editor.replaceChildren(paragraph);
  }
  editor.dispatchEvent(new Event('input', { bubbles: true, composed: true }));
}

function attachmentNames(root: Element | null, editor: HTMLElement): Set<string> {
  const names = new Set<string>();
  for (const node of root?.querySelectorAll('span, div, a, [aria-label], [title], img[alt]') ?? []) {
    if (node.contains(editor) || editor.contains(node) || node.closest('[hidden], [inert], [aria-hidden="true"]')) continue;
    for (const label of ['title', 'aria-label', 'alt']) {
      const name = node.getAttribute(label);
      if (name) names.add(name.trim());
    }
    if (!node.children.length && node.textContent) names.add(node.textContent.trim());
  }
  return names;
}

type AttachmentMethod = 'input' | 'paste' | 'drop';
const methods: AttachmentMethod[] = ['input', 'paste', 'drop'];

function attachFiles(method: AttachmentMethod, editor: HTMLElement, root: Element | null, files: File[]): boolean {
  const input = method === 'input' ? findFileInput(root, files) : undefined;
  if (method === 'input' && !input) return false;
  const dataTransfer = new DataTransfer();
  files.forEach(file => dataTransfer.items.add(file));
  try {
    if (input) {
      input.files = dataTransfer.files;
      input.dispatchEvent(new Event('change', { bubbles: true, composed: true }));
    } else if (method === 'paste') {
      editor.dispatchEvent(new ClipboardEvent('paste', { bubbles: true, cancelable: true, clipboardData: dataTransfer }));
    } else {
      (root ?? editor).dispatchEvent(new DragEvent('drop', { bubbles: true, cancelable: true, dataTransfer }));
    }
    return true;
  } catch {
    return false;
  }
}

const wait = (ms: number) => new Promise<void>(resolve => setTimeout(resolve, ms));
const uploadGraceMs = 4_000;
const composerSettleMs = 1_200;
const timeoutMs = 20_000;

export const injectChatGPT = async (pending: PendingHandoff) => {
  const startPath = location.pathname;
  const files = buildFiles(pending);
  const settings = await getStorage<Settings>('settings', {} as Settings);
  const expectedText = normalize(pending.handoffText);
  const deadline = Date.now() + timeoutMs;
  let currentEditor: HTMLElement | undefined;
  let currentRoot: Element | null = null;
  let nextMethod = 0;
  let retryAt = 0;
  let readySince: number | undefined;

  while (Date.now() < deadline && location.pathname === startPath) {
    const composer = findComposer();
    if (composer) {
      const { editor, root } = composer;
      const names = attachmentNames(root, editor);
      if (!currentEditor && (readEditor(editor) || files.some(file => names.has(file.name)))) return;
      const newComposer = editor !== currentEditor || root !== currentRoot;
      if (newComposer) {
        currentEditor = editor;
        currentRoot = root;
        nextMethod = 0;
        retryAt = 0;
        readySince = undefined;
      }

      const text = readEditor(editor);
      if (text && text !== expectedText) return; // A draft takes priority over the handoff.
      if (!text && expectedText) {
        if (readySince !== undefined) return; // The completed handoff was cleared or submitted.
        insertText(editor, pending.handoffText);
      }

      const now = Date.now();
      const missing = files.filter(file => !names.has(file.name));
      if (missing.length === 0 && readEditor(editor) === expectedText) {
        readySince ??= now;
        if (now - readySince >= composerSettleMs) {
          if (settings.autoSend !== true) return;
          const send = root?.querySelector<HTMLButtonElement>(
            'button[data-testid="send-button"], button[aria-label="Send prompt"], button[aria-label="Send"]'
          );
          if (send && !send.matches(':disabled, [aria-disabled="true"]') && !root?.querySelector('[aria-busy="true"]')) {
            send.click();
            return;
          }
        }
      } else {
        readySince = undefined;
        if (missing.length && now >= retryAt) {
          while (nextMethod < methods.length) {
            if (attachFiles(methods[nextMethod++], editor, root, missing)) {
              retryAt = now + uploadGraceMs;
              break;
            }
          }
        }
      }
    }
    await wait(200);
  }
  console.warn('[MoveChat] ChatGPT handoff did not finish. Check the prompt and attachments before sending.');
};
