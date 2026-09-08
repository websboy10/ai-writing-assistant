/**
 * Reaching a box under a question WITHOUT knowing how many blank lines sit
 * between: extend the selection down one line at a time with Shift+ArrowDown,
 * read the copy html after each step, stop when it contains a table (or a list
 * item), then collapse to the selection's end. The caret is in the box.
 *
 * The operator's test document (2026-09-08 23:52) had a blank line between
 * each question and its box. Docs' copy html leaves empty paragraphs out and
 * its text flavour renders a one-cell table as three empty lines, so neither
 * flavour says how many ArrowDowns the box is away (probe-docs-box-kinds.mjs,
 * probe-docs-text-lines.mjs). Docs' own "next table" chord is ignored when
 * synthetic (probe-docs-next-table.mjs). This is the remaining channel: a
 * selection read, which deleteBack() already trusts.
 *
 * Each case: the question found with Docs' Find (as docs-find.ts does), End,
 * then the extension loop; a letter pasted; the document read back. The
 * letter must be IN the cell / the list item, never on a blank line and never
 * past the box.
 *
 * Prereqs: .chrome-profile-cft signed into Google. No model quota.
 * Run: node scripts/probe-docs-extend-into-box.mjs
 */
import { launch, newDoc, isSignedIn, clickIntoDoc } from './docs-harness.mjs';

const sleep = (ms) => new Promise((s) => setTimeout(s, ms));
const ctx = await launch({ headless: false });
const page = ctx.pages()[0] ?? (await ctx.newPage());

