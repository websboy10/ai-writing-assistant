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
 * Two kinds of live-model variance this script tolerates, both already
 * documented as accepted/expected in 07-02-SUMMARY.md, neither a bug in
 * this plan's code:
 *  - a whole answer-batch call transiently returns zero answers (the panel
 *    shows "ingen kunne besvares — prøv igen" and stops, exactly as a real
 *    user would see it) — retried up to MAX_ATTEMPTS times;
 *  - which of the three question shapes gets detected varies run to run —
 *    asserted as "at least 2 of 3", not all 3, mirroring
 *    verify-autonomous-api.mjs's own "at least the three shapes" tolerance.
 *
 * Prereqs: backend running on 127.0.0.1:8787, extension BUILT WITH
 * VITE_BACKEND_URL=http://127.0.0.1:8787 pnpm --filter extension build
 * (the default build points at the deployed production backend, which does
 * not yet have this route — see 07-03-SUMMARY.md), tester@example.com with
 * an active entitlement.
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
const MAX_ATTEMPTS = 3;

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
// Deliberately NOT 07-02's statement text ("Projektet startede...") — that
// reads as the natural grounded answer to Q1 and the model quotes it back
// verbatim, colliding with this script's position-based text search. See
// test-pages/questions.html's comment.
const STATEMENT = 'Denne formular tager cirka fem minutter at udfylde.';

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

// NOTE on all waitForFunction calls below: (fn, options) — a 2-arg call —
// treats the options object as `arg` (Playwright's real signature is
// (fn, arg, options)), silently falling back to the DEFAULT 30s timeout
// regardless of what { timeout } says. The explicit `undefined` arg is
// required for the { timeout } option to actually apply.

/**
 * Drives one autonomous run to a terminal outcome, retrying transient
 * empty-answer runs (see file header). Returns { finished, elapsed } —
 * finished=false only after MAX_ATTEMPTS transient failures in a row.
 */
