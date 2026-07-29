import type { Session, Settings } from './types';

const DEFAULT_SETTINGS: Settings = {
  theme: 'light',
  autoSend: false,
  handoffTemplatePdf: "Continue from our previous conversation. The entire chat history is attached as `conversation-history.pdf` — every message, with uploaded files' contents inlined and the images embedded inline so you can read AND see everything. You have the complete prior context; please continue our conversation from where it left off.",
  handoffTemplateMd: "Continue from our previous conversation. The entire chat history is attached as `conversation-history.md` along with all images and files from the original conversation. You have the complete prior context; please continue our conversation from where it left off.",
  aiSummary: {
    provider: 'openai',
    apiKey: '',
    model: 'gpt-5.5',
    summaryTemplate: 'Provide a comprehensive summary of this conversation that can be handed off to another AI agent. Include: 1) The main goal/topic, 2) Key decisions made, 3) Important context and constraints, 4) Current state and next steps, 5) Any code or technical details that are essential.',
  }
};

const isExtension = typeof chrome !== 'undefined' && chrome.storage !== undefined && chrome.storage.local !== undefined;

export const getStorage = <T>(key: string, defaultValue: T): Promise<T> => {
  return new Promise((resolve) => {
    if (isExtension) {
      chrome.storage.local.get([key], (result: { [key: string]: any }) => {
        resolve(result[key] !== undefined ? result[key] : defaultValue);
      });
    } else {
      const val = localStorage.getItem(key);
      resolve(val ? JSON.parse(val) : defaultValue);
    }
  });
};

export const setStorage = <T>(key: string, value: T): Promise<void> => {
  return new Promise((resolve) => {
    if (isExtension) {
      chrome.storage.local.set({ [key]: value }, () => {
        resolve();
      });
    } else {
      localStorage.setItem(key, JSON.stringify(value));
      resolve();
    }
  });
};

export const getSessions = (): Promise<Session[]> => getStorage<Session[]>('sessions', []);
export const saveSessions = (sessions: Session[]): Promise<void> => setStorage<Session[]>('sessions', sessions);

export const getSettings = (): Promise<Settings> => getStorage<Settings>('settings', DEFAULT_SETTINGS);
export const saveSettings = (settings: Settings): Promise<void> => setStorage<Settings>('settings', settings);
