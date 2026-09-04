/** Intercepts every /api/ request the extension makes — including the ones its
 *  service worker makes, which page-level listeners never see — and prints the
 *  full URL. Ends the question of which backend is actually being called. */
import { launch, newDoc } from './docs-harness.mjs';

const ctx = await launch({ headless: false });
const seen = [];
await ctx.route('**/api/**', async (route) => {
  seen.push(`${route.request().method()} ${route.request().url()}`);
  await route.continue();
});

const page = ctx.pages()[0] ?? (await ctx.newPage());
try {
  const docId = await newDoc(page);
  const host = page.locator('awa-sidebar');
  const fab = host.locator('button[title*="ChatBot"]');
  await fab.waitFor({ timeout: 30_000 });
  if (!(await host.locator('textarea[placeholder*="Skriv til"], input[type="email"]').count())) await fab.click();
  await page.waitForTimeout(1500);

  // Ask one question through the composer, which is the only AI call left.
  await host.locator('textarea[placeholder*="Skriv til"]').fill('Svar med ét ord: ja.');
  await host.locator('button', { hasText: '↑' }).click();
  await host.locator('text=Indsæt straks').waitFor({ timeout: 120_000 }).catch(() => {});

  console.log(`\ndoc: ${docId}`);
  console.log(`\n--- every /api/ request observed (${seen.length}) ---`);
  for (const s of [...new Set(seen)]) console.log(`  ${s}`);
} finally {
  await ctx.close();
}
