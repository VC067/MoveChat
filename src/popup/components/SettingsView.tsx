import React, { useState } from 'react';
import type { Settings } from '../../shared/types';
import { Trash2, Eye, EyeOff, ChevronDown, ChevronRight } from 'lucide-react';

interface SettingsViewProps {
  settings: Settings;
  onUpdateSettings: (newSettings: Settings) => void;
}

export const SettingsView: React.FC<SettingsViewProps> = ({ settings, onUpdateSettings }) => {
  const [theme, setTheme] = useState(settings.theme);
  const [autoSend, setAutoSend] = useState(settings.autoSend);

  const [provider, setProvider] = useState(settings.aiSummary.provider);
  const [apiKey, setApiKey] = useState(settings.aiSummary.apiKey);
  const [model, setModel] = useState(settings.aiSummary.model);
  const [summaryTemplate, setSummaryTemplate] = useState(settings.aiSummary.summaryTemplate);

  const [pdfTemplate, setPdfTemplate] = useState(settings.handoffTemplatePdf);
  const [mdTemplate, setMdTemplate] = useState(settings.handoffTemplateMd);

  const [showKey, setShowKey] = useState(false);
  const [saveSuccess, setSaveSuccess] = useState(false);
  const [showAiSummary, setShowAiSummary] = useState(false);
  const [showTemplates, setShowTemplates] = useState(false);

  const handleThemeChange = (newTheme: 'light' | 'dark' | 'system') => {
    setTheme(newTheme);
    onUpdateSettings({
      ...settings,
      theme: newTheme,
    });
  };

  const handleSave = () => {
    const updated: Settings = {
      theme,
      autoSend,
      handoffTemplatePdf: pdfTemplate,
      handoffTemplateMd: mdTemplate,
      aiSummary: {
        provider,
        apiKey,
        model,
        summaryTemplate,
      },
    };
    onUpdateSettings(updated);
    setSaveSuccess(true);
    setTimeout(() => setSaveSuccess(false), 2000);
  };

  const handleFactoryReset = () => {
    if (confirm('Are you sure you want to perform a factory reset? This will delete all saved chats, API keys, and settings.')) {
      if (typeof chrome !== 'undefined' && chrome.storage && chrome.storage.local) {
        chrome.storage.local.clear(() => {
          window.location.reload();
        });
      } else {
        localStorage.clear();
        window.location.reload();
      }
    }
  };

  return (
    <div className="flex-1 overflow-y-auto flex flex-col bg-background select-none">
      <div className="flex-1 px-4 pt-2 pb-4 space-y-6">
        {/* General */}
        <div className="space-y-2">
          <h3 className="text-xs font-semibold text-muted-foreground uppercase tracking-wider px-1">
            General
          </h3>
          <div className="settings-group">
            <div className="settings-row border-b border-border">
              <span className="text-sm font-medium">Theme</span>
              <select
                value={theme}
                onChange={e => handleThemeChange(e.target.value as 'light' | 'dark' | 'system')}
                className="px-3 py-1.5 text-sm border border-border rounded-lg bg-secondary text-foreground focus:outline-none cursor-pointer"
              >
                <option value="light">Light</option>
                <option value="dark">Dark</option>
                <option value="system">System</option>
              </select>
            </div>
            <div className="settings-row">
              <div className="flex-1 mr-4">
                <span className="text-sm font-medium block">Auto-send after resume</span>
                <span className="text-xs text-muted-foreground">Automatically press send after importing.</span>
              </div>
              <button
                onClick={() => setAutoSend(!autoSend)}
                className={`ios-toggle ${autoSend ? 'active' : ''}`}
                aria-label="Toggle auto-send"
              />
            </div>
          </div>
        </div>

        {/* AI Summary (Collapsible) */}
        <div className="space-y-2">
          <button
            onClick={() => setShowAiSummary(prev => !prev)}
            className="w-full collapsible-header px-1"
          >
            <h3 className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">
              AI Summary
            </h3>
            {showAiSummary ? (
              <ChevronDown className="w-4 h-4 text-muted-foreground" />
            ) : (
              <ChevronRight className="w-4 h-4 text-muted-foreground" />
            )}
          </button>

          {showAiSummary && (
            <div className="settings-group space-y-3 px-4 py-4">
              <p className="text-xs text-muted-foreground leading-relaxed">
                Configure the AI provider used to generate handoff-ready summaries of your conversations.
              </p>

              <div className="flex items-center justify-between">
                <span className="text-sm font-medium">Provider</span>
                <select
                  value={provider}
                  onChange={e => {
                    const prov = e.target.value as any;
                    setProvider(prov);
                    if (prov === 'openai') setModel('gpt-5.5');
                    else if (prov === 'anthropic') setModel('claude-sonnet-4.5');
                    else if (prov === 'gemini') setModel('gemini-3.5-flash');
                  }}
                  className="px-3 py-1.5 text-sm border border-border rounded-lg bg-secondary focus:outline-none cursor-pointer"
                >
                  <option value="openai">OpenAI</option>
                  <option value="anthropic">Claude (Anthropic)</option>
                  <option value="gemini">Gemini</option>
                </select>
              </div>

              <div className="space-y-1.5">
                <span className="text-sm font-medium block">API Key</span>
                <div className="relative">
                  <input
                    type={showKey ? 'text' : 'password'}
                    value={apiKey}
                    onChange={e => setApiKey(e.target.value)}
                    placeholder="Paste key here..."
                    className="w-full text-sm pl-3 pr-10 py-2.5 border border-border rounded-xl bg-secondary focus:outline-none focus:ring-2 focus:ring-foreground/10 transition-all"
                  />
                  <button
                    onClick={() => setShowKey(!showKey)}
                    className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground cursor-pointer"
                  >
                    {showKey ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                  </button>
                </div>
              </div>

              <div className="flex items-center justify-between">
                <span className="text-sm font-medium">Model Name</span>
                <input
                  type="text"
                  value={model}
                  onChange={e => setModel(e.target.value)}
                  className="w-2/3 px-3 py-1.5 text-sm text-right border border-border rounded-lg bg-secondary focus:outline-none focus:ring-2 focus:ring-foreground/10 transition-all"
                />
              </div>

              <div className="space-y-1.5">
                <span className="text-sm font-medium block">Summary Prompt Template</span>
                <textarea
                  value={summaryTemplate}
                  onChange={e => setSummaryTemplate(e.target.value)}
                  rows={4}
                  className="w-full text-sm p-3 border border-border rounded-xl bg-secondary text-foreground focus:outline-none focus:ring-2 focus:ring-foreground/10 transition-all resize-none"
                />
                <p className="text-xs text-muted-foreground">
                  This prompt is sent to the AI along with the conversation to generate the summary.
                </p>
              </div>
            </div>
          )}
        </div>

        {/* Handoff Templates (Collapsible) */}
        <div className="space-y-2">
          <button
            onClick={() => setShowTemplates(prev => !prev)}
            className="w-full collapsible-header px-1"
          >
            <h3 className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">
              Handoff Templates
            </h3>
            {showTemplates ? (
              <ChevronDown className="w-4 h-4 text-muted-foreground" />
            ) : (
              <ChevronRight className="w-4 h-4 text-muted-foreground" />
            )}
          </button>

          {showTemplates && (
            <div className="settings-group space-y-4 px-4 py-4">
              <div className="space-y-2">
                <span className="text-sm font-medium block">Markdown Export Prompt</span>
                <textarea
                  value={mdTemplate}
                  onChange={e => setMdTemplate(e.target.value)}
                  rows={3}
                  className="w-full text-sm p-3 border border-border rounded-xl bg-secondary text-foreground focus:outline-none focus:ring-2 focus:ring-foreground/10 transition-all resize-none"
                />
              </div>
              <div className="space-y-2">
                <span className="text-sm font-medium block">PDF Export Prompt</span>
                <textarea
                  value={pdfTemplate}
                  onChange={e => setPdfTemplate(e.target.value)}
                  rows={3}
                  className="w-full text-sm p-3 border border-border rounded-xl bg-secondary text-foreground focus:outline-none focus:ring-2 focus:ring-foreground/10 transition-all resize-none"
                />
              </div>
            </div>
          )}
        </div>
      </div>

      {/* Footer */}
      <div className="px-4 py-4 border-t border-border space-y-2 select-none">
        <button
          onClick={handleSave}
          className={`btn-primary ${
            saveSuccess
              ? '!bg-emerald-500'
              : ''
          }`}
        >
          {saveSuccess ? 'Saved!' : 'Save Settings'}
        </button>

        <button
          onClick={handleFactoryReset}
          className="w-full flex items-center justify-center gap-1.5 py-2.5 text-destructive hover:bg-destructive/10 rounded-2xl text-sm font-medium cursor-pointer transition-colors"
        >
          <Trash2 className="w-4 h-4" />
          Factory Reset
        </button>
      </div>
    </div>
  );
};
