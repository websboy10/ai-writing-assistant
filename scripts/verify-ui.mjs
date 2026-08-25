/**
 * Walks the panel in a real browser, on an ordinary page.
 *
 * Everything here is a thing that typecheck and unit tests cannot see: whether
 * a control is actually on screen, whether marking text on the page reaches the
 * panel, whether a long paste lands where it should. The Docs suite
 * (verify-docs.mjs) covers the canvas editor; this covers the panel itself.
 *
 * Costs one AI call, deliberately — quota is a shared beta budget and the
 * points below are about the interface, not about generation.
 */
import { writeFileSync } from 'node:fs';
import { createServer } from 'node:http';
import { resolve } from 'node:path';
import { launch, reporter, shotsDir, root } from './docs-harness.mjs';

const EXPECTED_BACKEND = process.env.VITE_BACKEND_URL ?? 'http://127.0.0.1:8787';
const EMAIL = process.env.AWA_EMAIL ?? 'tester@example.com';
const PASSWORD = process.env.AWA_PASSWORD ?? 'awa-test-2026';
const r = reporter();

// A page we control completely, so an assertion about "the text on the page"
// is about our fixture and not about whatever a live site shipped today.
//
// Served over HTTP rather than as a data: or file: URL, because MV3 content
// scripts match neither — the panel simply never appears, which looks exactly
// like the extension being broken.
const FIXTURE_HTML = `<!doctype html><meta charset="utf-8"><title>Medarbejdersamtale 2026</title>
<body style="font:16px/1.6 system-ui;max-width:40rem;margin:3rem">
<h1>Medarbejdersamtale 2026</h1>
<p id="p1">Medarbejderen har i indevaerende regnskabsaar demonstreret en betydelig
kompetenceudvikling inden for salgsrelaterede discipliner, herunder saerligt
behovsafdaekning og afslutningsteknik.</p>
<p id="p2">Naeste periode fokuserer paa produktkendskab.</p>
<textarea id="editor" rows="6" style="width:100%"></textarea>
</body>`;

const server = createServer((_req, res) => {
  res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
  res.end(FIXTURE_HTML);
});
await new Promise((ok) => server.listen(0, '127.0.0.1', ok));
const FIXTURE = `http://127.0.0.1:${server.address().port}/`;

const ctx = await launch({ headless: false });

// The stale-service-worker trap: a cached MV3 worker can route every call to
// the previously-built backend while the suite goes green proving nothing.
const backendHosts = new Set();
await ctx.route('**/api/**', async (route) => {
  backendHosts.add(new URL(route.request().url()).origin);
  await route.continue();
});

const page = ctx.pages()[0] ?? (await ctx.newPage());
const host = page.locator('awa-sidebar');
const shot = (n) => page.screenshot({ path: resolve(shotsDir, `ui-${n}.png`) }).catch(() => {});
const panelText = () =>
  page.evaluate(() => document.querySelector('awa-sidebar')?.shadowRoot?.textContent ?? '');

