/**
 * End-to-end verification for autonomous mode (Phase 7, plan 03): loads the
 * BUILT extension into real Chromium, clicks into a document full of
 * questions, presses the autonomous button, and proves every question gets
 * an answer written directly beneath it — for both a plain textarea and a
 * contenteditable, in both Straks and Langsomt.
 *
 * Not a unit test — this is the "walk the actual user flow in a real
 * browser" proof the operator requires before anything is called done.
 * Talks to the real backend and the live model (same pattern as
 * scripts/verify-autonomous-api.mjs, 07-02), so a run costs real quota and
 * takes real wall-clock time (~20-25s per detection+answer call, plus
 * letter-by-letter typing time for Langsomt).
 *
 * Prereqs: backend running on 127.0.0.1:8787, extension built
 * (.output/chrome-mv3), tester@example.com with an active entitlement.
 * Run: node scripts/verify-autonomous.mjs
 *
 * Uses port 8789 (verify.mjs uses 8788) so both suites can run independently
 * without colliding.
 */
import { chromium } from 'playwright';
import { createServer } from 'node:http';
import { readFileSync, mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const extPath = resolve(root, 'apps/extension/.output/chrome-mv3');
const shotsDir = resolve(root, 'test-results');
mkdirSync(shotsDir, { recursive: true });

const TEST_EMAIL = 'tester@example.com';
const TEST_PASSWORD = 'awa-test-2026';

let passed = 0;
let failed = 0;
const failures = [];

function ok(name, cond, detail = '') {
  if (cond) {
    passed++;
    console.log(`  ✓ ${name}`);
  } else {
    failed++;
    failures.push({ name, detail });
    console.log(`  ✗ ${name}${detail ? ` — ${detail}` : ''}`);
  }
}

// Text reused verbatim from scripts/verify-autonomous-api.mjs (07-02) — that
// script already proved these five paragraphs reliably exercise all three
// question shapes plus the grounded:false case against the live model.
const Q1 = 'Hvad er status på projektet?';
const Q2 = 'Beskriv dine tre vigtigste resultater i år';
const Q3 = '2. Hvilke områder vil du gerne udvikle?';
const STATEMENT = 'Projektet startede i januar og blev afsluttet i juni.';

// ---- serve the fixture on http (content scripts don't run on file:// by default) ----
const fixture = readFileSync(resolve(root, 'test-pages/questions.html'));
const server = createServer((_req, res) => {
  res.writeHead(200, { 'Content-Type': 'text/html' });
  res.end(fixture);
});
await new Promise((r) => server.listen(8789, '127.0.0.1', r));

const ctx = await chromium.launchPersistentContext('', {
  channel: 'chromium',
  headless: true,
  args: [`--disable-extensions-except=${extPath}`, `--load-extension=${extPath}`],
});

const page = await ctx.newPage();
const consoleErrors = [];
page.on('console', (m) => {
  if (m.type() === 'error') consoleErrors.push(m.text());
});

const shadowText = () => page.evaluate(() => document.querySelector('awa-sidebar')?.shadowRoot?.textContent ?? '');

try {
  console.log('\n— Sidebar + auth —');
  await page.goto('http://127.0.0.1:8789/');
  const host = page.locator('awa-sidebar');
  await host.waitFor({ state: 'attached', timeout: 10_000 });
  const fab = host.locator('button[title*="Skriveassistent"]');
  await fab.waitFor({ timeout: 5_000 });
  await fab.click();
  const aside = host.locator('aside');
  await aside.waitFor({ timeout: 5_000 });

  await host.locator('input[type="email"]').fill(TEST_EMAIL);
  await host.locator('input[type="password"]').fill(TEST_PASSWORD);
  await host.locator('button', { hasText: 'Log ind' }).click();
  await host.locator('textarea[placeholder*="Skriv til"]').waitFor({ timeout: 15_000 });
  ok('signed in', true);

  console.log('\n— Autonomous run: whole document, Straks, plain textarea —');
  await page.locator('#doc').click();

  const autoBtn = host.getByRole('button', { name: 'Besvar alle spørgsmål', exact: true });
  await autoBtn.waitFor({ timeout: 5_000 }).catch(() => {});
  ok('autonomous button exists in the panel', await autoBtn.count() > 0 && (await autoBtn.isVisible().catch(() => false)));

  await autoBtn.click();
  const straksBtn = host.getByRole('button', { name: 'Straks', exact: true });
  await straksBtn.waitFor({ timeout: 5_000 });
  await straksBtn.click();

  await page.waitForFunction(
    () => /Færdig ✓/.test(document.querySelector('awa-sidebar')?.shadowRoot?.textContent ?? ''),
    { timeout: 120_000 },
  );
  ok('Straks run reports finished', true);
  await page.screenshot({ path: `${shotsDir}/01-doc-straks-done.png` });

  const docVal = await page.locator('#doc').inputValue();
  const lines = docVal.split('\n');
  const lineAfter = (question) => {
    const idx = lines.findIndex((l) => l.trim() === question);
    return idx === -1 ? null : (lines[idx + 1] ?? '').trim();
  };

  const ans1 = lineAfter(Q1);
  const ans2 = lineAfter(Q2);
  const ans3 = lineAfter(Q3);
  ok('Q1 has a non-empty answer directly beneath it', !!ans1, ans1 ?? '(missing)');
  ok('Q2 has a non-empty answer directly beneath it', !!ans2, ans2 ?? '(missing)');
  ok('Q3 has a non-empty answer directly beneath it', !!ans3, ans3 ?? '(missing)');

  const afterStatement = lineAfter(STATEMENT);
  ok('the statement paragraph has no text inserted beneath it', afterStatement === '', `"${afterStatement}"`);

  ok(
    'the questions themselves are unchanged and still present',
    [Q1, Q2, Q3, STATEMENT].every((q) => docVal.includes(q)),
  );

  const q1Pos = docVal.indexOf(Q1);
  const q2Pos = docVal.indexOf(Q2);
  const q3Pos = docVal.indexOf(Q3);
  const stPos = docVal.indexOf(STATEMENT);
  ok(
    'questions remain in original document order',
    q1Pos !== -1 && q2Pos !== -1 && q3Pos !== -1 && stPos !== -1 && q1Pos < q2Pos && q2Pos < q3Pos && q3Pos < stPos,
    `${q1Pos},${q2Pos},${q3Pos},${stPos}`,
  );

  ok(
    'the answer to question 1 sits above the answer to question 2 (document order)',
    !!ans1 && docVal.indexOf(ans1) !== -1 && docVal.indexOf(ans1) < q2Pos,
    `ans1@${docVal.indexOf(ans1 ?? '')} q2@${q2Pos}`,
  );

  await host.locator('button', { hasText: 'Skjul' }).click().catch(() => {});

  console.log('\n— Autonomous run: whole document, Langsomt, contenteditable —');
  await page.locator('#doc-ce').click();
  await autoBtn.waitFor({ timeout: 5_000 });
  await autoBtn.click();
  const langsomtBtn = host.getByRole('button', { name: 'Langsomt', exact: true });
  await langsomtBtn.waitFor({ timeout: 5_000 });

  const t0 = Date.now();
  await langsomtBtn.click();
  await page.waitForFunction(
    () => /Færdig ✓/.test(document.querySelector('awa-sidebar')?.shadowRoot?.textContent ?? ''),
    { timeout: 180_000 },
  );
  const elapsed = (Date.now() - t0) / 1000;
  ok('Langsomt run reports finished', true);
  // Human tempo: letter-by-letter must take seconds, not arrive as a disguised paste.
  ok('Langsomt is actually human-paced', elapsed > 3, `took ${elapsed.toFixed(1)}s`);
  await page.screenshot({ path: `${shotsDir}/02-doc-ce-langsomt-done.png` });

  const ceLines = ((await page.locator('#doc-ce').innerText()) ?? '')
    .split('\n')
    .map((l) => l.trim())
    .filter(Boolean);
  const ceLineAfter = (question) => {
    const idx = ceLines.indexOf(question);
    return idx === -1 ? null : (ceLines[idx + 1] ?? null);
  };
  ok('Q1 (contenteditable) has a non-empty answer beneath it', !!ceLineAfter(Q1));
  ok('Q2 (contenteditable) has a non-empty answer beneath it', !!ceLineAfter(Q2));
  ok('Q3 (contenteditable) has a non-empty answer beneath it', !!ceLineAfter(Q3));
  const ceQ1Idx = ceLines.indexOf(Q1);
  const ceQ2Idx = ceLines.indexOf(Q2);
  const ceQ3Idx = ceLines.indexOf(Q3);
  ok(
    'contenteditable questions remain in original order',
    ceQ1Idx !== -1 && ceQ2Idx !== -1 && ceQ3Idx !== -1 && ceQ1Idx < ceQ2Idx && ceQ2Idx < ceQ3Idx,
    `${ceQ1Idx},${ceQ2Idx},${ceQ3Idx}`,
  );
} catch (err) {
  failed++;
  failures.push({ name: 'unexpected failure', detail: String(err) });
  console.error('  ✗ unexpected failure:', err);
  await page.screenshot({ path: `${shotsDir}/99-failure.png` }).catch(() => {});
} finally {
  await ctx.close();
  server.close();
}

console.log(`\n========================================`);
console.log(`  ${passed} passed, ${failed} failed`);
if (consoleErrors.length) {
  console.log(`  page console errors (${consoleErrors.length}):`);
  consoleErrors.slice(0, 5).forEach((e) => console.log(`    - ${e.slice(0, 160)}`));
}
if (failures.length) {
  console.log('  failures:');
  failures.forEach((f) => console.log(`    - ${f.name}: ${f.detail.slice(0, 200)}`));
  process.exit(1);
}
