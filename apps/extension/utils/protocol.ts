import type { AutonomousRequest, AutonomousStreamEvent, ChatRequest, ChatStreamEvent } from '@awa/shared';

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
  | { kind: 'google-auth' };

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

/**
 * "Besvar alle" rides the same relay as chat, on its own port name. It was a
 * one-shot message until 0.2.5, and a one-shot fetch that waits more than 30s
 * for its response gets the service worker killed under it.
 */
export const AUTO_PORT = 'awa-auto';

export type ChatPortClientMsg = { type: 'start'; request: ChatRequest | AutonomousRequest } | { type: 'abort' };
// 'ping' relays the backend's SSE heartbeats: port traffic is what resets the
// MV3 service-worker idle timer, so heartbeats must cross the port during
// long token gaps or Chrome may kill the worker mid-stream (WR-15).
export type PortServerMsg<E> = { type: 'event'; event: E } | { type: 'ping' } | { type: 'closed' };
export type ChatPortServerMsg = PortServerMsg<ChatStreamEvent>;
export type AutoPortServerMsg = PortServerMsg<AutonomousStreamEvent>;

export interface StoredSession {
  access_token: string;
  refresh_token: string;
  expires_at: number; // epoch seconds
  email: string;
}

/**
 * Build-time flag for "Besvar alle spørgsmål", defined in wxt.config.ts. False
 * in the store build, true everywhere else — see the comment there for why the
 * feature is held back with a flag rather than reverted.
 */
declare global {
  const __AWA_ANSWER_ALL__: boolean;
}
