import React, { useState, useEffect } from 'react';
import {
  Search, Download, RefreshCw, AlertCircle, ChevronRight, Lock,
  CheckSquare, Square, Trash2
} from 'lucide-react';
import type { Session } from '../../shared/types';
import { generateMarkdown } from '../../shared/markdown';
import JSZip from 'jszip';
import PlatformLogo from './PlatformLogo';

interface CaptureProgress {
  current: number;
  total: number;
  step: string;
}

interface LibraryViewProps {
  sessions: Session[];
  lastCapturedSession: Session | null;
  captureProgress: CaptureProgress | null;
  onSelectSession: (session: Session) => void;
  onSelectProvider: (provider: string) => void;
  onDeleteSessions: (ids: string[]) => void;
  onCapture: () => Promise<Session | null>;
  onViewAll: () => void;
}

const platformLabels: Record<string, string> = {
  chatgpt: 'ChatGPT',
  claude: 'Claude',
  gemini: 'Gemini',
  perplexity: 'Perplexity',
};

export const LibraryView: React.FC<LibraryViewProps> = ({
  sessions,
  lastCapturedSession,
  captureProgress,
  onSelectSession,
  onSelectProvider,
  onDeleteSessions,
  onCapture,
  onViewAll,
}) => {
  const [activeTabPlatform, setActiveTabPlatform] = useState<'claude' | 'chatgpt' | 'gemini' | 'perplexity' | null>(null);
  const [capturing, setCapturing] = useState(false);
  const [captureError, setCaptureError] = useState<string | null>(null);
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedIds, setSelectedIds] = useState<string[]>([]);

  useEffect(() => {
    if (typeof chrome !== 'undefined' && chrome.tabs && chrome.tabs.query) {
      chrome.tabs.query({ active: true, currentWindow: true }, (tabs: chrome.tabs.Tab[]) => {
        const tab = tabs[0];
        if (tab && tab.url) {
          const url = tab.url;
          if (url.includes('chatgpt.com')) setActiveTabPlatform('chatgpt');
          else if (url.includes('claude.ai')) setActiveTabPlatform('claude');
          else if (url.includes('gemini.google.com')) setActiveTabPlatform('gemini');
          else if (url.includes('perplexity.ai')) setActiveTabPlatform('perplexity');
        }
      });
    }
  }, []);

  const handleCapture = async () => {
    setCapturing(true);
    setCaptureError(null);
    try {
      const res = await onCapture();
      if (!res) {
        setCaptureError('Failed to capture. Make sure you have a chat active on the page.');
      }
    } catch (err: any) {
      setCaptureError(err.message || 'Capture failed.');
    } finally {
      setCapturing(false);
    }
  };

  const toggleSelect = (id: string, e: React.MouseEvent) => {
    e.stopPropagation();
    setSelectedIds(prev =>
      prev.includes(id) ? prev.filter(x => x !== id) : [...prev, id]
    );
  };

  const toggleSelectAll = () => {
    const allIds = sessions.map(s => s.id);
    if (selectedIds.length === allIds.length) {
      setSelectedIds([]);
    } else {
      setSelectedIds(allIds);
    }
  };

  const handleBulkDelete = () => {
    if (confirm(`Delete ${selectedIds.length} selected conversations?`)) {
      onDeleteSessions(selectedIds);
      setSelectedIds([]);
    }
  };

  const handleBulkExport = async () => {
    try {
      const zip = new JSZip();
      const exportSessions = sessions.filter(s => selectedIds.includes(s.id));

      for (const s of exportSessions) {
        const md = generateMarkdown(s);
        const safeTitle = s.title.replace(/[^a-z0-9]/gi, '_').substring(0, 50);
        const basePath = `${s.platform}/${safeTitle}_${s.id}`;
        zip.file(`${basePath}/transcript.md`, md);
        s.messages.forEach(msg => {
          if (msg.files) {
            msg.files.forEach(file => {
              if (file.content) {
                const parts = file.content.split(',');
                const base64Data = parts[1] || parts[0];
                zip.file(`${basePath}/images/${file.name}`, base64Data, { base64: true });
              }
            });
          }
        });
      }

      const base64 = await zip.generateAsync({ type: 'base64' });
      const a = document.createElement('a');
      a.href = `data:application/zip;base64,${base64}`;
      a.download = `movechat_backup_${new Date().toISOString().slice(0, 10)}.zip`;
      a.click();
    } catch (err) {
      console.error('ZIP compilation failed:', err);
    }
  };

  const filteredSessions = sessions.filter(s =>
    s.title.toLowerCase().includes(searchQuery.toLowerCase())
  );

  const grouped: Record<string, Session[]> = {
    chatgpt: [],
    claude: [],
    gemini: [],
    perplexity: [],
  };
  sessions.forEach(s => {
    if (grouped[s.platform]) {
      grouped[s.platform].push(s);
    }
  });

  const providersWithSessions = Object.entries(grouped).filter(([, list]) => list.length > 0);

  const allRecentSessions = [...sessions]
    .sort((a, b) => new Date(b.savedAt).getTime() - new Date(a.savedAt).getTime());
  const recentSessions = allRecentSessions.slice(0, 3);

  const formatDate = (dateStr: string) => {
    const d = new Date(dateStr);
    return d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
  };

  const isSearching = searchQuery.length > 0;
  const showBulkActions = selectedIds.length > 0;

  return (
    <div className="flex-1 overflow-y-auto flex flex-col bg-background select-none">
      <div className="flex-1 px-4 pt-2 pb-4 space-y-6">
        {/* Primary Action Card */}
        {activeTabPlatform ? (
          <div className="space-y-3">
            <div className="p-4 border border-border rounded-2xl bg-card">
              <div className="flex items-center gap-2 mb-1">
                <PlatformLogo platform={activeTabPlatform} className="w-4 h-4" />
                <span className="text-sm font-medium text-foreground">
                  {platformLabels[activeTabPlatform]} Session
                </span>
              </div>
              <p className="text-xs text-muted-foreground mb-4">
                Save this conversation for export, transfer, or continuation.
              </p>
              {capturing || captureProgress ? (
                <div className="space-y-3">
                  <button disabled className="btn-primary opacity-70">
                    <RefreshCw className="w-4 h-4 animate-spin" />
                    Saving...
                  </button>
                  {captureProgress && (
                    <div className="space-y-1.5">
                      <div className="flex items-center justify-between text-xs">
                        <span className="text-muted-foreground truncate max-w-[200px]">
                          {captureProgress.step}
                        </span>
                        <span className="text-muted-foreground font-medium tabular-nums ml-2">
                          {captureProgress.current}/{captureProgress.total}
                        </span>
                      </div>
                      <div className="w-full h-1.5 bg-secondary rounded-full overflow-hidden">
                        <div
                          className="h-full bg-foreground/70 rounded-full transition-all duration-300 ease-out"
                          style={{
                            width: `${Math.min(100, (captureProgress.current / Math.max(1, captureProgress.total)) * 100)}%`,
                          }}
                        />
                      </div>
                    </div>
                  )}
                </div>
              ) : (
                <button onClick={handleCapture} className="btn-primary">
                  <Download className="w-4 h-4" />
                  Save Conversation
                </button>
              )}
              {captureError && (
                <div className="flex items-center gap-1.5 mt-3 text-destructive text-xs">
                  <AlertCircle className="w-3.5 h-3.5 flex-shrink-0" />
                  <span>{captureError}</span>
                </div>
              )}
            </div>
          </div>
        ) : (
          <div className="p-4 rounded-2xl border border-dashed border-border text-center text-xs text-muted-foreground">
            Open Claude, ChatGPT, Gemini, or Perplexity to capture an active conversation.
          </div>
        )}

        {/* Just Captured */}
        {lastCapturedSession && (
          <div className="space-y-2">
            <h3 className="text-xs font-semibold text-muted-foreground uppercase tracking-wider px-1">
              Just Captured
            </h3>
            <button
              onClick={() => onSelectSession(lastCapturedSession)}
              className="w-full border border-border rounded-2xl bg-card p-4 text-left hover:bg-accent/50 transition-colors cursor-pointer"
            >
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 rounded-xl bg-secondary flex items-center justify-center flex-shrink-0">
                  <PlatformLogo platform={lastCapturedSession.platform} className="w-5 h-5 text-muted-foreground" />
                </div>
                <div className="min-w-0 flex-1">
                  <h4 className="text-sm font-semibold truncate text-foreground">
                    {lastCapturedSession.title}
                  </h4>
                  <div className="flex items-center gap-2 mt-0.5">
                    <span className="text-xs text-muted-foreground">
                      {platformLabels[lastCapturedSession.platform] || lastCapturedSession.platform}
                    </span>
                    <span className="text-xs text-muted-foreground">
                      {lastCapturedSession.messages.length} messages
                    </span>
                    {lastCapturedSession.imageCount > 0 ? (
                      <span className="text-xs text-muted-foreground">
                        {lastCapturedSession.imageCount} images
                      </span>
                    ) : null}
                    {lastCapturedSession.fileCount > 0 ? (
                      <span className="text-xs text-muted-foreground">
                        {lastCapturedSession.fileCount} files
                      </span>
                    ) : null}
                  </div>
                </div>
                <ChevronRight className="w-4 h-4 text-muted-foreground flex-shrink-0" />
              </div>
            </button>
          </div>
        )}

        {/* Search + Select All */}
        {sessions.length > 0 && (
          <div className="flex gap-2">
            <div className="relative flex-1">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
              <input
                type="text"
                placeholder="Search your chats..."
                value={searchQuery}
                onChange={e => setSearchQuery(e.target.value)}
                className="w-full text-sm pl-10 pr-4 py-3 border border-border rounded-xl bg-card text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-foreground/10 transition-all"
              />
            </div>
            {!isSearching && (
              <button
                onClick={toggleSelectAll}
                className="px-3 border border-border rounded-xl bg-card text-muted-foreground hover:text-foreground hover:bg-secondary transition-colors cursor-pointer flex items-center"
                title="Select All"
              >
                {selectedIds.length === sessions.length && sessions.length > 0 ? (
                  <CheckSquare className="w-4 h-4 text-foreground" />
                ) : (
                  <Square className="w-4 h-4" />
                )}
              </button>
            )}
          </div>
        )}

        {/* Search Results */}
        {isSearching && filteredSessions.length > 0 && (
          <div className="space-y-1">
            {filteredSessions.slice(0, 8).map(session => {
              const isSelected = selectedIds.includes(session.id);
              return (
                <div
                  key={session.id}
                  onClick={() => onSelectSession(session)}
                  className="conversation-row"
                >
                  <button
                    onClick={(e) => toggleSelect(session.id, e)}
                    className="text-muted-foreground hover:text-foreground transition-colors cursor-pointer flex-shrink-0"
                  >
                    {isSelected ? (
                      <CheckSquare className="w-4 h-4 text-foreground" />
                    ) : (
                      <Square className="w-4 h-4 opacity-40" />
                    )}
                  </button>
                  <div className="min-w-0 flex-1">
                    <h4 className="text-sm font-medium truncate text-foreground">
                      {session.title}
                    </h4>
                    <p className="text-xs text-muted-foreground mt-0.5">
                      {platformLabels[session.platform]} · {formatDate(session.savedAt)}
                    </p>
                  </div>
                  <ChevronRight className="w-4 h-4 text-muted-foreground flex-shrink-0" />
                </div>
              );
            })}
          </div>
        )}

        {isSearching && filteredSessions.length === 0 && (
          <div className="text-center py-8 text-muted-foreground text-xs">
            No matches for "{searchQuery}"
          </div>
        )}

        {/* Providers */}
        {!isSearching && providersWithSessions.length > 0 && (
          <div className="space-y-2">
            <h3 className="text-xs font-semibold text-muted-foreground uppercase tracking-wider px-1">
              Providers
            </h3>
            <div className="border border-border rounded-2xl bg-card overflow-hidden divide-y divide-border">
              {providersWithSessions.map(([platform, list]) => (
                <div
                  key={platform}
                  onClick={() => onSelectProvider(platform)}
                  className="provider-row"
                >
                  <PlatformLogo platform={platform} className="w-5 h-5 flex-shrink-0" />
                  <span className="text-sm font-medium text-foreground flex-1">
                    {platformLabels[platform]}
                  </span>
                  <span className="text-xs text-muted-foreground">
                    {list.length} {list.length === 1 ? 'chat' : 'chats'}
                  </span>
                  <ChevronRight className="w-4 h-4 text-muted-foreground flex-shrink-0" />
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Recent Conversations */}
        {!isSearching && allRecentSessions.length > 0 && (
          <div className="space-y-2">
            <div className="flex items-center justify-between px-1">
              <h3 className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">
                Recent
              </h3>
              {allRecentSessions.length > 3 && (
                <button
                  onClick={onViewAll}
                  className="text-xs text-muted-foreground hover:text-foreground transition-colors cursor-pointer"
                >
                  View all
                </button>
              )}
            </div>
            <div className="border border-border rounded-2xl bg-card overflow-hidden divide-y divide-border">
              {recentSessions.map(session => {
                const isSelected = selectedIds.includes(session.id);
                return (
                  <div
                    key={session.id}
                    onClick={() => onSelectSession(session)}
                    className="conversation-row"
                  >
                    <button
                      onClick={(e) => toggleSelect(session.id, e)}
                      className="text-muted-foreground hover:text-foreground transition-colors cursor-pointer flex-shrink-0"
                    >
                      {isSelected ? (
                        <CheckSquare className="w-4 h-4 text-foreground" />
                      ) : (
                        <Square className="w-4 h-4 opacity-40" />
                      )}
                    </button>
                    <div className="min-w-0 flex-1">
                      <h4 className="text-sm font-medium truncate text-foreground">
                        {session.title}
                      </h4>
                      <p className="text-xs text-muted-foreground mt-0.5">
                        {platformLabels[session.platform]} · {formatDate(session.savedAt)}
                      </p>
                    </div>
                    <ChevronRight className="w-4 h-4 text-muted-foreground flex-shrink-0" />
                  </div>
                );
              })}
            </div>
          </div>
        )}

        {/* Empty State */}
        {sessions.length === 0 && (
          <div className="flex flex-col items-center justify-center py-12 text-center text-muted-foreground">
            <span className="text-sm font-medium">No saved sessions yet</span>
            <span className="text-xs mt-1">Capture conversations to start building your library.</span>
          </div>
        )}
      </div>

      {/* Bulk Actions Bar */}
      {showBulkActions && (
        <div className="px-4 py-3 bg-background/80 backdrop-blur-md border-t border-border flex items-center justify-between select-none">
          <span className="text-sm font-medium text-foreground">
            {selectedIds.length} Selected
          </span>
          <div className="flex gap-2">
            <button
              onClick={handleBulkExport}
              className="flex items-center gap-1.5 py-2 px-4 border border-border hover:bg-secondary rounded-xl text-sm font-medium cursor-pointer transition-colors"
            >
              <Download className="w-4 h-4" />
              ZIP
            </button>
            <button
              onClick={handleBulkDelete}
              className="flex items-center gap-1.5 py-2 px-4 bg-destructive text-destructive-foreground hover:opacity-90 rounded-xl text-sm font-medium cursor-pointer transition-opacity"
            >
              <Trash2 className="w-4 h-4" />
              Delete
            </button>
          </div>
        </div>
      )}

      {/* Footer */}
      {!showBulkActions && (
        <div className="px-4 py-3 border-t border-border">
          <div className="flex items-center justify-center gap-1.5 text-xs text-muted-foreground">
            <Lock className="w-3 h-3" />
            <span>Your API key is stored locally</span>
          </div>
        </div>
      )}
    </div>
  );
};
