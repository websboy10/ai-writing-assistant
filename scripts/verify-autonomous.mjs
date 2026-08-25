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
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
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
// Reused verbatim from 07-02's own fixture: a real question the page gives
// no grounding for — the deliberate grounded:false case (D-12).
const UNGROUNDED = 'Hvad var din kollegas vurdering af leveringen i marts?';

/**
 * The sentence that must never reach the user's document again.
 *
 * The prompt used to permit "one short sentence" saying the sources held
 * nothing, and that sentence landed under the user's own question for them to
 * delete by hand. Both languages, because the model picks the question's — and
 * these are the forms it actually produced, not a guess at them.
 */
const HEDGE =
  /fremgår ikke|oplyser ikke|ingen oplysninger|ikke nævnt|ikke angivet|kan ikke besvare|ikke muligt at|indeholder ikke|ikke tilstrækkelig|does not (mention|contain|specify)|no information|not (specified|mentioned|provided)/i;
// The full #doc fixture text, exactly as test-pages/questions.html defines
// it — 07-04's new sections (2-5, below) reset #doc to this between each
// other, because the Straks section above leaves #doc populated with
// inserted answers and never undoes them.
const DOC_TEXT = `${Q1}\n\n${Q2}\n\n${Q3}\n\n${STATEMENT}\n\n${UNGROUNDED}`;

// The ten-question marking (07-04's normal case, not an edge case — the
// operator raised this explicitly). Verbatim from test-pages/questions.html.
const TEN = [
  '1. Hvad hedder du?',
  '2. Hvor arbejder du?',
  '3. Hvad er din stilling?',
  '4. Hvor længe har du arbejdet der?',
  '5. Hvad er dine vigtigste opgaver?',
  '6. Hvilke værktøjer bruger du dagligt?',
  '7. Hvad er din største udfordring lige nu?',
  '8. Hvordan samarbejder du med dit team?',
  '9. Hvad vil du gerne blive bedre til?',
  '10. Hvad er dine mål for næste kvartal?',
];

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

/**
 * Waits for a field's value to actually grow past a baseline length — NOT
 * for the "Skriver" state word, which appears the INSTANT run() is called
 * (before the ~20-25s /api/autonomous/answer call even resolves, let alone
 * before the first letter lands). A wait keyed on the state word alone
 * resolves during that loading window and races every subsequent action.
 */
async function waitForFieldGrowth(selector, baseLen, timeoutMs) {
  await page.waitForFunction(
    ({ sel, base }) => (document.querySelector(sel)?.value?.length ?? 0) > base,
    { sel: selector, base: baseLen },
    { timeout: timeoutMs },
  );
}

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
/**
 * How long Langsomt is ALLOWED to take, derived rather than guessed.
 *
 * Langsomt types at DEFAULT_PACING.wpm (30 words/min, 5 chars/word) = 400ms a
 * character, by design — it is the mode whose whole point is that you can read
 * along and stop it. Three answers of ~120 characters is therefore ~2.5 minutes
 * of typing before a single second of thinking is counted.
 *
 * The budget was a flat 150_000, which was already inside the noise: on
 * 2026-08-25 the answers got longer (they started actually using the attached
 * file instead of saying "the document does not mention this") and the run
 * tipped over the edge, failing a suite in which nothing was wrong. A number
 * derived from the pacing cannot rot the same way — if the pace changes, this
 * follows.
 */
const LANGSOMT_CHARS_BUDGET = 3 * 200; // three answers, generous length each
const MS_PER_CHAR = 60_000 / (30 * 5);
const LANGSOMT_BUDGET_MS = Math.round(LANGSOMT_CHARS_BUDGET * MS_PER_CHAR) + 90_000; // + thinking time

/**
 * How long a run may take to put its FIRST character on the page.
 *
 * Nothing can be written until /api/autonomous/answer returns, so this is that
 * call's latency and nothing else. Measured against production 2026-08-25 on a
 * three-question document: 29.4s, 14.0s, 9.7s — the slow one being the first
 * request after an idle period. The old flat 40_000 sat close enough to that
 * worst case that the suite failed on cold starts with nothing wrong, which is
 * the same way a flat number failed the run budget above.
 */
const FIRST_CHAR_BUDGET_MS = 120_000;

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

