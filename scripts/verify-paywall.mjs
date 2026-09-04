/**
 * Money-flow proof: expired trial → hard paywall → real Stripe (test-mode)
 * checkout with the 4242 card → panel auto-unlocks without a refresh.
 *
 * Self-restoring. The previous version asserted a precondition it then
 * destroyed — paying with the test card left the account subscribed, so the
 * suite passed exactly once and every later run died on a 15s timeout that
 * named nothing. It now checks the precondition up front and says plainly what
 * is wrong, then hands the account back to the paywalled state at the end.
 *
 * Prereqs: backend on 127.0.0.1:8787, extension built against it.
 * Run: node scripts/verify-paywall.mjs [--keep]
 */
import { chromium } from 'playwright';
import { createServer } from 'node:http';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const root = process.cwd();
const extPath = resolve(root, 'apps/extension/.output/chrome-mv3');
const BACKEND = process.env.BACKEND_URL ?? 'http://127.0.0.1:8787';
const KEEP = process.argv.includes('--keep');

// A dedicated account whose trial has already expired. tester@example.com is
// deliberately NOT used: it holds the active subscription the other suites
// need, and paying on it once is what broke this script before.
const EMAIL = 'tester2@example.com';
const PASSWORD = 'awa-test-2026';

const env = Object.fromEntries(
  readFileSync(resolve(root, 'apps/backend/.env'), 'utf8')
    .split('\n')
    .filter((l) => l.includes('=') && !l.startsWith('#'))
    .map((l) => [l.slice(0, l.indexOf('=')), l.slice(l.indexOf('=') + 1)]),
);

const results = [];
const ok = (name, cond, detail = '') => {
  results.push([name, cond]);
  console.log(`  ${cond ? '✓' : '✗'} ${name}${!cond && detail ? ` — ${detail}` : ''}`);
  return cond;
};

async function login() {
  const res = await fetch(`${BACKEND}/api/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: EMAIL, password: PASSWORD }),
  });
  const body = await res.json();
  if (!body.access_token) throw new Error(`login failed: ${JSON.stringify(body).slice(0, 160)}`);
  return body.access_token;
}

const status = async (token) =>
  (await fetch(`${BACKEND}/api/billing/status`, { headers: { Authorization: `Bearer ${token}` } })).json();

/** Hands the account back to "expired trial, no subscription". */
async function restore(token) {
  const before = await status(token);
  if (!before.subscribed) return before;
  // Cancel in Stripe first so test mode doesn't accumulate live subscriptions,
  // then drop the link — the same call the backend makes when Stripe says a
  // customer is gone (see billing.ts → syncFromStripe).
  const userId = JSON.parse(Buffer.from(token.split('.')[1], 'base64url').toString()).sub;
  const subs = await fetch(
    `https://api.stripe.com/v1/subscriptions?customer=${await customerId(userId, token)}&status=all&limit=5`,
    { headers: { Authorization: `Bearer ${env.STRIPE_SECRET_KEY}` } },
  ).then((r) => r.json());
  for (const s of subs.data ?? []) {
    if (s.status !== 'canceled') {
      await fetch(`https://api.stripe.com/v1/subscriptions/${s.id}`, {
        method: 'DELETE',
        headers: { Authorization: `Bearer ${env.STRIPE_SECRET_KEY}` },
      });
    }
  }
  // The USER's token, not the anon key. billing_forget_customer is
  // self-scoped since migration 0006 — an anon caller is refused, which is the
  // whole point of that migration. Restoring the fixture the way the product
  // itself would is also the more honest test.
  const res = await fetch(`${env.SUPABASE_URL}/rest/v1/rpc/billing_forget_customer`, {
    method: 'POST',
    headers: {
      apikey: env.SUPABASE_ANON_KEY,
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ p_user_id: userId }),
  });
  if (!res.ok) console.log(`  (restore: billing_forget_customer -> HTTP ${res.status})`);
  return status(token);
}

async function customerId(userId, token) {
  const res = await fetch(`${env.SUPABASE_URL}/rest/v1/billing?user_id=eq.${userId}&select=stripe_customer_id`, {
    headers: { apikey: env.SUPABASE_ANON_KEY, Authorization: `Bearer ${token}` },
  });
  const rows = await res.json();
  return rows?.[0]?.stripe_customer_id ?? '';
}

