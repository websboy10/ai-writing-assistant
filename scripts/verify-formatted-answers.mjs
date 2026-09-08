/**
 * Phase 8's proof: a real worksheet, answered SLOWLY, with real formatting,
 * in the right boxes — through nothing but the document on screen.
 *
 * One document carries every shape a school or HR worksheet uses, so a single
 * run answers the whole requirement rather than one convenient case:
 *
 *   A  a heading (a section title — must NOT be answered)
 *   B  a question that asks for three things, with an empty numbered list
 *      under it — the answer must arrive as a REAL numbered list
 *   C  a question as ordinary text with a one-cell box drawn under it — the
 *      answer must land IN the box
 *   D  a two-column table, question beside an empty cell — the answer must
 *      land in the cell beside it
 *   E  a question asking for a bold label — bold must survive slow typing
 *
 * Read back through Docs' HTML export (the harness's channel, outside the
 * page), because only markup shows whether a list is a list and which cell a
 * sentence is in. Every check is on that markup, never on the extension's
 * own report of what it did — Docs paints to canvas and the extension cannot
 * see its own writes.
 *
 * Prereqs: backend on 127.0.0.1:8787, extension built against it,
 * .chrome-profile-cft signed into Google. COSTS REAL MODEL QUOTA.
 *
 * Run: node scripts/verify-formatted-answers.mjs [--keep]
 */
import { resolve } from 'node:path';
import { launch, newDoc, isSignedIn, reporter, shotsDir, clickIntoDoc } from './docs-harness.mjs';

const KEEP = process.argv.includes('--keep');
const TEST_EMAIL = process.env.AWA_TEST_EMAIL ?? 'modestlyeu+awatest@gmail.com';
const TEST_PASSWORD = process.env.AWA_TEST_PASSWORD ?? 'awa-test-2026-xK9';

const Q_LIST = 'Nævn tre danske byer, en pr. linje.';
const Q_BOX = 'Hvad er hovedstaden i Danmark?';
const Q_CELL = 'Hvor mange dage har en uge?';
const Q_BOLD = 'Skriv ordet Vigtigt med fed skrift, efterfulgt af en kort sætning om vejret.';

const WORKSHEET = `
<h1>Opgaver til i dag</h1>
<p>${Q_LIST}</p>
<ol><li></li></ol>
<p>${Q_BOX}</p>
<table border="1"><tr><td></td></tr></table>
<table border="1"><tr><td>${Q_CELL}</td><td></td></tr></table>
<p>${Q_BOLD}</p>
`;

const r = reporter();
const ctx = await launch({ headless: false });
const page = ctx.pages()[0] ?? (await ctx.newPage());

// The adapter's own diagnostics (insertion/debug.ts): the one channel that
// says which keys were pressed, since Docs cannot be asked what it received.
const awaLines = [];
page.on('console', (msg) => {
  const t = msg.text();
  if (t.startsWith('[AWA]')) awaLines.push(t);
});
const host = page.locator('awa-sidebar');
const shot = (n) => page.screenshot({ path: resolve(shotsDir, `formatted-${n}.png`) }).catch(() => {});
const sleep = (ms) => new Promise((s) => setTimeout(s, ms));

