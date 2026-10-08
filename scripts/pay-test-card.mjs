// One Stripe TEST checkout in the long-lived test browser: prints what the page charges, pays with 4242, prints where Stripe sends the buyer.
import { chromium } from 'playwright';
const url = process.argv[2];
const b = await chromium.connectOverCDP('http://127.0.0.1:9333');
const page = await b.contexts()[0].newPage();
try {
  await page.goto(url, { waitUntil: 'domcontentloaded' });
  if ((await page.locator('#cardNumber').count()) === 0) await page.locator('[data-testid="card-accordion-item"], #payment-method-accordion-item-title-card').first().click({ timeout: 15000 }).catch(() => {});
  await page.locator('#cardNumber').waitFor({ timeout: 30000 });
  const text = (await page.locator('body').first().innerText()).replace(/\s+/g, ' ');
  console.log('AMOUNTS:', [...new Set(text.match(/-?\d+[.,]\d{2}\s?(?:kr\.?|DKK)|(?:kr\.?|DKK)\s?-?\d+[.,]\d{2}|\d+\s?%[^.]{0,30}/gi) ?? [])].join(' | '));
  await page.screenshot({ path: 'test-results/checkout-' + (process.argv[3] ?? 'x') + '.png' });
  await page.locator('#cardNumber').fill('4242 4242 4242 4242');
  await page.locator('#cardExpiry').fill('12 / 34');
  await page.locator('#cardCvc').fill('123');
  await page.locator('#billingName').fill('Test Bruger');
  await page.locator('button[type="submit"]').click();
  await page.waitForURL((u) => !String(u).includes('checkout.stripe.com'), { timeout: 60000 });
  console.log('LANDED:', page.url());
} catch (e) {
  console.log('FAILED:', String(e).slice(0, 300));
  await page.screenshot({ path: 'test-results/checkout-failed.png' }).catch(() => {});
} finally {
  await page.close().catch(() => {});
  process.exit(0);
}
