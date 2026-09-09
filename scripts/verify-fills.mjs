/**
 * The proof that every place in a worksheet gets its own answer — the shapes
 * the operator's own form had on 2026-09-09, none of which "one question, one
 * box" could express:
 *
 *   A  a question ALREADY ANSWERED in the paragraph under it — left alone
 *   B  a table whose answer cells hold a starter and "fortsæt herunder…" —
 *      continued UNDER that text, inside the cell, the starter untouched.
 *      One cell breaks its lines with Shift+Enter (<br>, as the operator's
 *      document does), the other with a second paragraph
 *   C  a grid: verse rows × "Manden?"/"Kvinden?" columns — every empty cell
 *      filled, the header and the row labels untouched
 *   D  a four-column table with a header, an example row and two empty rows —
 *      all eight cells filled, row by row, the example row untouched
 *   E  a label with a colon ("Navn:") — a few words on the SAME line
 *   F  a question with an empty numbered list under it — a real list in it
 *   G  nothing written between a question and the table under it
 *
 * Read back through Docs' HTML export (the harness's channel, outside the
 * page), because only markup shows which cell a sentence is in. Every check is
 * on that markup, never on the extension's own report of what it did.
 *
 * Prereqs: backend on 127.0.0.1:8787, extension built against it,
 * .chrome-profile-cft signed into Google. COSTS REAL MODEL QUOTA.
 *
 * Run: node scripts/verify-fills.mjs [--slow] [--keep]
 */
import { resolve } from 'node:path';
import { writeFileSync } from 'node:fs';
import { launch, newDoc, isSignedIn, reporter, shotsDir, clickIntoDoc } from './docs-harness.mjs';

const KEEP = process.argv.includes('--keep');
const SLOW = process.argv.includes('--slow');
const TEST_EMAIL = process.env.AWA_TEST_EMAIL ?? 'modestlyeu+awatest@gmail.com';
const TEST_PASSWORD = process.env.AWA_TEST_PASSWORD ?? 'awa-test-2026-xK9';

const Q_DONE = 'Forklar kort hvor kønsstereotyper kommer fra.';
const A_DONE = 'De kommer fra gamle historier i Bibelen om Adam og Eva.';
const Q_CONTINUE = '1) Hvad kendetegner manden og kvinden? Brug myterne.';
const START_M = 'Manden skal herske';
const START_K = 'Kvinden skal begære sin mand';
const CONTINUE = 'fortsæt herunder…';
const Q_GRID = '2) Hvad fortæller versene om manden og kvinden?';
const Q_TABLE = '3) Udfyld skemaet med mindst to eksempler.';
const EXAMPLE = ['"Han skal herske over dig" 1. Mosebog 3,16', 'Manden bestemmer', 'Kvinden adlyder', 'negativ'];
const LABEL = 'Navn:';
const Q_LIST = 'Nævn to danske byer.';

const WORKSHEET = `
<h1>Religion: kønsroller</h1>
<p>${Q_DONE}</p>
<p>${A_DONE}</p>
<p><b>${Q_CONTINUE}</b></p>
<table border="1">
<tr><td>Hvad kendetegner manden?</td><td>Hvad kendetegner kvinden?</td></tr>
<tr><td><p>${START_M}<br>${CONTINUE}<br><br></p></td><td><p>${START_K}</p><p>${CONTINUE}</p></td></tr>
</table>
<p>${Q_GRID}</p>
<table border="1">
<tr><td>Bibelvers</td><td>Manden?</td><td>Kvinden?</td></tr>
<tr><td>1. Korintherbrev 11,3</td><td></td><td></td></tr>
<tr><td>Efeserbrevet 5,22-24</td><td></td><td></td></tr>
</table>
<p>${Q_TABLE}</p>
<table border="1">
<tr><td>Bibelcitat</td><td>Mand</td><td>Kvinde</td><td>Positiv eller negativ?</td></tr>
<tr>${EXAMPLE.map((c) => `<td>${c}</td>`).join('')}</tr>
<tr><td></td><td></td><td></td><td></td></tr>
<tr><td></td><td></td><td></td><td></td></tr>
</table>
<p>${LABEL}</p>
<p>${Q_LIST}</p>
<ol><li></li></ol>
`;

const r = reporter();
const ctx = await launch();
const page = ctx.pages()[0] ?? (await ctx.newPage());

const awaLines = [];
page.on('console', (msg) => {
  const t = msg.text();
  if (t.startsWith('[AWA]')) awaLines.push(t);
});
const host = page.locator('awa-sidebar');
const shot = (n) => page.screenshot({ path: resolve(shotsDir, `fills-${n}.png`) }).catch(() => {});
const sleep = (ms) => new Promise((s) => setTimeout(s, ms));