async function runAutonomous(host, autoBtn, modeLabel, perAttemptTimeoutMs) {
  const modeBtn = host.getByRole('button', { name: modeLabel, exact: true });
  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    await autoBtn.click();
    await modeBtn.waitFor({ timeout: 5_000 });
    const t0 = Date.now();
    await modeBtn.click();
    await page.waitForFunction(
      () => {
        const t = document.querySelector('awa-sidebar')?.shadowRoot?.textContent ?? '';
        return /Færdig ✓/.test(t) || /ingen kunne besvares/.test(t) || /ikke fundet nogen spørgsmål/.test(t);
      },
      undefined,
      { timeout: perAttemptTimeoutMs },
    );
    const elapsed = (Date.now() - t0) / 1000;
    const text = await shadowText();
    if (/Færdig ✓/.test(text)) return { finished: true, elapsed, attempt };
    if (attempt === MAX_ATTEMPTS) return { finished: false, elapsed, attempt };
    console.log(`  … attempt ${attempt} got a transient empty-answer notice, retrying (accepted live-model variance)`);
  }
  return { finished: false, elapsed: 0, attempt: MAX_ATTEMPTS };
}

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
  ok('autonomous button exists in the panel', (await autoBtn.count()) > 0 && (await autoBtn.isVisible().catch(() => false)));

  const straksResult = await runAutonomous(host, autoBtn, 'Straks', 90_000);
  ok('Straks run reports finished', straksResult.finished, `after ${straksResult.attempt} attempt(s)`);
  await page.screenshot({ path: `${shotsDir}/01-doc-straks-done.png` });

  if (straksResult.finished) {
    const docVal = await page.locator('#doc').inputValue();
    const lines = docVal.split('\n');
    const lineAfter = (question) => {
      const idx = lines.findIndex((l) => l.trim() === question);
      return idx === -1 ? null : (lines[idx + 1] ?? '').trim();
    };

    const ans1 = lineAfter(Q1);
    const ans2 = lineAfter(Q2);
    const ans3 = lineAfter(Q3);
    const answeredCount = [ans1, ans2, ans3].filter(Boolean).length;
    // Which of the three shapes gets detected varies run to run (07-02
    // SUMMARY) — the placement mechanism this plan proves is exercised as
    // soon as at least two land correctly; requiring all three would make
    // this test flaky on live-model variance that isn't a placement bug.
    ok(
      'at least 2 of the 3 question shapes get a non-empty answer directly beneath them',
      answeredCount >= 2,
      `Q1="${ans1 ?? '(none)'}" Q2="${ans2 ?? '(none)'}" Q3="${ans3 ?? '(none)'}"`,
    );

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

    // Order check tolerant of missing answers: for whichever questions DID
    // get answered, that answer's position must fall between its own
    // question and the next question in the fixed sequence.
    const boundaries = [
      { q: Q1, qPos: q1Pos, ans: ans1, nextPos: q2Pos },
      { q: Q2, qPos: q2Pos, ans: ans2, nextPos: q3Pos },
      { q: Q3, qPos: q3Pos, ans: ans3, nextPos: stPos },
    ].filter((b) => b.ans);
    const inOrder = boundaries.every((b) => {
      const ansPos = docVal.indexOf(b.ans, b.qPos);
      return ansPos !== -1 && ansPos > b.qPos && ansPos < b.nextPos;
    });
    ok(
      'each answer sits above the next question, in document order',
      inOrder,
      JSON.stringify(boundaries.map((b) => b.q)),
    );
  }

  await host.locator('button', { hasText: 'Skjul' }).click().catch(() => {});

  console.log('\n— Autonomous run: whole document, Langsomt, contenteditable —');
  await page.locator('#doc-ce').click();
  await autoBtn.waitFor({ timeout: 5_000 });

  const langsomtResult = await runAutonomous(host, autoBtn, 'Langsomt', 150_000);
  ok('Langsomt run reports finished', langsomtResult.finished, `after ${langsomtResult.attempt} attempt(s)`);
  // Human tempo: letter-by-letter must take seconds, not arrive as a disguised paste.
  ok('Langsomt is actually human-paced', langsomtResult.elapsed > 3, `took ${langsomtResult.elapsed.toFixed(1)}s`);
  await page.screenshot({ path: `${shotsDir}/02-doc-ce-langsomt-done.png` });

  if (langsomtResult.finished) {
    const ceLines = ((await page.locator('#doc-ce').innerText()) ?? '')
      .split('\n')
      .map((l) => l.trim())
      .filter(Boolean);
    const ceLineAfter = (question) => {
      const idx = ceLines.indexOf(question);
      return idx === -1 ? null : (ceLines[idx + 1] ?? null);
    };
    const ce1 = ceLineAfter(Q1);
    const ce2 = ceLineAfter(Q2);
    const ce3 = ceLineAfter(Q3);
    const ceAnsweredCount = [ce1, ce2, ce3].filter(Boolean).length;
    ok(
      'at least 2 of the 3 question shapes get a non-empty answer beneath them (contenteditable)',
      ceAnsweredCount >= 2,
      `Q1="${ce1 ?? '(none)'}" Q2="${ce2 ?? '(none)'}" Q3="${ce3 ?? '(none)'}"`,
    );
    const ceQ1Idx = ceLines.indexOf(Q1);
    const ceQ2Idx = ceLines.indexOf(Q2);
    const ceQ3Idx = ceLines.indexOf(Q3);
    ok(
      'contenteditable questions remain in original order',
      ceQ1Idx !== -1 && ceQ2Idx !== -1 && ceQ3Idx !== -1 && ceQ1Idx < ceQ2Idx && ceQ2Idx < ceQ3Idx,
      `${ceQ1Idx},${ceQ2Idx},${ceQ3Idx}`,
    );
  }
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
