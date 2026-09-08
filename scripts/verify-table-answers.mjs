/**
 * The proof that an answer lands in the TABLE's answer cell.
 *
 * A questionnaire in Docs is almost always a table: the question in one cell,
 * an empty cell beside it. Before this, Find put the answer immediately after
 * the question text — inside the question's own cell. The claim under test is
 * that it now lands in the empty cell next door, and that a cell which already
 * holds the user's text is never written into.
 *
 * Verified through Docs' own HTML export, because that is the only channel that
 * shows which CELL text sits in. The plain-text export flattens a table into
 * tab-separated lines and cannot tell "in the answer cell" from "appended to
 * the question".
 *
 * Prereqs: backend on 127.0.0.1:8787, extension built with
 * VITE_BACKEND_URL=http://127.0.0.1:8787, .chrome-profile-cft signed into
 * Google. COSTS REAL MODEL QUOTA.
 *
 * Run: node scripts/verify-table-answers.mjs [--keep]
 */
import { resolve } from 'node:path';
import { launch, newDoc, readDoc, isSignedIn, reporter, shotsDir, clickIntoDoc } from './docs-harness.mjs';

const KEEP = process.argv.includes('--keep');
const TEST_EMAIL = process.env.AWA_TEST_EMAIL ?? 'modestlyeu+awatest@gmail.com';
const TEST_PASSWORD = process.env.AWA_TEST_PASSWORD ?? 'awa-test-2026-xK9';

/**
 * Row three is the one that matters most. Its answer cell is ALREADY FILLED, so
 * the run must refuse it and report it rather than overwrite what the user
 * wrote — the failure mode this whole placement rule exists to prevent.
 */
const ROWS = [
  { q: 'Hvad er hovedstaden i Danmark?', expect: /k[øo]benhavn/i, filled: '' },
  { q: 'Hvilken farve får man af blå og gul?', expect: /gr[øo]n/i, filled: '' },
  { q: 'Hvor mange dage har en uge?', expect: /\b7\b|syv/i, filled: 'MIT EGET SVAR' },
];

const r = reporter();
const ctx = await launch();
const page = ctx.pages()[0] ?? (await ctx.newPage());

const host = page.locator('awa-sidebar');
const shot = (n) => page.screenshot({ path: resolve(shotsDir, `table-${n}.png`) }).catch(() => {});
const sleep = (ms) => new Promise((s) => setTimeout(s, ms));

