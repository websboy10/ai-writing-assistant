import { create } from 'zustand';
import type { BillingInfo, ChatMessage, ChatStatus, ContextItem, ConversationSummary, OutputLength, OutputPrefs, UsageInfo, WebSource } from '@awa/shared';
import { DEFAULT_PACING, MAX_WPM, MIN_WPM, type InsertionState, type PacingConfig, type RunState } from '@/insertion';
import { call } from './api';
import { stopGeneration } from './chat';

export type View = 'auth' | 'chat' | 'history';
export type Theme = 'light' | 'dark';

export interface UiMessage extends ChatMessage {
  id: string;
  /** true while tokens are still arriving */
  streaming?: boolean;
  /**
   * The model's reply before stripMarkdown() flattened it.
   *
   * `content` stays flat, because everything already depends on it — the
   * panel, Kopiér, the history, and every paced insertion. This is carried
   * beside it for the one caller that can use structure: "Indsæt straks" into
   * an editor that can hold real headings, bold and lists.
   */
  markdown?: string;
  /**
   * Where a web-searched answer came from.
   *
   * Shown beside the answer and deliberately absent from `content`, so no
   * address can ever be typed into the user's document — that separation is
   * the whole reason search can exist here (see openrouter.ts).
   */
  sources?: WebSource[];
  /**
   * What is happening while nothing has arrived yet, or undefined once the
   * first word has. Never part of `content` — nothing here is ever insertable.
   */
  status?: ChatStatus;
}

interface InsertStatus {
  state: InsertionState;
  detail?: string;
  progress: number; // 0..1
  targetLabel?: string;
  unverified?: boolean;
}

/**
 * One "Besvar alle spørgsmål" run — many InsertionSessions, one per answer.
 *
 * `unplaced` is the field that matters most, and it matters more now than when
 * this was first written. Placement used to have a fallback: when Docs' own
 * Find could not locate a question, the run wrote the answer through the Google
 * Docs API instead. That API is gone (it forced OAuth verification and blocked
 * the store release), so a question Find cannot reach is simply not answered in
 * the document — it lands here, and the panel has to say so out loud. The
 * alternative is guessing at a position, and a wrong guess writes into the
 * middle of somebody's real document.
 *
 * `ungrounded` is the other honesty channel: an answer the model produced
 * without support from the document or the attached files (D-12).
 */
interface AutoRunStatus {
  state: RunState;
  detail?: string;
  answersDone: number;
  answersTotal: number;
  progress: number; // 0..1
  targetLabel?: string;
  placement: 'in-place' | 'block';
  degradedReason?: string;
  unplaced: { questionText: string; reason: string }[];
  ungrounded: string[];
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
  /** A "Besvar alle spørgsmål" run in flight, or null when none is. */
  autoRun: AutoRunStatus | null;
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
  setPrefs: (partial: Partial<OutputPrefs>) => void;
  addContext: (item: ContextItem) => void;
  removeContext: (id: string) => void;
  newConversation: () => void;
}

const DEFAULT_PREFS: OutputPrefs = { length: 'medium' };
const LENGTHS: OutputLength[] = ['short', 'medium', 'long'];

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
  prefs: DEFAULT_PREFS,
  context: [],
  contextBusy: null,
  insertStatus: null,
  hasInsertTarget: false,
  autoRun: null,
  pacing: DEFAULT_PACING,
  usage: null,
  history: [],
  billing: null,

  set: (partial) => set(partial),

  loadSession: async () => {
    const res = await call({ kind: 'session' });
    const data = res.data as { email: string } | null;
    const { pacing, prefs } = await chrome.storage.local.get(['pacing', 'prefs']);
    // Theme is fixed to light: the settings page is gone, so a stored 'dark'
    // from an earlier build would be a trap with no way out.
    set({
      email: data?.email ?? null,
      view: data ? 'chat' : 'auth',
      theme: 'light',
      pacing: sanitizePacing(pacing),
      prefs: sanitizePrefs(prefs),
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

  /**
   * Persisted for the same reason the tempo is: a person who works in short
   * answers works in short answers all day, and re-picking it after every
   * browser restart is a small tax charged forever.
   */
  setPrefs: (partial) => {
    const prefs = sanitizePrefs({ ...get().prefs, ...partial });
    set({ prefs });
    void chrome.storage.local.set({ prefs });
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
      autoRun: null,
    });
  },
}));

/**
 * A stored pref from an older build is the interesting case, not a missing one.
 * Until 2026-09-04 this field held 'shorter' | 'same' | 'longer' and a tone
 * beside it; both are gone. An unrecognised value must land on the default
 * rather than travel to the backend, where an unknown length would silently
 * select the medium rule anyway and the picker would show something the model
 * never received.
 */
function sanitizePrefs(raw: unknown): OutputPrefs {
  const r = (raw ?? {}) as Partial<OutputPrefs>;
  const length = LENGTHS.includes(r.length as OutputLength) ? (r.length as OutputLength) : DEFAULT_PREFS.length;
  return { length, ...(typeof r.language === 'string' ? { language: r.language.slice(0, 40) } : {}) };
}

/**
 * Whatever storage holds becomes a config the engine can run: a value from an
 * older build, or none at all, falls back to the default rather than to NaN.
 */
function sanitizePacing(raw: unknown): PacingConfig {
  const r = (raw ?? {}) as Partial<PacingConfig>;
  const wpm = typeof r.wpm === 'number' && Number.isFinite(r.wpm) ? Math.min(MAX_WPM, Math.max(MIN_WPM, Math.round(r.wpm))) : DEFAULT_PACING.wpm;
  return { wpm, human: r.human === true };
}
