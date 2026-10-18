import React, { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Session } from '../src/shared/types';
import App from '../src/App';

const state = vi.hoisted(() => ({
  capture: vi.fn(), save: vi.fn(),
  onCapture: undefined as undefined | (() => Promise<Session | null>),
  lastCapture: null as Session | null,
}));
vi.mock('../src/popup/capture', () => ({ captureCurrentTab: state.capture }));
vi.mock('../src/popup/hooks/useStorage', () => ({
  useStorage: () => ({ sessions: [], settings: { theme: 'light', autoSend: false }, loading: false, addSession: state.save }),
}));
vi.mock('../src/popup/components/LibraryView', () => ({
  LibraryView: (props: { onCapture: () => Promise<Session | null>; lastCapturedSession: Session | null }) => {
    state.onCapture = props.onCapture;
    state.lastCapture = props.lastCapturedSession;
    return null;
  },
}));
vi.mock('../src/popup/components/Header', () => ({ Header: () => null }));
vi.mock('../src/popup/components/ProviderConversationsView', () => ({ ProviderConversationsView: () => null }));
vi.mock('../src/popup/components/SessionDetailView', () => ({ SessionDetailView: () => null }));
vi.mock('../src/popup/components/SettingsView', () => ({ SettingsView: () => null }));
vi.mock('../src/popup/components/DeleteConfirmation', () => ({ DeleteConfirmation: () => null }));
vi.mock('../src/popup/components/AllSessionsView', () => ({ AllSessionsView: () => null }));

const verified: Session = {
  id: 'verified-capture', title: 'Python', platform: 'chatgpt', sourceUrl: 'https://chatgpt.com/c/python-test',
  savedAt: '2026-10-18T00:00:00Z', startedAt: '2026-10-18T00:00:00Z', messageCount: 1, imageCount: 0, fileCount: 0,
  messages: [{ role: 'user', content: 'Python test marker' }],
};
let root: Root;

beforeEach(async () => {
  state.capture.mockReset();
  state.save.mockReset().mockResolvedValue(undefined);
  state.lastCapture = null;
  vi.stubGlobal('chrome', { tabs: {} });
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  const container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
  await act(async () => root.render(React.createElement(App)));
});
afterEach(async () => {
  await act(async () => root.unmount());
  document.body.innerHTML = '';
  vi.unstubAllGlobals();
});

describe('saving verified captures', () => {
  it('shares an in-flight request and saves its verified session only once', async () => {
    let finish!: (session: Session) => void;
    state.capture.mockImplementation(() => new Promise(resolve => { finish = resolve; }));
    let first!: Promise<Session | null>;
    let second!: Promise<Session | null>;
    act(() => { first = state.onCapture!(); second = state.onCapture!(); });
    expect(first).toBe(second);
    expect(state.capture).toHaveBeenCalledOnce();
    expect(state.save).not.toHaveBeenCalled();
    await act(async () => { finish(verified); await first; });
    expect(state.save).toHaveBeenCalledExactlyOnceWith(verified);
    expect(state.lastCapture).toBe(verified);
  });

  it('does not save a rejected capture or replace the last captured session', async () => {
    state.capture.mockRejectedValue(new Error('Captured conversation came from a different page. Nothing was saved.'));
    await act(async () => {
      await expect(state.onCapture!()).rejects.toThrow('different page');
    });
    expect(state.save).not.toHaveBeenCalled();
    expect(state.lastCapture).toBeNull();
    state.capture.mockResolvedValue(verified);
    await act(async () => { await state.onCapture!(); });
    expect(state.save).toHaveBeenCalledExactlyOnceWith(verified);
  });
});
