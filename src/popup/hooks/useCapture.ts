import { useEffect, useRef, useState } from 'react';
import type { CaptureStatus } from '../../shared/types';

export function useCapture() {
  const port = useRef<chrome.runtime.Port | null>(null);
  const [status, setStatus] = useState<CaptureStatus>({});

  useEffect(() => {
    if (!globalThis.chrome?.runtime?.connect) return;
    const connection = chrome.runtime.connect({ name: 'movechat-capture-status' });
    port.current = connection;
    connection.onMessage.addListener(setStatus);
    connection.onDisconnect.addListener(() => {
      const error = chrome.runtime.lastError?.message;
      if (port.current !== connection) return;
      port.current = null;
      setStatus(previous => previous.progress || error
        ? { error: 'MoveChat was disconnected. Reopen the popup and try again.' }
        : previous);
    });

    return () => {
      port.current = null;
      connection.disconnect();
    };
  }, []);

  const capture = async () => {
    try {
      const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
      if (!tab?.id) throw new Error('No active browser tab found.');
      if (!port.current) throw new Error('Reopen the MoveChat popup and try again.');
      port.current.postMessage({ tab: { id: tab.id, url: tab.url } });
    } catch (error) {
      setStatus({ error: error instanceof Error ? error.message : 'Capture failed.' });
    }
  };

  return { capture, status };
}
