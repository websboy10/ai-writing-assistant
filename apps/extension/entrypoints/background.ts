import type { ChatErrorCode, ChatStreamEvent } from '@awa/shared';
import {
  BACKEND_URL,
  CHAT_PORT,
  type ChatPortClientMsg,
  type ChatPortServerMsg,
  type OneShotRequest,
  type OneShotResponse,
  type StoredSession,
} from '@/utils/protocol';

/**
 * Background service worker: stateless message router + fetch relay.
 *
 * Everything network lives here because content scripts fetch under the host
 * page's CORS/CSP, and because only the extension origin holds the backend
 * host permission. Holds NO in-memory state that must survive — MV3 can kill
 * this worker at any time; session tokens live in chrome.storage.local and
 * streams are owned by the port that requested them (port traffic resets the
 * SW idle timer, which is what keeps long streams alive).
 */
export default defineBackground(() => {
  // ---- session management ----

  async function getSession(): Promise<StoredSession | null> {
    const { session } = await chrome.storage.local.get('session');
    return (session as StoredSession) ?? null;
  }

  async function setSession(s: StoredSession | null): Promise<void> {
    if (s) await chrome.storage.local.set({ session: s });
    else await chrome.storage.local.remove('session');
  }

  function sessionFromTokenResponse(data: Record<string, unknown>): StoredSession {
    const user = data.user as { email?: string } | undefined;
    return {
      access_token: String(data.access_token),
      refresh_token: String(data.refresh_token),
      expires_at: Number(data.expires_at ?? Math.floor(Date.now() / 1000) + 3000),
      email: user?.email ?? '',
    };
  }

  // Single-flight guard: GoTrue rotates refresh tokens, so two concurrent
  // refreshes with the same token can invalidate the session and silently log
  // the user out mid-session (WR-07). All concurrent callers share one refresh.
  let refreshing: Promise<string | null> | null = null;

  async function freshToken(): Promise<string | null> {
    const s = await getSession();
    if (!s) return null;
    if (s.expires_at - 60 > Date.now() / 1000) return s.access_token;
    refreshing ??= doRefresh(s).finally(() => {
      refreshing = null;
    });
    return refreshing;
  }

  async function doRefresh(s: StoredSession): Promise<string | null> {
    const res = await fetch(`${BACKEND_URL}/api/auth/refresh`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ refresh_token: s.refresh_token }),
    }).catch(() => null);
    if (!res?.ok) {
      await setSession(null);
      return null;
    }
    const data = (await res.json()) as Record<string, unknown>;
    const next = sessionFromTokenResponse(data);
    await setSession(next);
    return next.access_token;
  }

  async function apiFetch(path: string, init: RequestInit = {}): Promise<Response> {
    const token = await freshToken();
    const headers = new Headers(init.headers);
    if (token) headers.set('Authorization', `Bearer ${token}`);
    return fetch(`${BACKEND_URL}${path}`, { ...init, headers });
  }

  // ---- one-shot router ----

  chrome.runtime.onMessage.addListener((msg: OneShotRequest, _sender, sendResponse) => {
    handleOneShot(msg)
      .then(sendResponse)
      .catch((err) =>
        sendResponse({ ok: false, status: 0, error: err instanceof Error ? err.message : 'unknown error' }),
      );
    return true; // async response
  });

  async function handleOneShot(msg: OneShotRequest): Promise<OneShotResponse> {
    switch (msg.kind) {
      case 'session': {
        const s = await getSession();
        return { ok: true, status: 200, data: s ? { email: s.email } : null };
      }
      case 'login':
      case 'signup': {
        const res = await fetch(`${BACKEND_URL}/api/auth/${msg.kind}`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ email: msg.email, password: msg.password }),
        }).catch(() => null);
        if (!res) return { ok: false, status: 0, error: 'Backend unreachable — is it running? (pnpm dev:backend)' };
        const data = (await res.json()) as Record<string, unknown>;
        if (!res.ok) {
          const m = (data.error_description ?? data.msg ?? data.error ?? `HTTP ${res.status}`) as string;
          return { ok: false, status: res.status, error: m };
        }
        if (data.access_token) {
          await setSession(sessionFromTokenResponse(data));
          return { ok: true, status: 200, data: { email: (data.user as { email?: string })?.email ?? msg.email } };
        }
        // Signup without auto-login → email confirmation required.
        return {
          ok: true,
          status: 200,
          data: { email: msg.email, needsConfirmation: true },
        };
      }
      case 'logout': {
        await apiFetch('/api/auth/logout', { method: 'POST' }).catch(() => {});
        await setSession(null);
        return { ok: true, status: 200 };
      }
      case 'reset': {
        const res = await fetch(`${BACKEND_URL}/api/auth/reset`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ email: msg.email }),
        }).catch(() => null);
        if (!res) return { ok: false, status: 0, error: 'Backend unreachable' };
        const data = (await res.json()) as Record<string, unknown>;
        return res.ok
          ? { ok: true, status: 200, data }
          : { ok: false, status: res.status, error: String(data.error ?? data.msg ?? 'Reset failed') };
      }
      case 'api': {
        const res = await apiFetch(msg.path, {
          method: msg.method ?? 'GET',
          headers: msg.body !== undefined ? { 'Content-Type': 'application/json' } : undefined,
          body: msg.body !== undefined ? JSON.stringify(msg.body) : undefined,
        }).catch(() => null);
        if (!res) return { ok: false, status: 0, error: 'Backend unreachable — is it running? (pnpm dev:backend)' };
        const data = await res.json().catch(() => null);
        if (!res.ok) {
          const err = (data as { error?: string })?.error ?? `HTTP ${res.status}`;
          return { ok: false, status: res.status, error: err, data };
        }
        return { ok: true, status: res.status, data };
      }
      case 'upload': {
        const bytes = Uint8Array.from(atob(msg.base64), (c) => c.charCodeAt(0));
        const form = new FormData();
        form.append('file', new Blob([bytes], { type: msg.mime }), msg.name);
        const token = await freshToken();
        const res = await fetch(`${BACKEND_URL}/api/files`, {
          method: 'POST',
          headers: token ? { Authorization: `Bearer ${token}` } : undefined,
          body: form,
        }).catch(() => null);
        if (!res) return { ok: false, status: 0, error: 'Backend unreachable' };
        const data = await res.json().catch(() => null);
        if (!res.ok) {
          return { ok: false, status: res.status, error: (data as { error?: string })?.error ?? `HTTP ${res.status}` };
        }
        return { ok: true, status: 200, data };
      }
      case 'screenshot': {
        const dataUrl = await chrome.tabs.captureVisibleTab({ format: 'png' });
        return { ok: true, status: 200, data: { dataUrl } };
      }
      case 'google-auth': {
        const redirect = chrome.identity.getRedirectURL();
        const urlRes = await fetch(`${BACKEND_URL}/api/auth/google-url?redirect=${encodeURIComponent(redirect)}`).catch(
          () => null,
        );
        if (!urlRes?.ok) return { ok: false, status: 0, error: 'Backend unreachable' };
        const { url } = (await urlRes.json()) as { url: string };
        let responseUrl: string | undefined;
        try {
          responseUrl = await chrome.identity.launchWebAuthFlow({ url, interactive: true });
        } catch (e) {
          return {
            ok: false,
            status: 400,
            error:
              "Google sign-in isn't configured yet for this project — use email/password instead. (Supabase → Authentication → Providers → Google.)",
          };
        }
        const hash = new URL(responseUrl ?? '').hash.slice(1);
        const params = new URLSearchParams(hash);
        const access_token = params.get('access_token');
        const refresh_token = params.get('refresh_token');
        if (!access_token || !refresh_token) {
          return { ok: false, status: 400, error: 'Google sign-in did not return a session. Use email/password instead.' };
        }
        const userRes = await fetch(`${BACKEND_URL}/api/usage`, {
          headers: { Authorization: `Bearer ${access_token}` },
        }).catch(() => null);
        const email = params.get('email') ?? '';
        await setSession({
          access_token,
          refresh_token,
          expires_at: Number(params.get('expires_at') ?? Math.floor(Date.now() / 1000) + 3000),
          email,
        });
        return { ok: userRes?.ok ?? true, status: 200, data: { email } };
      }
    }
  }

  // ---- chat streaming over a long-lived port ----

  chrome.runtime.onConnect.addListener((port) => {
    if (port.name !== CHAT_PORT) return;
    const abort = new AbortController();
    let closed = false;
    let started = false;

    const send = (m: ChatPortServerMsg) => {
      if (!closed) {
        try {
          port.postMessage(m);
        } catch {
          closed = true;
        }
      }
    };

    port.onDisconnect.addListener(() => {
      closed = true;
      abort.abort();
    });

    port.onMessage.addListener(async (msg: ChatPortClientMsg) => {
      if (msg.type === 'abort') {
        abort.abort();
        return;
      }
      if (msg.type !== 'start') return;
      // One stream per port — a second start would share this AbortController
      // and interleave two responses on one port (IN-15).
      if (started) return;
      started = true;

      try {
        const res = await apiFetch('/api/chat', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(msg.request),
          signal: abort.signal,
        });

        if (!res.ok) {
          const data = (await res.json().catch(() => ({}))) as { error?: string; code?: string };
          send({
            type: 'event',
            event: {
              type: 'error',
              code: (data.code ?? 'upstream_error') as ChatErrorCode,
              message: data.error ?? `Request failed (HTTP ${res.status})`,
            },
          });
          send({ type: 'closed' });
          return;
        }

        const reader = res.body!.getReader();
        const decoder = new TextDecoder();
        let buffer = '';
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          buffer += decoder.decode(value, { stream: true });
          let idx: number;
          while ((idx = buffer.indexOf('\n\n')) !== -1) {
            const frame = buffer.slice(0, idx);
            buffer = buffer.slice(idx + 2);
            const line = frame.split('\n').find((l) => l.startsWith('data: '));
            if (!line) {
              // SSE comment frames are the server's heartbeats — forward them
              // so the port sees traffic during token gaps (WR-15).
              if (frame.startsWith(':')) send({ type: 'ping' });
              continue;
            }
            try {
              const event = JSON.parse(line.slice(6)) as ChatStreamEvent;
              send({ type: 'event', event });
            } catch {
              // ignore malformed frame
            }
          }
        }
      } catch (err) {
        if (!abort.signal.aborted) {
          send({
            type: 'event',
            event: {
              type: 'error',
              code: 'upstream_error',
              message: `Connection to the backend failed: ${err instanceof Error ? err.message : 'unknown'}. Is it running? (pnpm dev:backend)`,
            },
          });
        }
      } finally {
        send({ type: 'closed' });
      }
    });
  });

  // ---- sidebar toggle: toolbar icon + keyboard command ----

  async function toggleSidebar(tabId?: number) {
    const tabs = tabId
      ? [{ id: tabId }]
      : await chrome.tabs.query({ active: true, currentWindow: true });
    const id = tabs[0]?.id;
    if (id) chrome.tabs.sendMessage(id, { type: 'toggle-sidebar' }).catch(() => {});
  }

  chrome.action.onClicked.addListener((tab) => toggleSidebar(tab.id));
  chrome.commands.onCommand.addListener((command) => {
    if (command === 'toggle-sidebar') toggleSidebar();
  });
});
