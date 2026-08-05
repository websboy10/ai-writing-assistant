import type { ChatRequest, ChatStreamEvent } from '@awa/shared';

export const BACKEND_URL = 'http://127.0.0.1:8787';

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
