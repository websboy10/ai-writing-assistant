/**
 * Money-flow proof: expired trial → hard paywall → real Stripe (test-mode)
 * checkout with the 4242 card → panel auto-unlocks without a refresh.
 *
 * Prereq: tester@example.com's trial is expired and no subscription is active
 * (the script asserts the paywall actually shows before paying).
 */
import { chromium } from 'playwright';
import { createServer } from 'node:http';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const root = process.cwd();
const extPath = resolve(root, 'apps/extension/.output/chrome-mv3');
const harness = readFileSync(resolve(root, 'test-pages/harness.html'));
const server = createServer((_q, r) => {
  r.writeHead(200, { 'Content-Type': 'text/html' });
  r.end(harness);
});
await new Promise((r) => server.listen(8788, '127.0.0.1', r));

const ctx = await chromium.launchPersistentContext('', {
  channel: 'chromium',
  headless: true,
  args: [`--disable-extensions-except=${extPath}`, `--load-extension=${extPath}`],
});
const page = await ctx.newPage();
const results = [];
const ok = (name, cond) => {
  results.push([name, cond]);
  console.log(`  ${cond ? '✓' : '✗'} ${name}`);
};

try {
  await page.goto('http://127.0.0.1:8788/');
  const host = page.locator('awa-sidebar');
  const fab = host.locator('button[title*="Skriveassistent"]');
  await fab.waitFor({ timeout: 10_000 });
  await fab.click();
  await host.locator('input[type="email"]').fill('tester@example.com');
  await host.locator('input[type="password"]').fill('awa-test-2026');
  await host.locator('button', { hasText: 'Log ind' }).click();

  // 1. Hard paywall replaces chat
  await host.locator('text=Prøveperioden er slut').waitFor({ timeout: 15_000 });
  ok('hard paywall shows for expired trial', true);
  const chatVisible = await host.locator('textarea[placeholder*="Skriv til"]').count();
  ok('chat is NOT reachable behind the paywall', chatVisible === 0);
  await page.screenshot({ path: 'test-results/paywall.png' });

  // 2. Upgrade opens Stripe Checkout
  const pagePromise = ctx.waitForEvent('page', { timeout: 20_000 });
  await host.locator('button', { hasText: 'Opgrader' }).click();
  const checkout = await pagePromise;
  await checkout.waitForLoadState('domcontentloaded');
  ok('checkout tab opens on checkout.stripe.com', checkout.url().includes('checkout.stripe.com'));

  // 3. Pay with Stripe's test card. The hosted page may open on a Link/wallet
  // pane — switch to the plain card option if so.
  await checkout.waitForLoadState('networkidle').catch(() => {});
  // Payment methods render as radio rows ("Kort" / "Klarna" / wallets) — the
  // card inputs only exist after selecting Kort.
  if ((await checkout.locator('#cardNumber').count()) === 0) {
    const radio = checkout.locator('input[type="radio"][value="card"]').first();
    if (await radio.count()) {
      await radio.check({ force: true, timeout: 10_000 });
    } else {
      // fall back to clicking the row's coordinates
      const box = await checkout.getByText('Kort', { exact: true }).first().boundingBox();
      if (box) await checkout.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
    }
  }
  await checkout.screenshot({ path: 'test-results/checkout-page.png' }).catch(() => {});
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

  // 4. The panel unlocks by itself (5s status poll)
  await host.locator('textarea[placeholder*="Skriv til"]').waitFor({ timeout: 20_000 });
  ok('panel auto-unlocks without any refresh', true);
  await page.screenshot({ path: 'test-results/paywall-unlocked.png' });
} catch (err) {
  ok(`unexpected failure: ${String(err).slice(0, 160)}`, false);
  await page.screenshot({ path: 'test-results/paywall-failure.png' }).catch(() => {});
  for (const p of ctx.pages()) {
    if (p.url().includes('stripe.com')) await p.screenshot({ path: 'test-results/checkout-failure.png' }).catch(() => {});
  }
} finally {
  await ctx.close();
  server.close();
}

const failed = results.filter(([, c]) => !c).length;
console.log(`\n${results.length - failed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
