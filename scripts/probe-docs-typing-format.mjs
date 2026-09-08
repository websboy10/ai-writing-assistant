/**
 * Can slow, character-by-character typing carry FORMATTING in Google Docs?
 *
 * Today the two things are exclusive: "Indsæt straks" pastes HTML and gets
 * real headings and bold; "Indsæt langsomt" pastes one character at a time
 * and gets plain text. The obvious fix — paste `<h1>H</h1>` then `<h1>e</h1>`
 * — cannot work, because every paste of a block element starts a new block.
 *
 * So this tries what a PERSON does: press the formatting shortcut, type, press
 * it again. Docs already honours our synthetic Cmd+A and Tab (target.ts), so
 * the question is whether it honours Cmd+B, Cmd+Alt+1, Cmd+Shift+8 the same
 * way. If it does, the paced engine keeps typing characters and formatting
 * becomes a few extra keystrokes in the plan — no new permission, no API.
 *
 * Read back through the html flavour of the synthetic copy (proven by
 * probe-docs-html.mjs), so the check is what Docs itself says it holds.
 *
 * Prereqs: .chrome-profile-cft signed into Google.
 *
 * Run: node scripts/probe-docs-typing-format.mjs [--keep]
 */
import { resolve } from 'node:path';
import { launch, newDoc, isSignedIn, shotsDir, clickIntoDoc } from './docs-harness.mjs';

const KEEP = process.argv.includes('--keep');
const sleep = (ms) => new Promise((s) => setTimeout(s, ms));

const ctx = await launch({ headless: false });
const page = ctx.pages()[0] ?? (await ctx.newPage());

/** Runs inside the page. Types slowly with the product's own paste channel and presses shortcuts between. */
async function runScript(steps) {
  return page.evaluate(async (steps) => {
    const iframe = document.querySelector('iframe.docs-texteventtarget-iframe');
    const doc = iframe?.contentDocument;
    if (!doc) return 'no iframe';
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
    const typeChar = (ch) => {
      const dt = new DataTransfer();
      dt.setData('text/plain', ch);
      el.dispatchEvent(new ClipboardEvent('paste', { clipboardData: dt, bubbles: true, cancelable: true }));
    };
    const KEYS = {
      bold: { key: 'b', code: 'KeyB', keyCode: 66, which: 66, ...cmd },
      italic: { key: 'i', code: 'KeyI', keyCode: 73, which: 73, ...cmd },
      h1: { key: '1', code: 'Digit1', keyCode: 49, which: 49, ...cmd, altKey: true },
      h2: { key: '2', code: 'Digit2', keyCode: 50, which: 50, ...cmd, altKey: true },
      normal: { key: '0', code: 'Digit0', keyCode: 48, which: 48, ...cmd, altKey: true },
      bullets: { key: '8', code: 'Digit8', keyCode: 56, which: 56, ...cmd, shiftKey: true },
      numbered: { key: '7', code: 'Digit7', keyCode: 55, which: 55, ...cmd, shiftKey: true },
      enter: { key: 'Enter', code: 'Enter', keyCode: 13, which: 13 },
    };

    // adapters/gdocs.ts's rule: Docs trims a SPACE at either edge of a paste
    // and keeps interior ones, so a chunk may never start or end with a space.
    // Two-ish characters, with the boundary pushed past any space.
    const chunks = (t) => {
      const out = [];
      let cur = '';
      for (let i = 0; i < t.length; i++) {
        cur += t[i];
        if (cur.length >= 2 && t[i] !== ' ' && t[i + 1] !== ' ') { out.push(cur); cur = ''; }
      }
      if (cur) out.push(cur);
      return out;
    };
    // A space at the very edge of a typed run sits next to a toggle, where no
    // chunking can hide it from Docs' edge-trim. probe-docs-space.mjs: a
    // beforeinput insertText delivers a real U+0020 there.
    const spaceViaInput = () =>
      el.dispatchEvent(new InputEvent('beforeinput', { inputType: 'insertText', data: ' ', bubbles: true, cancelable: true }));
    for (const s of steps) {
      if (s.key) key(KEYS[s.key]);
      else if (s.type) {
        const lead = /^ /.test(s.type);
        const trail = / $/.test(s.type) && s.type.trim().length > 0;
        if (lead) { spaceViaInput(); await wait(60); }
        for (const c of chunks(s.type.trim())) { typeChar(c); await wait(60); }
        if (trail) { spaceViaInput(); await wait(60); }
      }
      await wait(120);
    }
    return 'ok';
  }, steps);
}

async function readHtml() {
  return page.evaluate(() => {
    const iframe = document.querySelector('iframe.docs-texteventtarget-iframe');
    const doc = iframe?.contentDocument;
    const el = doc.querySelector('[contenteditable="true"], [contenteditable=""]') ?? doc.body;
    iframe.contentWindow?.focus();
    const mac = navigator.platform.toLowerCase().includes('mac');
    const k = (init) => el.dispatchEvent(new KeyboardEvent('keydown', { bubbles: true, cancelable: true, ...init }));
    k({ key: 'a', code: 'KeyA', keyCode: 65, which: 65, ...(mac ? { metaKey: true } : { ctrlKey: true }) });
    const dt = new DataTransfer();
    dt.setData('text/plain', '');
    el.dispatchEvent(new ClipboardEvent('copy', { clipboardData: dt, bubbles: true, cancelable: true }));
    const html = dt.getData('text/html');
    k({ key: 'ArrowRight', code: 'ArrowRight', keyCode: 39, which: 39 });
    return html;
  });
}

