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

export const injectChatGPT = async (pending: PendingHandoff) => {
  // Build the main export file (MD or PDF)
  let mainFile: File;
  if (pending.mimeType === 'text/markdown') {
    mainFile = new File([pending.fileContent], pending.fileName, { type: pending.mimeType });
  } else {
    const base64Data = pending.fileContent.split(',')[1] || pending.fileContent;
    const byteCharacters = atob(base64Data);
    const byteNumbers = new Array(byteCharacters.length);
    for (let i = 0; i < byteCharacters.length; i++) {
      byteNumbers[i] = byteCharacters.charCodeAt(i);
    }
    const byteArray = new Uint8Array(byteNumbers);
    const blob = new Blob([byteArray], { type: pending.mimeType });
    mainFile = new File([blob], pending.fileName, { type: pending.mimeType });
  }

  const settings = await getStorage<Settings>('settings', {} as Settings);
  const handoffText = pending.handoffText;

  const maxAttempts = 30;
  let attempts = 0;

  const interval = setInterval(() => {
    attempts++;
    const editor = findChatGPTEditor();

    if (editor) {
      clearInterval(interval);

      editor.focus();

      // 1. Insert prompt text (execCommand works with ProseMirror / Lexical)
      let inserted = false;
      try {
        inserted = document.execCommand('insertText', false, handoffText);
      } catch (_) {}

      // Fallback if execCommand failed or didn't set content
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

      // 2. Build file transfer payload
      const dataTransfer = new DataTransfer();
      dataTransfer.items.add(mainFile);
      if (pending.attachments) {
        for (const att of pending.attachments) {
          if (att.name === 'debug_log.txt') continue;
          try {
            dataTransfer.items.add(attachedFileToFile(att));
          } catch (_) {}
        }
      }

      // 3. Attach file via <input type="file"> if present
      let fileAttached = false;
      const fileInput = document.querySelector('input[type="file"]') as HTMLInputElement | null;
      if (fileInput) {
        try {
          fileInput.files = dataTransfer.files;
          fileInput.dispatchEvent(new Event('change', { bubbles: true, composed: true }));
          fileAttached = true;
        } catch (_) {}
      }

      // 4. Fallback: dispatch paste and drop events if fileInput was not present
      if (!fileAttached) {
        try {
          const pasteEvent = new ClipboardEvent('paste', {
            bubbles: true,
            cancelable: true,
            clipboardData: dataTransfer,
          });
          editor.dispatchEvent(pasteEvent);
        } catch (_) {}

        try {
          const dropTarget = editor.closest('form') || editor;
          const dropEvent = new DragEvent('drop', {
            bubbles: true,
            cancelable: true,
            dataTransfer,
          });
          dropTarget.dispatchEvent(dropEvent);
        } catch (_) {}
      }

      // 5. Auto-send if enabled
      if (settings.autoSend) {
        setTimeout(() => {
          const sendBtn = findChatGPTSendButton();
          if (sendBtn && !sendBtn.disabled) {
            sendBtn.click();
          }
        }, 1500);
      }
    }

    if (attempts >= maxAttempts) {
      clearInterval(interval);
      console.warn('[MoveChat] ChatGPT editor input not found.');
    }
  }, 1000);
};
