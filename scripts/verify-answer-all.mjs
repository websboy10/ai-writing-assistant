/**
 * The proof for "Besvar alle spørgsmål", restored 2026-09-08 WITHOUT the Google
 * Docs API.
 *
 * This is the run that matters. The feature's answering half was always sound —
 * measured 20/20 in f5cb0f8 — and what was cut was the mechanism that PLACED
 * the answers, because it used the Docs API and its `auth/documents` scope
 * forced OAuth verification. Placement now drives Docs' OWN Ctrl+F find bar,
 * which needs no permission at all. So the single claim under test here is:
 *
 *   does each answer land under ITS OWN question, in a real document,
 *   with no Google permission granted?
 *
 * It is answered by reading the document back through Docs' own text export —
 * never by trusting the extension, which cannot see its own writes (Docs paints
 * to <canvas>, and a synthetic paste reports success either way).
 *
 * Prereqs: backend on 127.0.0.1:8787 (the route is not deployed yet), extension
 * built with VITE_BACKEND_URL=http://127.0.0.1:8787, .chrome-profile-cft signed
 * into Google. COSTS REAL MODEL QUOTA — every run is a live OpenRouter call.
 *
 * Run: node scripts/verify-answer-all.mjs [--keep] [--slow]
 */
import { resolve } from 'node:path';
import { launch, newDoc, readDoc, isSignedIn, reporter, shotsDir, clickIntoDoc, typeIntoDoc } from './docs-harness.mjs';

const KEEP = process.argv.includes('--keep');
const SLOW = process.argv.includes('--slow');
const TEST_EMAIL = process.env.AWA_TEST_EMAIL ?? 'modestlyeu+awatest@gmail.com';
const TEST_PASSWORD = process.env.AWA_TEST_PASSWORD ?? 'awa-test-2026-xK9';
const EXPECTED_BACKEND = new URL(process.env.AWA_BACKEND ?? 'http://127.0.0.1:8787').host;

/**
 * Three questions with unmistakable, checkable answers — the same three the
 * original Docs-API run was verified against in 2b0804e, so a regression is
 * comparable against that record rather than against a fresh invention.
 *
 * They are deliberately distinct from one another: an answer landing under the
 * WRONG question is the failure this feature must never have, and identical
 * questions would hide exactly that.
 */
const QUESTIONS = [
  { text: 'Hvad er hovedstaden i Danmark?', expect: /k[øo]benhavn/i },
  { text: 'Hvor mange dage har en uge?', expect: /\b7\b|syv/i },
  { text: 'Hvilken farve får man af blå og gul?', expect: /gr[øo]n/i },
];

const r = reporter();
const ctx = await launch({ headless: false });
const page = ctx.pages()[0] ?? (await ctx.newPage());

const host = page.locator('awa-sidebar');
const shot = (name) => page.screenshot({ path: resolve(shotsDir, `answerall-${name}.png`) }).catch(() => {});
const sleep = (ms) => new Promise((s) => setTimeout(s, ms));

const backendHosts = new Set();
await ctx.route('**/api/**', async (route) => {
  try {
    backendHosts.add(new URL(route.request().url()).host);
  } catch {}
  await route.continue();
});

async function openSidebar() {
  const fab = host.locator('button[title*="ChatBot"]');
  await fab.waitFor({ timeout: 30_000 });
  const open = await host.locator('textarea[placeholder*="Skriv til"], input[type="email"]').count();
  if (!open) await fab.click();
  await sleep(500);
}

async function signInIfNeeded() {
  const email = host.locator('input[type="email"]');
  if (await email.count()) {
    await email.fill(TEST_EMAIL);
    await host.locator('input[type="password"]').fill(TEST_PASSWORD);
    await host.locator('button', { hasText: 'Log ind' }).click();
  }
  await host.locator('textarea[placeholder*="Skriv til"]').waitFor({ timeout: 30_000 });
}

/** 4s between reads: Docs' export answers 429 if polled harder. */
async function waitForDoc(docId, predicate, { timeout = 240_000, label = '' } = {}) {
  const started = Date.now();
  let last = '';
  while (Date.now() - started < timeout) {
    last = await readDoc(ctx, docId);
    if (predicate(last)) return last;
    await sleep(4000);
  }
  throw new Error(`timeout waiting for ${label || 'document'}; last read: ${JSON.stringify(last.slice(0, 300))}`);
}

// ─────────────────────────────────────────────────────────────────────────────

