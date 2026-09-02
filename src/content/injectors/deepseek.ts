import type { PendingHandoff, Settings, AttachedFile } from '../../shared/types';
import { getStorage } from '../storage';

function attachedFileToFile(attached: AttachedFile): File {
  if (attached.content && attached.content.startsWith('data:')) {
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
  return new File([attached.content || ''], attached.name, { type: attached.type });
}

export const injectDeepSeek = async (pending: PendingHandoff) => {
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
    const textarea = document.querySelector('textarea[placeholder="Message DeepSeek"]') as HTMLTextAreaElement;
    const fileInput = document.querySelector('input[type="file"]') as HTMLInputElement;

    if (textarea && fileInput) {
      clearInterval(interval);

      const nativeInputValueSetter = Object.getOwnPropertyDescriptor(
        window.HTMLTextAreaElement.prototype, 'value'
      )?.set;
      if (nativeInputValueSetter) {
        nativeInputValueSetter.call(textarea, handoffText);
      } else {
        textarea.value = handoffText;
      }
      textarea.dispatchEvent(new Event('input', { bubbles: true }));
      textarea.dispatchEvent(new Event('change', { bubbles: true }));

      const dataTransfer = new DataTransfer();
      dataTransfer.items.add(mainFile);
      if (pending.attachments) {
        for (const att of pending.attachments) {
          if (att.name === 'debug_log.txt') continue;
          try {
            dataTransfer.items.add(attachedFileToFile(att));
          } catch (_) {
            // Skip files that can't be added
          }
        }
      }
      fileInput.files = dataTransfer.files;
      fileInput.dispatchEvent(new Event('change', { bubbles: true }));

      if (settings.autoSend) {
        setTimeout(() => {
          const sendBtn = document.querySelector(
            'div.ds-button.ds-button--primary.ds-button--filled.ds-button--circle:not(.ds-button--disabled)'
          ) as HTMLElement;
          if (sendBtn) {
            sendBtn.click();
          }
        }, 1500);
      }
    }

    if (attempts >= maxAttempts) {
      clearInterval(interval);
      console.warn('[MoveChat] DeepSeek inputs not found.');
    }
  }, 1000);
};
