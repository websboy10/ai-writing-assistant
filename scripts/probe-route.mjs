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
  const fab = host.locator('button[title*="Skriveassistent"]');
  await fab.waitFor({ timeout: 30_000 });
  if (!(await host.locator('textarea[placeholder*="Skriv til"], input[type="email"]').count())) await fab.click();
  await page.waitForTimeout(1500);

  // Type one question, then run the whole-document answer.
  const box = await page.locator('[class*="kix-page"]').first().boundingBox();
  const view = page.viewportSize() ?? { height: 800 };
  await page.mouse.click(box.x + box.width / 2, Math.min(box.y + box.height - 140, view.height - 60));
  await page.keyboard.type('Hvad er status på projektet?', { delay: 12 });
  await page.waitForTimeout(2500);

  await host.getByRole('button', { name: 'Besvar alle spørgsmål', exact: true }).click();
  await host.getByRole('button', { name: 'Straks', exact: true }).click();
  await page
    .waitForFunction(
      () => /Færdig ✓|ingen kunne besvares|ikke fundet nogen|Fejl/.test(document.querySelector('awa-sidebar')?.shadowRoot?.textContent ?? ''),
      undefined,
      { timeout: 180_000 },
    )
    .catch(() => {});

  console.log(`\ndoc: ${docId}`);
  console.log(`\n--- every /api/ request observed (${seen.length}) ---`);
  for (const s of [...new Set(seen)]) console.log(`  ${s}`);
} finally {
  await ctx.close();
}