const ENTITIES = {
  oslash: 'ø', Oslash: 'Ø', aring: 'å', Aring: 'Å', aelig: 'æ', AElig: 'Æ',
  amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ',
};
const decode = (t) =>
  t.replace(/&#(\d+);/g, (_m, n) => String.fromCharCode(Number(n))).replace(/&([a-zA-Z]+);/g, (m, n) => ENTITIES[n] ?? m);
const strip = (t) => decode(t.replace(/<[^>]+>/g, '')).replace(/ /g, ' ').replace(/\s+/g, ' ').trim();

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

  // The export writes æøå as entities, so the check runs on the decoded text.
  let before = '';
  const seeded = () => strip(before).includes(Q_BOLD) && (before.match(/<td/g) ?? []).length >= 3;
  for (let attempt = 1; attempt <= 4 && !seeded(); attempt++) {
    await clickIntoDoc(page);
    await sleep(400);
    await paste(WORKSHEET);
    await sleep(3500);
    before = await readHtml(docId);
    if (!seeded()) console.log(`    seed attempt ${attempt}: ${(before.match(/<td/g) ?? []).length} cells, bold prompt ${strip(before).includes(Q_BOLD)}`);
  }
  if (!seeded()) throw new Error(`could not seed the worksheet: ${strip(before).slice(0, 200)}`);
  r.ok('the worksheet is in the document: heading, list prompt, box below, cell beside, bold prompt', true);

  await openAndSignIn();
  await clickIntoDoc(page);
  await sleep(500);
  // Human typing on, so slips and rewrites are exercised INSIDE formatted runs.
  const human = host.locator('input[type="checkbox"]').first();
  if (!(await human.isChecked())) await human.check();
  await host.locator('button', { hasText: 'Besvar alle spørgsmål' }).click();
  await host.locator('button', { hasText: 'Langsomt' }).click();
  r.ok('run started — Langsomt, Skriv som et menneske on', true);
  await shot('running');

  await host.locator('button', { hasText: 'Fortryd alle svar' }).waitFor({ timeout: 900_000 });
  await sleep(2500);
  await shot('done');

  const html = await readHtml(docId);
  const text = strip(html);
  const cells = [...html.matchAll(/<td[^>]*>([\s\S]*?)<\/td>/gi)].map((m) => strip(m[1]));
  const lists = [...html.matchAll(/<(ol|ul)[^>]*>([\s\S]*?)<\/\1>/gi)].map((m) => ({
    kind: m[1].toLowerCase(),
    items: [...m[2].matchAll(/<li[^>]*>([\s\S]*?)<\/li>/gi)].map((x) => strip(x[1])).filter(Boolean),
  }));
  // The export expresses bold as CLASSES (".c1{font-weight:700}"), not inline
  // styles — the synthetic copy the product reads uses inline styles, and the
  // first version of this check looked for those and saw no bold at all while
  // the document had it. Resolve the classes from the export's own stylesheet.
  const boldClasses = [...html.matchAll(/\.(c\d+)\{[^}]*font-weight:\s*(?:700|bold)/g)].map((m) => m[1]);
  const boldRuns = [...html.matchAll(/<span class="([^"]*)"[^>]*>([\s\S]*?)<\/span>/gi)]
    .filter((m) => m[1].split(/\s+/).some((c) => boldClasses.includes(c)))
    .map((m) => strip(m[2]));
  const q4 = html.indexOf('Vigtigt');
  const q4para = html.slice(html.lastIndexOf('<p', q4 + 200), html.indexOf('</p>', q4 + 200) + 4);
  const unplaced = await host.locator('text=Kunne ikke placeres').count();

  console.log(`\n  cells after:  ${JSON.stringify(cells)}`);
  console.log(`  lists after:  ${JSON.stringify(lists)}`);
  console.log(`  bold classes: ${JSON.stringify(boldClasses)}   bold runs: ${JSON.stringify(boldRuns.filter((b) => !/Opgaver til i dag/.test(b)))}`);
  console.log(`  around Q4:    ${strip(html.slice(Math.max(0, q4 - 100), q4 + 260)).replace(/\n/g, ' ⏎ ')}`);
  console.log(`  Q4 raw:       ${q4para.slice(0, 500)}`);
  console.log(`  document:\n${text.split('\n').map((l) => `    | ${l.slice(0, 160)}`).join('\n')}\n`);
  for (const l of awaLines.filter((l) => /autonomous\.answers|docs\.locate|engine\.plan/.test(l))) console.log(`  ${l.slice(0, 400)}`);
  for (const l of awaLines.filter((l) => /pressKey/.test(l))) console.log(`  ${l.slice(0, 160)}`);
  console.log('');

  // A — the heading is a title, not a question.
  const headingAnswered = /Opgaver til i dag[^<]{0,4}<\/span><\/h1>[\s\S]{0,400}?<p[^>]*>(?:(?!Nævn tre)[^<]|<span[^>]*>)*?[a-zæøå]{12,}/i.test(html);
  r.ok('the heading was left alone — no answer written under a section title', !headingAnswered);

  // B — three cities, as a REAL numbered list.
  const cityList = lists.find((l) => l.kind === 'ol' && l.items.length >= 3);
  r.ok('the "three cities" answer is a real numbered list with at least three items', !!cityList, JSON.stringify(lists));
  r.ok('no literal "1. " or "- " typed as characters at a line start', !/(?:^|>)\s*(?:\d+\.|-)\s+[A-ZÆØÅ]/m.test(text.replace(/Nævn tre danske byer, en pr\. linje\./, '')));

  // C — the box below the plain-text question.
  r.ok('the capital landed IN the box drawn below its question', /k[øo]benhavn/i.test(cells[0] ?? ''), `box: ${JSON.stringify(cells[0])}`);

  // D — the cell beside.
  r.ok('the weekday answer landed in the cell beside its question', /\b7\b|syv/i.test(cells[2] ?? ''), `cell: ${JSON.stringify(cells[2])}`);
  r.ok('the question cell itself was not written into', (cells[1] ?? '') === Q_CELL, JSON.stringify(cells[1]));

  // E — bold survived slow typing, and no asterisks reached the document.
  r.ok('"Vigtigt" arrived in real bold', boldRuns.some((b) => /^vigtigt/i.test(b)), JSON.stringify(boldRuns));
  r.ok('not a single asterisk in the document', !text.includes('*'));

  r.ok('nothing was reported as unplaced', unplaced === 0);
} catch (err) {
  r.ok('run completed', false, String(err?.message ?? err));
  await shot('failure');
} finally {
  if (!KEEP) await ctx.close();
}

process.exit(r.summary() ? 1 : 0);
