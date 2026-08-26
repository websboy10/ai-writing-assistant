/**
 * The Google Docs proof. Drives the BUILT extension in a real Chrome against a
 * REAL Google Doc, on the normal product path — cursor in the document,
 * sidebar open, press the button a user would press — and verifies every claim
 * by reading the document back through Docs' own text export.
 *
 * Why the read-back matters: Docs paints to <canvas>, so nothing in the page
 * can be inspected, and a synthetic paste reports success whether or not the
 * text arrived. Four wrong fixes were written before this channel existed.
 *
 * Each run creates a FRESH empty document, so runs never contaminate each
 * other and there is no fixture to reset.
 *
 * Prereqs: backend on 127.0.0.1:8787, extension built with
 * VITE_BACKEND_URL=http://127.0.0.1:8787, .chrome-profile-cft signed into
 * Google. Costs real model quota.
 *
 * Run: node scripts/verify-docs.mjs [--keep] [--only=<section>]
 */
import { resolve } from 'node:path';
import {
  launch,
  newDoc,
  readDoc,
  isSignedIn,
  reporter,
  shotsDir,
  clickIntoDoc as harnessClickIntoDoc,
  typeIntoDoc as harnessTypeIntoDoc,
} from './docs-harness.mjs';

const KEEP = process.argv.includes('--keep');
const ONLY = process.argv.find((a) => a.startsWith('--only='))?.slice(7);
const TEST_EMAIL = 'tester@example.com';
const TEST_PASSWORD = 'awa-test-2026';

const EXPECTED_BACKEND = process.env.VITE_BACKEND_URL ?? 'http://127.0.0.1:8787';

const r = reporter();
const ctx = await launch({ headless: false });
const page = ctx.pages()[0] ?? (await ctx.newPage());

/**
 * Which backend the extension ACTUALLY reached.
 *
 * This exists because of a full afternoon lost 2026-08-25. Chrome served a
 * CACHED service worker out of the persistent profile — the content script was
 * the current build, but its background worker was an old one still pointing at
 * production. Every autonomous run in this suite was therefore measured against
 * the deployed backend rather than the local one under test, and the suite went
 * green while proving nothing about the fixes it was supposed to prove. The
 * local server's log was empty the whole time; that was the only clue.
 *
 * A route interceptor sees service-worker traffic, which page-level listeners
 * never do. Anything reaching an unexpected host now fails the run loudly.
 * (`rm -rf .chrome-profile-cft/Default/'Service Worker'` clears the cache.)
 */
const backendHosts = new Set();
await ctx.route('**/api/**', async (route) => {
  const url = route.request().url();
  if (url.includes('/api/')) backendHosts.add(new URL(url).origin);
  await route.continue();
});

// The extension's diagnostics are opt-in per page. Without this, a run cannot
// say WHICH of the three Docs write paths it used — API, Find or paste — and
// "it passed" is then a much weaker claim than it looks, because the three
// fail in completely different ways.
await ctx.addInitScript(() => {
  try {
    localStorage.setItem('awa-debug', '1');
  } catch {}
});

const awaLog = [];
const sourcesUsed = [];
page.on('console', (m) => {
  const t = m.text();
  if (t.includes('docs.source')) sourcesUsed.push(t.replace(/^\[AWA\]\s*/, ''));
  if (t.includes('AWA') || m.type() === 'error') awaLog.push(`[${m.type()}] ${t.slice(0, 200)}`);
});
// "Failed to load resource" in the console names no URL, so a page full of them
// is unreadable. requestfailed does name it — which is what separates Docs'
// own noise from a request the extension actually needs.
//
// `chrome-extension://invalid/` is Docs' own doing, NOT ours: measured
// 2026-08-25, a Docs page produces exactly the same five of them with no
// extension loaded at all. Docs probes for extension IDs it knows about, and
// Chrome rewrites every miss to that URL. Counting them as our failures sends
// the next person hunting a bug that does not exist.
const BENIGN_FAILURE = /^chrome-extension:\/\/invalid\//;
const failedRequests = new Map();
page.on('requestfailed', (req) => {
  const url = req.url();
  if (BENIGN_FAILURE.test(url)) return;
  let host = 'unparseable';
  try {
    host = new URL(url).host;
  } catch {}
  const key = `${host} — ${req.failure()?.errorText}`;
  failedRequests.set(key, (failedRequests.get(key) ?? 0) + 1);
});

