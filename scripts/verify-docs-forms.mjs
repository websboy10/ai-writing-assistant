/**
 * "Besvar alle" on a Google Doc that is answered INSIDE its lines: blanks,
 * tick boxes, lettered options, "Sandt / Falsk".
 *
 * scripts/verify-answer-all-forms.mjs proves this in a textarea and a
 * contenteditable. Docs has no ranges to write over, so the blank is found,
 * marked, checked and taken out by keystrokes (docs-source.ts placeInLine) —
 * a different mechanism, proven here on a real document, undo included.
 *
 * Prereqs: backend on 127.0.0.1:8787, extension built against it, profile
 * signed into Google. COSTS REAL MODEL QUOTA (one run).
 *
 * Run: node scripts/verify-docs-forms.mjs
 */
import { resolve } from 'node:path';
import { launch, newDoc, isSignedIn, readDoc, reporter, shotsDir, clickIntoDoc } from './docs-harness.mjs';

const TEST_EMAIL = process.env.AWA_TEST_EMAIL ?? 'modestlyeu+awatest@gmail.com';
const TEST_PASSWORD = process.env.AWA_TEST_PASSWORD ?? 'awa-test-2026-xK9';
const LINES = [
  'Udfyld de tomme felter.',
  'Danmarks hovedstad er __________.',
  'En uge har ____ dage.',
  'Hvilke af disse er frugter? Sæt kryds.',
  '☐ Æble',
  '☐ Gulerod',
  '☐ Banan',
  'Hvad er hovedstaden i Sverige?',
  'a) Oslo',
  'b) Stockholm',
  'c) Helsinki',
  'Sandt eller falsk?',
  'Hvaler er fisk. Sandt / Falsk',
  'Forklar kort, hvad fotosyntese er.',
];

const r = reporter();
const ctx = await launch();
const page = ctx.pages()[0] ?? (await ctx.newPage());
const host = page.locator('awa-sidebar');
const sleep = (ms) => new Promise((s) => setTimeout(s, ms));
const awaLines = [];
page.on('console', (m) => m.text().startsWith('[AWA]') && awaLines.push(m.text()));
const lines = async (docId) => (await readDoc(ctx, docId)).split('\n').map((l) => l.replace(/[​﻿]/g, '').replace(/ /g, ' ').trim()).filter(Boolean);

try {
  if (!(await isSignedIn(page))) throw new Error('profile is not signed into Google');
  const docId = await newDoc(page);
  console.log(`  https://docs.google.com/document/d/${docId}/edit`);
  await sleep(3000);
  let before = [];
  for (let i = 0; i < 4 && before.length < LINES.length; i++) {
    await clickIntoDoc(page);
    await page.evaluate((h) => {
      const iframe = document.querySelector('iframe.docs-texteventtarget-iframe');
      const doc = iframe.contentDocument;
      const el = doc.querySelector('[contenteditable="true"], [contenteditable=""]') ?? doc.body;
      iframe.contentWindow?.focus();
      const dt = new DataTransfer();
      dt.setData('text/plain', '');
      dt.setData('text/html', h);
      el.dispatchEvent(new ClipboardEvent('paste', { clipboardData: dt, bubbles: true, cancelable: true }));
    }, LINES.map((l) => `<p>${l}</p>`).join(''));
    await sleep(3500);
    before = await lines(docId);
  }
  r.ok('the form is in the document', before.join('\n') === LINES.join('\n'), JSON.stringify(before.slice(0, 4)));

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

  await clickIntoDoc(page);
  await host.locator('button', { hasText: 'Besvar alle spørgsmål' }).click();
  await host.locator('button', { hasText: 'Straks' }).first().click();
  await host.locator('button', { hasText: 'Fortryd alle svar' }).waitFor({ timeout: 600_000 });
  await sleep(3000);
  await page.screenshot({ path: resolve(shotsDir, 'docs-forms-done.png') }).catch(() => {});
  r.ok('nothing was left unplaced', !(await host.locator('text=Kunne ikke placeres').count()));

  const after = await lines(docId);
  const has = (name, re) => r.ok(name, after.some((l) => re.test(l)), JSON.stringify(after));
  has('the blank in a sentence was written into', /^Danmarks hovedstad er k[øo]benhavn\.$/i);
  has('a second blank, mid-sentence', /^En uge har (7|syv) dage\.$/i);
  has('the right boxes are ticked: Æble', /^☒ Æble$/);
  has('the right boxes are ticked: Banan', /^☒ Banan$/);
  has('the wrong box is left empty', /^☐ Gulerod$/);
  has('the right option is marked', /^b\) Stockholm ✓$/);
  has('the wrong options are untouched', /^a\) Oslo$/);
  has('"Sandt / Falsk" is settled on the line', /^Hvaler er fisk\. Falsk$/);
  const photo = after.indexOf('Forklar kort, hvad fotosyntese er.');
  r.ok('an open question still gets its answer on the line below', photo >= 0 && /lys|sol/i.test(after[photo + 1] ?? ''), JSON.stringify(after.slice(photo)));

  await host.locator('button', { hasText: 'Fortryd alle svar' }).first().click();
  await sleep(5000);
  const undone = await lines(docId);
  r.ok('undo puts back exactly what was there', undone.join('\n') === LINES.join('\n'), JSON.stringify(undone));
} catch (err) {
  r.ok('run completed', false, String(err?.message ?? err));
  await page.screenshot({ path: resolve(shotsDir, 'docs-forms-failure.png') }).catch(() => {});
} finally {
  if (r.results.some((x) => !x.cond)) console.log(awaLines.filter((l) => /autonomous\.answers|docs\.(locate|inline)|engine\.fail/.test(l)).join('\n').slice(0, 4000));
  await ctx.close();
}
process.exit(r.summary() ? 1 : 0);