const results = [];
const check = (name, cond, detail = '') => {
  results.push([name, cond]);
  console.log(`  ${cond ? 'YES' : 'no '}  ${name}${detail ? `   (${detail})` : ''}`);
};

try {
  if (!(await isSignedIn(page))) throw new Error('.chrome-profile-cft is not signed into Google');
  const docId = await newDoc(page);
  console.log(`  doc: https://docs.google.com/document/d/${docId}/edit\n`);
  await sleep(3000);
  await clickIntoDoc(page);
  await sleep(500);

  // What a person would do to produce a small formatted answer, typed slowly.
  const r = await runScript([
    { key: 'h1' }, { type: 'Overskrift' }, { key: 'enter' }, { key: 'normal' },
    { type: 'Normal tekst med ' }, { key: 'bold' }, { type: 'fede ord' }, { key: 'bold' }, { type: ' og ' },
    { key: 'italic' }, { type: 'kursiv' }, { key: 'italic' }, { type: '.' }, { key: 'enter' },
    { key: 'bullets' }, { type: 'Første punkt' }, { key: 'enter' }, { type: 'Andet punkt' }, { key: 'enter' }, { key: 'enter' },
    { key: 'numbered' }, { type: 'Trin et' }, { key: 'enter' }, { type: 'Trin to' }, { key: 'enter' }, { key: 'enter' },
    { key: 'h2' }, { type: 'Underoverskrift' }, { key: 'enter' }, { key: 'normal' },
    { type: 'Slut.' },
  ]);
  if (r !== 'ok') throw new Error(r);
  await sleep(2500);
  await page.screenshot({ path: resolve(shotsDir, 'typing-format.png') }).catch(() => {});

  const html = await readHtml();
  const strip = (s) => s.replace(/<[^>]+>/g, '').replace(/&nbsp;/g, ' ').trim();
  const h1 = [...html.matchAll(/<h1[^>]*>([\s\S]*?)<\/h1>/gi)].map((m) => strip(m[1]));
  const h2 = [...html.matchAll(/<h2[^>]*>([\s\S]*?)<\/h2>/gi)].map((m) => strip(m[1]));
  const bold = [...html.matchAll(/<span[^>]*font-weight:\s*(?:700|bold)[^>]*>([\s\S]*?)<\/span>/gi)].map((m) => strip(m[1]));
  const italic = [...html.matchAll(/<span[^>]*font-style:\s*italic[^>]*>([\s\S]*?)<\/span>/gi)].map((m) => strip(m[1]));
  const ul = [...html.matchAll(/<ul[^>]*>([\s\S]*?)<\/ul>/gi)].map((m) => [...m[1].matchAll(/<li[^>]*>([\s\S]*?)<\/li>/gi)].map((x) => strip(x[1])));
  const ol = [...html.matchAll(/<ol[^>]*>([\s\S]*?)<\/ol>/gi)].map((m) => [...m[1].matchAll(/<li[^>]*>([\s\S]*?)<\/li>/gi)].map((x) => strip(x[1])));
  const plain = strip(html.replace(/<\/(p|h[1-6]|li)>/gi, '\n')).replace(/\n{2,}/g, '\n');

  console.log('  WHAT DOCS HOLDS AFTER TYPING SLOWLY WITH SHORTCUTS\n');
  check('Cmd+Alt+1 made a real Heading 1', h1.includes('Overskrift'), JSON.stringify(h1));
  check('Cmd+Alt+2 made a real Heading 2', h2.includes('Underoverskrift'), JSON.stringify(h2));
  check('Cmd+Alt+0 returned to normal text after the heading', /Normal tekst/.test(plain) && !h1.some((h) => /Normal tekst/.test(h)));
  check('Cmd+B toggled bold on exactly the right words', bold.some((b) => b === 'fede ord') && !bold.some((b) => /Normal tekst|og/.test(b)), JSON.stringify(bold.filter((b) => !/Overskrift|Underoverskrift/.test(b))));
  check('Cmd+I toggled italic on exactly the right word', italic.some((i) => i === 'kursiv'), JSON.stringify(italic));
  check('Cmd+Shift+8 made a bullet list with both items', ul.some((l) => l.join('|') === 'Første punkt|Andet punkt'), JSON.stringify(ul));
  check('Cmd+Shift+7 made a numbered list with both items', ol.some((l) => l.join('|') === 'Trin et|Trin to'), JSON.stringify(ol));
  check('Enter twice left the list, so "Slut." is not a list item', !ul.flat().includes('Slut.') && !ol.flat().includes('Slut.') && /Slut\./.test(plain));

  console.log('\n  PLAIN READ-BACK\n' + plain.split('\n').map((l) => '    ' + l).join('\n'));
} catch (err) {
  console.log(`\n  FAILED: ${err?.message ?? err}`);
  await page.screenshot({ path: resolve(shotsDir, 'typing-format-failure.png') }).catch(() => {});
} finally {
  if (!KEEP) await ctx.close();
}

const passed = results.filter(([, c]) => c).length;
console.log(`\n  ${passed}/${results.length}`);
