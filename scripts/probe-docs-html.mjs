/**
 * Does Docs hand us the document's STRUCTURE, not just its text?
 *
 * This is the whole question behind "recognise every type of formatting", and
 * it has to be answered before anything is designed on top of it.
 *
 * target.ts's synthetic-copy read asks Docs for `text/plain` and reads back
 * `text/plain`. A real copy in Docs writes BOTH text/plain and text/html into
 * the DataTransfer. If the html flavour is there for the taking, then tables,
 * headings, bold and list markers are already arriving and are simply being
 * dropped — and the answer to "how do we see the boxes" costs one extra line
 * and no permission, no API, no Google account, no network request.
 *
 * Builds its own document first, so the shapes under test are known rather
 * than whatever a real questionnaire happens to contain: a heading, bold text,
 * a bullet list, a numbered list, and — the one that matters most — a question
 * in a table with an EMPTY cell beneath it.
 *
 * Prereqs: .chrome-profile-cft signed into Google.
 *
 * Run: node scripts/probe-docs-html.mjs [--keep]
 */
import { resolve } from 'node:path';
import { launch, newDoc, isSignedIn, shotsDir, clickIntoDoc } from './docs-harness.mjs';

const KEEP = process.argv.includes('--keep');
const sleep = (ms) => new Promise((s) => setTimeout(s, ms));

const FIXTURE = `
<h1>Medarbejderudviklingssamtale 2026</h1>
<p>Udfyld skemaet nedenfor. Skriv dine svar i felterne.</p>
<h2>Del 1 — Året der gik</h2>
<p><b>Vigtigt:</b> svar så konkret som muligt.</p>
<p>1. Hvad er du mest stolt af i år?</p>
<ul><li>Overvej både faglige og personlige resultater</li><li>Nævn gerne et konkret eksempel</li></ul>
<table border="1"><tr><td>2. Hvilke områder vil du gerne udvikle?</td></tr><tr><td></td></tr></table>
<p>Beskriv dine tre vigtigste mål:</p>
<ol><li>Mål et</li><li>Mål to</li><li>Mål tre</li></ol>
<table border="1"><tr><td>Spørgsmål</td><td>Dit svar</td></tr><tr><td>3. Hvordan går samarbejdet?</td><td></td></tr></table>
`;

const ctx = await launch({ headless: false });
const page = ctx.pages()[0] ?? (await ctx.newPage());

