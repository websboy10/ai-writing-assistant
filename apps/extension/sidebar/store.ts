import { create } from 'zustand';
import type {
  BillingInfo,
  ChatMessage,
  ContextItem,
  ConversationSummary,
  OutputPrefs,
  PromptOperation,
  UsageInfo,
} from '@awa/shared';
import { type InsertionState } from '@/insertion';
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
  operation: PromptOperation;
  prefs: OutputPrefs;
  containsRealData: boolean;
  // context
  context: ContextItem[];
  contextBusy: string | null;
  // insertion
  insertStatus: InsertStatus | null;
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
  usage: null,
  history: [],
  billing: null,

  set: (partial) => set(partial),

  loadSession: async () => {
    const res = await call({ kind: 'session' });
    const data = res.data as { email: string } | null;
    // Theme is fixed to light: the settings page is gone, so a stored 'dark'
    // from an earlier build would be a trap with no way out.
    set({
      email: data?.email ?? null,
      view: data ? 'chat' : 'auth',
      theme: 'light',
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

  addContext: (item) => set({ context: [...get().context, item] }),
  removeContext: (id) => set({ context: get().context.filter((c) => c.id !== id) }),

  newConversation: () => {
    // A still-running stream would keep generating (and charging quota) into
    // a conversation the user just left (WR-16).
    stopGeneration();
    set({ conversationId: null, messages: [], streaming: false, error: null, notice: null, insertStatus: null });
  },
}));

