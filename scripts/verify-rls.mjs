/**
 * The paywall and the quota, attacked the way anyone could attack them.
 *
 * Every check below is an exploit that WORKED against the live project on
 * 2026-08-25, run with nothing but curl and the publishable key that ships
 * inside the extension bundle:
 *
 *   - billing_set_subscription switched a paywalled account to active with no
 *     user token at all, and takes any p_user_id, so it worked on other
 *     people's accounts too.
 *   - refund_quota let a signed-in user reset their own daily counter.
 *   - consume_quota accepted a negative cost, the same result by another door.
 *
 * They are SECURITY DEFINER functions, so they run as the owner and ignore RLS;
 * being granted to PUBLIC handed that privilege to the anon role. Migration
 * 0006 closed them. This suite exists so they cannot quietly reopen — a
 * `create or replace` restores a function's grants, so a future edit that
 * forgets the revoke would silently undo all of it.
 */
import { readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { reporter } from './docs-harness.mjs';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const env = Object.fromEntries(
  readFileSync(resolve(root, 'apps/backend/.env'), 'utf8')
    .split('\n')
    .filter((l) => l.includes('=') && !l.startsWith('#'))
    .map((l) => [l.slice(0, l.indexOf('=')).trim(), l.slice(l.indexOf('=') + 1).trim()]),
);
const BACKEND = process.env.AWA_BACKEND ?? 'http://127.0.0.1:8787';
const SUPA = env.SUPABASE_URL;
const ANON = env.SUPABASE_ANON_KEY;
const r = reporter();

const login = async (email, password = 'awa-test-2026') => {
  const res = await fetch(`${BACKEND}/api/auth/login`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ email, password }),
  });
  const b = await res.json();
  if (!b.access_token) throw new Error(`login ${email}: ${JSON.stringify(b).slice(0, 160)}`);
  return { token: b.access_token, id: b.user.id };
};

/** Calls an RPC the way an attacker would: straight at PostgREST. */
const callRpc = async (fn, args, token) => {
  const res = await fetch(`${SUPA}/rest/v1/rpc/${fn}`, {
    method: 'POST',
    headers: {
      apikey: ANON,
      ...(token ? { authorization: `Bearer ${token}` } : {}),
      'content-type': 'application/json',
    },
    body: JSON.stringify(args),
  });
  return { status: res.status, body: (await res.text()).slice(0, 160) };
};

// Refusal comes in two shapes: PostgREST's own 401/403 when EXECUTE is not
// granted, and the function raising once it looks at auth.uid(). Both are a
// refusal; only a 200 with the write applied is a hole.
const denied = (res) =>
  res.status === 401 || res.status === 403 || /permission denied|forbidden|unauthenticated/i.test(res.body);

const victim = await login('tester2@example.com');
const attacker = await login('tester@example.com');

console.log('attacking the paywall and the quota with the publishable key\n');

// 1. The big one: no token whatsoever.
let res = await callRpc(
  'billing_set_subscription',
  { p_user_id: victim.id, p_customer_id: null, p_subscription_id: null, p_status: 'active', p_period_end: null },
  null,
);
r.ok('billing_set_subscription refuses an anonymous caller', denied(res), `HTTP ${res.status} ${res.body}`);

// 2. Same call, but signed in as somebody. Being a customer is not authority.
res = await callRpc(
  'billing_set_subscription',
  { p_user_id: victim.id, p_customer_id: null, p_subscription_id: null, p_status: 'active', p_period_end: null },
  attacker.token,
);
r.ok('billing_set_subscription refuses a signed-in caller', denied(res), `HTTP ${res.status} ${res.body}`);

// 3. Clearing someone else's Stripe link.
res = await callRpc('billing_forget_customer', { p_user_id: victim.id }, attacker.token);
r.ok('billing_forget_customer refuses another user’s id', denied(res), `HTTP ${res.status} ${res.body}`);

// 4. Starting a trial in someone else's name (and poisoning trial_devices).
res = await callRpc('billing_init', { p_user_id: victim.id, p_install_hash: 'attack' }, attacker.token);
r.ok('billing_init refuses another user’s id', denied(res), `HTTP ${res.status} ${res.body}`);

// 5. Reading which account owns a Stripe customer.
res = await callRpc('billing_user_for_customer', { p_customer_id: 'cus_x' }, attacker.token);
r.ok('billing_user_for_customer is not readable by a user', denied(res), `HTTP ${res.status} ${res.body}`);

// 6. The self-serve daily limit reset.
res = await callRpc('refund_quota', { p_cost: 50 }, attacker.token);
r.ok('refund_quota is not callable by the user it benefits', denied(res), `HTTP ${res.status} ${res.body}`);

res = await callRpc('refund_quota_for', { p_user_id: attacker.id, p_cost: 50 }, attacker.token);
r.ok('refund_quota_for is service-only', denied(res), `HTTP ${res.status} ${res.body}`);

// 6b. The auth throttle (migration 0008). If a caller can drive this, they can
//     spend someone else's login budget and lock that person out of their own
//     account — a denial of service with the security control as the weapon.
res = await callRpc('auth_throttle_hit', { p_key: 'login:acct:whoever', p_limit: 1, p_window_seconds: 3600 }, attacker.token);
r.ok('auth_throttle_hit cannot be driven by a signed-in caller', denied(res), `HTTP ${res.status} ${res.body}`);

res = await callRpc('auth_throttle_hit', { p_key: 'login:acct:whoever', p_limit: 1, p_window_seconds: 3600 }, null);
r.ok('auth_throttle_hit cannot be driven anonymously', denied(res), `HTTP ${res.status} ${res.body}`);

// 7. The same result by arithmetic.
res = await callRpc('consume_quota', { p_cost: -100 }, attacker.token);
r.ok('consume_quota rejects a negative cost', /invalid cost/i.test(res.body), `HTTP ${res.status} ${res.body}`);

res = await callRpc('consume_quota', { p_cost: 0 }, attacker.token);
r.ok('consume_quota rejects a zero cost', /invalid cost/i.test(res.body), `HTTP ${res.status} ${res.body}`);

// 8. And the legitimate self-scoped path still works, or we have merely
//    broken the product instead of securing it.
res = await callRpc(
  'billing_sync_self',
  { p_customer_id: null, p_subscription_id: null, p_status: 'expired', p_period_end: null },
  victim.token,
);
r.ok('billing_sync_self still works for the user themselves', res.status === 200 || res.status === 204, `HTTP ${res.status} ${res.body}`);

res = await callRpc('billing_sync_self', { p_customer_id: null, p_subscription_id: null, p_status: 'active', p_period_end: null }, null);
r.ok('billing_sync_self refuses an anonymous caller', denied(res), `HTTP ${res.status} ${res.body}`);

const after = await (await fetch(`${BACKEND}/api/billing/status`, { headers: { authorization: `Bearer ${victim.token}` } })).json();
r.ok('the victim account was never actually unlocked', after.active === false, JSON.stringify(after));

process.exit(r.summary() ? 1 : 0);