const ENTITIES = {
  oslash: 'ø', Oslash: 'Ø', aring: 'å', Aring: 'Å', aelig: 'æ', AElig: 'Æ',
  amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ', hellip: '…', ldquo: '“', rdquo: '”',
};
const decode = (t) =>
  t.replace(/&#(\d+);/g, (_m, n) => String.fromCharCode(Number(n))).replace(/&([a-zA-Z]+);/g, (m, n) => ENTITIES[n] ?? m);
const strip = (t) => decode(t.replace(/<[^>]+>/g, '')).replace(/[  ​﻿]/g, ' ').replace(/\s+/g, ' ').trim();
/** A cell's lines, as the export paragraphs them — a soft break (<br>) is a line too. */
const cellLines = (inner) =>
  [...inner.replace(/<br\s*\/?>/gi, '</p><p>').matchAll(/<p[^>]*>([\s\S]*?)<\/p>/gi)].map((m) => strip(m[1])).filter(Boolean);

async function readHtml(docId) {
  for (let i = 0; i < 6; i++) {
    const res = await ctx.request.get(`https://docs.google.com/document/d/${docId}/export?format=html`, { timeout: 20_000 });
    if (res.ok()) return await res.text();
    await sleep(2500);
  }
  throw new Error('html export failed');
}

async function paste(html) {
  return page.evaluate((h) => {
    const iframe = document.querySelector('iframe.docs-texteventtarget-iframe');
    const doc = iframe?.contentDocument;
    if (!doc) return 'no iframe';
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

try {
  if (!(await isSignedIn(page))) throw new Error('.chrome-profile-cft is not signed into Google');
  const docId = await newDoc(page);
  console.log(`  document: https://docs.google.com/document/d/${docId}/edit`);
  await sleep(3000);
  await page.evaluate(() => localStorage.setItem('awa-debug', '1'));

  let before = '';
  const seeded = () => strip(before).includes(Q_LIST) && (before.match(/<td/g) ?? []).length >= 4 + 9 + 16;
  for (let attempt = 1; attempt <= 4 && !seeded(); attempt++) {
    await clickIntoDoc(page);
    await sleep(400);
    await paste(WORKSHEET);
    await sleep(3500);
    before = await readHtml(docId);
    if (!seeded()) console.log(`    seed attempt ${attempt}: ${(before.match(/<td/g) ?? []).length} cells`);
  }
  if (!seeded()) throw new Error(`could not seed the worksheet: ${strip(before).slice(0, 200)}`);
  r.ok('the worksheet is in the document: 29 cells, three tables, a label, an empty list', true);

  await openAndSignIn();
  await clickIntoDoc(page);
  await sleep(500);
  await host.locator('button', { hasText: 'Besvar alle spørgsmål' }).click();
  await host.locator('button', { hasText: SLOW ? 'Langsomt' : 'Straks' }).click();
  r.ok(`run started (${SLOW ? 'Langsomt' : 'Straks'})`, true);
  await shot('running');

  const doneButton = host.locator('button', { hasText: 'Fortryd alle svar' });
  const stopped = host.locator('text=/brugt alle|Noget gik galt|fejlede|ingen kunne besvares|ikke fundet nogen/i');
  await Promise.race([doneButton.waitFor({ timeout: 900_000 }), stopped.first().waitFor({ timeout: 900_000 })]);
  if (await stopped.count()) throw new Error(`the run stopped: ${(await stopped.first().textContent())?.trim()}`);
  await sleep(3000);
  await shot('done');
  writeFileSync(resolve(shotsDir, 'fills-awa.log'), awaLines.join('\n'));

  const html = await readHtml(docId);
  const text = strip(html);
  const cellsRaw = [...html.matchAll(/<td[^>]*>([\s\S]*?)<\/td>/gi)].map((m) => m[1]);
  const cells = cellsRaw.map((c) => strip(c.replace(/<\/(?:p|li|div|h[1-6])>/gi, ' ')));
  const lists = [...html.matchAll(/<(ol|ul)[^>]*>([\s\S]*?)<\/\1>/gi)].map((m) => ({
    kind: m[1].toLowerCase(),
    items: [...m[2].matchAll(/<li[^>]*>([\s\S]*?)<\/li>/gi)].map((x) => strip(x[1])).filter(Boolean),
  }));
  const paras = [...html.replace(/<table[\s\S]*?<\/table>/gi, '').matchAll(/<(?:p|h[1-6])[^>]*>([\s\S]*?)<\/(?:p|h[1-6])>/gi)]
    .map((m) => strip(m[1]))
    .filter(Boolean);
  const unplaced = await host.locator('text=Kunne ikke placeres').count();

  console.log(`\n  cells after:`);
  cells.forEach((c, i) => console.log(`    [${String(i).padStart(2)}] ${JSON.stringify(c.slice(0, 110))}`));
  console.log(`  paragraphs outside tables:\n${paras.map((p) => `    | ${p.slice(0, 120)}`).join('\n')}`);
  console.log(`  lists: ${JSON.stringify(lists)}\n`);
  for (const l of awaLines.filter((l) => /autonomous\.answers|docs\.locate|docs\.plan|docs\.walk/.test(l))) console.log(`  ${l.slice(0, 600)}`);
  console.log('');

  // A — the answered question stays answered once: the paragraph after it is
  // the answer that was there, and the paragraph after THAT is the next task.
  const iDone = paras.indexOf(Q_DONE);
  r.ok('the already-answered question was left alone: its answer, then the next task', iDone >= 0 && paras[iDone + 1] === A_DONE && paras[iDone + 2] === Q_CONTINUE, JSON.stringify(paras.slice(iDone, iDone + 3)));

  // B — continued under "fortsæt herunder…", inside each cell, the starter intact.
  for (const [i, start] of [[2, START_M], [3, START_K]]) {
    const lines = cellLines(cellsRaw[i]);
    const after = lines.slice(lines.indexOf(CONTINUE) + 1).join(' ');
    r.ok(`cell ${i} was continued under "${CONTINUE}", its starter "${start}" untouched`, lines[0] === start && lines.includes(CONTINUE) && after.length >= 30, JSON.stringify(lines));
  }

  // C — the grid: header and row labels untouched, every empty cell filled.
  r.ok('grid header and row labels untouched', cells[4] === 'Bibelvers' && cells[5] === 'Manden?' && cells[6] === 'Kvinden?' && cells[7] === '1. Korintherbrev 11,3' && cells[10] === 'Efeserbrevet 5,22-24', JSON.stringify([cells[4], cells[5], cells[6], cells[7], cells[10]]));
  for (const i of [8, 9, 11, 12]) r.ok(`grid cell ${i} filled`, (cells[i] ?? '').length >= 10, JSON.stringify(cells[i]));

  // D — the table: header and example untouched, both empty rows filled, the last column a verdict.
  r.ok('table header untouched', cells[13] === 'Bibelcitat' && cells[14] === 'Mand' && cells[15] === 'Kvinde' && cells[16] === 'Positiv eller negativ?', JSON.stringify(cells.slice(13, 17)));
  r.ok('example row untouched', EXAMPLE.every((c, k) => cells[17 + k] === c), JSON.stringify(cells.slice(17, 21)));
  for (const i of [21, 22, 23, 24, 25, 26, 27, 28]) r.ok(`table cell ${i} filled`, (cells[i] ?? '').length >= 3, JSON.stringify(cells[i]));
  r.ok('the last column of both new rows is a verdict (positiv/negativ)', /positiv|negativ/i.test(cells[24] ?? '') && /positiv|negativ/i.test(cells[28] ?? ''), JSON.stringify([cells[24], cells[28]]));
  r.ok('the two new rows differ from each other and from the example', cells[21] !== cells[25] && cells[21] !== EXAMPLE[0] && cells[25] !== EXAMPLE[0]);

  // E — the label: a few words on the same line.
  const navn = paras.find((p) => p.startsWith(LABEL));
  r.ok('"Navn:" got its answer on the SAME line', !!navn && navn.length > LABEL.length + 2 && navn.length < 80, JSON.stringify(navn));

  // F — the list.
  const cityList = lists.find((l) => l.kind === 'ol' && l.items.length >= 2);
  r.ok('the two cities are a real numbered list', !!cityList, JSON.stringify(lists));

  // G — nothing between a question and its table.
  for (const q of [Q_CONTINUE, Q_GRID, Q_TABLE]) {
    const i = paras.indexOf(q);
    const next = paras[i + 1];
    r.ok(`nothing written under "${q.slice(0, 30)}…" — its answers went into the table`, i >= 0 && [Q_GRID, Q_TABLE, navn, Q_LIST].includes(next), JSON.stringify(next));
  }

  r.ok('nothing was reported as unplaced', unplaced === 0);
  r.ok('not a single asterisk in the document', !text.includes('*'));
} catch (err) {
  r.ok('run completed', false, String(err?.message ?? err));
  await shot('failure');
} finally {
  if (!KEEP) await ctx.close();
}

process.exit(r.summary() ? 1 : 0);
