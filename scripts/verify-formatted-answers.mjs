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
 *   F  the form's own instruction line, in bold, under the title — it tells
 *      the reader how to fill in the form and must NOT be answered
 *   G  a question with bullet-point hints under it and the box under THOSE —
 *      the answer must land in the box, not between the question and its hints
 *
 * F and G were both failures on the first real form this ran on (2026-09-08).
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
const INSTRUCTION = 'Udfyld skemaet nedenfor. Svar så konkret som muligt.';
const Q_HINTS = 'Beskriv dine vigtigste resultater i år.';
const HINT_1 = 'Tænk på både faglige og personlige resultater';
const HINT_2 = 'Nævn gerne konkrete eksempler';

const WORKSHEET = `
<h1>Opgaver til i dag</h1>
<p><b>${INSTRUCTION}</b></p>
<p>${Q_LIST}</p>
<ol><li></li></ol>
<p>${Q_BOX}</p>
<table border="1"><tr><td></td></tr></table>
<table border="1"><tr><td>${Q_CELL}</td><td></td></tr></table>
<p>${Q_BOLD}</p>
<p>${Q_HINTS}</p>
<ul><li>${HINT_1}</li><li>${HINT_2}</li></ul>
<table border="1"><tr><td></td></tr></table>
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
  const seeded = () => strip(before).includes(Q_BOLD) && strip(before).includes(HINT_2) && (before.match(/<td/g) ?? []).length >= 4;
  for (let attempt = 1; attempt <= 4 && !seeded(); attempt++) {
    await clickIntoDoc(page);
    await sleep(400);
    await paste(WORKSHEET);
    await sleep(3500);
    before = await readHtml(docId);
    if (!seeded()) console.log(`    seed attempt ${attempt}: ${(before.match(/<td/g) ?? []).length} cells, bold prompt ${strip(before).includes(Q_BOLD)}`);
  }
  if (!seeded()) throw new Error(`could not seed the worksheet: ${strip(before).slice(0, 200)}`);
  r.ok('the worksheet is in the document: heading, instruction, list prompt, box below, cell beside, bold prompt, hints + box', true);

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

  // A run that never starts — the test account out of daily requests, a
  // backend error — shows in the panel within seconds; do not wait 15 minutes
  // for a button that is not coming.
  const doneButton = host.locator('button', { hasText: 'Fortryd alle svar' });
  const stopped = host.locator('text=/brugt alle|Noget gik galt|kunne ikke/i');
  await Promise.race([doneButton.waitFor({ timeout: 900_000 }), stopped.first().waitFor({ timeout: 900_000 })]);
  if (await stopped.count()) throw new Error(`the run stopped: ${(await stopped.first().textContent())?.trim()}`);
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
  for (const l of awaLines.filter((l) => /autonomous\.answers|docs\.locate|engine\.plan/.test(l))) console.log(`  ${l.slice(0, 4000)}`);
  for (const l of awaLines.filter((l) => /pressKey/.test(l))) console.log(`  ${l.slice(0, 160)}`);
  const deleteLogs = awaLines.filter((l) => /gdocs\.deleteBack/.test(l));
  for (const l of deleteLogs) console.log(`  ${l.slice(0, 200)}`);
  console.log('');

  // The answers the model gave, by the question they answer — so a typed
  // answer can be compared with what it was meant to be, letter for letter.
  // The answers log carries paragraph indices; the docs.locate log says which
  // question each index was — join the two.
  const parseLog = (l) => {
    try {
      return JSON.parse(l.slice(l.indexOf('{')));
    } catch {
      return null;
    }
  };
  const answers = parseLog(awaLines.find((l) => l.startsWith('[AWA] autonomous.answers')) ?? '')?.answers ?? [];
  const located = awaLines.filter((l) => l.startsWith('[AWA] docs.locate')).map(parseLog).filter(Boolean);
  const answerFor = (q) => {
    const at = located.find((x) => q.startsWith(x.q) || x.q.startsWith(q.slice(0, 40)));
    return answers.find((a) => a.i === at?.index)?.md ?? null;
  };
  const norm = (s) => (s ?? '').replace(/\*\*|__/g, '').replace(/[​﻿]/g, '').replace(/\s+/g, ' ').trim();

  // A — the heading is a title, not a question. F — the instruction line is
  // the form talking to its reader, not a question either. Both read the same
  // way: nothing but the next prompt between them and the first question.
  const betweenTitleAndFirstQuestion = text.slice(text.indexOf('Opgaver til i dag') + 17, text.indexOf(Q_LIST)).trim();
  r.ok('the heading was left alone — no answer written under a section title', betweenTitleAndFirstQuestion.startsWith(INSTRUCTION), JSON.stringify(betweenTitleAndFirstQuestion.slice(0, 120)));
  r.ok('the bold instruction line was not answered', betweenTitleAndFirstQuestion === INSTRUCTION, JSON.stringify(betweenTitleAndFirstQuestion.slice(0, 200)));

  // G — hints between the question and its box: the answer goes in the box.
  const afterHintsQuestion = text.slice(text.indexOf(Q_HINTS) + Q_HINTS.length, text.indexOf(HINT_1)).trim();
  r.ok('nothing was written between the hints question and its first hint', afterHintsQuestion === '', JSON.stringify(afterHintsQuestion.slice(0, 120)));
  r.ok('the hints question was answered IN the box below its hints', (cells[3] ?? '').length >= 20, `box: ${JSON.stringify(cells[3])}`);

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

  // H — "Skriv som et menneske" was on for the whole run, so every answer was
  // typed with slips and rewrites. What is in the boxes has to be, letter for
  // letter, what the model wrote: a slip left behind or a letter eaten by a
  // late correction is exactly the "drerude" / "Sren" defect of 2026-09-08.
  for (const [label, q, cell] of [['capital', Q_BOX, cells[0]], ['weekday', Q_CELL, cells[2]], ['results', Q_HINTS, cells[3]]]) {
    const want = answerFor(q);
    r.ok(`the ${label} answer arrived letter for letter as the model wrote it`, want !== null && norm(cell) === norm(want), `typed ${JSON.stringify(norm(cell))} wanted ${JSON.stringify(norm(want))}`);
  }
  const failedDeletes = deleteLogs.filter((l) => /"ok":false/.test(l)).length;
  r.ok(`every deletion was verified before anything was replaced (${deleteLogs.length} deletions)`, deleteLogs.length > 0 && failedDeletes === 0, `${failedDeletes} unverified`);
} catch (err) {
  r.ok('run completed', false, String(err?.message ?? err));
  await shot('failure');
} finally {
  if (!KEEP) await ctx.close();
}

process.exit(r.summary() ? 1 : 0);
