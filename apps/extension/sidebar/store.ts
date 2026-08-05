import { create } from 'zustand';
import type {
  ChatMessage,
  ContextItem,
  ConversationSummary,
  OutputPrefs,
  PromptOperation,
  UsageInfo,
} from '@awa/shared';
import { DEFAULT_PACING, type PacingConfig, type InsertionState } from '@/insertion';
import { call } from './api';
import { stopGeneration } from './chat';

export type View = 'auth' | 'chat' | 'history' | 'settings';
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
  operation: PromptOperation;
  prefs: OutputPrefs;
  containsRealData: boolean;
  // context
  context: ContextItem[];
  contextBusy: string | null;
  // insertion
  insertStatus: InsertStatus | null;
  pacing: PacingConfig;
  // usage/history
  usage: UsageInfo | null;
  history: ConversationSummary[];

  set: (partial: Partial<AwaState>) => void;
  loadSession: () => Promise<void>;
  loadUsage: () => Promise<void>;
  loadHistory: (q?: string) => Promise<void>;
  signOut: () => Promise<void>;
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
  operation: 'chat',
  prefs: { tone: 'neutral', length: 'same' },
  containsRealData: false,
  context: [],
  contextBusy: null,
  insertStatus: null,
  pacing: DEFAULT_PACING,
  usage: null,
  history: [],

  set: (partial) => set(partial),

  loadSession: async () => {
    const [{ theme, pacing }, res] = await Promise.all([
      chrome.storage.local.get(['theme', 'pacing']) as Promise<{ theme?: Theme; pacing?: PacingConfig }>,
      call({ kind: 'session' }),
    ]);
    const data = res.data as { email: string } | null;
    set({
      email: data?.email ?? null,
      view: data ? 'chat' : 'auth',
      theme: theme ?? 'light',
      pacing: pacing ?? DEFAULT_PACING,
    });
    if (data) void get().loadUsage();
  },

  loadUsage: async () => {
    const res = await call({ kind: 'api', path: '/api/usage' });
    if (res.ok) set({ usage: res.data as UsageInfo });
  },

  loadHistory: async (q?: string) => {
    const path = q?.trim() ? `/api/conversations?q=${encodeURIComponent(q.trim())}` : '/api/conversations';
    const res = await call({ kind: 'api', path });
    if (res.ok) set({ history: res.data as ConversationSummary[] });
    else set({ error: res.error ?? 'Could not load history' });
  },

  signOut: async () => {
    await call({ kind: 'logout' });
    set({ email: null, view: 'auth', messages: [], conversationId: null, history: [], usage: null });
  },

  addContext: (item) => set({ context: [...get().context, item] }),
  removeContext: (id) => set({ context: get().context.filter((c) => c.id !== id) }),

  newConversation: () => {
    // A still-running stream would keep generating (and charging quota) into
    // a conversation the user just left (WR-16).
    stopGeneration();
    set({ conversationId: null, messages: [], streaming: false, error: null, notice: null, insertStatus: null });
  },
}));

export function setTheme(theme: Theme): void {
  useStore.getState().set({ theme });
  void chrome.storage.local.set({ theme });
}

export function setPacing(pacing: PacingConfig): void {
  useStore.getState().set({ pacing });
  void chrome.storage.local.set({ pacing });
}
