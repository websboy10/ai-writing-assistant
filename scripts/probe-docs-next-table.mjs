/**
 * Can a synthetic chord walk the caret INTO the next table or list, past any
 * blank lines, the way Docs' own "Move to next table/list" shortcuts do?
 *
 * The operator's test document (2026-09-08 23:52): a question, a blank line,
 * a one-cell box. Docs' copy html leaves empty paragraphs out entirely
 * (scripts/probe-docs-box-kinds.mjs), so the structure read saw the box
 * right under the question, and End + ArrowDown — one visual line — landed on
 * the invisible blank line. The answer went there and the box stayed empty.
 *
 * Docs' navigation shortcuts: Ctrl+Cmd+N then Ctrl+Cmd+T = next table,
 * Ctrl+Cmd+N then Ctrl+Cmd+L = next list (Ctrl+Alt on Windows). Measured
 * here from the end of a question line with 0, 1 and 2 blank lines before the
 * box, then a letter pasted and the document read back: the letter must be
 * IN the cell / the list item.
 *
 * Prereqs: .chrome-profile-cft signed into Google. No model quota.
 * Run: node scripts/probe-docs-next-table.mjs
 */
import { launch, newDoc, isSignedIn, clickIntoDoc, readDoc } from './docs-harness.mjs';

const sleep = (ms) => new Promise((s) => setTimeout(s, ms));
const ctx = await launch({ headless: false });
const page = ctx.pages()[0] ?? (await ctx.newPage());

const HTML = `
<p>Alpha zero blanks</p>
<table border="1"><tr><td></td></tr></table>
<p>Bravo one blank</p>
<p></p>
<table border="1"><tr><td></td></tr></table>
<p>Charlie two blanks</p>
<p></p>
<p></p>
<table border="1"><tr><td></td></tr></table>
<p>Delta blank then list</p>
<p></p>
<ol><li></li></ol>
<p>Echo beside</p>
<table border="1"><tr><td>Echo question cell</td><td></td></tr></table>
<p>Slut</p>
`;

try {
  if (!(await isSignedIn(page))) throw new Error('.chrome-profile-cft is not signed into Google');
  const docId = await newDoc(page);
  console.log(`  doc: https://docs.google.com/document/d/${docId}/edit\n`);
  await sleep(3000);
  await clickIntoDoc(page);
  await sleep(500);

  const steps = await page.evaluate(async (h) => {
    const iframe = document.querySelector('iframe.docs-texteventtarget-iframe');
    const doc = iframe.contentDocument;
    const el = doc.querySelector('[contenteditable="true"], [contenteditable=""]') ?? doc.body;
    iframe.contentWindow?.focus();
    const wait = (ms) => new Promise((s) => setTimeout(s, ms));
    const mac = navigator.platform.toLowerCase().includes('mac');
    const cmd = mac ? { metaKey: true } : { ctrlKey: true };
    const nav = mac ? { metaKey: true, ctrlKey: true } : { ctrlKey: true, altKey: true };
    const key = (init) => {
      const full = { bubbles: true, cancelable: true, ...init };
      el.dispatchEvent(new KeyboardEvent('keydown', full));
      el.dispatchEvent(new KeyboardEvent('keyup', full));
    };
    const paste = (t) => {
      const dt = new DataTransfer();
      dt.setData('text/plain', t);
      el.dispatchEvent(new ClipboardEvent('paste', { clipboardData: dt, bubbles: true, cancelable: true }));
    };
    const pasteHtml = (html) => {
      const dt = new DataTransfer();
      dt.setData('text/plain', '');
      dt.setData('text/html', html);
      el.dispatchEvent(new ClipboardEvent('paste', { clipboardData: dt, bubbles: true, cancelable: true }));
    };
    // Docs' Find bar as the cursor positioner, as docs-find.ts does it.
    const findAndCollapse = async (text) => {
      key({ key: 'f', code: 'KeyF', keyCode: 70, which: 70, ...cmd });
      await wait(500);
      const input = document.querySelector('.docs-findbar-input input, input.docs-findbar-input-typebox, input[aria-label="Find in document" i], input[aria-label="Find i dokumentet" i], input[aria-label="Søg i dokument" i]');
      if (!input) return 'no find input';
      input.focus();
      input.value = text;
      input.dispatchEvent(new Event('input', { bubbles: true }));
      await wait(600);
      input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', code: 'Escape', keyCode: 27, which: 27, bubbles: true }));
      await wait(400);
      key({ key: 'ArrowRight', code: 'ArrowRight', keyCode: 39, which: 39 });
      await wait(150);
      key({ key: 'End', code: 'End', keyCode: 35, which: 35 });
      await wait(150);
      return 'ok';
    };
    const nextTable = async () => {
      key({ key: 'n', code: 'KeyN', keyCode: 78, which: 78, ...nav });
      await wait(150);
      key({ key: 't', code: 'KeyT', keyCode: 84, which: 84, ...nav });
      await wait(400);
    };
    const nextList = async () => {
      key({ key: 'n', code: 'KeyN', keyCode: 78, which: 78, ...nav });
      await wait(150);
      key({ key: 'l', code: 'KeyL', keyCode: 76, which: 76, ...nav });
      await wait(400);
    };

    pasteHtml(h);
    await wait(3000);
    const log = [];
    for (const [q, action, letter] of [
      ['Alpha zero blanks', 'table', 'A'],
      ['Bravo one blank', 'table', 'B'],
      ['Charlie two blanks', 'table', 'C'],
      ['Delta blank then list', 'list', 'D'],
      ['Echo beside', 'table', 'E'],
    ]) {
      const f = await findAndCollapse(q);
      if (action === 'table') await nextTable();
      else await nextList();
      paste(letter);
      await wait(400);
      log.push(`${q}: find ${f}, ${action} chord, pasted ${letter}`);
    }
    await wait(1500);
    return log;
  }, HTML);
  for (const l of steps) console.log(`  ${l}`);

  const html = await readDoc(ctx, docId);
  const strip = (t) => t.replace(/<[^>]+>/g, '').replace(/&nbsp;|&#8203;/g, '').replace(/\s+/g, ' ').trim();
  const cells = [...html.matchAll(/<td[^>]*>([\s\S]*?)<\/td>/gi)].map((m) => strip(m[1]));
  const items = [...html.matchAll(/<li[^>]*>([\s\S]*?)<\/li>/gi)].map((m) => strip(m[1]));
  const paras = [...html.matchAll(/<p[^>]*>([\s\S]*?)<\/p>/gi)].map((m) => strip(m[1])).filter(Boolean);
  console.log(`\n  cells:      ${JSON.stringify(cells)}`);
  console.log(`  list items: ${JSON.stringify(items)}`);
  console.log(`  paragraphs: ${JSON.stringify(paras)}`);
  console.log(`\n  A in cell 0: ${cells[0] === 'A'}   B in cell 1: ${cells[1] === 'B'}   C in cell 2: ${cells[2] === 'C'}   D in list item: ${items[0] === 'D'}   E in cell beside: ${cells[4] === 'E'}`);
} catch (err) {
  console.log(`\n  FAILED: ${err?.message ?? err}`);
} finally {
  await ctx.close();
}
