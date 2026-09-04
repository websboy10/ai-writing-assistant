import { env } from './env.js';

/**
 * PostHog, server side, with no SDK.
 *
 * WHY NO DEPENDENCY: posthog-node is a package, a version bump and an audit
 * for what is one POST to a documented JSON endpoint. Thirty lines is the
 * smallest thing that fully solves it (RULE 3), and it keeps the deployed
 * function small, which is what cold starts are paid in.
 *
 * WHY SERVER SIDE AND NOT IN THE EXTENSION: an extension that phones an
 * analytics host from every page the user visits is a privacy claim we would
 * have to make in PRIVACY.md and defend in Chrome Web Store review, for data
 * the backend already sees. Everything worth counting — a generation, a
 * failure, a payment — passes through here anyway.
 *
 * NEVER SEND CONTENT. Not the prompt, not the reply, not a file name, not an
 * e-mail address. What goes out is shape and outcome: which model, how many
 * tokens, how long, which error code. The user id is the Supabase uuid, which
 * identifies a row and nothing about a person on its own.
 */
export interface CaptureProps {
  [key: string]: string | number | boolean | null | undefined;
}

/**
 * Fire and forget, and it means it.
 *
 * A failed analytics call must never turn a delivered answer into an error, and
 * must never add latency to a stream the user is watching. So: no await at the
 * call sites, a short timeout, and every failure swallowed after no log line at
 * all. This is the one place in this codebase where swallowing an error is
 * correct, because the alternative is analytics taking the product down.
 */
export function capture(userId: string, event: string, props: CaptureProps = {}): void {
  if (!env.posthogKey) return;
  const body = JSON.stringify({
    api_key: env.posthogKey,
    event,
    distinct_id: userId,
    properties: { ...props, $lib: 'awa-backend' },
    timestamp: new Date().toISOString(),
  });
  void fetch(`${env.posthogHost}/i/v0/e/`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body,
    signal: AbortSignal.timeout(3_000),
  }).catch(() => {
    /* analytics is never allowed to be the reason a request failed */
  });
}

/**
 * Read side: run HogQL against the project and hand back rows.
 *
 * Uses the personal API key, which is broad on the whole account, so it lives
 * only in the server environment and is only ever reachable through the admin
 * routes. Every query in this codebase is a literal written in admin.ts;
 * nothing user-supplied is ever concatenated into one, which is the only reason
 * exposing a SQL surface at all is acceptable.
 */
export async function hogql<T = unknown[]>(query: string): Promise<T[]> {
  if (!env.posthogApiKey || !env.posthogProjectId) {
    throw new Error('PostHog er ikke sat op (POSTHOG_API_KEY / POSTHOG_PROJECT_ID)');
  }
  const res = await fetch(`${env.posthogApiHost}/api/projects/${env.posthogProjectId}/query/`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${env.posthogApiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ query: { kind: 'HogQLQuery', query } }),
    signal: AbortSignal.timeout(20_000),
  });
  if (!res.ok) {
    throw new Error(`PostHog query failed (${res.status}): ${(await res.text()).slice(0, 300)}`);
  }
  const data = (await res.json()) as { results?: T[] };
  return data.results ?? [];
}
