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

function findGeminiEditor(): HTMLElement | null {
  // 1. Check for explicit contenteditable container inside rich-textarea or page
  const contentEditable = document.querySelector('rich-textarea div[contenteditable="true"], div[contenteditable="true"], p[contenteditable="true"]') as HTMLElement;
  if (contentEditable) return contentEditable;

  // 2. Check inside rich-textarea web component
  const richTextarea = document.querySelector('rich-textarea');
  if (richTextarea) {
    const inner = richTextarea.querySelector('.ql-editor, p, textarea') as HTMLElement;
    if (inner) return inner;

    if (richTextarea.shadowRoot) {
      const shadowInner = richTextarea.shadowRoot.querySelector('div[contenteditable="true"], p, textarea') as HTMLElement;
      if (shadowInner) return shadowInner;
    }
  }

  // 3. Fallback to standard textarea or inputs
  return document.querySelector('textarea, [contenteditable="true"]') as HTMLElement;
}

function findGeminiFileInput(): HTMLInputElement | null {
  let fileInput = document.querySelector('input[type="file"]') as HTMLInputElement;
  if (fileInput) return fileInput;

  const richTextarea = document.querySelector('rich-textarea');
  if (richTextarea?.shadowRoot) {
    fileInput = richTextarea.shadowRoot.querySelector('input[type="file"]') as HTMLInputElement;
    if (fileInput) return fileInput;
  }

  const uploader = document.querySelector('uploader-component, [class*="uploader"], [class*="upload"]');
  if (uploader) {
    fileInput = uploader.querySelector('input[type="file"]') as HTMLInputElement;
    if (fileInput) return fileInput;
  }

  return null;
}

function findGeminiSendButton(): HTMLButtonElement | null {
  const buttons = Array.from(document.querySelectorAll('button'));
  for (const btn of buttons) {
    const label = (btn.getAttribute('aria-label') || '').toLowerCase();
    const title = (btn.getAttribute('title') || '').toLowerCase();
    const html = btn.innerHTML.toLowerCase();

    if (
      label.includes('send') || label.includes('submit') ||
      title.includes('send') || title.includes('submit') ||
      html.includes('send') || html.includes('submit')
    ) {
      return btn as HTMLButtonElement;
    }
  }
  return document.querySelector('button[aria-label*="Send"], button[aria-label*="send"], .send-button') as HTMLButtonElement;
}

export const injectGemini = async (pending: PendingHandoff) => {
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
    const editor = findGeminiEditor();
    const fileInput = findGeminiFileInput();

    if (editor) {
      clearInterval(interval);

      editor.focus();

      // Attempt command insertion first
      try {
        document.execCommand('insertText', false, handoffText);
      } catch (_) {}

      // Verify and set content if insertText failed or didn't update
      if (!editor.textContent || !editor.textContent.includes(handoffText.substring(0, 10))) {
        if (editor.tagName.toLowerCase() === 'textarea' || editor.tagName.toLowerCase() === 'input') {
          (editor as HTMLInputElement).value = handoffText;
        } else {
          editor.innerHTML = '';
          const p = document.createElement('p');
          p.textContent = handoffText;
          editor.appendChild(p);
        }
      }

      // Dispatch standard input and change events to update framework state
      editor.dispatchEvent(new Event('input', { bubbles: true, composed: true }));
      editor.dispatchEvent(new Event('change', { bubbles: true, composed: true }));

      // Handle attachments
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

      if (fileInput) {
        fileInput.files = dataTransfer.files;
        fileInput.dispatchEvent(new Event('change', { bubbles: true, composed: true }));
      }

      // Fallback: paste event for web component file drop areas
      try {
        const pasteEvent = new ClipboardEvent('paste', {
          bubbles: true,
          cancelable: true,
          clipboardData: dataTransfer
        });
        editor.dispatchEvent(pasteEvent);
      } catch (_) {}

      if (settings.autoSend) {
        setTimeout(() => {
          const sendBtn = findGeminiSendButton();
          if (sendBtn && !sendBtn.disabled) {
            sendBtn.click();
          }
        }, 1500);
      }
    }

    if (attempts >= maxAttempts) {
      clearInterval(interval);
      console.warn('[MoveChat] Gemini inputs not found.');
    }
  }, 1000);
};
