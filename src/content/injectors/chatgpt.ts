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
    const textarea = document.querySelector('#prompt-textarea') as HTMLTextAreaElement;
    const fileInput = document.querySelector('input[type="file"]') as HTMLInputElement;

    if (textarea && fileInput) {
      clearInterval(interval);
      
      textarea.value = handoffText;
      textarea.dispatchEvent(new Event('input', { bubbles: true }));

      // Attach main file + all scraped images/files
      const dataTransfer = new DataTransfer();
      dataTransfer.items.add(mainFile);
      if (pending.attachments) {
        for (const att of pending.attachments) {
          try {
            dataTransfer.items.add(attachedFileToFile(att));
          } catch (_) {
            // Skip files that can't be added (e.g. too large)
          }
        }
      }
      fileInput.files = dataTransfer.files;
      fileInput.dispatchEvent(new Event('change', { bubbles: true }));

      if (settings.autoSend) {
        setTimeout(() => {
          const sendBtn = document.querySelector('[data-testid="send-button"], button[class*="send"]') as HTMLButtonElement;
          if (sendBtn && !sendBtn.disabled) {
            sendBtn.click();
          }
        }, 1500);
      }
    }

    if (attempts >= maxAttempts) {
      clearInterval(interval);
      console.warn('[MoveChat] ChatGPT inputs not found.');
    }
  }, 1000);
};
