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

  const handleCaptureCurrentTab = async (): Promise<Session | null> => {
    setCaptureProgress({ current: 0, total: 1, step: 'Starting capture...' });
    return new Promise((resolve, reject) => {
      if (typeof chrome !== 'undefined' && chrome.tabs) {
        chrome.tabs.query({ active: true, currentWindow: true }, (tabs: chrome.tabs.Tab[]) => {
          const activeTab = tabs[0];
          if (!activeTab || !activeTab.id) {
            setCaptureProgress(null);
            reject(new Error('No active browser tab found.'));
            return;
          }

          const connectWithInjectFallback = () => {
            let port: chrome.runtime.Port;
            try {
              port = chrome.tabs.connect(activeTab.id!, { name: 'movechat-scrape' });
            } catch {
              // Fall through to inject
              injectAndRetry();
              return;
            }

            const onMsg = (msg: any) => {
              if (msg.type === 'progress') {
                setCaptureProgress({ current: msg.current, total: msg.total, step: msg.step });
              } else if (msg.type === 'result') {
                setCaptureProgress(null);
                port.onMessage.removeListener(onMsg);
                const newSession: Session = {
                  ...msg.session,
                  id: `session_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`,
                };
                addSession(newSession);
                setLastCapturedSession(newSession);
                resolve(newSession);
              } else if (msg.type === 'error') {
                setCaptureProgress(null);
                port.onMessage.removeListener(onMsg);
                reject(new Error(msg.error));
              }
            };

            port.onMessage.addListener(onMsg);
            port.onDisconnect.addListener(() => {
              if (chrome.runtime.lastError) {
                injectAndRetry();
              }
            });
          };

          const injectAndRetry = () => {
            if (chrome.scripting && activeTab.id) {
              const isSupportedUrl = activeTab.url
                ? ['claude.ai', 'chatgpt.com', 'gemini.google.com', 'perplexity.ai'].some(
                    domain => activeTab.url!.includes(domain)
                  )
                : true;

              if (isSupportedUrl) {
                chrome.scripting.executeScript(
                  {
                    target: { tabId: activeTab.id },
                    files: ['content.js'],
                  },
                  () => {
                    if (chrome.runtime.lastError) {
                      console.error('[MoveChat] Script injection failed:', chrome.runtime.lastError.message);
                      setCaptureProgress(null);
                      reject(new Error('Extension context updated. Please refresh this page to capture the chat.'));
                    } else {
                      setTimeout(() => {
                        // After injection, try port connection again
                        try {
                          const retryPort = chrome.tabs.connect(activeTab.id!, { name: 'movechat-scrape' });
                          retryPort.onMessage.addListener((msg: any) => {
                            if (msg.type === 'progress') {
                              setCaptureProgress({ current: msg.current, total: msg.total, step: msg.step });
                            } else if (msg.type === 'result') {
                              setCaptureProgress(null);
                              const newSession: Session = {
                                ...msg.session,
                                id: `session_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`,
                              };
                              addSession(newSession);
                              setLastCapturedSession(newSession);
                              resolve(newSession);
                            } else if (msg.type === 'error') {
                              setCaptureProgress(null);
                              reject(new Error(msg.error));
                            }
                          });
                          retryPort.onDisconnect.addListener(() => {
                            setCaptureProgress(null);
                            if (chrome.runtime.lastError) {
                              reject(new Error('Unable to capture. Please refresh the page and try again.'));
                            }
                          });
                        } catch {
                          setCaptureProgress(null);
                          reject(new Error('Unable to capture. Please refresh the page and try again.'));
                        }
                      }, 300);
                    }
                  }
                );
                return;
              }
            }

            setCaptureProgress(null);
            reject(
              new Error(
                'Unable to capture. Make sure you are on a supported AI platform (Claude, ChatGPT, Gemini, Perplexity) and the page is fully loaded.'
              )
            );
          };

          connectWithInjectFallback();
        });
      } else {
        // DEV MODE FALLBACK
        setTimeout(() => {
          const platforms: Session['platform'][] = ['chatgpt', 'claude', 'gemini', 'perplexity'];
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
          addSession(mockSession);
          setLastCapturedSession(mockSession);
          resolve(mockSession);
        }, 1000);
      }
    });
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
