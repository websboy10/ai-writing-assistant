import { env } from './env.js';

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
    if (res.ok) return (await res.json()) as T;
    const body = await res.text();
    if (attempt === 0 && body.includes('PGRST303')) {
      await new Promise((r) => setTimeout(r, 1200));
      continue;
    }
    throw new Error(`rpc ${fn} failed (${res.status}): ${body}`);
  }
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
