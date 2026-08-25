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
import { launch, newDoc, readDoc, isSignedIn, reporter, shotsDir } from './docs-harness.mjs';

const KEEP = process.argv.includes('--keep');
const ONLY = process.argv.find((a) => a.startsWith('--only='))?.slice(7);
const TEST_EMAIL = 'tester@example.com';
const TEST_PASSWORD = 'awa-test-2026';

const r = reporter();
const ctx = await launch({ headless: false });
const page = ctx.pages()[0] ?? (await ctx.newPage());

const awaLog = [];
page.on('console', (m) => {
  const t = m.text();
  if (t.includes('AWA') || m.type() === 'error') awaLog.push(`[${m.type()}] ${t.slice(0, 200)}`);
});

const host = page.locator('awa-sidebar');
const shot = (name) => page.screenshot({ path: resolve(shotsDir, `docs-${name}.png`) }).catch(() => {});
const sleep = (ms) => new Promise((s) => setTimeout(s, ms));

/** Docs' canvas swallows Playwright's .click() — overlays intercept pointer
 *  events — so every click into the document goes through raw coordinates. */
// Measured 2026-08-25: the page element is `.kix-page-paginated`, NOT the
// `.kix-page` every older note names. Matching the prefix survives the next
// rename too — a stale Docs selector has already cost this project a session.
const PAGE_SEL = '[class*="kix-page"]';

/**
 * Clicks into the BOTTOM of the page, never the top. A blank Google Doc offers
 * "building block" chips (Meeting notes, Email draft…) near the first line, and
 * a raw-coordinate click on one of them silently inserts a whole email template
 * into the document — which then reads back as the extension having written it.
 * The lower half of the page is always empty space, and clicking empty space
 * puts the cursor at the end of the document, which is where insertion belongs.
 */
async function clickIntoDoc() {
  const box = await page.locator(PAGE_SEL).first().boundingBox();
  if (!box) throw new Error(`no ${PAGE_SEL} — document did not render`);
  await page.mouse.click(box.x + box.width / 2, box.y + box.height - 140);
  await sleep(300);
}

/** Leaves the document genuinely empty, whatever a stray click put in it. */
async function clearDoc(docId) {
  await clickIntoDoc();
  await page.keyboard.press('ControlOrMeta+a');
  await page.keyboard.press('Backspace');
  await sleep(1500);
  const text = await readDoc(ctx, docId);
  if (text.trim()) throw new Error(`document would not clear: ${JSON.stringify(text.slice(0, 120))}`);
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

/** Types straight into the Docs canvas as a real user would. */
async function typeIntoDoc(text) {
  await clickIntoDoc();
  await page.keyboard.type(text, { delay: 12 });
  await sleep(1200); // let Docs commit to its server before we export
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

  const names = ONLY ? [ONLY] : Object.keys(sections);
  for (const name of names) {
    if (!sections[name]) throw new Error(`unknown section: ${name}`);
    // Undo is itself under test, so sections must not depend on the previous
    // one having cleaned up — every section starts from a provably empty doc.
    if (name !== 'chat-undo') await clearDoc(docId);
    await sections[name](docId);
  }
} catch (err) {
  r.ok(`unexpected failure: ${String(err).slice(0, 300)}`, false);
  await shot('failure');
} finally {
  if (awaLog.length) {
    console.log(`\n— console (AWA + errors), last 15 of ${awaLog.length} —`);
    for (const l of awaLog.slice(-15)) console.log(`  ${l}`);
  }
  for (const id of ctxDocIds) console.log(`\ndocument left at: https://docs.google.com/document/d/${id}/edit`);
  if (!KEEP) await ctx.close();
}

process.exit(r.summary() ? 1 : 0);
