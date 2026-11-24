import React, { useState, useCallback } from 'react';
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
import { useCapture } from './popup/hooks/useCapture';

type View = 'home' | 'provider' | 'detail' | 'settings' | 'all';

const App: React.FC = () => {
  const {
    sessions,
    settings,
    loading,
    deleteSession,
    deleteSessions,
    renameSession,
    updateSettings,
  } = useStorage();

  const [view, setView] = useState<View>('home');
  const [selectedSession, setSelectedSession] = useState<Session | null>(null);
  const [selectedProvider, setSelectedProvider] = useState<string | null>(null);
  const [showDeleteModal, setShowDeleteModal] = useState(false);
  const [sessionToDelete, setSessionToDelete] = useState<string | null>(null);
  const { capture, status } = useCapture();
  const [dismissedCapture, setDismissedCapture] = useState<string>();
  const lastCapturedSession = status.sessionId !== dismissedCapture
    ? sessions.find(session => session.id === status.sessionId) ?? null
    : null;

  const handleSelectSession = (session: Session) => {
    setSelectedSession(session);
    setView('detail');
  };

  const handleSelectProvider = (provider: string) => {
    setSelectedProvider(provider);
    setView('provider');
  };

  const handleUpdateTitle = async (id: string, newTitle: string) => {
    await renameSession(id, newTitle);
    setSelectedSession(session => session?.id === id ? { ...session, title: newTitle } : session);
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
    setDismissedCapture(status.sessionId);
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
  }, [view, selectedProvider, status.sessionId]);

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
            captureProgress={status.progress ?? null}
            captureError={status.error}
            onSelectSession={handleSelectSession}
            onSelectProvider={handleSelectProvider}
            onDeleteSessions={deleteSessions}
            onCapture={capture}
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
