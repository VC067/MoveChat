import React, { useState } from 'react';
import { Search, ChevronRight, MessageSquare, CheckSquare, Square, Trash2, Download } from 'lucide-react';
import type { Session } from '../../shared/types';
import { generateMarkdown } from '../../shared/markdown';
import JSZip from 'jszip';
import PlatformLogo from './PlatformLogo';

interface ProviderConversationsViewProps {
  provider: string;
  sessions: Session[];
  onSelectSession: (session: Session) => void;
  onDeleteSessions: (ids: string[]) => void;
}

const platformLabels: Record<string, string> = {
  chatgpt: 'ChatGPT',
  claude: 'Claude',
  gemini: 'Gemini',
  perplexity: 'Perplexity',
};

export const ProviderConversationsView: React.FC<ProviderConversationsViewProps> = ({
  provider,
  sessions,
  onSelectSession,
  onDeleteSessions,
}) => {
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedIds, setSelectedIds] = useState<string[]>([]);

  const filteredSessions = sessions.filter(s =>
    s.title.toLowerCase().includes(searchQuery.toLowerCase())
  );

  const toggleSelect = (id: string, e: React.MouseEvent) => {
    e.stopPropagation();
    setSelectedIds(prev =>
      prev.includes(id) ? prev.filter(x => x !== id) : [...prev, id]
    );
  };

  const toggleSelectAll = () => {
    if (selectedIds.length === filteredSessions.length) {
      setSelectedIds([]);
    } else {
      setSelectedIds(filteredSessions.map(s => s.id));
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
      a.download = `movechat_${provider}_${new Date().toISOString().slice(0, 10)}.zip`;
      a.click();
    } catch (err) {
      console.error('ZIP compilation failed:', err);
    }
  };

  const formatDate = (dateStr: string) => {
    const d = new Date(dateStr);
    return d.toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' });
  };

  const showBulkActions = selectedIds.length > 0;

  return (
    <div className="flex-1 overflow-y-auto flex flex-col bg-background select-none">
      <div className="flex-1 px-4 pt-2 pb-4 space-y-4">
        {/* Provider Header */}
        <div className="flex items-center gap-3">
          <PlatformLogo platform={provider} className="w-6 h-6" />
          <div>
            <h2 className="text-lg font-semibold text-foreground">
              {platformLabels[provider]}
            </h2>
            <p className="text-xs text-muted-foreground">
              {sessions.length} {sessions.length === 1 ? 'chat' : 'chats'}
            </p>
          </div>
        </div>

        {/* Search + Select All */}
        {sessions.length > 0 && (
          <div className="flex gap-2">
            <div className="relative flex-1">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
              <input
                type="text"
                placeholder={`Search ${platformLabels[provider]} chats...`}
                value={searchQuery}
                onChange={e => setSearchQuery(e.target.value)}
                className="w-full text-sm pl-10 pr-4 py-3 border border-border rounded-xl bg-card text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-foreground/10 transition-all"
              />
            </div>
            <button
              onClick={toggleSelectAll}
              className="px-3 border border-border rounded-xl bg-card text-muted-foreground hover:text-foreground hover:bg-secondary transition-colors cursor-pointer flex items-center"
              title="Select All"
            >
              {selectedIds.length === filteredSessions.length && filteredSessions.length > 0 ? (
                <CheckSquare className="w-4 h-4 text-foreground" />
              ) : (
                <Square className="w-4 h-4" />
              )}
            </button>
          </div>
        )}

        {/* Conversation List */}
        {filteredSessions.length > 0 ? (
          <div className="border border-border rounded-2xl bg-card overflow-hidden divide-y divide-border">
            {filteredSessions.map(session => {
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
                    <div className="flex items-center gap-2 mt-1">
                      <div className="flex items-center gap-1 text-xs text-muted-foreground">
                        <MessageSquare className="w-3 h-3" />
                        <span>{session.messageCount} messages</span>
                      </div>
                      <span className="text-xs text-muted-foreground">·</span>
                      <span className="text-xs text-muted-foreground">
                        {formatDate(session.savedAt)}
                      </span>
                    </div>
                  </div>
                  <ChevronRight className="w-4 h-4 text-muted-foreground flex-shrink-0" />
                </div>
              );
            })}
          </div>
        ) : (
          <div className="text-center py-12 text-muted-foreground text-xs">
            {searchQuery
              ? `No matches for "${searchQuery}"`
              : `No ${platformLabels[provider]} conversations saved yet.`
            }
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
    </div>
  );
};