try {
  if (!(await isSignedIn(page))) throw new Error('.chrome-profile-cft is not signed into Google');

  const docId = await newDoc(page);
  console.log(`  document: https://docs.google.com/document/d/${docId}/edit`);
  await sleep(3000);

  // Seeding the document is the flakiest step in the whole run, and it is pure
  // SETUP — a failure here says nothing about the feature, but reads exactly
  // like the feature being broken. Measured on this machine: the same call that
  // worked on one run put NOTHING in the document on the next, with the caret
  // sitting on line 1 and the export returning "". Docs simply was not ready
  // for synthetic input yet. So: type, confirm through the export, and retry
  // the whole thing rather than trusting one attempt.
  const wanted = QUESTIONS.map((q) => q.text).join('\n');
  let before = '';
  for (let attempt = 1; attempt <= 4 && !QUESTIONS.every((q) => before.includes(q.text)); attempt++) {
    await typeIntoDoc(page, wanted);
    for (let i = 0; i < 5; i++) {
      before = await readDoc(ctx, docId);
      if (QUESTIONS.every((q) => before.includes(q.text))) break;
      await sleep(3000);
    }
    if (!QUESTIONS.every((q) => before.includes(q.text))) {
      console.log(`    seed attempt ${attempt} left ${JSON.stringify(before.slice(0, 60))}`);
      await sleep(2000);
    }
  }
  if (!QUESTIONS.every((q) => before.includes(q.text))) {
    throw new Error(`could not seed the document with the questions; last read: ${JSON.stringify(before.slice(0, 200))}`);
  }
  r.ok('three questions are in the document', true);

  await openSidebar();
  await signInIfNeeded();
  r.ok('panel open and signed in', true);

  // The run answers whatever field was last clicked in, so the caret must be
  // in the document — not in the panel that was just used to sign in.
  await clickIntoDoc(page);
  await sleep(500);

  await host.locator('button', { hasText: 'Besvar alle spørgsmål' }).click();
  await host.locator('button', { hasText: SLOW ? 'Langsomt' : 'Straks' }).click();
  r.ok(`run started (${SLOW ? 'Langsomt' : 'Straks'})`, true);
  await shot('running');

  // Wait for the RUN to finish, not for the text to look finished.
  //
  // Reading as soon as the last answer's keyword appears catches Langsomt
  // mid-keystroke: a real run was captured here ending "Blå og gul giver grøn,
  // nej vent, det giv" — the "Skriv som et menneske" self-correction, still
  // being typed. Asserting on that is asserting on a half-written document.
  // "Fortryd alle svar" only appears once the run has left the writing state,
  // so its arrival is the honest completion signal.
  const undo = host.locator('button', { hasText: 'Fortryd alle svar' });
  await undo.waitFor({ timeout: 600_000 });
  await sleep(1500); // let Docs commit the final keystrokes to its export
  r.ok('the run reached a finished state', true);

  const after = await waitForDoc(docId, (t) => QUESTIONS[2].expect.test(t), { label: "the last question's answer" });

  console.log(`\n  document read back:\n${after.trim().split('\n').map((l) => `    | ${l}`).join('\n')}\n`);

  // ── every answer present ──────────────────────────────────────────────────
  for (const q of QUESTIONS) {
    if (!q.expect.test(after)) throw new Error(`no answer matching ${q.expect} for: ${q.text}`);
  }
  r.ok('every question was answered', true);

  // ── and, the claim that actually matters, each under ITS OWN question ─────
  // An answer that exists somewhere in the document proves nothing: the bug
  // this feature must never have is an answer landing under the wrong
  // question, which a mere "contains" check passes happily.
  for (const q of QUESTIONS) {
    const qAt = after.indexOf(q.text);
    const aAt = after.search(q.expect);
    if (aAt < qAt) throw new Error(`the answer sits ABOVE its question: ${q.text}`);
    const between = after.slice(qAt + q.text.length, aAt);
    const otherQuestion = QUESTIONS.find((o) => o !== q && between.includes(o.text));
    if (otherQuestion) {
      throw new Error(`answer to "${q.text}" landed below "${otherQuestion.text}" instead of its own question`);
    }
  }
  r.ok('each answer sits directly under its own question', true);

  // ── the questions themselves survived ─────────────────────────────────────
  // 2b0804e's third bug ate characters out of the questions ("Hvor mange dage h
  // en uge?"). Nothing may edit what the user wrote.
  for (const q of QUESTIONS) {
    if (!after.includes(q.text)) throw new Error(`the run damaged the user's own question: ${q.text}`);
  }
  r.ok("the user's own questions are untouched", true);

  await shot('answered');

  // ── Fortryd alle svar restores the document exactly ───────────────────────
  // 2b0804e's third bug ate characters out of the questions on undo. Comparing
  // the whole document against what it held before the run is the only check
  // that would have caught it.
  await undo.click();
  const restored = await waitForDoc(docId, (t) => !QUESTIONS[2].expect.test(t), {
    timeout: 180_000,
    label: 'the document to be restored',
  });
  const norm = (s) => s.replace(/\s+/g, ' ').trim();
  if (norm(restored) !== norm(before)) {
    throw new Error(
      `undo did not restore the document.\n  before: ${JSON.stringify(norm(before))}\n  after:  ${JSON.stringify(norm(restored))}`,
    );
  }
  r.ok('Fortryd alle svar restored the document exactly', true);

  if (!backendHosts.has(EXPECTED_BACKEND)) {
    throw new Error(`extension never reached ${EXPECTED_BACKEND}; it reached: ${[...backendHosts].join(', ') || 'nothing'}`);
  }
  r.ok(`backend actually reached: ${[...backendHosts].join(', ')}`, true);

  await shot('done');
} catch (err) {
  r.ok('run completed', false, String(err?.message ?? err));
  await shot('failure');
} finally {
  if (!KEEP) await ctx.close();
}

process.exit(r.summary() ? 1 : 0);