try {
  if (!(await isSignedIn(page))) throw new Error('.chrome-profile-cft is not signed into Google');
  const docId = await newDoc(page);
  console.log(`  doc: https://docs.google.com/document/d/${docId}/edit\n`);
  await sleep(3000);
  await clickIntoDoc(page);
  await sleep(500);

  const out = await page.evaluate(async () => {
    const iframe = document.querySelector('iframe.docs-texteventtarget-iframe');
    const doc = iframe.contentDocument;
    const el = doc.querySelector('[contenteditable="true"], [contenteditable=""]') ?? doc.body;
    iframe.contentWindow?.focus();
    const wait = (ms) => new Promise((s) => setTimeout(s, ms));
    const mac = navigator.platform.toLowerCase().includes('mac');
    const cmd = mac ? { metaKey: true } : { ctrlKey: true };
    const key = (init) => {
      const full = { bubbles: true, cancelable: true, ...init };
      el.dispatchEvent(new KeyboardEvent('keydown', full));
      el.dispatchEvent(new KeyboardEvent('keyup', full));
    };
    const paste = (t, html) => {
      const dt = new DataTransfer();
      dt.setData('text/plain', t);
      if (html) dt.setData('text/html', html);
      el.dispatchEvent(new ClipboardEvent('paste', { clipboardData: dt, bubbles: true, cancelable: true }));
    };
    const copy = () => {
      const dt = new DataTransfer();
      dt.setData('text/plain', '');
      el.dispatchEvent(new ClipboardEvent('copy', { clipboardData: dt, bubbles: true, cancelable: true }));
      return { text: dt.getData('text/plain'), html: dt.getData('text/html') };
    };
    const findAndCollapse = async (text) => {
      key({ key: 'f', code: 'KeyF', keyCode: 70, which: 70, ...cmd });
      await wait(500);
      const input = document.querySelector('.docs-findbar-input input, input.docs-findbar-input-typebox, input[aria-label="Find in document" i], input[aria-label="Find i dokumentet" i], input[aria-label="Søg i dokument" i]');
      if (!input) return false;
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
      return true;
    };
    /** Shift+ArrowDown until the selection's html holds the wanted structure; collapse to its end. */
    const extendInto = async (pattern, max = 6, late = 0) => {
      const seen = [];
      for (let i = 1; i <= max; i++) {
        key({ key: 'ArrowDown', code: 'ArrowDown', keyCode: 40, which: 40, shiftKey: true });
        await wait(120);
        const { html, text } = copy();
        seen.push(`${i}:${pattern.test(html) ? 'HIT' : 'no'}(${JSON.stringify(text.replace(/[​﻿]/g, '').slice(0, 20))})`);
        if (pattern.test(html)) {
          // Docs takes a table into a selection whole, so the selection's end
          // is PAST the box. Collapse to the start instead — the question's
          // end — and walk down the measured number of lines unshifted: the
          // i-th line down is the one the box begins on.
          key({ key: 'ArrowLeft', code: 'ArrowLeft', keyCode: 37, which: 37 });
          await wait(150);
          key({ key: 'End', code: 'End', keyCode: 35, which: 35 });
          await wait(150);
          // An EMPTY list item has nothing to serialise, so its list shows up
          // in the html one step late (measured: D landed on the blank above).
          for (let j = 0; j < i - late; j++) {
            key({ key: 'ArrowDown', code: 'ArrowDown', keyCode: 40, which: 40 });
            await wait(120);
          }
          return { steps: i, seen };
        }
      }
      key({ key: 'ArrowLeft', code: 'ArrowLeft', keyCode: 37, which: 37 });
      return { steps: 0, seen };
    };

    const BOX = '<table border="1"><tr><td></td></tr></table>';
    const build = async (t, html) => { paste(t, html); await wait(900); };
    await build('Alpha zero blanks\n');
    await build('', BOX);
    await build('Bravo one blank\n\n');
    await build('', BOX);
    await build('Charlie two blanks\n\n\n');
    await build('', BOX);
    await build('Delta blank then list\n\n');
    await build('', '<ol><li></li></ol>');
    await build('\nEcho hint then blank then box\n');
    await build('', '<ul><li>a hint line</li></ul>');
    await build('\n');
    await build('', BOX);
    await build('Slut');
    await wait(1200);

    // What the document looks like before placement, line by line.
    key({ key: 'a', code: 'KeyA', keyCode: 65, which: 65, ...cmd });
    await wait(300);
    const before = copy().text.split('\n').map((l) => l.replace(/[​﻿]/g, ''));
    key({ key: 'ArrowRight', code: 'ArrowRight', keyCode: 39, which: 39 });
    await wait(300);

    const log = [];
    for (const [q, pattern, letter, late] of [
      ['Alpha zero blanks', /<t(able|d)\b/i, 'A', 0],
      ['Bravo one blank', /<t(able|d)\b/i, 'B', 0],
      ['Charlie two blanks', /<t(able|d)\b/i, 'C', 0],
      ['Delta blank then list', /<(ol|ul|li)\b/i, 'D', 1],
      ['a hint line', /<t(able|d)\b/i, 'E', 0],
    ]) {
      const found = await findAndCollapse(q);
      const r = found ? await extendInto(pattern, 6, late) : { steps: -1, seen: [] };
      if (r.steps > 0) paste(letter);
      await wait(500);
      log.push(`${q.padEnd(24)} find ${found}  steps ${r.steps}  ${r.seen.join(' ')}`);
    }
    await wait(1500);
    return { before, log };
  });

  console.log('  document lines before placement:');
  out.before.forEach((l, i) => console.log(`    ${String(i).padStart(2)}  ${JSON.stringify(l)}`));
  console.log('\n  placement:');
  for (const l of out.log) console.log(`    ${l}`);

  const res = await ctx.request.get(`https://docs.google.com/document/d/${docId}/export?format=html`, { timeout: 20_000 });
  const html = await res.text();
  const strip = (t) => t.replace(/<[^>]+>/g, '').replace(/&nbsp;|&#8203;/g, '').replace(/\s+/g, ' ').trim();
  const cells = [...html.matchAll(/<td[^>]*>([\s\S]*?)<\/td>/gi)].map((m) => strip(m[1]));
  const items = [...html.matchAll(/<li[^>]*>([\s\S]*?)<\/li>/gi)].map((m) => strip(m[1]));
  console.log(`\n  cells after:      ${JSON.stringify(cells)}`);
  console.log(`  list items after: ${JSON.stringify(items)}`);
  const ok = cells[0] === 'A' && cells[1] === 'B' && cells[2] === 'C' && items[0] === 'D' && cells[3] === 'E';
  console.log(`\n  every letter in its box: ${ok}   (doc ${docId})`);
} catch (err) {
  console.log(`\n  FAILED: ${err?.message ?? err}`);
} finally {
  await ctx.close();
}
