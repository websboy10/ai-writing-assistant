import type { ChatErrorCode, ChatStreamEvent } from '@awa/shared';
import {
  BACKEND_URL,
  CHAT_PORT,
  DOCS_SCOPE,
  type ChatPortClientMsg,
  type ChatPortServerMsg,
  type DocsParagraph,
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

  // Stable per-install id for the one-free-trial-per-device rule (BILL-02).
  // Survives sign-out and account switching; resets only on reinstall.
  async function installId(): Promise<string> {
    const { install_id } = await chrome.storage.local.get('install_id');
    if (typeof install_id === 'string') return install_id;
    const id = crypto.randomUUID();
    await chrome.storage.local.set({ install_id: id });
    return id;
  }

  async function apiFetch(path: string, init: RequestInit = {}): Promise<Response> {
    const token = await freshToken();
    const headers = new Headers(init.headers);
    if (token) headers.set('Authorization', `Bearer ${token}`);
    headers.set('x-awa-install', await installId());
    return fetch(`${BACKEND_URL}${path}`, { ...init, headers });
  }

  // ---- Google Docs API (D-16, D-17) ----
  //
  // T-07-01: the access token lives ONLY inside this closure. Every caller
  // gets a result, never the token — never logged, never put in an error
  // string, never written to chrome.storage. Chrome owns cache and refresh
  // for tokens obtained through chrome.identity.getAuthToken; there is
  // nothing for us to persist.

  type DocsAuthOk = { ok: true; token: string };
  // `detail` carries Chrome's own words for a refusal, which name the cause
  // ("bad client id", "user is not signed in", "OAuth2 not granted or
  // revoked"). `error` stays plain Danish for the user; without a separate
  // field the refusal reached us as a bare 401 explaining nothing, and the
  // Docs path went dark with no way to tell which of four setups was wrong.
  type DocsAuthFail = { ok: false; status: 401 | 403; error: string; detail?: string };

  /**
   * Google's own explanation for a rejected Docs API call. Its error bodies are
   * specific and actionable where an HTTP status is not, and reading the body
   * is the only chance to get it — the response can be consumed once.
   */
  async function googleErrorMessage(res: Response): Promise<string> {
    try {
      const body = (await res.json()) as { error?: { message?: string; status?: string } };
      return body.error?.message ?? body.error?.status ?? `HTTP ${res.status}`;
    } catch {
      return `HTTP ${res.status}`;
    }
  }

  /**
   * T-07-02: `enableGranularPermissions` lets a user grant sign-in while
   * unticking `documents`. Recent Chrome resolves an object carrying
   * `grantedScopes`; older Chrome resolves a bare token string with no way to
   * inspect what was granted. Where `grantedScopes` IS present, a partial
   * grant is caught here and never treated as success. Where it is absent,
   * this function cannot detect a partial grant by itself — the 403 that
   * docs-get/docs-batch-update get back from Google when that happens is the
   * authority in that case (see their handlers below).
   */
  async function docsAuth(interactive: boolean): Promise<DocsAuthOk | DocsAuthFail> {
    // `enableGranularPermissions` is real (Chrome ships it) but missing from
    // @types/chrome@0.0.287's TokenDetails, and the Promise overload it DOES
    // declare only models the modern `{ token, grantedScopes }` shape — not
    // the bare-string shape older Chrome actually resolves. Both gaps are
    // widened here via a local, non-literal variable (so no excess-property
    // check fires) and an `unknown` cast, then narrowed by hand at runtime.
    const tokenDetails: chrome.identity.TokenDetails & { enableGranularPermissions?: boolean } = {
      interactive,
      enableGranularPermissions: true,
    };
    let result: string | { token?: string; grantedScopes?: string[] } | undefined;
    let detail = '';
    try {
      const raw: unknown = await chrome.identity.getAuthToken(tokenDetails);
      result = raw as string | { token?: string; grantedScopes?: string[] } | undefined;
    } catch (e) {
      detail = e instanceof Error ? e.message : String(e);
      result = undefined;
    }
    // Some Chrome builds resolve undefined and report the reason on
    // lastError instead of rejecting, which is exactly the shape a
    // misconfigured client takes: no token, no prompt, no exception.
    if (!detail && chrome.runtime.lastError?.message) detail = chrome.runtime.lastError.message;
    const token = typeof result === 'string' ? result : result?.token;
    const grantedScopes = typeof result === 'string' ? undefined : result?.grantedScopes;
    if (!token) {
      return {
        ok: false,
        status: 401,
        error: 'Google-adgang blev ikke givet — AI Skriveassistenten bruger reservevejen (indsæt) i stedet.',
        detail: detail || 'Chrome gav ingen begrundelse.',
      };
    }
    if (grantedScopes && !grantedScopes.includes(DOCS_SCOPE)) {
      await chrome.identity.removeCachedAuthToken({ token }).catch(() => {});
      return {
        ok: false,
        status: 403,
        error:
          'Adgang til dokumentet blev ikke givet (fluebenet ved dokumentadgang var afkrydset fra) — AI Skriveassistenten bruger reservevejen (indsæt) i stedet.',
      };
    }
    return { ok: true, token };
  }

  interface DocsTextRun {
    content?: string;
  }
  interface DocsParagraphElement {
    textRun?: DocsTextRun;
  }
  interface DocsParagraphBody {
    elements?: DocsParagraphElement[];
    paragraphStyle?: { namedStyleType?: string };
  }
  interface DocsStructuralElement {
    startIndex?: number;
    endIndex?: number;
    paragraph?: DocsParagraphBody;
  }

  /** One DocsParagraph per non-empty paragraph, indices carried straight from the API. */
  function extractDocsParagraphs(content: DocsStructuralElement[]): DocsParagraph[] {
    const paragraphs: DocsParagraph[] = [];
    let index = 0;
    for (const el of content) {
      const p = el.paragraph;
      if (!p) continue;
      const text = (p.elements ?? []).map((e) => e.textRun?.content ?? '').join('');
      if (!text.trim()) continue;
      paragraphs.push({
        index: index++,
        text,
        startIndex: el.startIndex ?? 0,
        endIndex: el.endIndex ?? 0,
        namedStyleType: p.paragraphStyle?.namedStyleType,
      });
    }
    return paragraphs;
  }

  // ---- one-shot router ----

  chrome.runtime.onMessage.addListener((msg: OneShotRequest, _sender, sendResponse) => {
    handleOneShot(msg)
      .then(sendResponse)
      .catch((err) =>
        sendResponse({ ok: false, status: 0, error: err instanceof Error ? err.message : 'Der opstod en ukendt fejl.' }),
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
        if (!res) return { ok: false, status: 0, error: 'Der er ingen forbindelse til assistenten lige nu. Tjek din internetforbindelse, og prøv igen.' };
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
        if (!res) return { ok: false, status: 0, error: 'Der er ingen forbindelse til assistenten lige nu. Tjek din internetforbindelse, og prøv igen.' };
        const data = (await res.json()) as Record<string, unknown>;
        return res.ok
          ? { ok: true, status: 200, data }
          : { ok: false, status: res.status, error: String(data.error ?? data.msg ?? 'Adgangskoden kunne ikke nulstilles. Prøv igen.') };
      }
      case 'api': {
        const res = await apiFetch(msg.path, {
          method: msg.method ?? 'GET',
          headers: msg.body !== undefined ? { 'Content-Type': 'application/json' } : undefined,
          body: msg.body !== undefined ? JSON.stringify(msg.body) : undefined,
        }).catch(() => null);
        if (!res) return { ok: false, status: 0, error: 'Der er ingen forbindelse til assistenten lige nu. Tjek din internetforbindelse, og prøv igen.' };
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
        if (!res) return { ok: false, status: 0, error: 'Der er ingen forbindelse til assistenten lige nu. Tjek din internetforbindelse, og prøv igen.' };
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
        if (!urlRes?.ok) return { ok: false, status: 0, error: 'Der er ingen forbindelse til assistenten lige nu. Tjek din internetforbindelse, og prøv igen.' };
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
          return { ok: false, status: 400, error: 'Google-login gav ingen session. Log ind med e-mail og adgangskode i stedet.' };
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
      case 'docs-auth': {
        const auth = await docsAuth(msg.interactive);
        // Only this route reports the refusal reason: it is the one the spike
        // and the "why is Docs not working" path call. The read/write routes
        // below stay quiet so a technical string can never surface mid-run.
        if (!auth.ok) return { ok: false, status: auth.status, error: auth.error, data: { detail: auth.detail } };
        return { ok: true, status: 200, data: { granted: true } };
      }
      case 'docs-get': {
        const auth = await docsAuth(false);
        if (!auth.ok) return { ok: false, status: auth.status, error: auth.error };
        const fetchDoc = (bearer: string) =>
          fetch(`https://docs.googleapis.com/v1/documents/${encodeURIComponent(msg.documentId)}`, {
            headers: { Authorization: `Bearer ${bearer}` },
          }).catch(() => null);
        let res = await fetchDoc(auth.token);
        if (res?.status === 401) {
          // Cached token expired between docsAuth() and this fetch — clear it
          // and retry once with a fresh one before giving up.
          await chrome.identity.removeCachedAuthToken({ token: auth.token }).catch(() => {});
          const retry = await docsAuth(false);
          if (!retry.ok) return { ok: false, status: retry.status, error: retry.error };
          res = await fetchDoc(retry.token);
        }
        if (!res) return { ok: false, status: 0, error: 'Google Docs API kunne ikke nås.' };
        if (res.status === 403 || res.status === 404) {
          return {
            ok: false,
            status: res.status,
            error: 'Den Google-konto, der er logget ind i denne Chrome-profil, har ikke adgang til dette dokument.',
          };
        }
        if (!res.ok) {
          return { ok: false, status: res.status, error: `Google Docs API-fejl (HTTP ${res.status}).` };
        }
        const doc = (await res.json()) as { title?: string; body?: { content?: DocsStructuralElement[] } };
        const paragraphs = extractDocsParagraphs(doc.body?.content ?? []);
        return { ok: true, status: 200, data: { title: doc.title ?? '', paragraphs } };
      }
      case 'docs-batch-update': {
        const auth = await docsAuth(false);
        if (!auth.ok) return { ok: false, status: auth.status, error: auth.error };
        const res = await fetch(
          `https://docs.googleapis.com/v1/documents/${encodeURIComponent(msg.documentId)}:batchUpdate`,
          {
            method: 'POST',
            headers: { Authorization: `Bearer ${auth.token}`, 'Content-Type': 'application/json' },
            body: JSON.stringify({ requests: msg.requests }),
          },
        ).catch(() => null);
        if (!res) return { ok: false, status: 0, error: 'Google Docs API kunne ikke nås.' };
        if (res.status === 429) {
          return { ok: false, status: 429, error: 'Google begrænsede antallet af skrivninger — prøv igen om lidt.' };
        }
        if (!res.ok) {
          // Google says exactly what is wrong with a rejected write ("Index
          // 96 must be less than the end index of the referenced segment").
          // Swallowing that is what turned a one-line index bug into an
          // unexplained HTTP 400 — the same mistake the auth path made before
          // it started reporting Chrome's own reason. User-facing text is
          // unchanged; the reason rides along as `detail` for diagnostics.
          return {
            ok: false,
            status: res.status,
            error: `Google Docs API-fejl (HTTP ${res.status}).`,
            data: { detail: await googleErrorMessage(res) },
          };
        }
        const data = (await res.json()) as { replies?: unknown[] };
        return { ok: true, status: 200, data: { replies: data.replies ?? [] } };
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