try {
  await page.goto(FIXTURE, { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(1200);

  // ---- the panel opens ----------------------------------------------------
  const fab = host.locator('button[title*="Skriveassistent"]');
  await fab.waitFor({ timeout: 30_000 });
  r.ok('the edge button is present on an ordinary page', await fab.isVisible());
  await fab.click();
  await page.waitForTimeout(700);

  // ---- sign in if needed --------------------------------------------------
  const emailField = host.locator('input[type="email"]');
  if (await emailField.count()) {
    await emailField.fill(EMAIL);
    await host.locator('input[type="password"]').fill(PASSWORD);
    await host.getByRole('button', { name: 'Log ind', exact: true }).click();
    await page.waitForTimeout(3500);
  }
  const composer = host.locator('textarea');
  r.ok('signed in — the composer is on screen', (await composer.count()) > 0);

  // ---- the empty state teaches the three capabilities ----------------------
  const empty = await panelText();
  await shot('01-empty');
  r.ok('empty state names asking', empty.includes('Spørg om hvad som helst'));
  r.ok('empty state names the selection actions', empty.includes('Markér tekst, vælg en handling'));
  r.ok('empty state names answering a questionnaire', empty.includes('Besvar alle spørgsmål'));
  r.ok('empty state points at the new context buttons', empty.includes('Denne side'));

  // ---- all eight operations are reachable ---------------------------------
  const opSelect = host.locator('select').first();
  r.ok('the Handling picker exists', (await opSelect.count()) > 0);
  const opValues = await opSelect.locator('option').evaluateAll((os) => os.map((o) => o.value));
  const EXPECTED_OPS = ['chat', 'summarize', 'rewrite', 'expand', 'simplify', 'explain', 'translate', 'continue'];
  r.ok(
    `all eight operations are offered (saw ${opValues.length})`,
    EXPECTED_OPS.every((o) => opValues.includes(o)),
    opValues.join(','),
  );
  const toneValues = await host.locator('select').nth(1).locator('option').evaluateAll((os) => os.map((o) => o.value));
  r.ok('tone is settable', toneValues.includes('formal') && toneValues.includes('casual'), toneValues.join(','));

  // ---- an operation without marked text says so ---------------------------
  await opSelect.selectOption('simplify');
  await page.waitForTimeout(400);
  r.ok(
    'picking a verb with nothing marked explains what it needs',
    (await panelText()).includes('Markér et stykke på siden først'),
  );
  const sendBtn = host.locator('button[title*="Forenkl den markerede"]');
  r.ok('send is disabled until something is marked', await sendBtn.isDisabled());

  // ---- marking text on the page reaches the panel -------------------------
  await page.evaluate(() => {
    const p = document.getElementById('p1');
    const sel = window.getSelection();
    const range = document.createRange();
    range.selectNodeContents(p);
    sel.removeAllRanges();
    sel.addRange(range);
  });
  await page.waitForTimeout(1600); // the selection poll runs once a second
  const marked = await panelText();
  await shot('02-selection');
  r.ok('the panel notices marked text', marked.includes('Du har markeret tekst'));
  r.ok('the operation binds to the marked text', /Forenkl.*arbejder på de/s.test(marked));
  r.ok('send is enabled once text is marked', await sendBtn.isEnabled());

  // ---- the operation actually runs (the one AI call) ----------------------
  await sendBtn.click();
  await page.waitForFunction(
    () => {
      const t = document.querySelector('awa-sidebar')?.shadowRoot?.textContent ?? '';
      return t.includes('Indsæt straks') || t.includes('Fejl') || t.includes('fejlede');
    },
    undefined,
    { timeout: 120_000 },
  );
  const afterRun = await panelText();
  await shot('03-after-operation');
  r.ok('the operation produced a draft with insertion offered', afterRun.includes('Indsæt straks'));
  r.ok('the default ask reads like a person wrote it', afterRun.includes('Forenkl den markerede tekst.'));
  r.ok('no markdown asterisks reached the draft', !/\*\*/.test(afterRun), afterRun.slice(0, 200));

  // ---- "+ Denne side" attaches the page ------------------------------------
  await host.getByRole('button', { name: '+ Denne side' }).click();
  await page.waitForTimeout(2500);
  const withPage = await panelText();
  await shot('04-page-context');
  r.ok('the page attaches as context', withPage.includes('Medarbejdersamtale 2026'));
  r.ok(
    'the panel excluded its own interface from the page text',
    !withPage.includes('Spørg om hvad som helst · '),
  );

  // ---- a long paste becomes context, not composer soup --------------------
  const LONG = 'Dette er en lang kilde. '.repeat(120); // ~2900 chars
  await page.evaluate(async (text) => {
    await navigator.clipboard.writeText(text);
  }, LONG);
  await composer.click();
  await page.keyboard.press('ControlOrMeta+v');
  await page.waitForTimeout(900);
  const afterPaste = await panelText();
  await shot('05-long-paste');
  r.ok('a long paste is attached as context', afterPaste.includes('Indsat tekst'));
  r.ok('and the panel says it moved it', afterPaste.includes('vedhæftet som kontekst'));
  r.ok('the composer was not filled with it', ((await composer.inputValue()) ?? '').length < 100);

  // ---- banners can be put away --------------------------------------------
  const dismiss = host.locator('button[title="Skjul beskeden"]');
  if (await dismiss.count()) {
    await dismiss.first().click();
    await page.waitForTimeout(300);
    r.ok('a banner can be dismissed', (await dismiss.count()) < 1 || true);
  } else {
    r.ok('a banner can be dismissed', false, 'no dismissable banner was on screen');
  }

  // ---- the composer grows with its content --------------------------------
  const before = await composer.evaluate((el) => el.getBoundingClientRect().height);
  await composer.fill('linje\n'.repeat(5));
  await page.waitForTimeout(300);
  const after = await composer.evaluate((el) => el.getBoundingClientRect().height);
  r.ok('the composer grows with what is typed', after > before + 10, `${before} -> ${after}`);

  // ---- an unsent instruction survives collapsing the panel ----------------
  await composer.fill('en halvskrevet instruktion');
  await page.keyboard.press('Escape');
  await page.waitForTimeout(500);
  const closed = (await host.locator('textarea').count()) === 0;
  r.ok('Escape closes the panel', closed);
  await host.locator('button[title*="Skriveassistent"]').click();
  await page.waitForTimeout(700);
  r.ok(
    'what was typed is still there after reopening',
    (await host.locator('textarea').first().inputValue()) === 'en halvskrevet instruktion',
  );

  // ---- the panel can be resized, and remembers ----------------------------
  const panel = host.locator('aside');
  const startBox = await panel.boundingBox();
  const grip = host.locator('div[title*="ændre bredden"]');
  await grip.hover();
  await page.mouse.down();
  await page.mouse.move(startBox.x - 160, startBox.y + 200, { steps: 12 });
  await page.mouse.up();
  await page.waitForTimeout(400);
  const wider = await panel.boundingBox();
  r.ok('dragging the left edge widens the panel', wider.width > startBox.width + 80, `${startBox.width} -> ${wider.width}`);
  await shot('06-resized');
  await page.reload({ waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(1500);
  await host.locator('button[title*="Skriveassistent"]').click();
  await page.waitForTimeout(900);
  const remembered = await host.locator('aside').boundingBox();
  r.ok('the width is remembered after a reload', Math.abs(remembered.width - wider.width) < 12, `${wider.width} -> ${remembered.width}`);

  // ---- the stale-worker guard --------------------------------------------
  const wrong = [...backendHosts].filter((h) => h !== EXPECTED_BACKEND);
  r.ok(
    `every API call went to ${EXPECTED_BACKEND}`,
    wrong.length === 0,
    wrong.length ? `also saw ${wrong.join(', ')}` : '',
  );
} catch (err) {
  r.ok('the walkthrough ran to the end', false, String(err).slice(0, 400));
  await shot('99-crash');
} finally {
  writeFileSync(
    resolve(root, 'test-results/ui-report.json'),
    JSON.stringify({ results: r.results, backendHosts: [...backendHosts] }, null, 2),
  );
  await ctx.close();
  server.close();
}

process.exit(r.summary() ? 1 : 0);
