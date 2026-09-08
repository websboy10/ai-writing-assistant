/**
 * Can the caret be moved from a QUESTION into the EMPTY BOX that answers it,
 * with keystrokes alone — for every shape a real worksheet uses?
 *
 * Three shapes, each built here so the answer is measured, not reasoned:
 *
 *   beside    | question | [box] |            Find → Tab            (shipped, proven)
 *   stacked   | question |                    Find → Tab            (next cell in
 *             | [box]    |                                            document order)
 *   below     question as ordinary text        Find → End → ArrowDown  (the unknown)
 *             +-----------+
 *             | [box]     |
 *             +-----------+
 *
 * Each shape: build it, use Docs' Find to land on the question, press the
 * candidate keys, paste a marker, and read every cell back through the html
 * flavour of the synthetic copy. The marker is in the box, or it is not.
 *
 * Prereqs: .chrome-profile-cft signed into Google.
 * Run: node scripts/probe-docs-placement.mjs [--keep]
 */
import { launch, newDoc, isSignedIn, clickIntoDoc } from './docs-harness.mjs';

const KEEP = process.argv.includes('--keep');
const sleep = (ms) => new Promise((s) => setTimeout(s, ms));
const Q = 'Hvad er hovedstaden i Danmark?';
const MARK = 'SVARMARKØR';

const SHAPES = {
  beside: { html: `<table border="1"><tr><td>${Q}</td><td></td></tr></table>`, keys: ['Tab'] },
  stacked: { html: `<table border="1"><tr><td>${Q}</td></tr><tr><td></td></tr></table>`, keys: ['Tab'] },
  below: { html: `<p>${Q}</p><table border="1"><tr><td></td></tr></table>`, keys: ['End', 'ArrowDown'] },
  'below, two paragraphs of text first': {
    html: `<p>Intro.</p><p>${Q}</p><table border="1"><tr><td></td></tr></table><p>Efter.</p>`,
    keys: ['End', 'ArrowDown'],
  },
};

const ctx = await launch({ headless: false });
const page = ctx.pages()[0] ?? (await ctx.newPage());

async function inDoc(fn, arg) {
  return page.evaluate(async ([src, arg]) => {
    const iframe = document.querySelector('iframe.docs-texteventtarget-iframe');
    const doc = iframe.contentDocument;
    const el = doc.querySelector('[contenteditable="true"], [contenteditable=""]') ?? doc.body;
    iframe.contentWindow?.focus();
    const mac = navigator.platform.toLowerCase().includes('mac');
    const cmd = mac ? { metaKey: true } : { ctrlKey: true };
    const wait = (ms) => new Promise((s) => setTimeout(s, ms));
    const key = (init) => {
      const full = { bubbles: true, cancelable: true, ...init };
      el.dispatchEvent(new KeyboardEvent('keydown', full));
      el.dispatchEvent(new KeyboardEvent('keyup', full));
    };
    const KEY = {
      Tab: { key: 'Tab', code: 'Tab', keyCode: 9, which: 9 },
      End: { key: 'End', code: 'End', keyCode: 35, which: 35 },
      ArrowDown: { key: 'ArrowDown', code: 'ArrowDown', keyCode: 40, which: 40 },
      ArrowRight: { key: 'ArrowRight', code: 'ArrowRight', keyCode: 39, which: 39 },
    };
    const paste = (plain, html) => {
      const dt = new DataTransfer();
      dt.setData('text/plain', plain);
      if (html) dt.setData('text/html', html);
      el.dispatchEvent(new ClipboardEvent('paste', { clipboardData: dt, bubbles: true, cancelable: true }));
    };
    const copyHtml = () => {
      key({ key: 'a', code: 'KeyA', keyCode: 65, which: 65, ...cmd });
      const dt = new DataTransfer();
      dt.setData('text/plain', '');
      el.dispatchEvent(new ClipboardEvent('copy', { clipboardData: dt, bubbles: true, cancelable: true }));
      const html = dt.getData('text/html');
      key(KEY.ArrowRight);
      return html;
    };
    const fn = new Function('ctx', 'arg', `return (${src})(ctx, arg)`);
    return fn({ el, doc, key, KEY, paste, copyHtml, wait, cmd }, arg);
  }, [fn.toString(), arg]);
}

/** Docs' own Find bar, the way docs-find.ts drives it: Cmd+F, type, Enter, Escape leaves the match selected; ArrowRight collapses to its end. */
async function findQuestion(text) {
  await inDoc(async ({ el, key, cmd, wait, KEY }, q) => {
    key({ key: 'f', code: 'KeyF', keyCode: 70, which: 70, ...cmd });
    await wait(600);
  }, text);
  // The Find bar is real DOM in the top document.
  const input = page.locator('input.docs-findinput-input, [aria-label*="Find"] input, input[type="text"]').first();
  await input.waitFor({ timeout: 5000 });
  await input.fill(text);
  await page.keyboard.press('Enter');
  await sleep(400);
  await page.keyboard.press('Escape');
  await sleep(400);
  await inDoc(async ({ key, KEY, wait }) => { key(KEY.ArrowRight); await wait(200); });
}

try {
  if (!(await isSignedIn(page))) throw new Error('.chrome-profile-cft is not signed into Google');
  for (const [name, shape] of Object.entries(SHAPES)) {
    const docId = await newDoc(page);
    await sleep(2500);
    await clickIntoDoc(page);
    await sleep(400);
    await inDoc(async ({ paste }, html) => paste('', html), shape.html);
    await sleep(3000);

    await findQuestion(Q);
    await inDoc(async ({ key, KEY, wait, paste }, keys) => {
      for (const k of keys) { key(KEY[k]); await wait(200); }
      paste('SVARMARKØR');
      await wait(300);
    }, shape.keys);
    await sleep(1500);

    const html = await inDoc(({ copyHtml }) => copyHtml());
    const cells = [...html.matchAll(/<td[^>]*>([\s\S]*?)<\/td>/gi)].map((m) =>
      m[1].replace(/<[^>]+>/g, '').replace(/&nbsp;/g, ' ').trim(),
    );
    const boxIndex = cells.length - 1;
    const inBox = cells[boxIndex]?.includes(MARK);
    const questionIntact = html.includes(Q);
    const elsewhere = !inBox && html.includes(MARK);
    console.log(
      `  ${inBox ? 'YES' : 'no '}  ${name.padEnd(40)} keys ${shape.keys.join('+').padEnd(14)} cells ${JSON.stringify(cells)}` +
        `${elsewhere ? '   ← marker landed OUTSIDE the box' : ''}${questionIntact ? '' : '   ← QUESTION DAMAGED'}`,
    );
  }
} catch (err) {
  console.log(`\n  FAILED: ${err?.message ?? err}`);
} finally {
  if (!KEEP) await ctx.close();
}
