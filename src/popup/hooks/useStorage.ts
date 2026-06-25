import { useState, useEffect } from 'react';
import type { Session, Settings } from '../../shared/types';
import { getSessions, saveSessions, getSettings, saveSettings } from '../../shared/storage';

const DEFAULT_AI_SUMMARY = {
  provider: 'openai' as const,
  apiKey: '',
  model: 'gpt-5.5',
  summaryTemplate: 'Provide a comprehensive summary of this conversation that can be handed off to another AI agent. Include: 1) The main goal/topic, 2) Key decisions made, 3) Important context and constraints, 4) Current state and next steps, 5) Any code or technical details that are essential.',
};

const migrateSettings = (raw: any): Settings => {
  // Handle migration from old aiCompression format to new aiSummary
  const aiSummary = raw.aiSummary || DEFAULT_AI_SUMMARY;
  return {
    theme: raw.theme || 'light',
    autoSend: !!raw.autoSend,
    handoffTemplatePdf: raw.handoffTemplatePdf || '',
    handoffTemplateMd: raw.handoffTemplateMd || '',
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
    const loadAll = async () => {
      try {
        const storedSessions = await getSessions();
        const rawSettings = await getSettings();
        const storedSettings = migrateSettings(rawSettings);
        setSessions(storedSessions);
        setSettings(storedSettings);
        // Apply theme synchronously before paint
        applyThemeToDom(storedSettings.theme);
      } catch (err) {
        console.error('Error loading storage:', err);
      } finally {
        setLoading(false);
      }
    };
    loadAll();
  }, []);

  const addSession = async (newSession: Session) => {
    const updated = [newSession, ...sessions];
    setSessions(updated);
    await saveSessions(updated);
  };

  const deleteSession = async (id: string) => {
    const updated = sessions.filter(s => s.id !== id);
    setSessions(updated);
    await saveSessions(updated);
  };

  const deleteSessions = async (ids: string[]) => {
    const updated = sessions.filter(s => !ids.includes(s.id));
    setSessions(updated);
    await saveSessions(updated);
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
    addSession,
    deleteSession,
    deleteSessions,
    updateSettings
  };
};
