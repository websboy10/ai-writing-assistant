/**
 * A question with the answer box BENEATH it — the school-worksheet shape.
 *
 * "Beside" and "beneath" are not the same problem. The placement rule shipped
 * on 2026-09-08 presses one Tab, which moves to the next cell in DOCUMENT
 * order, and that is only the cell below in some layouts. Both shapes a real
 * worksheet uses are built here and observed, rather than reasoned about:
 *
 *   A  a one-column table: the question in the top cell, an empty cell under it.
 *      Next-in-document-order IS the cell below, so this should already work.
 *   B  the question as ordinary text, with a one-cell box under it. The question
 *      is in no cell at all, so nothing can match it to one.
 *
 * Read back through Docs' HTML export, because only that shows WHICH cell the
 * text ended up in.
 *
 * Prereqs: backend on 127.0.0.1:8787, extension built against it, profile
 * signed into Google. COSTS REAL MODEL QUOTA.
 *
 * Run: node scripts/verify-box-below.mjs [--keep]
 */
import { resolve } from 'node:path';
import { launch, newDoc, isSignedIn, reporter, shotsDir, clickIntoDoc } from './docs-harness.mjs';

const KEEP = process.argv.includes('--keep');
const TEST_EMAIL = process.env.AWA_TEST_EMAIL ?? 'modestlyeu+awatest@gmail.com';
const TEST_PASSWORD = process.env.AWA_TEST_PASSWORD ?? 'awa-test-2026-xK9';

const QUESTION = 'Hvad er hovedstaden i Danmark?';
const TRUTH = /k[øo]benhavn/i;

const LAYOUTS = {
  // A: one column, question on top, empty box under it.
  stacked: `<table border="1"><tr><td>${QUESTION}</td></tr><tr><td></td></tr></table>`,
  // B: the question is ordinary text; the box under it is a one-cell table.
  paragraph: `<p>${QUESTION}</p><table border="1"><tr><td></td></tr></table>`,
};

const r = reporter();
const ctx = await launch();
const page = ctx.pages()[0] ?? (await ctx.newPage());

const host = page.locator('awa-sidebar');
const shot = (n) => page.screenshot({ path: resolve(shotsDir, `box-${n}.png`) }).catch(() => {});
const sleep = (ms) => new Promise((s) => setTimeout(s, ms));

const ENTITIES = {
  oslash: 'ø', Oslash: 'Ø', aring: 'å', Aring: 'Å',
  aelig: 'æ', AElig: 'Æ', amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ',
};
const decode = (t) =>
  t.replace(/&#(\d+);/g, (_m, n) => String.fromCharCode(Number(n))).replace(/&([a-zA-Z]+);/g, (m, n) => ENTITIES[n] ?? m);

async function readDoc(docId) {
  const res = await ctx.request.get(`https://docs.google.com/document/d/${docId}/export?format=html`, {
    timeout: 20_000,
  });
  if (!res.ok()) throw new Error(`html export HTTP ${res.status()}`);
  const html = await res.text();
  const cells = [...html.matchAll(/<td[^>]*>(.*?)<\/td>/gis)].map((m) =>
    decode(m[1].replace(/<[^>]+>/g, '')).replace(/ /g, ' ').trim(),
  );
  const text = decode(html.replace(/<[^>]+>/g, ' ')).replace(/\s+/g, ' ').trim();
  return { cells, text };
}

async function paste(html) {
  return page.evaluate((h) => {
    const iframe = document.querySelector('iframe.docs-texteventtarget-iframe');
    if (!iframe?.contentDocument) return 'no iframe';
    const doc = iframe.contentDocument;
    const el = doc.querySelector('[contenteditable="true"], [contenteditable=""]') ?? doc.body;
    iframe.contentWindow?.focus();
    const dt = new DataTransfer();
    dt.setData('text/plain', '');
    dt.setData('text/html', h);
    el.dispatchEvent(new ClipboardEvent('paste', { clipboardData: dt, bubbles: true, cancelable: true }));
    return 'ok';
  }, html);
}

async function openAndSignIn() {
  const fab = host.locator('button[title*="ChatBot"]');
  await fab.waitFor({ timeout: 30_000 });
  if (!(await host.locator('textarea[placeholder*="Skriv til"], input[type="email"]').count())) await fab.click();
  await sleep(500);
  const email = host.locator('input[type="email"]');
  if (await email.count()) {
    await email.fill(TEST_EMAIL);
    await host.locator('input[type="password"]').fill(TEST_PASSWORD);
    await host.locator('button', { hasText: 'Log ind' }).click();
  }
  await host.locator('textarea[placeholder*="Skriv til"]').waitFor({ timeout: 30_000 });
}

async function runLayout(name, html, expectedCells) {
  const docId = await newDoc(page);
  console.log(`\n  [${name}] https://docs.google.com/document/d/${docId}/edit`);
  await sleep(3000);

  let before = { cells: [] };
  for (let i = 1; i <= 4 && before.cells.length < expectedCells; i++) {
    await clickIntoDoc(page);
    await sleep(400);
    await paste(html);
    await sleep(3500);
    before = await readDoc(docId);
  }
  if (before.cells.length < expectedCells) {
    throw new Error(`[${name}] could not build the layout; cells: ${JSON.stringify(before.cells)}`);
  }
  console.log(`  [${name}] cells before: ${JSON.stringify(before.cells)}`);

  await openAndSignIn();
  await clickIntoDoc(page);
  await sleep(500);
  await host.locator('button', { hasText: 'Besvar alle spørgsmål' }).click();
  await host.locator('button', { hasText: 'Straks' }).click();

  await host.locator('button', { hasText: 'Fortryd alle svar' }).waitFor({ timeout: 600_000 });
  await sleep(2500);

  const after = await readDoc(docId);
  console.log(`  [${name}] cells after:  ${JSON.stringify(after.cells)}`);
  await shot(name);

  const boxIndex = after.cells.length - 1; // the empty box is the last cell in both layouts
  const inBox = TRUTH.test(after.cells[boxIndex] ?? '');
  const answeredAtAll = TRUTH.test(after.text);
  const unplaced = await host.locator('text=Kunne ikke placeres').count();

  console.log(`  [${name}] answer is in the box: ${inBox}   answered anywhere: ${answeredAtAll}   reported unplaced: ${unplaced > 0}`);
  r.ok(`[${name}] the answer landed in the box beneath the question`, inBox, answeredAtAll ? 'it was written somewhere else in the document' : 'no answer anywhere');

  // Dismiss so the next layout starts clean.
  const dismiss = host.locator('button', { hasText: 'Skjul' });
  if (await dismiss.count()) await dismiss.click();
  await sleep(500);
}

try {
  if (!(await isSignedIn(page))) throw new Error('.chrome-profile-cft is not signed into Google');
  await runLayout('stacked', LAYOUTS.stacked, 2);
  await runLayout('paragraph', LAYOUTS.paragraph, 1);
} catch (err) {
  r.ok('run completed', false, String(err?.message ?? err));
  await shot('failure');
} finally {
  if (!KEEP) await ctx.close();
}

process.exit(r.summary() ? 1 : 0);
