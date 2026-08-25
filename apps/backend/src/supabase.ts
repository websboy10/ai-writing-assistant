import { env } from './env.js';

/**
 * Ids are interpolated into PostgREST filter strings — a non-UUID value can
 * inject extra query parameters and widen DELETE/PATCH scope (WR-05).
 */
export function isUuid(v: string): boolean {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(v);
}

export interface AuthedUser {
  id: string;
  email: string;
  token: string;
}

/**
 * Verify a user's Supabase JWT by asking GoTrue for the user it belongs to.
 * The backend never holds a privileged key — every DB access below runs with
 * the user's own JWT so RLS is the enforcement layer, not backend discipline.
 */
export async function verifyUser(authHeader: string | undefined): Promise<AuthedUser | null> {
  if (!authHeader?.startsWith('Bearer ')) return null;
  const token = authHeader.slice(7);
  const res = await fetch(`${env.supabaseUrl}/auth/v1/user`, {
    headers: { apikey: env.supabaseAnonKey, Authorization: `Bearer ${token}` },
  });
  if (!res.ok) return null;
  const user = (await res.json()) as { id?: string; email?: string };
  if (!user.id) return null;
  return { id: user.id, email: user.email ?? '', token };
}

/** PostgREST request with the user's JWT (RLS-scoped). */
export async function rest(
  user: AuthedUser,
  path: string,
  init: RequestInit & { prefer?: string } = {},
): Promise<Response> {
  const headers: Record<string, string> = {
    apikey: env.supabaseAnonKey,
    Authorization: `Bearer ${user.token}`,
    'Content-Type': 'application/json',
    ...(init.prefer ? { Prefer: init.prefer } : {}),
    ...((init.headers as Record<string, string>) ?? {}),
  };
  return fetch(`${env.supabaseUrl}/rest/v1${path}`, { ...init, headers });
}

export async function rpc<T>(user: AuthedUser, fn: string, args: Record<string, unknown> = {}): Promise<T> {
  // PGRST303 "JWT issued at future": a token used within ~1s of issuance can
  // hit sub-second clock drift between GoTrue and PostgREST. Transient — one
  // short retry absorbs it.
  for (let attempt = 0; ; attempt++) {
    const res = await rest(user, `/rpc/${fn}`, { method: 'POST', body: JSON.stringify(args) });
    if (res.ok) {
      // A `returns void` function answers 204 with no body, and res.json()
      // throws "Unexpected end of JSON input" on that. anonRpc has always
      // guarded for it; this did not — so every refund_quota call, whose only
      // caller wraps it in .catch(log), threw on success and was swallowed.
      // Refunds have therefore never actually happened: a generation that
      // failed before producing a single token still cost the user a quota
      // point, which is precisely what WR-06 added the refund to prevent.
      const text = await res.text();
      return (text ? JSON.parse(text) : undefined) as T;
    }
    const body = await res.text();
    if (attempt === 0 && body.includes('PGRST303')) {
      await new Promise((r) => setTimeout(r, 1200));
      continue;
    }
    throw new Error(`rpc ${fn} failed (${res.status}): ${body}`);
  }
}

/**
 * RPC for the handful of calls that genuinely have NO user to act as: the
 * Stripe webhook and the checkout-success landing page.
 *
 * It used to send only the anon key, and the functions it called were granted
 * to PUBLIC to make that work. That did not give the backend privilege — it
 * gave privilege to everyone, because the anon key is published in the
 * extension bundle and printed into the password-reset page. Anyone could
 * call billing_set_subscription and switch any account to 'active'; proven
 * with curl against the live project on 2026-08-25, with no token at all.
 *
 * Those functions are now service_role only (migration 0006). The service key
 * is the one credential that must never leave the server, so it is optional
 * here: without it these calls fail, every call site logs and carries on, and
 * the on-demand re-sync in billing.ts — which runs as the user and needs no
 * privilege — still unlocks a paying customer. Failing closed on the push
 * channel is the right way round; failing open on the paywall was not.
 */
export async function anonRpc<T>(fn: string, args: Record<string, unknown> = {}): Promise<T> {
  const key = env.supabaseServiceKey || env.supabaseAnonKey;
  const res = await fetch(`${env.supabaseUrl}/rest/v1/rpc/${fn}`, {
    method: 'POST',
    headers: {
      apikey: key,
      // PostgREST reads the role from the JWT, not from `apikey` alone.
      Authorization: `Bearer ${key}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(args),
  });
  const text = await res.text();
  if (!res.ok) {
    throw new Error(
      `anonRpc ${fn} failed (${res.status}): ${text}` +
        (env.supabaseServiceKey ? '' : ' — SUPABASE_SERVICE_ROLE_KEY is not set'),
    );
  }
  // void functions return an empty body — not valid JSON.
  return (text ? JSON.parse(text) : undefined) as T;
}

/** GoTrue passthrough used by the auth proxy routes. */
export async function gotrue(path: string, init: RequestInit = {}, userToken?: string): Promise<Response> {
  const headers: Record<string, string> = {
    apikey: env.supabaseAnonKey,
    'Content-Type': 'application/json',
    ...(userToken ? { Authorization: `Bearer ${userToken}` } : {}),
    ...((init.headers as Record<string, string>) ?? {}),
  };
  return fetch(`${env.supabaseUrl}/auth/v1${path}`, { ...init, headers });
}

/**
 * A reset time a person can read.
 *
 * The quota message interpolated `resets_at` straight from Postgres, so the one
 * sentence a user sees when the product stops working ended
 * "…nulstilles 2026-08-26T00:00:00+00:00." — a machine timestamp in the middle
 * of a Danish sentence, in UTC, for an audience in Copenhagen.
 */
export function danishTime(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return 'ved midnat';
  return d.toLocaleString('da-DK', {
    timeZone: 'Europe/Copenhagen',
    weekday: 'long',
    hour: '2-digit',
    minute: '2-digit',
  });
}
