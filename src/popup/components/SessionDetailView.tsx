import React, { useState } from 'react';
import {
  Play, Trash2, Check, FileText, Copy,
  MessageSquare, Image, Paperclip, Archive, AlertTriangle, Loader2, Sparkles
} from 'lucide-react';
import JSZip from 'jszip';
import type { Session, Settings } from '../../shared/types';
import { generateMarkdown } from '../../shared/markdown';
import { generatePdf } from '../../shared/pdf';
import { setStorage } from '../../shared/storage';
import PlatformLogo from './PlatformLogo';

interface SessionDetailViewProps {
  session: Session;
  settings: Settings | null;
  onBack: () => void;
  onDelete: (id: string) => void;
  onUpdateTitle: (id: string, newTitle: string) => void;
}

const platformLabels: Record<string, string> = {
  chatgpt: 'ChatGPT',
  claude: 'Claude',
  gemini: 'Gemini',
  perplexity: 'Perplexity',
};

async function generateAiSummary(session: Session, settings: Settings): Promise<string> {
  const s = settings.aiSummary;
  if (!s.apiKey) throw new Error('No API key set. Configure in Settings.');

  // Build conversation text for the LLM
  const conversationText = session.messages
    .map(m => `[${m.role.toUpperCase()}]: ${m.content}`)
    .join('\n\n');

  const prompt = `${s.summaryTemplate}\n\n---\n\nCONVERSATION:\n\n${conversationText}`;

  if (s.provider === 'openai') {
    const response = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${s.apiKey}`
      },
      body: JSON.stringify({
        model: s.model || 'gpt-5.5',
        messages: [{ role: 'user', content: prompt }],
        temperature: 0.3
      })
    });
    if (!response.ok) {
      const err = await response.json();
      throw new Error(err.error?.message || 'OpenAI API request failed');
    }
    const data = await response.json();
    return data.choices[0]?.message?.content || '';
  } else if (s.provider === 'anthropic') {
    const response = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-api-key': s.apiKey,
        'anthropic-version': '2023-06-01'
      },
      body: JSON.stringify({
        model: s.model || 'claude-sonnet-4.5',
        max_tokens: 4096,
        messages: [{ role: 'user', content: prompt }]
      })
    });
    if (!response.ok) {
      const errText = await response.text();
      throw new Error(errText || 'Anthropic API request failed');
    }
    const data = await response.json();
    return data.content[0]?.text || '';
  } else if (s.provider === 'gemini') {
    const model = s.model || 'gemini-3.5-flash';
    const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${s.apiKey}`;
    const response = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        contents: [{ parts: [{ text: prompt }] }]
      })
    });
    if (!response.ok) {
      const err = await response.json();
      throw new Error(err.error?.message || 'Gemini API request failed');
    }
    const data = await response.json();
    return data.candidates?.[0]?.content?.parts?.[0]?.text || '';
  }

  throw new Error('Unknown provider');
}