try {
  if (!(await isSignedIn(page))) throw new Error('.chrome-profile-cft is not signed into Google');

  const docId = await newDoc(page);
  console.log(`  doc: https://docs.google.com/document/d/${docId}/edit`);
  await sleep(3000);

  // Build the fixture by pasting HTML in — the same channel the product uses.
  await clickIntoDoc(page);
  await sleep(500);
  await page.evaluate((html) => {
    const iframe = document.querySelector('iframe.docs-texteventtarget-iframe');
    const doc = iframe?.contentDocument;
    if (!doc) return;
    const el = doc.querySelector('[contenteditable="true"], [contenteditable=""]') ?? doc.body;
    iframe.contentWindow?.focus();
    const dt = new DataTransfer();
    dt.setData('text/plain', '');
    dt.setData('text/html', html);
    el.dispatchEvent(new ClipboardEvent('paste', { clipboardData: dt, bubbles: true, cancelable: true }));
  }, FIXTURE);
  await sleep(4000);
  await page.screenshot({ path: resolve(shotsDir, 'docs-html-fixture.png') }).catch(() => {});

  // THE PROBE: select all, then ask Docs to serialise the selection — and this
  // time look at every flavour it offers, not only text/plain.
  const out = await page.evaluate(() => {
    const iframe = document.querySelector('iframe.docs-texteventtarget-iframe');
    const doc = iframe?.contentDocument;
    if (!doc) return { err: 'no iframe' };
    const el = doc.querySelector('[contenteditable="true"], [contenteditable=""]') ?? doc.body;
    iframe.contentWindow?.focus();

    const key = (init) =>
      el.dispatchEvent(new KeyboardEvent('keydown', { bubbles: true, cancelable: true, ...init }));
    const mac = navigator.platform.toLowerCase().includes('mac');
    key({ key: 'a', code: 'KeyA', keyCode: 65, which: 65, ...(mac ? { metaKey: true } : { ctrlKey: true }) });

    const dt = new DataTransfer();
    dt.setData('text/plain', '');
    // Deliberately NOT pre-seeding text/html: the question is whether Docs
    // puts it there on its own.
    el.dispatchEvent(new ClipboardEvent('copy', { clipboardData: dt, bubbles: true, cancelable: true }));

    const types = [...dt.types];
    const result = { types, plain: dt.getData('text/plain'), html: dt.getData('text/html') };

    key({ key: 'ArrowRight', code: 'ArrowRight', keyCode: 39, which: 39 });
    return result;
  });

  if (out.err) throw new Error(out.err);

  console.log(`\n  FLAVOURS OFFERED: ${JSON.stringify(out.types)}`);
  console.log(`  text/plain: ${out.plain.length} chars`);
  console.log(`  text/html:  ${out.html.length} chars`);

  const has = (re) => (re.test(out.html) ? 'YES' : 'no ');
  console.log('\n  STRUCTURE VISIBLE IN THE HTML');
  console.log(`    tables          ${has(/<table/i)}`);
  console.log(`    table cells     ${has(/<td/i)}   (${(out.html.match(/<td/gi) ?? []).length} cells)`);
  console.log(`    headings        ${has(/<h[1-6]/i)}`);
  console.log(`    bold            ${has(/font-weight:\s*(bold|700)|<b[ >]|<strong/i)}`);
  console.log(`    bullet list     ${has(/<ul/i)}`);
  console.log(`    numbered list   ${has(/<ol/i)}`);
  console.log(`    empty cell      ${has(/<td[^>]*>\s*(<p[^>]*>(<span[^>]*>)?(\s|&nbsp;|<br\s*\/?>)*(<\/span>)?<\/p>)?\s*<\/td>/i)}`);

  console.log('\n  WHAT PLAIN TEXT SEES (the current input to the model)');
  console.log(out.plain.split('\n').map((l, i) => `    [${i}] ${l}`).join('\n').slice(0, 1200));

  // The question the whole feature turns on: can an EMPTY ANSWER BOX be told
  // apart from a blank line? In plain text both are "". In the html one is a
  // <td> and the other is not.
  console.log('\n  EVERY TABLE CELL, AS THE HTML SHOWS IT');
  const cells = [...out.html.matchAll(/<td[^>]*>([\s\S]*?)<\/td>/gi)];
  cells.forEach((m, i) => {
    const inner = m[1];
    const text = inner.replace(/<[^>]+>/g, '').replace(/&nbsp;/g, ' ').trim();
    console.log(`    cell ${i}  ${text ? `"${text.slice(0, 60)}"` : '*** EMPTY — an answer box ***'}`);
    if (!text) console.log(`             raw: ${inner.slice(0, 220)}`);
  });

  console.log('\n  LIST ITEMS');
  for (const m of out.html.matchAll(/<li[^>]*>([\s\S]*?)<\/li>/gi)) {
    console.log(`    "${m[1].replace(/<[^>]+>/g, '').trim().slice(0, 60)}"`);
  }

  console.log('\n  HEADINGS');
  for (const m of out.html.matchAll(/<(h[1-6])[^>]*>([\s\S]*?)<\/\1>/gi)) {
    console.log(`    <${m[1]}> "${m[2].replace(/<[^>]+>/g, '').trim().slice(0, 60)}"`);
  }
} catch (err) {
  console.log(`\n  FAILED: ${err?.message ?? err}`);
  await page.screenshot({ path: resolve(shotsDir, 'docs-html-failure.png') }).catch(() => {});
} finally {
  if (!KEEP) await ctx.close();
}