/**
 * Same shape as runAutonomous, but for the "Besvar markeringen" entry point
 * (07-04, D-04a): clicking it must ask Straks/Langsomt directly and write —
 * no draft, no Insert press. Mirrors the whole-document helper's retry
 * tolerance for transient empty-answer batches.
 */
// `alreadyOpen: true` skips the FIRST attempt's click on "Besvar markeringen"
// — used when the caller already opened the Straks/Langsomt choice itself
// (e.g. to assert on it before running). Any retry still reopens it, since a
// failed run collapses back to the entry button.
async function runSelection(host, modeLabel, perAttemptTimeoutMs, { alreadyOpen = false } = {}) {
  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    if (!(alreadyOpen && attempt === 1)) {
      const answerBtn = host.getByRole('button', { name: 'Besvar markeringen', exact: true });
      await answerBtn.waitFor({ timeout: 5_000 });
      await answerBtn.click();
    }
    const modeBtn = host.getByRole('button', { name: modeLabel, exact: true });
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
    await page.waitForTimeout(500);
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

  const langsomtResult = await runAutonomous(host, autoBtn, 'Langsomt', LANGSOMT_BUDGET_MS);
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
  await host.locator('button', { hasText: 'Skjul' }).click().catch(() => {});

  // ---------------------------------------------------------------------
  // 07-04, section 1: ten questions in one marking — the operator's explicit
  // "normal case, not an edge case". "Besvar markeringen" must ask
  // Straks/Langsomt and write directly, exactly like the whole-document
  // button (D-04a) — no draft, no Insert press.
  // ---------------------------------------------------------------------
  console.log('\n— Besvar markeringen: ten questions in ONE marking (D-04a) —');
  await page.locator('#ten').click();
  await page.locator('#ten').press('ControlOrMeta+a');
  await page.waitForTimeout(1400); // selection poll runs every second

  const answerBtn = host.getByRole('button', { name: 'Besvar markeringen', exact: true });
  await answerBtn.waitFor({ timeout: 5_000 });
  await answerBtn.click();

  const selStraks = host.getByRole('button', { name: 'Straks', exact: true });
  const selLangsomt = host.getByRole('button', { name: 'Langsomt', exact: true });
  await selStraks.waitFor({ timeout: 5_000 });
  ok(
    'the panel offers Straks and Langsomt directly on the selection',
    (await selStraks.count()) > 0 && (await selLangsomt.count()) > 0,
  );
  ok(
    'no draft awaiting an Insert press appeared — the old two-step is gone on this path',
    (await host.locator('button', { hasText: 'Indsæt straks' }).count()) === 0,
  );
  ok(
    'no old "Besvarer markeringen" chip appeared',
    !/Besvarer markeringen ·/.test(await shadowText()),
  );

  const tenResult = await runSelection(host, 'Straks', 90_000, { alreadyOpen: true });
  ok('the ten-question run reports finished', tenResult.finished, `after ${tenResult.attempt} attempt(s)`);
  await page.screenshot({ path: `${shotsDir}/03-ten-straks-done.png` });

  if (tenResult.finished) {
    const tenVal = await page.locator('#ten').inputValue();
    const tenLines = tenVal.split('\n');
    const lineAfterTen = (question) => {
      const idx = tenLines.findIndex((l) => l.trim() === question);
      return idx === -1 ? null : (tenLines[idx + 1] ?? '').trim();
    };

    ok('all ten questions are still present, unchanged', TEN.every((q) => tenVal.includes(q)));

    const answers = TEN.map(lineAfterTen);
    ok(
      'all ten questions have a non-empty answer on the line beneath them',
      answers.every((a) => !!a),
      JSON.stringify(answers.map((a, i) => `${i + 1}:${a ? a.slice(0, 24) : '(none)'}`)),
    );

    const positions = TEN.map((q) => tenVal.indexOf(q));
    ok(
      'all ten questions remain in original document order',
      positions.every((p, i) => p !== -1 && (i === 0 || p > positions[i - 1])),
      JSON.stringify(positions),
    );

    const q3Pos = positions[2];
    const q4Pos = positions[3];
    const ans3 = answers[2];
    const ans3Pos = ans3 ? tenVal.indexOf(ans3, q3Pos) : -1;
    ok(
      "the answer for question 3 sits between questions 3 and 4",
      !!ans3 && ans3Pos > q3Pos && (q4Pos === -1 || ans3Pos < q4Pos),
      `q3=${q3Pos} ans3=${ans3Pos} q4=${q4Pos}`,
    );
  }
  await host.locator('button', { hasText: 'Skjul' }).click().catch(() => {});

  // ---------------------------------------------------------------------
  // 07-04, sections 2-5 all drive #doc. The whole-document Straks section
  // above (07-03) left #doc populated with inserted answers and never
  // undoes them — reset to the pristine fixture text before each of the
  // following, so every section starts from known content.
  // ---------------------------------------------------------------------

  console.log('\n— Whole-run transport: pause holds the WHOLE run, resume continues, Fortryd undoes it all in one press (D-15) —');
  await page.locator('#doc').fill(DOC_TEXT);
  await page.locator('#doc').click();
  await autoBtn.waitFor({ timeout: 5_000 });
  await autoBtn.click();
  const transportLangsomt = host.getByRole('button', { name: 'Langsomt', exact: true });
  await transportLangsomt.waitFor({ timeout: 5_000 });
  await transportLangsomt.click();

  // Wait for real, visible progress (the backend call alone can take
  // ~20-25s) — not just the "Skriver" label, which appears the instant
  // run() is called.
  await waitForFieldGrowth('#doc', DOC_TEXT.length, FIRST_CHAR_BUDGET_MS);

  const pauseBtn = host.locator('button', { hasText: 'Pause' });
  await pauseBtn.waitFor({ timeout: 5_000 });
  let isPaused = false;
  for (let i = 0; i < 8 && !isPaused; i++) {
    await pauseBtn.click().catch(() => {});
    await page.waitForTimeout(250);
    isPaused = /Fortsæt/.test(await shadowText());
  }
  ok('pause holds the whole run — even one pressed between two answers, not just mid-typing', isPaused);

  const pausedVal = await page.locator('#doc').inputValue();
  await page.waitForTimeout(900);
  const stillPausedVal = await page.locator('#doc').inputValue();
  ok(
    'the field stops growing across a 900ms wait while paused',
    isPaused && pausedVal === stillPausedVal,
    `len ${pausedVal.length} vs ${stillPausedVal.length}`,
  );

  await host.locator('button', { hasText: 'Fortsæt' }).click();
  await page.waitForFunction(
    () => /Færdig ✓/.test(document.querySelector('awa-sidebar')?.shadowRoot?.textContent ?? ''),
    undefined,
    { timeout: LANGSOMT_BUDGET_MS },
  );
  ok('the Langsomt run over #doc finishes after resume', true);

  await host.locator('button', { hasText: 'Fortryd alle svar' }).click();
  await page.waitForTimeout(600);
  const undoneVal = await page.locator('#doc').inputValue();
  ok(
    'Fortryd removes EVERY answer in one press — the whole run, not per-answer (D-15)',
    undoneVal.trim() === DOC_TEXT.trim(),
    `"${undoneVal.slice(0, 250)}"`,
  );
  ok(
    'the original questions are untouched after undo',
    [Q1, Q2, Q3, STATEMENT, UNGROUNDED].every((q) => undoneVal.includes(q)),
  );
  await host.locator('button', { hasText: 'Skjul' }).click().catch(() => {});

  console.log('\n— Typing race: a trusted keystroke mid-run pauses the WHOLE run (D-13) —');
  await page.locator('#doc').fill(DOC_TEXT);
  await page.locator('#doc').click();
  await autoBtn.waitFor({ timeout: 5_000 });
  await autoBtn.click();
  const raceLangsomt = host.getByRole('button', { name: 'Langsomt', exact: true });
  await raceLangsomt.waitFor({ timeout: 5_000 });
  await raceLangsomt.click();

  await waitForFieldGrowth('#doc', DOC_TEXT.length, FIRST_CHAR_BUDGET_MS);
  await page.waitForTimeout(900); // outlive the first few paced ticks, like verify.mjs's own typing-race test
  await page.locator('#doc').press('x'); // a trusted keystroke — never one we synthesized
  await page.waitForTimeout(500);
  ok('a trusted keystroke mid-run pauses the run, reporting why', /du begyndte at skrive/i.test(await shadowText()));

  await host.locator('button', { hasText: 'Fortsæt' }).click().catch(() => {});
  await page.waitForTimeout(600);
  const afterResume = await page.locator('#doc').inputValue();
  ok('the typed character survives resume', afterResume.includes('x'), `"${afterResume.slice(0, 250)}"`);

  await page
    .waitForFunction(
      () => /Færdig ✓|Stoppet|Fejl/.test(document.querySelector('awa-sidebar')?.shadowRoot?.textContent ?? ''),
      undefined,
      { timeout: LANGSOMT_BUDGET_MS },
    )
    .catch(() => {});
  await host.locator('button', { hasText: 'Skjul' }).click().catch(() => {});

  // A question the page gives nothing to build on used to produce a sentence
  // saying so, plus a panel list naming it. Both are gone (operator's call,
  // 2026-08-26): what lands is a first draft the person edits, and a refusal
  // is not editable. What has to hold now is the opposite of what it was — a
  // real answer, no hedge in the document, no hedge in the panel.
  console.log('\n— A question with nothing to build on still gets a usable, unhedged answer —');
  await page.locator('#doc').fill(DOC_TEXT);
  await page.locator('#doc').click();
  const gapRun = await runAutonomous(host, autoBtn, 'Straks', 90_000);
  const gapPanelText = await shadowText();
  const gapDocVal = await page.locator('#doc').inputValue();
  ok('the run finished', gapRun.finished, gapPanelText.slice(0, 200));

  const gapLines = gapDocVal.split('\n');
  const gapIdx = gapLines.findIndex((l) => l.trim() === UNGROUNDED);
  const afterUngrounded = gapIdx === -1 ? '' : (gapLines[gapIdx + 1] ?? '').trim();
  ok('the question nothing could ground still gets an answer beneath it', !!afterUngrounded, `"${afterUngrounded}"`);
  // The failure this replaces was user-visible and specific: "det fremgår ikke
  // af dokumentet" written into the user's own document, under their own
  // question, for them to delete by hand.
  ok(
    'that answer states something rather than declining to',
    !!afterUngrounded && !HEDGE.test(afterUngrounded),
    `"${afterUngrounded}"`,
  );
  ok(
    'the document carries no marker, flag or bracket next to it',
    !!afterUngrounded && !/[[\]{}]|⚠|TODO|FIXME|usikker|ubekræftet/i.test(afterUngrounded),
    `"${afterUngrounded}"`,
  );
  ok(
    'the panel no longer tells the user which answers it made up',
    !/Uden grundlag/i.test(gapPanelText),
    gapPanelText.slice(0, 200),
  );
  await host.locator('button', { hasText: 'Skjul' }).click().catch(() => {});

  console.log('\n— Panel independence: closing the sidebar does not stop a running Langsomt run (D-14) —');
  await page.locator('#doc').fill(DOC_TEXT);
  await page.locator('#doc').click();
  await autoBtn.waitFor({ timeout: 5_000 });
  await autoBtn.click();
  const bgLangsomt = host.getByRole('button', { name: 'Langsomt', exact: true });
  await bgLangsomt.waitFor({ timeout: 5_000 });
  await bgLangsomt.click();

  await waitForFieldGrowth('#doc', DOC_TEXT.length, FIRST_CHAR_BUDGET_MS);
  await page.waitForTimeout(1500);
  const lenBeforeClose = (await page.locator('#doc').inputValue()).length;

  await host.locator('button[title="Skjul panelet"]').click();
  await host.locator('aside').waitFor({ state: 'detached', timeout: 5_000 }).catch(() => {});
  await page.waitForTimeout(3000); // the run must keep going while the panel (and its React tree) is unmounted

  const lenWhileClosed = (await page.locator('#doc').inputValue()).length;
  ok('the run advanced while the panel was collapsed', lenWhileClosed > lenBeforeClose, `${lenBeforeClose} → ${lenWhileClosed}`);

  await host.locator('button[title*="Skriveassistent"]').click();
  await host.locator('aside').waitFor({ timeout: 5_000 });
  await page.waitForFunction(
    () => /Færdig ✓/.test(document.querySelector('awa-sidebar')?.shadowRoot?.textContent ?? ''),
    undefined,
    { timeout: LANGSOMT_BUDGET_MS },
  );
  ok('reopening the panel shows the run still finishes on its own', true);
  await host.locator('button', { hasText: 'Skjul' }).click().catch(() => {});

  console.log('\n— Regression: Brug som kontekst is unchanged — still a chip, never a run (D-04b) —');
  await page.locator('#doc').fill(Q1);
  await page.locator('#doc').click();
  await page.locator('#doc').press('ControlOrMeta+a');
  await page.waitForTimeout(1400);
  await host.locator('button', { hasText: 'Brug som kontekst' }).click();
  await page.waitForTimeout(300);
  const kontekstText = await shadowText();
  ok('Brug som kontekst still produces a context chip', /Markeret tekst \(/.test(kontekstText));
  ok(
    'Brug som kontekst never starts an autonomous run — no transport bar appears',
    !/Skriver\b/.test(kontekstText) && (await host.locator('button', { hasText: '⏸ Pause' }).count()) === 0,
  );
  await host.locator('button[title^="Fjern"]').first().click().catch(() => {});
  await page.locator('#doc').fill(DOC_TEXT);

  // ---- Acceptance scenario (07-06) ----
  //
  // The sections above probe features one at a time. This one walks the
  // operator's own framing in a single uninterrupted flow, because that is
  // the thing the phase exists for: a project leader sends a worker a
  // document full of questions; the worker attaches the material they'd
  // actually answer from, presses one button, watches the answers get typed
  // in from the top down, and can take it all back out with one press.
  //
  // The attached file is what makes this more than a repeat of the sections
  // above: D-11 says answers are built from the worker's own material, and
  // that is only proven if a fact that exists NOWHERE on the page comes back
  // out inside an answer.
  console.log("\n— Acceptance scenario: the operator's own framing, start to finish —");

  const SOURCE_FACT_A = 'Havfrue';
  const SOURCE_FACT_B = '0,4 %';
  const sourcePath = `${shotsDir}/acceptance-kilde.txt`;
  writeFileSync(
    sourcePath,
    [
      `Projektet ${SOURCE_FACT_A} er 87 % færdigt og leverer til tiden.`,
      `Årets tre vigtigste resultater: lanceringen af ${SOURCE_FACT_A}-portalen, en fejlrate ned på ${SOURCE_FACT_B}, og 12 nye kunder.`,
    ].join('\n'),
    'utf8',
  );

  // 1. A fresh page load, still signed in, nothing else carried over.
  await page.goto('http://127.0.0.1:8789/');
  await host.waitFor({ state: 'attached', timeout: 10_000 });
  await host.locator('button[title*="Skriveassistent"]').click();
  await host.locator('aside').waitFor({ timeout: 5_000 });
  await host.locator('textarea[placeholder*="Skriv til"]').waitFor({ timeout: 15_000 });
  ok('a fresh page load is still signed in — no second login to start work', true);

  // 2. Attach the worker's own material through the normal panel flow.
  await host.locator('input[type="file"]').setInputFiles(sourcePath);
  // A CHIP, specifically — and asserted, not assumed.
  //
  // This waited for the filename anywhere in the panel and then passed `true`
  // unconditionally, so it could not fail. A failed upload puts the same
  // filename in an error banner ("Behandlingen af \"acceptance-kilde.txt\"
  // fejlede"), which satisfied the wait; and passing `true` meant even a
  // timeout-free but chip-less panel reported success. The grounding assertion
  // 40 lines below then failed instead, pointing at the model for something
  // that had gone wrong up here.
  const chip = host.locator('button[title*="acceptance-kilde.txt"]');
  await chip.waitFor({ timeout: 20_000 }).catch(() => {});
  const chipPresent = (await chip.count()) > 0;
  ok(
    'the attached file appears as a context chip, ready to answer from',
    chipPresent,
    chipPresent ? '' : `panel says: ${(await shadowText()).replace(/\s+/g, ' ').trim().slice(-260)}`,
  );

  // 3. Click into the document, one button, Langsomt.
  const acceptanceBefore = await page.locator('#doc').inputValue();
  await page.locator('#doc').click();

  // Reading the text that currently sits between two known questions — the
  // only way to ask "has THIS question been answered yet" while the run is
  // still going.
  const between = (val, from, to) => {
    const a = val.indexOf(from);
    const b = val.indexOf(to);
    return a === -1 || b === -1 || b < a ? '' : val.slice(a + from.length, b);
  };

  let acceptanceRun = { finished: false, attempt: MAX_ATTEMPTS };
  let sawTopDown = false;
  let topDownDetail = '';
  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    await page.locator('#doc').fill(acceptanceBefore);
    await page.locator('#doc').click();
    await autoBtn.waitFor({ timeout: 5_000 });
    await autoBtn.click();
    const langsomtBtn = host.getByRole('button', { name: 'Langsomt', exact: true });
    await langsomtBtn.waitFor({ timeout: 5_000 });
    await langsomtBtn.click();

    // 4. The first question is being answered before the second has been
    //    touched. Sampled the moment the first gap starts growing — waiting
    //    any longer and a fast run would already have reached question two,
    //    which is the same evidence arriving too late to see.
    try {
      await page.waitForFunction(
        ({ q1, q2 }) => {
          const v = document.querySelector('#doc')?.value ?? '';
          const a = v.indexOf(q1);
          const b = v.indexOf(q2);
          return a !== -1 && b !== -1 && v.slice(a + q1.length, b).trim().length > 0;
        },
        { q1: Q1, q2: Q2 },
        { timeout: 60_000 },
      );
      const midVal = await page.locator('#doc').inputValue();
      sawTopDown = between(midVal, Q2, Q3).trim().length === 0;
      topDownDetail = `efter Q1="${between(midVal, Q1, Q2).trim().slice(0, 60)}" · efter Q2="${between(midVal, Q2, Q3).trim().slice(0, 60)}"`;
    } catch {
      topDownDetail = 'the first answer never started growing within 60s';
    }
    await page.screenshot({ path: `${shotsDir}/10-acceptance-mid-run.png` });

    await page
      .waitForFunction(
        () => {
          const t = document.querySelector('awa-sidebar')?.shadowRoot?.textContent ?? '';
          return /Færdig ✓/.test(t) || /ingen kunne besvares/.test(t) || /ikke fundet nogen spørgsmål/.test(t);
        },
        undefined,
        { timeout: 240_000 },
      )
      .catch(() => {});
    if (/Færdig ✓/.test(await shadowText())) {
      acceptanceRun = { finished: true, attempt };
      break;
    }
    if (attempt < MAX_ATTEMPTS) {
      console.log(`  … attempt ${attempt} got a transient empty-answer notice, retrying (accepted live-model variance)`);
      await host.locator('button', { hasText: 'Fortryd alle svar' }).click().catch(() => {});
      await page.waitForTimeout(400);
    }
  }

  ok('the whole scenario runs to a finished state, unattended', acceptanceRun.finished, `after ${acceptanceRun.attempt} attempt(s)`);
  ok('answers arrive top-down — the first question is answered before the second is touched', sawTopDown, topDownDetail);

  if (acceptanceRun.finished) {
    const doneVal = await page.locator('#doc').inputValue();
    const donePanel = await shadowText();
    await page.screenshot({ path: `${shotsDir}/11-acceptance-done.png` });

    const ansQ1 = between(doneVal, Q1, Q2).trim();
    const ansQ2 = between(doneVal, Q2, Q3).trim();
    const ansQ3 = between(doneVal, Q3, STATEMENT).trim();
    const answered = [ansQ1, ansQ2, ansQ3].filter(Boolean).length;
    ok(
      'at least 2 of the 3 question shapes end up with an answer beneath them',
      answered >= 2,
      `Q1="${ansQ1.slice(0, 60)}" Q2="${ansQ2.slice(0, 60)}" Q3="${ansQ3.slice(0, 60)}"`,
    );

    // D-11 proven rather than assumed: neither fact appears anywhere on the
    // page, so an answer can only contain one by having read the attachment.
    const groundedHits = [ansQ1, ansQ2].filter((a) => a.includes(SOURCE_FACT_A) || a.includes(SOURCE_FACT_B)).length;
    ok(
      'the answers are built from the attached file — a fact that exists only in it comes back out',
      groundedHits >= 1,
      `Q1="${ansQ1.slice(0, 120)}" Q2="${ansQ2.slice(0, 120)}"`,
    );

    ok(
      'the panel reports the run without naming which answers it made up',
      !/Uden grundlag/i.test(donePanel),
      donePanel.slice(0, 200),
    );

    // 6. One press puts the document back — compared in full, character for
    //    character, not by substring. A partial restore that happens to
    //    contain the original text would pass a looser check.
    await host.locator('button', { hasText: 'Fortryd alle svar' }).click();
    await page.waitForTimeout(800);
    const restored = await page.locator('#doc').inputValue();
    await page.screenshot({ path: `${shotsDir}/12-acceptance-undone.png` });
    ok(
      'one press restores the document character for character',
      restored === acceptanceBefore,
      `len ${restored.length} vs ${acceptanceBefore.length}`,
    );
  }

  await host.locator('button[title^="Fjern"]').first().click().catch(() => {});
  await page.locator('#doc').fill(DOC_TEXT);
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