const host = page.locator('awa-sidebar');
const shot = (name) => page.screenshot({ path: resolve(shotsDir, `docs-${name}.png`) }).catch(() => {});
const sleep = (ms) => new Promise((s) => setTimeout(s, ms));

// clickIntoDoc and typeIntoDoc live in docs-harness.mjs now: the spike scripts
// need exactly the same two behaviours, and keeping a second copy here is how
// the left-edge fix would have been applied to one of them and not the other.
const clickIntoDoc = () => harnessClickIntoDoc(page);
const typeIntoDoc = (text) => harnessTypeIntoDoc(page, text);

/** Leaves the document genuinely empty, whatever a stray click put in it. */
async function clearDoc(docId) {
  for (let attempt = 1; attempt <= 3; attempt++) {
    await clickIntoDoc();
    await page.keyboard.press('ControlOrMeta+a');
    await sleep(300);
    await page.keyboard.press('Backspace');
    await sleep(1500);
    const text = await readDoc(ctx, docId);
    if (!text.trim()) return;
    // Say WHERE the click went and WHAT had focus, rather than only that the
    // text is still there — the first two attempts at this bug were spent
    // guessing between the two.
    const where = await page.evaluate(() => {
      const el = document.activeElement;
      const host = document.querySelector('awa-sidebar');
      const r = host?.getBoundingClientRect();
      return {
        focus: `${el?.tagName}.${(el?.className ?? '').toString().slice(0, 40)}`,
        panel: r ? `${Math.round(r.x)},${Math.round(r.y)} ${Math.round(r.width)}x${Math.round(r.height)}` : 'none',
      };
    });
    console.log(`    clearDoc attempt ${attempt} left ${JSON.stringify(text.trim().slice(0, 40))} · focus ${where.focus} · panel ${where.panel}`);
    await shot(`clear-fail-${attempt}`);
  }
  const text = await readDoc(ctx, docId);
  throw new Error(`document would not clear: ${JSON.stringify(text.slice(0, 120))}`);
}

