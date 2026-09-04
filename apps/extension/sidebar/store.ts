import { create } from 'zustand';
import type { BillingInfo, ChatMessage, ContextItem, ConversationSummary, OutputPrefs, UsageInfo } from '@awa/shared';
import { DEFAULT_PACING, MAX_WPM, MIN_WPM, type InsertionState, type PacingConfig } from '@/insertion';
import { call } from './api';
import { stopGeneration } from './chat';

export type View = 'auth' | 'chat' | 'history';
export type Theme = 'light' | 'dark';

export interface UiMessage extends ChatMessage {
  id: string;
  /** true while tokens are still arriving */
  streaming?: boolean;
}

interface InsertStatus {
  state: InsertionState;
  detail?: string;
  progress: number; // 0..1
  targetLabel?: string;
  unverified?: boolean;
}

interface AwaState {
  // session
  email: string | null;
  view: View;
  theme: Theme;
  // chat
  conversationId: string | null;
  messages: UiMessage[];
  streaming: boolean;
  error: string | null;
  notice: string | null;
  /**
   * What is typed in the composer but not yet sent.
   *
   * It lived in ChatView's own useState, which unmounts the moment the panel
   * collapses — so closing the panel threw away a half-written instruction with
   * no warning, and SIDE-03's promise that collapsing keeps state was true of
   * everything except the one thing the user had just written themselves.
   */
  draft: string;
  prefs: OutputPrefs;
  // context
  context: ContextItem[];
  contextBusy: string | null;
  // insertion
  insertStatus: InsertStatus | null;
  /**
   * Is there anywhere on the page to insert INTO?
   *
   * Published by the one poller that already asks (TargetHint), so a draft's
   * buttons can lead with the action that will actually work without starting a
   * second interval of their own — and read through a narrow selector, so a
   * message bubble does not re-render on every streamed token (WR-14).
   */
  hasInsertTarget: boolean;
  /**
   * How "Indsæt langsomt" types. Persisted in chrome.storage.local, so the
   * tempo a person settled on holds across every tab and every restart.
   */
  pacing: PacingConfig;
  // usage/history
  usage: UsageInfo | null;
  history: ConversationSummary[];
  // freemium gate (null = not loaded yet)
  billing: BillingInfo | null;

  set: (partial: Partial<AwaState>) => void;
  loadSession: () => Promise<void>;
  loadUsage: () => Promise<void>;
  loadBilling: () => Promise<void>;
  loadHistory: (q?: string) => Promise<void>;
  signOut: () => Promise<void>;
  setPacing: (partial: Partial<PacingConfig>) => void;
  addContext: (item: ContextItem) => void;
  removeContext: (id: string) => void;
  newConversation: () => void;
}

let idCounter = 0;
export const nextId = (): string => `m${Date.now()}-${idCounter++}`;

export const useStore = create<AwaState>((set, get) => ({
  email: null,
  view: 'auth',
  theme: 'light',
  conversationId: null,
  messages: [],
  streaming: false,
  error: null,
  notice: null,
  draft: '',
  prefs: { tone: 'neutral', length: 'same' },
  context: [],
  contextBusy: null,
  insertStatus: null,
  hasInsertTarget: false,
  pacing: DEFAULT_PACING,
  usage: null,
  history: [],
  billing: null,

  set: (partial) => set(partial),

  loadSession: async () => {
    const res = await call({ kind: 'session' });
    const data = res.data as { email: string } | null;
    const { pacing } = await chrome.storage.local.get('pacing');
    // Theme is fixed to light: the settings page is gone, so a stored 'dark'
    // from an earlier build would be a trap with no way out.
    set({
      email: data?.email ?? null,
      view: data ? 'chat' : 'auth',
      theme: 'light',
      pacing: sanitizePacing(pacing),
    });
    if (data) {
      void get().loadUsage();
      void get().loadBilling();
    }
  },

  loadUsage: async () => {
    const res = await call({ kind: 'api', path: '/api/usage' });
    if (res.ok) set({ usage: res.data as UsageInfo });
  },

  loadBilling: async () => {
    const res = await call({ kind: 'api', path: '/api/billing/status' });
    if (res.ok) set({ billing: res.data as BillingInfo });
  },

  loadHistory: async (q?: string) => {
    const path = q?.trim() ? `/api/conversations?q=${encodeURIComponent(q.trim())}` : '/api/conversations';
    const res = await call({ kind: 'api', path });
    if (res.ok) set({ history: res.data as ConversationSummary[] });
    else set({ error: res.error ?? 'Historikken kunne ikke hentes' });
  },

  signOut: async () => {
    await call({ kind: 'logout' });
    set({ email: null, view: 'auth', messages: [], conversationId: null, history: [], usage: null, billing: null });
  },

  setPacing: (partial) => {
    const pacing = sanitizePacing({ ...get().pacing, ...partial });
    set({ pacing });
    void chrome.storage.local.set({ pacing });
  },

  addContext: (item) => set({ context: [...get().context, item] }),
  removeContext: (id) => set({ context: get().context.filter((c) => c.id !== id) }),

  newConversation: () => {
    // A still-running stream would keep generating (and charging quota) into
    // a conversation the user just left (WR-16).
    stopGeneration();
    set({
      conversationId: null,
      messages: [],
      streaming: false,
      error: null,
      notice: null,
      insertStatus: null,
    });
  },
}));

/**
 * Whatever storage holds becomes a config the engine can run: a value from an
 * older build, or none at all, falls back to the default rather than to NaN.
 */
function sanitizePacing(raw: unknown): PacingConfig {
  const r = (raw ?? {}) as Partial<PacingConfig>;
  const wpm = typeof r.wpm === 'number' && Number.isFinite(r.wpm) ? Math.min(MAX_WPM, Math.max(MIN_WPM, Math.round(r.wpm))) : DEFAULT_PACING.wpm;
  return { wpm, human: r.human === true };
}
