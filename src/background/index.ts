chrome.runtime.onMessage.addListener(
  (request: any, _sender: chrome.runtime.MessageSender, sendResponse: (response?: any) => void) => {
    if (request.action === 'RESUME_CHAT') {
      const { targetPlatform } = request;

      let url = 'https://chatgpt.com/';
      if (targetPlatform === 'claude') url = 'https://claude.ai/new';
      else if (targetPlatform === 'gemini') url = 'https://gemini.google.com/app';
      else if (targetPlatform === 'perplexity') url = 'https://www.perplexity.ai/';

      chrome.tabs.create({ url }, (_tab: chrome.tabs.Tab) => {
        sendResponse({ success: true });
      });

      return true; // keep async channel open
    }

    // Fetch an image URL and return base64 data URL (bypasses CORS in content scripts)
    if (request.action === 'FETCH_IMAGE_BASE64') {
      const { url } = request;
      fetch(url)
        .then(resp => {
          if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
          return resp.blob();
        })
        .then(blob => {
          const reader = new FileReader();
          reader.onloadend = () => {
            sendResponse({ base64: reader.result as string });
          };
          reader.onerror = () => {
            sendResponse({ base64: '' });
          };
          reader.readAsDataURL(blob);
        })
        .catch(err => {
          console.error('[MoveChat] Background image fetch failed:', err);
          sendResponse({ base64: '' });
        });

      return true; // keep channel open for async
    }
  }
);
