import type { FastifyReply, FastifyRequest } from 'fastify';
import { anonRpc } from './supabase.js';

/**
 * Hard rate limiting — the kind that survives a Vercel cold start.
 *
 * @fastify/rate-limit is registered in index.ts and cannot do this job: it
 * keeps its counters in memory and every invocation may be a fresh instance, so
 * the limit is whatever the platform's scheduling happens to make it. Measured
 * 2026-08-26, 70 concurrent requests to /api/chat were all served 200. It is
 * kept as a burst guard for one warm instance and nothing more.
 *
 * The counter has to live where the data lives. auth_throttle_hit (migration
 * 0008) is already exactly that primitive — one row per key, fixed window,
 * service_role only — so this reuses it rather than growing a second table that
 * would drift out of step with the first.
 *
 * KEYS ARE NAMESPACED BY ROUTE AND BY USER ID. Never by IP for a signed-in
 * route: the first market is HR teams on Google Workspace, where a whole office
 * shares one address, and an IP-keyed limit locks out the ninth person to sign
 * in on a Monday. IP keying belongs on the routes with no user, which is what
 * routes/auth.ts already does.
 */
export interface Budget {
  limit: number;
  seconds: number;
}

/** A day, to the second. Named because "86400" in a call site says nothing. */
export const DAY = 86_400;
export const HOUR = 3_600;
export const MINUTE = 60;

async function hit(key: string, b: Budget): Promise<boolean> {
  return anonRpc<boolean>('auth_throttle_hit', {
    p_key: key.slice(0, 200),
    p_limit: b.limit,
    p_window_seconds: b.seconds,
  });
}

/**
 * Check every budget for a route and answer whether the caller may proceed.
 *
 * FAILS CLOSED. This is the difference between this helper and the auth
 * throttle, which fails open on purpose: sign-in must keep working when the
 * counter is unreachable, because that throttle is defence in depth over
 * GoTrue's own. The routes here spend real money — vision-model OCR, Stripe
 * customer creation — and an unreachable counter means an unbounded one. The
 * calls run through anonRpc, so they need SUPABASE_SERVICE_ROLE_KEY; without it
 * they throw and these routes refuse, loudly and by design. That is a
 * deployment error, and a loud one beats an uncapped bill.
 */
export async function enforce(
  req: FastifyRequest,
  reply: FastifyReply,
  route: string,
  userId: string,
  budgets: Budget[],
): Promise<boolean> {
  let allowed: boolean[];
  try {
    allowed = await Promise.all(budgets.map((b, i) => hit(`${route}:${i}:${userId}`, b)));
  } catch (err) {
    req.log.error(err, `rate limit unreachable on ${route} — refusing rather than running uncapped`);
    reply.code(503).send({
      error: 'Tjenesten kan ikke behandle forespørgslen lige nu. Prøv igen om et øjeblik.',
      code: 'upstream_error',
    });
    return false;
  }
  if (allowed.every(Boolean)) return true;

  // Which budget was hit decides what the user is told: "wait a minute" and
  // "you are done for today" are different facts and a person can act on only
  // one of them.
  const firstHit = budgets[allowed.indexOf(false)];
  reply.code(429).send({
    error:
      firstHit.seconds >= DAY
        ? 'Du har nået dagens grænse for denne handling. Den nulstilles i morgen.'
        : 'For mange forsøg lige efter hinanden. Vent et øjeblik, og prøv igen.',
    code: 'rate_limited',
  });
  return false;
}