async function readCells(docId) {
  const res = await ctx.request.get(`https://docs.google.com/document/d/${docId}/export?format=html`, {
    timeout: 20_000,
  });
  if (!res.ok()) throw new Error(`html export HTTP ${res.status()}`);
  const html = await res.text();
  // Docs' HTML export writes every non-ASCII letter as a named entity, so a
  // cell holding "Kobenhavn" with an o-slash comes back as "K&oslash;benhavn".
  // Asserting against that raw form failed a run in which the feature had
  // worked perfectly - decode first, or the test is about the export format
  // rather than about which cell the answer landed in.
  const ENTITIES = {
    oslash: '\u00f8', Oslash: '\u00d8', aring: '\u00e5', Aring: '\u00c5',
    aelig: '\u00e6', AElig: '\u00c6', amp: '&', lt: '<', gt: '>',
    quot: '"', apos: "'", nbsp: ' ',
  };
  const decode = (t) =>
    t
      .replace(/&#(\d+);/g, (_m, n) => String.fromCharCode(Number(n)))
      .replace(/&([a-zA-Z]+);/g, (m, name) => ENTITIES[name] ?? m);
  return [...html.matchAll(/<td[^>]*>(.*?)<\/td>/gis)].map((m) =>
    decode(m[1].replace(/<[^>]+>/g, '')).replace(/\u00a0/g, ' ').trim(),
  );
}

/** Build the table by pasting HTML — Docs turns it into a real table. */
async function seedTable(page) {
  const rows = ROWS.map((row) => `<tr><td>${row.q}</td><td>${row.filled}</td></tr>`).join('');
  return page.evaluate((html) => {
    const iframe = document.querySelector('iframe.docs-texteventtarget-iframe');
    if (!iframe?.contentDocument) return 'no iframe';
    const doc = iframe.contentDocument;
    const el = doc.querySelector('[contenteditable="true"], [contenteditable=""]') ?? doc.body;
    iframe.contentWindow?.focus();
    const dt = new DataTransfer();
    dt.setData('text/plain', '');
    dt.setData('text/html', html);
    el.dispatchEvent(new ClipboardEvent('paste', { clipboardData: dt, bubbles: true, cancelable: true }));
    return 'ok';
  }, `<table border="1">${rows}</table>`);
}

async function openSidebar() {
  const fab = host.locator('button[title*="ChatBot"]');
  await fab.waitFor({ timeout: 30_000 });
  if (!(await host.locator('textarea[placeholder*="Skriv til"], input[type="email"]').count())) await fab.click();
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

try {
  if (!(await isSignedIn(page))) throw new Error('.chrome-profile-cft is not signed into Google');

  const docId = await newDoc(page);
  console.log(`  document: https://docs.google.com/document/d/${docId}/edit`);
  await sleep(3000);
  await clickIntoDoc(page);
  await sleep(500);

  let cells = [];
  for (let attempt = 1; attempt <= 4 && cells.length < 6; attempt++) {
    await clickIntoDoc(page);
    await sleep(400);
    await seedTable(page);
    await sleep(3500);
    cells = await readCells(docId);
    if (cells.length < 6) console.log(`    seed attempt ${attempt} gave ${cells.length} cells`);
  }
  if (cells.length < 6) throw new Error(`could not build the 3x2 table; cells: ${JSON.stringify(cells)}`);
  console.log(`  cells before: ${JSON.stringify(cells)}`);
  r.ok('a real 3-row table exists, with one answer cell already filled', true);

  await openSidebar();
  await signInIfNeeded();
  await clickIntoDoc(page);
  await sleep(500);

  await host.locator('button', { hasText: 'Besvar alle spørgsmål' }).click();
  await host.locator('button', { hasText: 'Straks' }).click();
  r.ok('run started', true);

  const undo = host.locator('button', { hasText: 'Fortryd alle svar' });
  await undo.waitFor({ timeout: 600_000 });
  await sleep(2500);
  r.ok('the run reached a finished state', true);

  const after = await readCells(docId);
  console.log(`  cells after:  ${JSON.stringify(after)}`);
  await shot('answered');

  // ── the two empty answer cells now hold their own answers ─────────────────
  for (const [i, row] of ROWS.entries()) {
    if (row.filled) continue;
    const answerCell = after[i * 2 + 1] ?? '';
    if (!row.expect.test(answerCell)) {
      throw new Error(`answer cell for "${row.q}" holds ${JSON.stringify(answerCell)} — expected ${row.expect}`);
    }
  }
  r.ok('each answer landed in the empty cell beside its own question', true);

  // ── the question cells were not written into ──────────────────────────────
  for (const [i, row] of ROWS.entries()) {
    const questionCell = after[i * 2] ?? '';
    if (questionCell.trim() !== row.q) {
      throw new Error(`the question cell changed: ${JSON.stringify(questionCell)} — expected ${JSON.stringify(row.q)}`);
    }
  }
  r.ok('every question cell is untouched', true);

  // ── the cell that already held the user's text was NOT overwritten ────────
  const guarded = ROWS.findIndex((row) => row.filled);
  const guardedCell = after[guarded * 2 + 1] ?? '';
  if (guardedCell.trim() !== ROWS[guarded].filled) {
    throw new Error(`a cell holding the user's own text was overwritten: ${JSON.stringify(guardedCell)}`);
  }
  r.ok("a cell already holding the user's text was refused, not overwritten", true);

  // ── and the refusal was REPORTED, not silent ──────────────────────────────
  const unplaced = await host.locator('text=Kunne ikke placeres').count();
  r.ok('the refused question is reported under "Kunne ikke placeres"', unplaced > 0, 'no such panel section');
} catch (err) {
  r.ok('run completed', false, String(err?.message ?? err));
  await shot('failure');
} finally {
  if (!KEEP) await ctx.close();
}

process.exit(r.summary() ? 1 : 0);
