import type { ChatRequest, ChatStreamEvent } from '@awa/shared';

// Deployed backend by default; local dev overrides with
// VITE_BACKEND_URL=http://127.0.0.1:8787 at build time.
export const BACKEND_URL: string = import.meta.env.VITE_BACKEND_URL ?? 'https://ai-skriveassistent-api.vercel.app';

// ---- one-shot messages (UI/content ↔ background) ----

// One non-empty Docs paragraph, as read by 'docs-get' (D-16 step 1). Carries
// the API's own startIndex/endIndex untouched — those are the coordinates
// Find-positioning (insertion/autonomous/docs-find.ts) and the D-16a
// batchUpdate fallback both key off.
export interface DocsParagraph {
  index: number;
  text: string;
  startIndex: number;
  endIndex: number;
  namedStyleType?: string;
  /** Inline images in this paragraph as data URLs — see AutonomousParagraph.images. */
  images?: string[];
}

// Exactly `documents`, never `drive` or `drive.file` (T-07-03). Must match
// the scope in wxt.config.ts's oauth2 manifest block — the two can't share
// an import because wxt.config.ts runs in Node at build time, not the
// extension bundle.
export const DOCS_SCOPE = 'https://www.googleapis.com/auth/documents';

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
  // data: { granted: boolean } — false is only ever returned as ok:false with
  // a specific `error`; a caller never has to distinguish granted:false from
  // a thrown error, because there isn't a success/false state, only ok/error.
  | { kind: 'docs-auth'; interactive: boolean }
  | { kind: 'docs-get'; documentId: string } // data: { title: string; paragraphs: DocsParagraph[] }
  | { kind: 'docs-batch-update'; documentId: string; requests: unknown[] }; // data: { replies: unknown[] }

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
