import React, { useState, useMemo } from 'react';
import {
  Search, ChevronRight, CheckSquare, Square, Trash2, Download, X
} from 'lucide-react';
import type { Session } from '../../shared/types';
import { generateMarkdown } from '../../shared/markdown';
import JSZip from 'jszip';
import PlatformLogo from './PlatformLogo';

interface AllSessionsViewProps {
  sessions: Session[];
  onSelectSession: (session: Session) => void;
  onDeleteSessions: (ids: string[]) => void;
  onBack: () => void;
}

const platformLabels: Record<string, string> = {
  chatgpt: 'ChatGPT',
  claude: 'Claude',
  gemini: 'Gemini',
  perplexity: 'Perplexity',
};

type DateFilter = 'all' | 'today' | 'week' | 'month' | 'year';

export const AllSessionsView: React.FC<AllSessionsViewProps> = ({
  sessions,
  onSelectSession,
  onDeleteSessions,
  onBack,
}) => {
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedPlatforms, setSelectedPlatforms] = useState<string[]>([]);
  const [dateFilter, setDateFilter] = useState<DateFilter>('all');
  const [selectedIds, setSelectedIds] = useState<string[]>([]);

  const togglePlatform = (platform: string) => {
    setSelectedPlatforms(prev =>
      prev.includes(platform) ? prev.filter(p => p !== platform) : [...prev, platform]
    );
  };

  const toggleSelect = (id: string, e: React.MouseEvent) => {
    e.stopPropagation();
    setSelectedIds(prev =>
      prev.includes(id) ? prev.filter(x => x !== id) : [...prev, id]
    );
  };

  const toggleSelectAll = () => {
    const allIds = filteredSessions.map(s => s.id);
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
      a.download = `movechat_export_${new Date().toISOString().slice(0, 10)}.zip`;
      a.click();
    } catch (err) {
      console.error('ZIP export failed:', err);
    }
  };

  const matchesDateFilter = (session: Session): boolean => {
    if (dateFilter === 'all') return true;
    const saved = new Date(session.savedAt);
    const now = new Date();
    if (dateFilter === 'today') {
      return saved.toDateString() === now.toDateString();
    }
    if (dateFilter === 'week') {
      const weekAgo = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
      return saved >= weekAgo;
    }
    if (dateFilter === 'month') {
      const monthAgo = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);
      return saved >= monthAgo;
    }
    if (dateFilter === 'year') {
      const yearAgo = new Date(now.getTime() - 365 * 24 * 60 * 60 * 1000);
      return saved >= yearAgo;
    }
    return true;
  };

  const filteredSessions = useMemo(() => {
    return sessions.filter(s => {
      const matchesSearch = !searchQuery ||
        s.title.toLowerCase().includes(searchQuery.toLowerCase());
      const matchesPlatform = selectedPlatforms.length === 0 ||
        selectedPlatforms.includes(s.platform);
      const matchesDate = matchesDateFilter(s);
      return matchesSearch && matchesPlatform && matchesDate;
    });
  }, [sessions, searchQuery, selectedPlatforms, dateFilter]);

  const formatDate = (dateStr: string) => {
    const d = new Date(dateStr);
    return d.toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' });
  };

  const showBulkActions = selectedIds.length > 0;

  return (
    <div className="flex-1 overflow-y-auto flex flex-col bg-background select-none">
      <div className="flex-1 px-4 pt-2 pb-4 space-y-4">
        {/* Header */}
        <div className="flex items-center justify-between">
          <h2 className="text-lg font-semibold text-foreground">All Conversations</h2>
          <button
            onClick={onBack}
            className="p-1.5 rounded-lg hover:bg-secondary text-muted-foreground hover:text-foreground cursor-pointer transition-colors"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Search */}
        <div className="relative">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
          <input
            type="text"
            placeholder="Search conversations..."
            value={searchQuery}
            onChange={e => setSearchQuery(e.target.value)}
            className="w-full text-sm pl-10 pr-4 py-3 border border-border rounded-xl bg-card text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-foreground/10 transition-all"
          />
        </div>

        {/* Provider Filters */}
        <div className="space-y-2">
          <h3 className="text-xs font-semibold text-muted-foreground uppercase tracking-wider px-1">
            Providers
          </h3>
          <div className="flex flex-wrap gap-2">
            {(['chatgpt', 'claude', 'gemini', 'perplexity'] as const).map(platform => {
              const count = sessions.filter(s => s.platform === platform).length;
              if (count === 0) return null;
              const isActive = selectedPlatforms.includes(platform);
              return (
                <button
                  key={platform}
                  onClick={() => togglePlatform(platform)}
                  className={`flex items-center gap-2 py-1.5 px-3 rounded-xl text-xs font-medium border transition-colors cursor-pointer ${
                    isActive
                      ? 'border-foreground bg-foreground text-background'
                      : 'border-border bg-card text-muted-foreground hover:text-foreground hover:bg-secondary'
                  }`}
                >
                  <PlatformLogo platform={platform} className="w-3.5 h-3.5" />
                  {platformLabels[platform]}
                  <span className="opacity-60">{count}</span>
                </button>
              );
            })}
          </div>
        </div>

        {/* Date Filters */}
        <div className="space-y-2">
          <h3 className="text-xs font-semibold text-muted-foreground uppercase tracking-wider px-1">
            Date
          </h3>
          <div className="flex flex-wrap gap-2">
            {([
              { value: 'all', label: 'All time' },
              { value: 'today', label: 'Today' },
              { value: 'week', label: 'This week' },
              { value: 'month', label: 'This month' },
              { value: 'year', label: 'This year' },
            ] as const).map(opt => (
              <button
                key={opt.value}
                onClick={() => setDateFilter(opt.value)}
                className={`py-1.5 px-3 rounded-xl text-xs font-medium border transition-colors cursor-pointer ${
                  dateFilter === opt.value
                    ? 'border-foreground bg-foreground text-background'
                    : 'border-border bg-card text-muted-foreground hover:text-foreground hover:bg-secondary'
                }`}
              >
                {opt.label}
              </button>
            ))}
          </div>
        </div>

        {/* Results count + Select All */}
        <div className="flex items-center justify-between px-1">
          <span className="text-xs text-muted-foreground">
            {filteredSessions.length} {filteredSessions.length === 1 ? 'conversation' : 'conversations'}
          </span>
          {filteredSessions.length > 0 && (
            <button
              onClick={toggleSelectAll}
              className="text-xs text-muted-foreground hover:text-foreground transition-colors cursor-pointer"
            >
              {selectedIds.length === filteredSessions.length ? 'Deselect all' : 'Select all'}
            </button>
          )}
        </div>

        {/* Session List */}
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
                    <div className="flex items-center gap-2 mt-0.5">
                      <PlatformLogo platform={session.platform} className="w-3 h-3" />
                      <span className="text-xs text-muted-foreground">
                        {platformLabels[session.platform]} · {formatDate(session.savedAt)}
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
            No conversations match your filters.
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
