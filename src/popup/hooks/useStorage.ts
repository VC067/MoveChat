import { useState, useEffect } from 'react';
import type { Session, SessionEdit, Settings } from '../../shared/types';
import { getSessions, saveSessions, getSettings, saveSettings, DEFAULT_SETTINGS } from '../../shared/storage';

const DEFAULT_AI_SUMMARY = {
  provider: 'openai' as const,
  apiKey: '',
  model: 'gpt-5.5',
  summaryTemplate: 'Provide a comprehensive summary of this conversation that can be handed off to another AI agent. Include: 1) The main goal/topic, 2) Key decisions made, 3) Important context and constraints, 4) Current state and next steps, 5) Any code or technical details that are essential.',
};

const migrateSettings = (raw: Partial<Settings>): Settings => {
  // Handle migration from old aiCompression format to new aiSummary
  const aiSummary = raw.aiSummary || DEFAULT_AI_SUMMARY;
  let handoffTemplatePdf = raw.handoffTemplatePdf || DEFAULT_SETTINGS.handoffTemplatePdf;
  let handoffTemplateMd = raw.handoffTemplateMd || DEFAULT_SETTINGS.handoffTemplateMd;

  // Auto-migrate previous default template naming conversation-history -> movechat-history if still using old default
  if (handoffTemplateMd.includes('`conversation-history.md`')) {
    handoffTemplateMd = handoffTemplateMd.replace('`conversation-history.md`', '`movechat-history.md`');
  }
  if (handoffTemplatePdf.includes('`conversation-history.pdf`')) {
    handoffTemplatePdf = handoffTemplatePdf.replace('`conversation-history.pdf`', '`movechat-history.pdf`');
  }

  return {
    theme: raw.theme || 'light',
    autoSend: !!raw.autoSend,
    handoffTemplatePdf,
    handoffTemplateMd,
    aiSummary: {
      provider: aiSummary.provider || 'openai',
      apiKey: aiSummary.apiKey || '',
      model: aiSummary.model || 'gpt-5.5',
      summaryTemplate: aiSummary.summaryTemplate || DEFAULT_AI_SUMMARY.summaryTemplate,
    },
  };
};

const applyThemeToDom = (theme: 'light' | 'dark' | 'system') => {
  const root = window.document.documentElement;
  if (theme === 'dark' || (theme === 'system' && window.matchMedia('(prefers-color-scheme: dark)').matches)) {
    root.classList.add('dark');
  } else {
    root.classList.remove('dark');
  }
};

export const useStorage = () => {
  const [sessions, setSessions] = useState<Session[]>([]);
  const [settings, setSettings] = useState<Settings | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let sessionsChanged = false;
    const onStorageChange: Parameters<typeof chrome.storage.onChanged.addListener>[0] = (changes, area) => {
      if (area === 'local' && changes.sessions) {
        sessionsChanged = true;
        setSessions((changes.sessions.newValue as Session[] | undefined) ?? []);
      }
    };
    const storageEvents = globalThis.chrome?.storage?.onChanged;
    storageEvents?.addListener(onStorageChange);
    const loadAll = async () => {
      try {
        const storedSessions = await getSessions();
        if (!sessionsChanged) setSessions(storedSessions);
        const rawSettings = await getSettings();
        const storedSettings = migrateSettings(rawSettings);
        setSettings(storedSettings);
        // Apply theme synchronously before paint
        applyThemeToDom(storedSettings.theme);
      } catch (err) {
        console.error('Error loading storage:', err);
      } finally {
        setLoading(false);
      }
    };
    void loadAll();
    return () => storageEvents?.removeListener(onStorageChange);
  }, []);

  const editSessions = async (edit: SessionEdit['edit']) => {
    if (globalThis.chrome?.runtime) {
      const response = await chrome.runtime.sendMessage<SessionEdit, { error?: string }>({ action: 'EDIT_SESSIONS', edit });
      if (response.error) throw new Error(response.error);
      return;
    }
    const updated = edit.type === 'delete'
      ? sessions.filter(session => !edit.ids.includes(session.id))
      : sessions.map(session => session.id === edit.id ? { ...session, title: edit.title } : session);
    await saveSessions(updated);
    setSessions(updated);
  };

  const updateSettings = async (newSettings: Settings) => {
    setSettings(newSettings);
    applyThemeToDom(newSettings.theme);
    await saveSettings(newSettings);
  };

  return {
    sessions,
    settings,
    loading,
    deleteSession: (id: string) => editSessions({ type: 'delete', ids: [id] }),
    deleteSessions: (ids: string[]) => editSessions({ type: 'delete', ids }),
    renameSession: (id: string, title: string) => editSessions({ type: 'rename', id, title }),
    updateSettings
  };
};