export const SessionDetailView: React.FC<SessionDetailViewProps> = ({
  session,
  settings,
  onDelete,
  onUpdateTitle,
}) => {
  const [isEditingTitle, setIsEditingTitle] = useState(false);
  const [editedTitle, setEditedTitle] = useState(session.title);
  const [copied, setCopied] = useState(false);
  const [resuming, setResuming] = useState<string | null>(null);
  const [showPlatformDropdown, setShowPlatformDropdown] = useState(false);

  const [summaryLoading, setSummaryLoading] = useState(false);
  const [summaryResult, setSummaryResult] = useState<string | null>(null);
  const [summaryError, setSummaryError] = useState<string | null>(null);
  const [summaryCopied, setSummaryCopied] = useState(false);

  const handleSaveTitle = () => {
    if (editedTitle.trim()) {
      onUpdateTitle(session.id, editedTitle.trim());
    }
    setIsEditingTitle(false);
  };

  const handleCopy = () => {
    const mdContent = generateMarkdown(session);
    navigator.clipboard.writeText(mdContent);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const handleDownloadMd = async () => {
    const safeTitle = session.title.replace(/[^a-z0-9]/gi, '_').toLowerCase();
    const hasMedia = session.messages.some(msg => msg.files?.some(f => f.content));

    if (hasMedia) {
      const zip = new JSZip();
      zip.file('transcript.md', generateMarkdown(session));
      session.messages.forEach(msg => {
        if (msg.files) {
          msg.files.forEach(file => {
            if (file.content) {
              const parts = file.content.split(',');
              const base64Data = parts[1] || parts[0];
              zip.file(`images/${file.name}`, base64Data, { base64: true });
            }
          });
        }
      });
      const base64 = await zip.generateAsync({ type: 'base64' });
      const a = document.createElement('a');
      a.href = `data:application/zip;base64,${base64}`;
      a.download = `${safeTitle}.zip`;
      a.click();
    } else {
      const blob = new Blob([generateMarkdown(session)], { type: 'text/markdown' });
      const reader = new FileReader();
      reader.onloadend = () => {
        const a = document.createElement('a');
        a.href = reader.result as string;
        a.download = `${safeTitle}.md`;
        a.click();
      };
      reader.readAsDataURL(blob);
    }
  };

  const handleDownloadPdf = async () => {
    const safeTitle = session.title.replace(/[^a-z0-9]/gi, '_').toLowerCase();
    const pdfBlob = await generatePdf(session);
    const reader = new FileReader();
    reader.onloadend = () => {
      const a = document.createElement('a');
      a.href = reader.result as string;
      a.download = `${safeTitle}.pdf`;
      a.click();
    };
    reader.readAsDataURL(pdfBlob);
  };

  const handleSaveZip = async () => {
    const safeTitle = session.title.replace(/[^a-z0-9]/gi, '_').toLowerCase();
    const zip = new JSZip();
    zip.file('transcript.md', generateMarkdown(session));
    session.messages.forEach(msg => {
      if (msg.files) {
        msg.files.forEach(file => {
          if (file.content) {
            const parts = file.content.split(',');
            const base64Data = parts[1] || parts[0];
            zip.file(`images/${file.name}`, base64Data, { base64: true });
          }
        });
      }
    });
    const base64 = await zip.generateAsync({ type: 'base64' });
    const a = document.createElement('a');
    a.href = `data:application/zip;base64,${base64}`;
    a.download = `${safeTitle}.zip`;
    a.click();
  };

  const handleResume = async (targetPlatform: Session['platform']) => {
    setResuming(targetPlatform);
    try {
      const handoffText = settings?.handoffTemplateMd || 'Attached is my previous conversation transcript.';
      const format = 'md';

      const allAttachments: { name: string; type: string; content: string }[] = [];
      for (const msg of session.messages) {
        if (msg.files && msg.files.length > 0) {
          for (const file of msg.files) {
            if (file.content && !allAttachments.some(a => a.content === file.content)) {
              allAttachments.push({
                name: file.name,
                type: file.type,
                content: file.content,
              });
            }
          }
        }
      }

      const executeHandoffRedirection = async (fileContent: string) => {
        const pending = {
          targetPlatform,
          handoffText,
          fileName: `movechat-history.${format}`,
          mimeType: 'text/markdown',
          fileContent,
          attachments: allAttachments.length > 0 ? allAttachments : undefined,
        };
        await setStorage('pending_handoff', pending);

        if (typeof chrome !== 'undefined' && chrome.runtime && chrome.runtime.sendMessage) {
          chrome.runtime.sendMessage({
            action: 'RESUME_CHAT',
            targetPlatform,
          }, () => {
            window.close();
          });
        } else {
          alert(`Dev Mode: Handoff stored in storage and redirected to ${targetPlatform}`);
          setResuming(null);
        }
      };

      const mdText = generateMarkdown(session);
      await executeHandoffRedirection(mdText);
    } catch (err) {
      console.error(err);
      setResuming(null);
    }
  };

  const handleGenerateSummary = async () => {
    setSummaryLoading(true);
    setSummaryError(null);
    setSummaryResult(null);
    try {
      const result = await generateAiSummary(session, settings!);
      setSummaryResult(result);
    } catch (err: any) {
      setSummaryError(err.message || 'Failed to generate summary.');
    } finally {
      setSummaryLoading(false);
    }
  };

  const handleCopySummary = () => {
    if (summaryResult) {
      navigator.clipboard.writeText(summaryResult);
      setSummaryCopied(true);
      setTimeout(() => setSummaryCopied(false), 2000);
    }
  };

  return (
    <div className="flex-1 overflow-y-auto flex flex-col bg-background select-none">
      <div className="flex-1 px-4 pt-2 pb-4 space-y-5">
        {/* Title */}
        <div>
          {isEditingTitle ? (
            <input
              type="text"
              value={editedTitle}
              onChange={e => setEditedTitle(e.target.value)}
              onBlur={handleSaveTitle}
              onKeyDown={e => e.key === 'Enter' && handleSaveTitle()}
              className="w-full text-lg font-semibold px-0 py-1 border-0 border-b-2 border-foreground bg-transparent text-foreground focus:outline-none transition-all"
              autoFocus
            />
          ) : (
            <div className="flex items-start justify-between gap-2">
              <h2 className="text-lg font-semibold text-foreground leading-snug">
                {session.title}
              </h2>
              <button
                onClick={() => setIsEditingTitle(true)}
                className="p-1.5 rounded-lg hover:bg-secondary text-muted-foreground hover:text-foreground cursor-pointer flex-shrink-0 transition-colors"
                title="Edit Title"
              >
                <span className="text-xs font-medium">Edit</span>
              </button>
            </div>
          )}
          <div className="flex items-center gap-2 mt-1.5">
            <PlatformLogo platform={session.platform} className="w-3.5 h-3.5" />
            <p className="text-xs text-muted-foreground">
              {platformLabels[session.platform]} · {new Date(session.savedAt).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' })} · {new Date(session.savedAt).toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' })}
            </p>
          </div>
        </div>

        {/* Metadata Chips */}
        <div className="flex items-center gap-2">
          <div className="chip">
            <MessageSquare className="w-3 h-3" />
            <span>{session.messageCount}</span>
          </div>
          <div className="chip">
            <Image className="w-3 h-3" />
            <span>{session.imageCount}</span>
          </div>
          <div className="chip">
            <Paperclip className="w-3 h-3" />
            <span>{session.fileCount}</span>
          </div>
        </div>

        {/* Resume Button */}
        <div className="relative">
          <button
            onClick={() => setShowPlatformDropdown(prev => !prev)}
            disabled={resuming !== null}
            className="btn-primary"
          >
            <Play className="w-4 h-4 fill-current" />
            {resuming ? 'Resuming chat...' : 'Resume in new chat'}
          </button>

          {showPlatformDropdown && (
            <div className="absolute top-full mt-2 left-0 right-0 border border-border bg-card rounded-2xl shadow-lg overflow-hidden z-10">
              {(['claude', 'chatgpt', 'gemini', 'perplexity'] as const).map(plt => (
                <button
                  key={plt}
                  onClick={() => {
                    setShowPlatformDropdown(false);
                    handleResume(plt);
                  }}
                  className="w-full flex items-center gap-3 py-3 px-4 hover:bg-secondary text-left text-sm font-medium transition-colors cursor-pointer"
                >
                  <PlatformLogo platform={plt} className="w-5 h-5 flex-shrink-0" />
                  {platformLabels[plt]}
                </button>
              ))}
            </div>
          )}
        </div>

        {/* AI Summary Section */}
        <div className="p-4 border border-border rounded-2xl bg-card">
          <div className="flex items-start gap-3">
            <div className="w-8 h-8 rounded-xl bg-secondary flex items-center justify-center flex-shrink-0 mt-0.5">
              <Sparkles className="w-4 h-4 text-muted-foreground" />
            </div>
            <div className="flex-1">
              <label className="text-sm font-medium text-foreground block">
                Generate AI Summary
              </label>
              <p className="text-xs text-muted-foreground mt-1 leading-relaxed">
                Create a handoff-ready summary for the next AI agent or chat.
              </p>

              <button
                onClick={handleGenerateSummary}
                disabled={summaryLoading}
                className="mt-3 flex items-center gap-2 py-2 px-4 border border-border hover:bg-secondary rounded-xl text-sm font-medium cursor-pointer transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
              >
                {summaryLoading ? (
                  <>
                    <Loader2 className="w-4 h-4 animate-spin" />
                    Generating...
                  </>
                ) : (
                  <>
                    <Sparkles className="w-4 h-4" />
                    Generate summary
                  </>
                )}
              </button>

              {summaryError && (
                <div className="flex items-center gap-1.5 mt-2 text-destructive text-xs">
                  <AlertTriangle className="w-3.5 h-3.5 flex-shrink-0" />
                  <span>{summaryError}</span>
                </div>
              )}

              {summaryResult && (
                <div className="mt-3 space-y-2">
                  <div className="p-3 bg-secondary/50 rounded-xl text-sm text-foreground leading-relaxed whitespace-pre-wrap max-h-64 overflow-y-auto">
                    {summaryResult}
                  </div>
                  <button
                    onClick={handleCopySummary}
                    className="flex items-center gap-1.5 py-1.5 px-3 text-xs font-medium text-muted-foreground hover:text-foreground transition-colors cursor-pointer"
                  >
                    {summaryCopied ? (
                      <>
                        <Check className="w-3.5 h-3.5 text-emerald-500" />
                        Copied!
                      </>
                    ) : (
                      <>
                        <Copy className="w-3.5 h-3.5" />
                        Copy summary
                      </>
                    )}
                  </button>
                </div>
              )}
            </div>
          </div>
        </div>

        {/* Export Section */}
        <div className="space-y-3">
          <h3 className="text-xs font-semibold text-muted-foreground uppercase tracking-wider px-1">
            Export
          </h3>
          <div className="grid grid-cols-2 gap-3">
            <button onClick={handleDownloadMd} className="btn-secondary">
              <FileText className="w-4 h-4" />
              Download as MD
            </button>
            <button onClick={handleDownloadPdf} className="btn-secondary">
              <FileText className="w-4 h-4" />
              Download as PDF
            </button>
          </div>
        </div>

        {/* Actions */}
        <div className="space-y-1">
          <button
            onClick={handleCopy}
            className="w-full flex items-center gap-3 py-3 px-4 border border-border bg-card hover:bg-secondary rounded-2xl transition-colors text-sm font-medium text-left cursor-pointer"
          >
            {copied ? (
              <Check className="w-4 h-4 text-emerald-500 flex-shrink-0" />
            ) : (
              <Copy className="w-4 h-4 text-muted-foreground flex-shrink-0" />
            )}
            <span>{copied ? 'Copied chat history!' : 'Copy chat history'}</span>
          </button>

          <button
            onClick={handleSaveZip}
            className="w-full flex items-center gap-3 py-3 px-4 border border-border bg-card hover:bg-secondary rounded-2xl transition-colors text-sm font-medium text-left cursor-pointer"
          >
            <Archive className="w-4 h-4 text-muted-foreground flex-shrink-0" />
            <span>Save as file bundle (.zip)</span>
          </button>
        </div>

        {/* Danger Zone */}
        <div className="pt-2 border-t border-border">
          <button
            onClick={() => onDelete(session.id)}
            className="w-full flex items-center justify-center gap-2 py-2.5 text-destructive hover:bg-destructive/10 rounded-2xl text-sm font-medium cursor-pointer bg-transparent transition-colors"
          >
            <Trash2 className="w-4 h-4" />
            Delete this session
          </button>
        </div>
      </div>
    </div>
  );
};