async function openSidebar() {
  const fab = host.locator('button[title*="Skriveassistent"]');
  await fab.waitFor({ timeout: 30_000 });
  // Already open if the composer or the sign-in form is on screen.
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

// 4s between reads: Docs' export endpoint answers 429 if polled harder, and a
// rate-limited harness looks exactly like a broken product.
async function waitForDoc(docId, predicate, { timeout = 90_000, label = '' } = {}) {
  const started = Date.now();
  let last = '';
  while (Date.now() - started < timeout) {
    last = await readDoc(ctx, docId);
    if (predicate(last)) return last;
    await sleep(4000);
  }
  throw new Error(`timeout waiting for ${label || 'document'}; last read: ${JSON.stringify(last.slice(0, 200))}`);
}

const sections = {};
const section = (name, fn) => (sections[name] = fn);

// ─────────────────────────────────────────────────────────────────────────────

section('chat-instant', async (docId) => {
  console.log('\n— Chat → Indsæt straks (real Docs) —');
  await clickIntoDoc();
  const sentence = 'Dette er en test af indsættelse med mellemrum.';
  await host.locator('textarea[placeholder*="Skriv til"]').fill(`Svar præcis dette og intet andet: ${sentence}`);
  await host.locator('button', { hasText: '↑' }).click();
  await host.locator('text=Indsæt straks').waitFor({ timeout: 90_000 });
  await clickIntoDoc(); // put the cursor back where the answer should land
  await host.locator('button', { hasText: 'Indsæt straks' }).first().click();

  const text = await waitForDoc(docId, (t) => t.trim().length > 10, { label: 'Straks text to land' });
  r.ok('Straks: text lands in the real document', text.trim().length > 10, `got ${JSON.stringify(text.slice(0, 80))}`);
  // The whole point of the 2026-08-18 whitespace fix: no word-joining.
  const joined = /[a-zæøå][A-ZÆØÅ]/.test(text) || /\w{28,}/.test(text);
  r.ok('Straks: words are not glued together (no lost spaces)', !joined, JSON.stringify(text.slice(0, 120)));
  await shot('chat-instant');
  return text;
});

section('chat-undo', async (docId) => {
  console.log('\n— Fortryd indsættelse —');
  const before = await readDoc(ctx, docId);
  await host.locator('button', { hasText: 'Fortryd indsættelse' }).first().click();
  await sleep(3000);
  const after = await waitForDoc(docId, (t) => t.trim().length < before.trim().length, {
    timeout: 30_000,
    label: 'undo to shrink the document',
  }).catch(() => readDoc(ctx, docId));
  r.ok('Fortryd: the inserted text is removed', after.trim().length < before.trim().length, `${before.trim().length} → ${after.trim().length}`);
  r.ok('Fortryd: document returns to empty', after.trim().length === 0, JSON.stringify(after.slice(0, 80)));
  await shot('chat-undo');
});

section('chat-progressive', async (docId) => {
  console.log('\n— Chat → Indsæt langsomt (the whitespace path) —');
  await clickIntoDoc();
  const sentence = 'Hej med dig verden, dette er en rigtig test.';
  await host.locator('textarea[placeholder*="Skriv til"]').fill(`Svar præcis dette og intet andet: ${sentence}`);
  await host.locator('button', { hasText: '↑' }).click();
  await host.locator('text=Indsæt langsomt').waitFor({ timeout: 90_000 });
  await clickIntoDoc();
  await host.locator('button', { hasText: 'Indsæt langsomt' }).first().click();

  const text = await waitForDoc(docId, (t) => t.includes('.') && t.trim().split(/\s+/).length >= 6, {
    timeout: 180_000,
    label: 'Langsomt text to finish',
  });
  const words = text.trim().split(/\s+/).length;
  r.ok('Langsomt: text arrives as separate words, spaces intact', words >= 6, `${words} words: ${JSON.stringify(text.slice(0, 120))}`);
  r.ok('Langsomt: no glued words', !/[a-zæøå][A-ZÆØÅ]/.test(text) && !/\w{28,}/.test(text), JSON.stringify(text.slice(0, 120)));
  await shot('chat-progressive');
});

// ── Autonomous mode: the questions fixture ───────────────────────────────────

const Q1 = 'Hvad er status på projektet?';
const Q2 = 'Beskriv dine tre vigtigste resultater i år';
const Q3 = '2. Hvilke områder vil du gerne udvikle?';
const STATEMENT = 'Denne formular tager cirka fem minutter at udfylde.';
const QUESTIONS = [Q1, Q2, Q3];

/**
 * Types the fixture into the real document, one paragraph per line.
 *
 * Retries once: a click that fails to focus the canvas makes every keystroke
 * go nowhere, and the run then fails on an empty document as though the
 * extension were at fault. That is the harness lying about the product.
 */
async function writeQuestions(docId) {
  for (let attempt = 1; attempt <= 2; attempt++) {
    await clickIntoDoc();
    // insertText per line, Enter between them. `keyboard.type` does not survive
    // this canvas at any delay — measured on a real document, ten characters
    // arrived as one — and a single Enter keypress does, which is why the two
    // are mixed rather than one call with newlines in it.
    const lines = [Q1, Q2, Q3, STATEMENT];
    for (let i = 0; i < lines.length; i++) {
      await page.keyboard.insertText(lines[i]);
      if (i < lines.length - 1) await page.keyboard.press('Enter');
      await sleep(150);
    }
    await sleep(2500);
    const text = await readDoc(ctx, docId);
    if (QUESTIONS.every((q) => text.includes(q))) return text;
    if (attempt === 2) {
      await shot('write-questions-failed');
      const where = await page.evaluate(() => {
        const el = document.activeElement;
        const box = document.querySelector('[class*="kix-page"]')?.getBoundingClientRect();
        return {
          focus: `${el?.tagName}.${(el?.className ?? '').toString().slice(0, 50)}`,
          page: box ? `${Math.round(box.x)},${Math.round(box.y)} ${Math.round(box.width)}x${Math.round(box.height)}` : 'none',
          view: `${innerWidth}x${innerHeight}`,
        };
      });
      console.log(`    focus ${where.focus} · page box ${where.page} · viewport ${where.view}`);
      throw new Error(`the questions never reached the document; last read: ${JSON.stringify(text.slice(0, 160))}`);
    }
    console.log('  … the document stayed empty — the click missed the canvas, retrying');
    await clearDoc(docId).catch(() => {});
  }
}

/** Waits for the run transport to reach a terminal state, and says which. */
async function waitForRun(timeout) {
  try {
    await page.waitForFunction(
      () => {
        const t = document.querySelector('awa-sidebar')?.shadowRoot?.textContent ?? '';
        return /Færdig ✓/.test(t) || /Stoppet/.test(t) || /Fejl/.test(t) || /ingen kunne besvares/.test(t) || /ikke fundet nogen spørgsmål/.test(t);
      },
      undefined,
      { timeout },
    );
  } catch {
    // A timeout used to throw straight past the report below, so the one thing
    // that would explain it — what the panel actually says — was the one thing
    // never printed. The panel is still on screen; read it.
    // NOT shadowRoot.textContent: the injected Tailwind sheet is ~24KB of CSS
    // living in a <style> inside the same root, so it fills the whole excerpt
    // and the interface text never appears. Read the rendered panel instead.
    const stuck = await page.evaluate(() => {
      const root = document.querySelector('awa-sidebar')?.shadowRoot;
      const panel = root?.querySelector('aside') ?? root?.querySelector('.awa-root');
      return panel?.textContent ?? '(panel not rendered)';
    });
    console.log(`  … run never reached a terminal state. Panel says: ${JSON.stringify(stuck.replace(/\s+/g, ' ').trim().slice(0, 700))}`);
    return 'timeout';
  }
  const t = await page.evaluate(() => document.querySelector('awa-sidebar')?.shadowRoot?.textContent ?? '');
  if (!/Færdig ✓/.test(t)) {
    // Whatever went wrong, the panel already said it in words. Printing them
    // beats another round of inferring from a one-word verdict.
    console.log(`  … panel after the run: ${JSON.stringify(t.replace(/\s+/g, ' ').trim().slice(0, 700))}`);
  }
  if (/Færdig ✓/.test(t)) return 'done';
  // Carry the panel's own words out with the verdict — "no-answers" alone
  // sends the next person digging through logs for a sentence the UI already
  // had on screen.
  const said = t.match(/\d+ spørgsmål blev fundet[^.]*\./)?.[0] ?? t.match(/Der blev ikke fundet[^.]*\./)?.[0] ?? '';
  if (/ingen kunne besvares/.test(t)) return `no-answers${said ? ` — panel: "${said}"` : ''}`;
  if (/ikke fundet nogen spørgsmål/.test(t)) return `no-questions${said ? ` — panel: "${said}"` : ''}`;
  if (/Fejl/.test(t)) return 'error';
  return 'stopped';
}

/**
 * Every question keeps its text, and gains a non-empty line beneath it that is
 * NOT simply the next fixture line.
 *
 * The fixture's paragraphs are consecutive, so "the line after Q1" is Q2 until
 * something is written between them. Counting that as an answer made these
 * assertions pass on a run that wrote nothing at all — caught 2026-08-25 when
 * a run reported "ingen kunne besvares" and every check still went green.
 */
const FIXTURE_LINES = new Set([Q1, Q2, Q3, STATEMENT]);

function answersUnderQuestions(text) {
  const lines = text.split('\n');
  return QUESTIONS.map((q) => {
    const i = lines.findIndex((l) => l.trim() === q);
    const below = i === -1 ? '' : (lines[i + 1] ?? '').trim();
    return { q, found: i !== -1, answer: FIXTURE_LINES.has(below) ? '' : below };
  });
}

section('mark-selection', async (docId) => {
  console.log('\n— Marking text in a real document —');
  await writeQuestions(docId);
  await clickIntoDoc();
  await page.keyboard.press('ControlOrMeta+a');
  await sleep(2500); // the selection poll runs once a second

  const bar = host.locator('text=Du har markeret tekst');
  const appeared = await bar
    .waitFor({ timeout: 15_000 })
    .then(() => true)
    .catch(() => false);
  r.ok('marking text shows the selection bar', appeared);
  if (appeared) {
    const label = await host.locator('p', { hasText: 'Du har markeret tekst' }).first().textContent();
    const claimed = Number(label?.match(/([\d.]+)\s*tegn/)?.[1]?.replace(/\./g, '') ?? 0);
    r.ok('the character count is real, not a placeholder', claimed > 100, `label was ${JSON.stringify(label)}`);
    r.ok('both selection actions are offered', (await host.getByRole('button', { name: 'Besvar markeringen', exact: true }).count()) > 0 && (await host.getByRole('button', { name: 'Brug som kontekst', exact: true }).count()) > 0);
  }
  await shot('mark-selection');

  // Deselect: the bar must go away again, or it invites action on nothing.
  await page.keyboard.press('ArrowRight');
  await sleep(2500);
  r.ok('deselecting hides the selection bar', (await host.locator('text=Du har markeret tekst').count()) === 0);
});

section('answer-selection', async (docId) => {
  console.log('\n— Besvar markeringen (Straks) on a real document —');
  const before = await writeQuestions(docId);
  await clickIntoDoc();
  await page.keyboard.press('ControlOrMeta+a');
  await sleep(2500);

  await host.getByRole('button', { name: 'Besvar markeringen', exact: true }).click();
  await host.getByRole('button', { name: 'Straks', exact: true }).click();
  const outcome = await waitForRun(180_000);
  r.ok('the marked-selection run finishes', outcome === 'done', outcome);

  const after = await waitForDoc(docId, (t) => t.length > before.length + 20, {
    timeout: 90_000,
    label: 'answers to land under the marked questions',
  }).catch(() => readDoc(ctx, docId));

  const rows = answersUnderQuestions(after);
  r.ok('every question survives the run verbatim', rows.every((x) => x.found), JSON.stringify(rows.map((x) => x.found)));
  r.ok(
    'every question has a non-empty answer directly beneath it',
    rows.every((x) => x.answer.length > 0),
    JSON.stringify(rows.map((x) => `${x.q.slice(0, 18)}→${x.answer.slice(0, 24) || '(none)'}`)),
  );
  r.ok('no answer was written under the plain statement', !(after.split('\n')[after.split('\n').findIndex((l) => l.trim() === STATEMENT) + 1] ?? '').trim());
  await shot('answer-selection');
});

section('answer-document', async (docId) => {
  console.log('\n— Besvar alle spørgsmål (Straks), whole document —');
  const before = await writeQuestions(docId);
  await clickIntoDoc();
  await sleep(500);

  await host.getByRole('button', { name: 'Besvar alle spørgsmål', exact: true }).click();
  await host.getByRole('button', { name: 'Straks', exact: true }).click();
  const outcome = await waitForRun(180_000);
  r.ok('the whole-document run finishes', outcome === 'done', outcome);

  const after = await waitForDoc(docId, (t) => t.length > before.length + 20, {
    timeout: 90_000,
    label: 'answers to land in the document',
  }).catch(() => readDoc(ctx, docId));

  const rows = answersUnderQuestions(after);
  r.ok('every question survives verbatim', rows.every((x) => x.found));
  r.ok(
    'every question has a non-empty answer beneath it',
    rows.every((x) => x.answer.length > 0),
    JSON.stringify(rows.map((x) => `${x.q.slice(0, 18)}→${x.answer.slice(0, 24) || '(none)'}`)),
  );
  r.ok('no blank line was written as an answer', !/\n\n\n/.test(after), JSON.stringify(after.slice(0, 160)));
  const order = QUESTIONS.map((q) => after.indexOf(q));
  r.ok('questions stay in document order', order.every((p, i) => p !== -1 && (i === 0 || p > order[i - 1])), JSON.stringify(order));
  await shot('answer-document');

  console.log('\n— Fortryd alle svar —');
  await host.getByRole('button', { name: '↩ Fortryd alle svar', exact: true }).click();
  const restored = await waitForDoc(docId, (t) => t.trim() === before.trim(), {
    timeout: 90_000,
    label: 'the document to be restored byte-for-byte',
  }).catch(() => readDoc(ctx, docId));
  r.ok(
    'undo restores the document byte-for-byte',
    restored.trim() === before.trim(),
    `before ${before.trim().length} chars, after ${restored.trim().length}`,
  );
  await shot('answer-document-undone');
});

section('answer-document-slow', async (docId) => {
  console.log('\n— Besvar alle spørgsmål (Langsomt) — the least-tested path —');
  const before = await writeQuestions(docId);
  await clickIntoDoc();
  await sleep(500);

  await host.getByRole('button', { name: 'Besvar alle spørgsmål', exact: true }).click();
  await host.getByRole('button', { name: 'Langsomt', exact: true }).click();
  const outcome = await waitForRun(300_000);
  r.ok('the Langsomt whole-document run finishes', outcome === 'done', outcome);

  const after = await waitForDoc(docId, (t) => t.length > before.length + 20, {
    timeout: 120_000,
    label: 'Langsomt answers to land',
  }).catch(() => readDoc(ctx, docId));

  const rows = answersUnderQuestions(after);
  // On failure the whole document is the evidence. Docs cannot be read back
  // from the page, so without printing it here the only thing left is a
  // guess about what went wrong — which is how four wrong fixes got written.
  const dump = `\n--- document as written ---\n${after}\n---------------------------`;
  r.ok(
    'Langsomt: every question survives verbatim',
    rows.every((x) => x.found),
    `missing: ${JSON.stringify(rows.filter((x) => !x.found).map((x) => x.q))}${dump}`,
  );
  r.ok(
    'Langsomt: every question has a non-empty answer beneath it',
    rows.every((x) => x.answer.length > 0),
    `${JSON.stringify(rows.map((x) => `${x.q.slice(0, 18)}→${x.answer.slice(0, 24) || '(none)'}`))}${
      rows.every((x) => x.answer.length > 0) ? '' : dump
    }`,
  );
  r.ok('Langsomt: no glued words in the answers', !rows.some((x) => /[a-zæøå][A-ZÆØÅ]/.test(x.answer) || /\w{28,}/.test(x.answer)));
  await shot('answer-document-slow');
});

// ─────────────────────────────────────────────────────────────────────────────

const ctxDocIds = [];
try {
  if (!(await isSignedIn(page))) {
    r.ok('Google sign-in in the test profile', false, 'profile is signed out — run: node scripts/probe-docs.mjs');
    throw new Error('not signed in');
  }
  r.ok('Google sign-in in the test profile', true);

  const docId = await newDoc(page);
  ctxDocIds.push(docId);
  console.log(`\ndocument: https://docs.google.com/document/d/${docId}/edit`);

  await openSidebar();
  await signInIfNeeded();
  r.ok('sidebar opens and is signed in on docs.google.com', true);

  // Opening the panel already fetched usage and billing status, so by now the
  // extension has named its backend. Check before spending a single model call
  // on sections whose results would otherwise mean nothing.
  const wrongHosts = [...backendHosts].filter((h) => h !== EXPECTED_BACKEND);
  if (
    !r.ok(
      `the extension is talking to ${EXPECTED_BACKEND}`,
      backendHosts.size > 0 && wrongHosts.length === 0,
      backendHosts.size === 0
        ? 'no backend call seen at all — the panel may not have loaded'
        : `reached ${JSON.stringify([...backendHosts])}; a cached service worker in .chrome-profile-cft is the usual cause — rm -rf ".chrome-profile-cft/Default/Service Worker"`,
    )
  ) {
    throw new Error('refusing to run: results would describe the wrong backend');
  }

  const names = ONLY ? [ONLY] : Object.keys(sections);
  let current = docId;
  for (const name of names) {
    if (!sections[name]) throw new Error(`unknown section: ${name}`);
    // Undo is itself under test, so it has to keep whatever chat-instant left
    // in the document. Every other section gets a BRAND NEW document.
    //
    // It used to reuse one document and empty it with select-all plus
    // Backspace. That worked until it did not: after a Langsomt insertion the
    // select-all stopped selecting — Backspace still deleted, one character per
    // attempt, so the document was never empty and the suite blamed the
    // product. Whatever the extension leaves behind that eats a select-all, a
    // fresh document cannot have it, and "provably empty" stops being a claim
    // the harness has to prove at all.
    if (name !== 'chat-undo') {
      current = await newDoc(page);
      ctxDocIds.push(current);
      await openSidebar();
      await signInIfNeeded();
    }
    await sections[name](current);
  }
} catch (err) {
  r.ok(`unexpected failure: ${String(err).slice(0, 300)}`, false);
  await shot('failure');
} finally {
  if (awaLog.length) {
    console.log(`\n— console (AWA + errors), last 15 of ${awaLog.length} —`);
    for (const l of awaLog.slice(-15)) console.log(`  ${l}`);
  }
  if (failedRequests.size) {
    console.log('\n— failed requests, by host —');
    for (const [key, n] of [...failedRequests].sort((a, b) => b[1] - a[1])) console.log(`  ${String(n).padStart(3)}×  ${key}`);
  }
  console.log('\n— which Docs write path each run took —');
  if (!sourcesUsed.length) console.log('  (none recorded — no autonomous run in this selection)');
  for (const s of sourcesUsed) console.log(`  ${s}`);
  for (const id of ctxDocIds) console.log(`\ndocument left at: https://docs.google.com/document/d/${id}/edit`);
  if (!KEEP) await ctx.close();
}

process.exit(r.summary() ? 1 : 0);
