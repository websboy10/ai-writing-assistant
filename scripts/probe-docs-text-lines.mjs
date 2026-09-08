/**
 * How does Docs' copy text/plain render blank paragraphs, empty cells and
 * table edges — can they be told apart?
 *
 * The copy html leaves empty paragraphs out (probe-docs-box-kinds.mjs), so
 * only the text flavour knows how many blank lines sit between a question
 * and its box, which is how many ArrowDowns reach the box. The text flavour
 * shows an empty cell as "" too — unless Docs pads it with something (it
 * pads empty cells with zero-width characters in its html export).
 *
 * Every line printed as its character codes, so an invisible character is
 * visible.
 *
 * Prereqs: .chrome-profile-cft signed into Google. No model quota.
 * Run: node scripts/probe-docs-text-lines.mjs
 */
import { launch, newDoc, isSignedIn, clickIntoDoc } from './docs-harness.mjs';

const sleep = (ms) => new Promise((s) => setTimeout(s, ms));
const ctx = await launch({ headless: false });
const page = ctx.pages()[0] ?? (await ctx.newPage());

const HTML = `
<p>Q1 blank before</p>
<p></p>
<table border="1"><tr><td></td></tr></table>
<p>Q2 blank before and after</p>
<p></p>
<table border="1"><tr><td></td></tr></table>
<p></p>
<p>Q3 two columns</p>
<table border="1"><tr><td>left cell</td><td></td></tr><tr><td></td><td>right two</td></tr></table>
<p>Q4 blank then empty numbered</p>
<p></p>
<ol><li></li></ol>
<p>Q5 blank then filled bullet</p>
<p></p>
<ul><li>hint here</li></ul>
<p>Slut</p>
`;

try {
  if (!(await isSignedIn(page))) throw new Error('.chrome-profile-cft is not signed into Google');
  const docId = await newDoc(page);
  console.log(`  doc: https://docs.google.com/document/d/${docId}/edit\n`);
  await sleep(3000);
  await clickIntoDoc(page);
  await sleep(500);

  const out = await page.evaluate(async (h) => {
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
    // Built with real keystrokes, the way a person makes a form: a question,
    // Enter for each blank line, then the box. An HTML paste drops empty
    // paragraphs before a table (measured), so it cannot build this shape.
    const paste = (t, html) => {
      const dt = new DataTransfer();
      dt.setData('text/plain', t);
      if (html) dt.setData('text/html', html);
      el.dispatchEvent(new ClipboardEvent('paste', { clipboardData: dt, bubbles: true, cancelable: true }));
    };
    const enter = async () => { key({ key: 'Enter', code: 'Enter', keyCode: 13, which: 13 }); await wait(250); };
    const BOX = '<table border="1"><tr><td></td></tr></table>';
    paste('Q1 zero blanks'); await enter();
    paste('', BOX); await wait(800); await enter();
    paste('Q2 one blank'); await enter(); await enter();
    paste('', BOX); await wait(800); await enter();
    paste('Q3 two blanks'); await enter(); await enter(); await enter();
    paste('', BOX); await wait(800); await enter(); await enter();
    paste('Q4 blank after previous table, and one blank then empty numbered'); await enter(); await enter();
    paste('', '<ol><li></li></ol>'); await wait(800); await enter();
    paste('Slut'); await wait(1500);
    key({ key: 'a', code: 'KeyA', keyCode: 65, which: 65, ...cmd });
    await wait(300);
    const c = new DataTransfer();
    c.setData('text/plain', '');
    el.dispatchEvent(new ClipboardEvent('copy', { clipboardData: c, bubbles: true, cancelable: true }));
    key({ key: 'ArrowRight', code: 'ArrowRight', keyCode: 39, which: 39 });
    return { text: c.getData('text/plain'), html: c.getData('text/html') };
  }, HTML);

  const show = (s) => [...s].map((ch) => (ch.charCodeAt(0) >= 32 && ch.charCodeAt(0) < 127 ? ch : `‹${ch.charCodeAt(0).toString(16)}›`)).join('');
  console.log('  text/plain, line by line (control and invisible characters shown as ‹hex›):');
  out.text.split('\n').forEach((l, i) => console.log(`    ${String(i).padStart(2)}  "${show(l)}"`));
  const blocks = [...out.html.matchAll(/<(p|table|ol|ul|li|td)\b[^>]*>([\s\S]*?)(?=<(?:p|table|ol|ul|li|td|\/td|\/li|\/p)\b)/gi)].map((m) => {
    const inner = m[2].replace(/<[^>]+>/g, '').replace(/&nbsp;|&#8203;/g, '').trim();
    return m[1].toLowerCase() + (m[1].toLowerCase() === 'p' ? `(${inner ? inner.slice(0, 12) : 'EMPTY'})` : '');
  });
  console.log(`\n  html block order: ${blocks.join(' ')}`);
} catch (err) {
  console.log(`\n  FAILED: ${err?.message ?? err}`);
} finally {
  await ctx.close();
}
