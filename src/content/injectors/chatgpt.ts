import type { PendingHandoff, Settings, AttachedFile } from '../../shared/types';
import { getStorage } from '../storage';

function attachedFileToFile(attached: AttachedFile): File {
  if (attached.content && attached.content.startsWith('data:')) {
    // base64 data URL → Blob → File
    const parts = attached.content.split(',');
    const byteCharacters = atob(parts[1] || parts[0]);
    const byteNumbers = new Array(byteCharacters.length);
    for (let i = 0; i < byteCharacters.length; i++) {
      byteNumbers[i] = byteCharacters.charCodeAt(i);
    }
    const byteArray = new Uint8Array(byteNumbers);
    const blob = new Blob([byteArray], { type: attached.type });
    return new File([blob], attached.name, { type: attached.type });
  }
  // Plain text content
  return new File([attached.content || ''], attached.name, { type: attached.type });
}

function findChatGPTEditor(): HTMLElement | null {
  return (
    (document.querySelector('#prompt-textarea') as HTMLElement | null) ||
    (document.querySelector('form div[contenteditable="true"]') as HTMLElement | null) ||
    (document.querySelector('div[contenteditable="true"]') as HTMLElement | null) ||
    (document.querySelector('textarea') as HTMLElement | null)
  );
}

function findChatGPTSendButton(): HTMLButtonElement | null {
  return (
    (document.querySelector('[data-testid="send-button"]') as HTMLButtonElement | null) ||
    (document.querySelector('button[aria-label*="Send prompt"]') as HTMLButtonElement | null) ||
    (document.querySelector('button[aria-label*="Send"]') as HTMLButtonElement | null) ||
    (document.querySelector('button[class*="send"]') as HTMLButtonElement | null)
  );
}

function findChatGPTFileInput(): HTMLInputElement | null {
  const inputs = Array.from(document.querySelectorAll<HTMLInputElement>('input[type="file"]'))
    .filter(i => !i.disabled);
  const isImageOrCamera = (i: HTMLInputElement): boolean => {
    const accept = (i.getAttribute('accept') || '').toLowerCase();
    return i.hasAttribute('capture') || accept.includes('image') || accept.includes('video') || accept.includes('camera');
  };
  return (
    inputs.find(i => !i.getAttribute('accept') && !i.hasAttribute('capture')) ||
    inputs.find(i => !isImageOrCamera(i)) ||
    inputs[0] ||
    null
  );
}

function buildMainFile(pending: PendingHandoff): File {
  if (pending.mimeType === 'text/markdown') {
    return new File([pending.fileContent], pending.fileName, { type: pending.mimeType });
  }
  const base64Data = pending.fileContent.split(',')[1] || pending.fileContent;
  const byteCharacters = atob(base64Data);
  const byteNumbers = new Array(byteCharacters.length);
  for (let i = 0; i < byteCharacters.length; i++) {
    byteNumbers[i] = byteCharacters.charCodeAt(i);
  }
  const byteArray = new Uint8Array(byteNumbers);
  const blob = new Blob([byteArray], { type: pending.mimeType });
  return new File([blob], pending.fileName, { type: pending.mimeType });
}

const wait = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

export const injectChatGPT = async (pending: PendingHandoff) => {
  const mainFile = buildMainFile(pending);
  const settings = await getStorage<Settings>('settings', {} as Settings);
  const handoffText = pending.handoffText;

  const attachmentNames = [
    mainFile.name,
    ...(pending.attachments || []).map(a => a.name).filter(n => n !== 'debug_log.txt'),
  ];

  const dataTransfer = new DataTransfer();
  dataTransfer.items.add(mainFile);
  for (const att of pending.attachments || []) {
    if (att.name === 'debug_log.txt') continue;
    try {
      dataTransfer.items.add(attachedFileToFile(att));
    } catch { /* Skip attachments that cannot be converted. */ }
  }

  const textPresent = (): boolean => {
    const editor = findChatGPTEditor();
    return !!editor && !!editor.textContent && editor.textContent.includes(handoffText.substring(0, 10));
  };

  const chipsPresent = (): boolean => {
    const leaves = document.querySelectorAll('span, div, a');
    for (const el of Array.from(leaves)) {
      if (el.children.length !== 0) continue;
      if (el.closest('[contenteditable="true"], textarea')) continue;
      const t = (el.textContent || '').trim();
      if (t && attachmentNames.some(n => t === n || t.includes(n))) return true;
    }
    return false;
  };

  const insertText = (editor: HTMLElement): void => {
    if (editor.textContent?.includes(handoffText.substring(0, 10))) return;
    editor.focus();
    let inserted = false;
    try {
      inserted = document.execCommand('insertText', false, handoffText);
    } catch { /* Use the editor fallback below. */ }

    if (!inserted || !editor.textContent?.includes(handoffText.substring(0, 10))) {
      if (editor.tagName.toLowerCase() === 'textarea') {
        const nativeSetter = Object.getOwnPropertyDescriptor(
          window.HTMLTextAreaElement.prototype,
          'value'
        )?.set;
        if (nativeSetter) {
          nativeSetter.call(editor, handoffText);
        } else {
          (editor as HTMLTextAreaElement).value = handoffText;
        }
      } else {
        editor.innerHTML = '';
        const p = document.createElement('p');
        p.textContent = handoffText;
        editor.appendChild(p);
      }
      editor.dispatchEvent(new Event('input', { bubbles: true, composed: true }));
      editor.dispatchEvent(new Event('change', { bubbles: true, composed: true }));
    }
  };

  const attachViaInput = (): void => {
    const fileInput = findChatGPTFileInput();
    if (!fileInput) return;
    try {
      fileInput.files = dataTransfer.files;
      fileInput.dispatchEvent(new Event('change', { bubbles: true, composed: true }));
    } catch { /* Try the paste/drop fallbacks below. */ }
  };

  const attachViaPaste = (editor: HTMLElement): void => {
    try {
      const pasteEvent = new ClipboardEvent('paste', {
        bubbles: true,
        cancelable: true,
        clipboardData: dataTransfer,
      });
      editor.dispatchEvent(pasteEvent);
    } catch { /* Some composers only accept a drop event. */ }
  };

  const attachViaDrop = (editor: HTMLElement): void => {
    try {
      const dropTarget = editor.closest('form') || editor;
      const dropEvent = new DragEvent('drop', {
        bubbles: true,
        cancelable: true,
        dataTransfer,
      });
      dropTarget.dispatchEvent(dropEvent);
    } catch { /* The target UI may reject synthetic drop events. */ }
  };

  const maxAttempts = 30;

  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    const editor = findChatGPTEditor();
    if (editor) {
      insertText(editor);

      if (!chipsPresent()) {
        attachViaInput();
        await wait(400);
      }
      if (!chipsPresent()) {
        attachViaPaste(editor);
        await wait(400);
      }
      if (!chipsPresent()) {
        attachViaDrop(editor);
        await wait(400);
      }

      if (textPresent() && chipsPresent()) {
        if (settings.autoSend) {
          await wait(500);
          const sendBtn = findChatGPTSendButton();
          if (sendBtn && !sendBtn.disabled) {
            sendBtn.click();
          }
        }
        return;
      }
    }
    await wait(1000);
  }

  console.warn('[MoveChat] ChatGPT injection could not be completed.');
};