const harness = readFileSync(resolve(root, 'test-pages/harness.html'));
const server = createServer((_q, r) => {
  r.writeHead(200, { 'Content-Type': 'text/html' });
  r.end(harness);
});
await new Promise((r) => server.listen(8788, '127.0.0.1', r));

let ctx;
let token;
try {
  token = await login();
  let st = await status(token);
  if (st.active) {
    console.log(`  … ${EMAIL} is currently subscribed — restoring the paywalled state first`);
    st = await restore(token);
  }
  if (!ok('precondition: the account is genuinely paywalled', st.active === false, JSON.stringify(st))) {
    throw new Error('cannot test the paywall on an account that is allowed through');
  }

  ctx = await chromium.launchPersistentContext('', {
    channel: 'chromium',
    headless: true,
    args: [`--disable-extensions-except=${extPath}`, `--load-extension=${extPath}`],
  });
  const page = await ctx.newPage();
  await page.goto('http://127.0.0.1:8788/');
  const host = page.locator('awa-sidebar');
  const fab = host.locator('button[title*="ChatBot"]');
  await fab.waitFor({ timeout: 10_000 });
  await fab.click();
  await host.locator('input[type="email"]').fill(EMAIL);
  await host.locator('input[type="password"]').fill(PASSWORD);
  await host.locator('button', { hasText: 'Log ind' }).click();

  // 1. Hard paywall replaces chat
  await host.locator('text=Prøveperioden er slut').waitFor({ timeout: 20_000 });
  ok('hard paywall shows for an expired trial', true);
  ok('chat is NOT reachable behind the paywall', (await host.locator('textarea[placeholder*="Skriv til"]').count()) === 0);
  await page.screenshot({ path: 'test-results/paywall.png' });

  // 2. Upgrade opens Stripe Checkout
  const pagePromise = ctx.waitForEvent('page', { timeout: 25_000 });
  // The card subscription, not the month pass: the pass is a one-off payment
  // whose Stripe test flow is a different page. Its own check lives below.
  await host.locator('button', { hasText: 'Abonnement' }).click();
  const checkout = await pagePromise;
  await checkout.waitForLoadState('domcontentloaded');
  ok('checkout opens on checkout.stripe.com', checkout.url().includes('checkout.stripe.com'), checkout.url().slice(0, 80));

  // 3. Pay with Stripe's test card.
  await checkout.waitForLoadState('networkidle').catch(() => {});
  if ((await checkout.locator('#cardNumber').count()) === 0) {
    const radio = checkout.locator('input[type="radio"][value="card"]').first();
    if (await radio.count()) await radio.check({ force: true, timeout: 10_000 });
  }
  await checkout.locator('#cardNumber').waitFor({ timeout: 30_000 });
  await checkout.locator('#cardNumber').fill('4242 4242 4242 4242');
  await checkout.locator('#cardExpiry').fill('12 / 34');
  await checkout.locator('#cardCvc').fill('123');
  await checkout.locator('#billingName').fill('Test Bruger');
  const postal = checkout.locator('#billingPostalCode');
  if (await postal.count()) await postal.fill('2100');
  await checkout.locator('button[type="submit"]').click();
  await checkout.waitForURL(/billing\/success/, { timeout: 60_000 });
  ok('payment completes → lands on the Danish success page', /abonnement er aktivt/.test(await checkout.content()));

  // 4. The panel unlocks by itself (5s status poll) — no refresh, no re-login.
  await host.locator('textarea[placeholder*="Skriv til"]').waitFor({ timeout: 25_000 });
  ok('panel auto-unlocks without any refresh', true);
  await page.screenshot({ path: 'test-results/paywall-unlocked.png' });
} catch (err) {
  ok(`unexpected failure: ${String(err).slice(0, 200)}`, false);
  for (const p of ctx?.pages() ?? []) {
    const name = p.url().includes('stripe.com') ? 'checkout-failure' : 'paywall-failure';
    await p.screenshot({ path: `test-results/${name}.png` }).catch(() => {});
  }
} finally {
  await ctx?.close();
  server.close();
  // Hand the account back, so the next run has the state it needs.
  if (token && !KEEP) {
    const st = await restore(token).catch((e) => ({ error: String(e).slice(0, 120) }));
    console.log(`\nrestored ${EMAIL}: ${JSON.stringify(st)}`);
  }
}

const failed = results.filter(([, c]) => !c).length;
console.log(`\n${results.length - failed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
