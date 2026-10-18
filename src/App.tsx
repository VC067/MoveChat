import React, { useState, useCallback, useRef } from 'react';
import { useStorage } from './popup/hooks/useStorage';
import { Header } from './popup/components/Header';
import { LibraryView } from './popup/components/LibraryView';
import { ProviderConversationsView } from './popup/components/ProviderConversationsView';
import { SessionDetailView } from './popup/components/SessionDetailView';
import { SettingsView } from './popup/components/SettingsView';
import { DeleteConfirmation } from './popup/components/DeleteConfirmation';
import { AllSessionsView } from './popup/components/AllSessionsView';
import type { Session } from './shared/types';
import { Loader2 } from 'lucide-react';
import { captureCurrentTab } from './popup/capture';

type View = 'home' | 'provider' | 'detail' | 'settings' | 'all';

const App: React.FC = () => {
  const {
    sessions,
    settings,
    loading,
    addSession,
    deleteSession,
    deleteSessions,
    updateSettings,
  } = useStorage();

  const [view, setView] = useState<View>('home');
  const [selectedSession, setSelectedSession] = useState<Session | null>(null);
  const [selectedProvider, setSelectedProvider] = useState<string | null>(null);
  const [showDeleteModal, setShowDeleteModal] = useState(false);
  const [sessionToDelete, setSessionToDelete] = useState<string | null>(null);
  const [lastCapturedSession, setLastCapturedSession] = useState<Session | null>(null);
  const [captureProgress, setCaptureProgress] = useState<{ current: number; total: number; step: string } | null>(null);
  const captureInFlight = useRef<Promise<Session | null> | null>(null);

  const handleCaptureCurrentTab = (): Promise<Session | null> => {
    if (captureInFlight.current) return captureInFlight.current;
    const runCapture = async (): Promise<Session | null> => {
      setCaptureProgress({ current: 0, total: 1, step: 'Starting capture...' });
      try {
        if (typeof chrome !== 'undefined' && chrome.tabs) {
          // The transport verifies the pinned tab, top frame and source URL
          // before returning. Only this single path is allowed to save a result.
          const newSession = await captureCurrentTab(setCaptureProgress);
          await addSession(newSession);
          setLastCapturedSession(newSession);
          return newSession;
        }
        // DEV MODE FALLBACK
        await new Promise<void>(resolve => setTimeout(resolve, 1000));
          const platforms: Session['platform'][] = ['chatgpt', 'claude', 'gemini', 'perplexity', 'deepseek'];
          const randPlatform = platforms[Math.floor(Math.random() * platforms.length)];
          const mockSession: Session = {
            id: `session_${Date.now()}`,
            title: `AI Chat Capture Example (${randPlatform})`,
            platform: randPlatform,
            messageCount: 4,
            imageCount: 0,
            fileCount: 0,
            startedAt: new Date(Date.now() - 3600000).toISOString(),
            savedAt: new Date().toISOString(),
            messages: [
              { role: 'user', content: 'What is the speed of light?' },
              {
                role: 'assistant',
                content:
                  'The speed of light in a vacuum is approximately 299,792 kilometers per second (about 186,282 miles per second).',
              },
              { role: 'user', content: 'Can we go faster than that?' },
              {
                role: 'assistant',
                content:
                  "According to Einstein's theory of special relativity, physical objects cannot travel at or exceed the speed of light because it would require infinite energy.",
              },
            ],
          };
          await addSession(mockSession);
          setLastCapturedSession(mockSession);
          return mockSession;
      } finally {
        setCaptureProgress(null);
      }
    };
    const request = runCapture().finally(() => { captureInFlight.current = null; });
    captureInFlight.current = request;
    return request;
  };

  const handleSelectSession = (session: Session) => {
    setSelectedSession(session);
    setView('detail');
  };

  const handleSelectProvider = (provider: string) => {
    setSelectedProvider(provider);
    setView('provider');
  };

  const handleUpdateTitle = async (id: string, newTitle: string) => {
    const updatedSessions = sessions.map(s => (s.id === id ? { ...s, title: newTitle } : s));
    const targetSession = updatedSessions.find(s => s.id === id);
    if (targetSession) {
      if (selectedSession && selectedSession.id === id) {
        setSelectedSession({ ...selectedSession, title: newTitle });
      }
      if (typeof chrome !== 'undefined' && chrome.storage && chrome.storage.local) {
        chrome.storage.local.set({ sessions: updatedSessions }, () => {
          window.location.reload();
        });
      } else {
        localStorage.setItem('sessions', JSON.stringify(updatedSessions));
        window.location.reload();
      }
    }
  };

  const handleRequestDelete = (id: string) => {
    setSessionToDelete(id);
    setShowDeleteModal(true);
  };

  const handleConfirmDelete = () => {
    if (sessionToDelete) {
      deleteSession(sessionToDelete);
      setShowDeleteModal(false);
      setSessionToDelete(null);
      setView('home');
    }
  };

  const handleCancelDelete = () => {
    setShowDeleteModal(false);
    setSessionToDelete(null);
  };

  const handleBack = useCallback(() => {
    setLastCapturedSession(null);
    switch (view) {
      case 'provider':
        setView('home');
        setSelectedProvider(null);
        break;
      case 'detail':
        if (selectedProvider) {
          setView('provider');
        } else {
          setView('home');
        }
        setSelectedSession(null);
        break;
      case 'settings':
        setView('home');
        break;
      case 'all':
        setView('home');
        break;
      default:
        setView('home');
    }
  }, [view, selectedProvider]);

  if (loading || !settings) {
    return (
      <div className="flex-1 flex flex-col items-center justify-center p-6 bg-background text-foreground h-full">
        <Loader2 className="w-6 h-6 animate-spin text-muted-foreground" />
        <span className="text-xs font-medium mt-2 text-muted-foreground">Loading...</span>
      </div>
    );
  }

  const providerSessions = selectedProvider
    ? sessions.filter(s => s.platform === selectedProvider)
    : [];

  return (
    <div className="w-full h-full flex flex-col bg-background text-foreground overflow-hidden">
      <Header
        view={view}
        onBack={handleBack}
        onGoToSettings={() => setView('settings')}
      />

      <main className="flex-1 overflow-hidden flex flex-col relative">
        {view === 'home' && (
          <LibraryView
            sessions={sessions}
            lastCapturedSession={lastCapturedSession}
            captureProgress={captureProgress}
            onSelectSession={handleSelectSession}
            onSelectProvider={handleSelectProvider}
            onDeleteSessions={deleteSessions}
            onCapture={handleCaptureCurrentTab}
            onViewAll={() => setView('all')}
          />
        )}

        {view === 'provider' && selectedProvider && (
          <ProviderConversationsView
            provider={selectedProvider}
            sessions={providerSessions}
            onSelectSession={handleSelectSession}
            onDeleteSessions={deleteSessions}
          />
        )}

        {view === 'detail' && selectedSession && (
          <SessionDetailView
            session={selectedSession}
            settings={settings}
            onBack={handleBack}
            onDelete={handleRequestDelete}
            onUpdateTitle={handleUpdateTitle}
          />
        )}

        {view === 'settings' && (
          <SettingsView
            settings={settings}
            onUpdateSettings={updateSettings}
          />
        )}

        {view === 'all' && (
          <AllSessionsView
            sessions={sessions}
            onSelectSession={handleSelectSession}
            onDeleteSessions={deleteSessions}
            onBack={handleBack}
          />
        )}
      </main>

      {showDeleteModal && (
        <DeleteConfirmation
          onConfirm={handleConfirmDelete}
          onCancel={handleCancelDelete}
        />
      )}
    </div>
  );
};

export default App;
