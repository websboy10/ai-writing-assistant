/**
 * Does an attached file reach the autonomous run?
 *
 * The acceptance walk in verify-autonomous.mjs kept answering "der er intet
 * vedhæftet kontekstmateriale" about a file that was visibly attached, and the
 * backend's own input log settled it: `contextItems=0` on every run. The model
 * was telling the truth — nothing arrived.
 *
 * The chip renders, so the store holds the item. The request carries nothing.
 * This narrows that gap in one run instead of a twenty-minute suite: it prints
 * what the panel shows AND what the panel sent, side by side.
 */
import { createServer } from 'node:http';
import { writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { launch, shotsDir, root } from './docs-harness.mjs';

const BACKEND = process.env.VITE_BACKEND_URL ?? 'http://127.0.0.1:8787';
const EMAIL = process.env.AWA_EMAIL ?? 'tester@example.com';
const PASSWORD = process.env.AWA_PASSWORD ?? 'awa-test-2026';

const FACT = 'Havfrue';
const sourcePath = resolve(shotsDir, 'probe-kilde.txt');
writeFileSync(sourcePath, `Projektet ${FACT} er 87 % færdigt og leverer til tiden.\n`, 'utf8');

const PAGE = `<!doctype html><meta charset="utf-8"><title>Probe</title>
<body style="font:16px system-ui;margin:2rem">
<textarea id="doc" rows="10" style="width:36rem">Hvad er status på projektet?

Denne formular tager cirka fem minutter at udfylde.</textarea>
</body>`;
const server = createServer((_q, r) => {
  r.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
  r.end(PAGE);
});
await new Promise((ok) => server.listen(0, '127.0.0.1', ok));
const URL_ = `http://127.0.0.1:${server.address().port}/`;

const ctx = await launch({ headless: false });

// The whole point: capture the request body the panel actually sends.
let sentContext = null;
await ctx.route('**/api/autonomous/answer', async (route) => {
  try {
    const body = JSON.parse(route.request().postData() ?? '{}');
    sentContext = {
      items: body.context?.length ?? 0,
      chars: body.context?.reduce((n, c) => n + (c.text?.length ?? 0), 0) ?? 0,
      names: (body.context ?? []).map((c) => c.name),
    };
  } catch {
    sentContext = { items: 'unparseable' };
  }
  await route.continue();
});

const page = ctx.pages()[0] ?? (await ctx.newPage());
const host = page.locator('awa-sidebar');
const panelText = () =>
  page.evaluate(() => {
    const root = document.querySelector('awa-sidebar')?.shadowRoot;
    return (root?.querySelector('aside') ?? root)?.textContent ?? '';
  });

try {
  await page.goto(URL_, { waitUntil: 'domcontentloaded' });
  await host.locator('button[title*="Skriveassistent"]').waitFor({ timeout: 30_000 });
  await host.locator('button[title*="Skriveassistent"]').click();
  await page.waitForTimeout(800);
  if (await host.locator('input[type="email"]').count()) {
    await host.locator('input[type="email"]').fill(EMAIL);
    await host.locator('input[type="password"]').fill(PASSWORD);
    await host.getByRole('button', { name: 'Log ind', exact: true }).click();
    await page.waitForTimeout(3500);
  }

  console.log(`how many awa-sidebar hosts are on the page? ${await page.locator('awa-sidebar').count()}`);

  await host.locator('input[type="file"]').setInputFiles(sourcePath);
  await page.waitForFunction(
    () => /probe-kilde\.txt/.test(document.querySelector('awa-sidebar')?.shadowRoot?.textContent ?? ''),
    undefined,
    { timeout: 30_000 },
  );
  console.log('panel shows the chip: yes');

  await page.locator('#doc').click();
  await page.waitForTimeout(600);
  await host.getByRole('button', { name: 'Besvar alle spørgsmål', exact: true }).click();
  await host.getByRole('button', { name: 'Straks', exact: true }).click();
  await page.waitForFunction(
    () => {
      const r = document.querySelector('awa-sidebar')?.shadowRoot;
      const t = (r?.querySelector('aside') ?? r)?.textContent ?? '';
      return /Færdig ✓|Fejl|ingen kunne besvares|ikke fundet nogen/.test(t);
    },
    undefined,
    { timeout: 180_000 },
  );

  const doc = await page.locator('#doc').inputValue();
  console.log(`\nwhat the panel SENT: ${JSON.stringify(sentContext)}`);
  console.log(`the answer mentions "${FACT}": ${doc.includes(FACT) ? 'YES' : 'NO'}`);
  console.log(`\ndocument now:\n${doc}`);
  await page.screenshot({ path: resolve(shotsDir, 'probe-context.png') }).catch(() => {});
} catch (err) {
  console.log(`FAILED: ${String(err).slice(0, 300)}`);
  console.log(`panel said: ${(await panelText()).slice(0, 300)}`);
} finally {
  await ctx.close();
  server.close();
}
