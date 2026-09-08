import type { ChatRequest, ChatStreamEvent } from '@awa/shared';

// Deployed backend by default; local dev overrides with
// VITE_BACKEND_URL=http://127.0.0.1:8787 at build time.
export const BACKEND_URL: string = import.meta.env.VITE_BACKEND_URL ?? 'https://ai-skriveassistent-api.vercel.app';

// ---- one-shot messages (UI/content ↔ background) ----

export type OneShotRequest =
  | { kind: 'api'; path: string; method?: string; body?: unknown }
  | { kind: 'upload'; name: string; mime: string; base64: string }
  | { kind: 'login'; email: string; password: string }
  | { kind: 'signup'; email: string; password: string }
  | { kind: 'logout' }
  | { kind: 'reset'; email: string }
  | { kind: 'session' }
  | { kind: 'screenshot' }
  | { kind: 'google-auth' }
  // Docs' own HTML export, fetched with nothing but the browser's existing
  // cookies — no OAuth, no scope, nothing to have verified. It must be asked
  // for from HERE: the Docs page's own CSP blocks the same fetch made from the
  // content script. Answers `{ html: string }`.
  | { kind: 'docs-export-html'; documentId: string };

export interface OneShotResponse {
  ok: boolean;
  status: number;
  data?: unknown;
  error?: string;
}

// ---- background → content ----

export type BackgroundBroadcast = { type: 'toggle-sidebar' };

// ---- chat streaming port ----

export const CHAT_PORT = 'awa-chat';

export type ChatPortClientMsg = { type: 'start'; request: ChatRequest } | { type: 'abort' };
// 'ping' relays the backend's SSE heartbeats: port traffic is what resets the
// MV3 service-worker idle timer, so heartbeats must cross the port during
// long token gaps or Chrome may kill the worker mid-stream (WR-15).
export type ChatPortServerMsg = { type: 'event'; event: ChatStreamEvent } | { type: 'ping' } | { type: 'closed' };

export interface StoredSession {
  access_token: string;
  refresh_token: string;
  expires_at: number; // epoch seconds
  email: string;
}
