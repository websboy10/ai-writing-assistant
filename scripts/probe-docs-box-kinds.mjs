/**
 * What does Docs' copy html say about the boxes a real worksheet draws?
 *
 * The operator's own test document (2026-09-08 23:52) had an answer box under
 * each question that the run did not use: the answer went on the line under
 * the question and the box stayed empty. The box was not recognised, and the
 * two shapes that would do that are (a) a blank line between the question and
 * a one-cell table, (b) a bordered PARAGRAPH — Format › Paragraph styles ›
 * Borders and shading — which looks exactly like a one-cell table and is not
 * one.
 *
 * Both are built here, plus a cell holding only a non-breaking space, and the
 * copy html (docs-structure.ts's input) is printed for each, so the parser
 * and the placement rules can be written against what Docs really sends.
 *
 * Prereqs: .chrome-profile-cft signed into Google. No model quota.
 * Run: node scripts/probe-docs-box-kinds.mjs
 */
import { launch, newDoc, isSignedIn, clickIntoDoc } from './docs-harness.mjs';

const sleep = (ms) => new Promise((s) => setTimeout(s, ms));
const ctx = await launch({ headless: false });
const page = ctx.pages()[0] ?? (await ctx.newPage());

const HTML = `
<p>Q1 blank line then table?</p>
<p></p>
<table border="1"><tr><td></td></tr></table>
<p>Q2 bordered paragraph?</p>
<p><br></p>
<p>Q3 cell with nbsp?</p>
<table border="1"><tr><td>&nbsp;</td></tr></table>
<p>Q4 two blank lines then table?</p>
<p></p>
<p></p>
<table border="1"><tr><td></td></tr></table>
<p>Slut</p>
`;

try {
  if (!(await isSignedIn(page))) throw new Error('.chrome-profile-cft is not signed into Google');
  const docId = await newDoc(page);
  console.log(`  doc: https://docs.google.com/document/d/${docId}/edit\n`);
  await sleep(3000);
  await clickIntoDoc(page);
  await sleep(500);

  // A REAL paragraph border through Docs' own menu on the empty line under Q2,
  // driven while the page script waits at __awaProbeGo.
  const outPromise = page.evaluate(async (h) => {
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
    const dt = new DataTransfer();
    dt.setData('text/plain', '');
    dt.setData('text/html', h);
    el.dispatchEvent(new ClipboardEvent('paste', { clipboardData: dt, bubbles: true, cancelable: true }));
    await wait(3000);
    // Caret onto the empty line after Q2 (doc start, then down: Q1, blank, cell, Q2, blank).
    key({ key: 'ArrowUp', code: 'ArrowUp', keyCode: 38, which: 38, ...cmd });
    await wait(200);
    for (let i = 0; i < 4; i++) { key({ key: 'ArrowDown', code: 'ArrowDown', keyCode: 40, which: 40 }); await wait(120); }
    window.__awaProbeReady = true;
    await new Promise((s) => { window.__awaProbeGo = s; });
    key({ key: 'a', code: 'KeyA', keyCode: 65, which: 65, ...cmd });
    await wait(300);
    const c = new DataTransfer();
    c.setData('text/plain', '');
    el.dispatchEvent(new ClipboardEvent('copy', { clipboardData: c, bubbles: true, cancelable: true }));
    key({ key: 'ArrowRight', code: 'ArrowRight', keyCode: 39, which: 39 });
    return { text: c.getData('text/plain'), html: c.getData('text/html') };
  }, HTML);
  await page.waitForFunction(() => window.__awaProbeReady, null, { timeout: 20_000 });
  let bordered = 'not attempted';
  try {
    await page.click('#docs-format-menu');
    await page.getByRole('menuitem', { name: /Afsnitstypografier|Paragraph styles/ }).hover();
    await sleep(600);
    await page.getByRole('menuitem', { name: /Kanter og skygge|Borders and shading/ }).click();
    await sleep(1000);
    // The dialog: border width select, then Apply.
    const dialog = page.locator('.modal-dialog:visible, [role="dialog"]:visible').last();
    const widthBox = dialog.locator('[role="listbox"], .goog-menu-button').first();
    await widthBox.click();
    await sleep(300);
    await page.getByRole('option', { name: /1 pkt|1 pt|1pt/ }).first().click();
    await sleep(300);
    await dialog.getByRole('button', { name: /Anvend|Apply/ }).click();
    await sleep(800);
    bordered = 'applied via menu';
  } catch (err) {
    bordered = `menu route failed: ${String(err?.message ?? err).split('\n')[0].slice(0, 120)}`;
    await page.keyboard.press('Escape').catch(() => {});
  }
  await page.screenshot({ path: 'test-results/box-kinds.png' }).catch(() => {});
  await page.evaluate(() => window.__awaProbeGo && window.__awaProbeGo());
  const out = await outPromise;
  console.log(`  bordered paragraph: ${bordered}\n`);

  const body = out.html;
  // Strip the noise Docs adds so the structure is readable: ids, font styles.
  const tidy = body
    .replace(/ id="[^"]*"/g, '')
    .replace(/font-family:[^;"]*;?/g, '')
    .replace(/font-size:[^;"]*;?/g, '')
    .replace(/(vertical-align|color|background-color|font-weight|font-style|text-decoration|line-height|orphans|widows|text-align|margin-[a-z]+|height|white-space|overflow|overflow-wrap|padding-[a-z]+):[^;"]*;?/g, '')
    .replace(/style="\s*"/g, '')
    .replace(/&#8203;/g, '‹ZW›')
    .replace(/&nbsp;/g, '‹NBSP›');
  console.log('  text/plain:\n' + out.text.split('\n').map((l) => `    | ${JSON.stringify(l)}`).join('\n'));
  console.log('\n  text/html (tidied):\n' + tidy.replace(/></g, '>\n<').split('\n').map((l) => `    ${l}`).join('\n'));
} catch (err) {
  console.log(`\n  FAILED: ${err?.message ?? err}`);
} finally {
  await ctx.close();
}
