/**
 * What makes Google Docs swallow a typed letter?
 *
 * "Skriv som et menneske" loses about one letter per run on Docs: the letter
 * is gone and two zero-width spaces stand in its place ("Pla​​ten", 2026-10-08).
 * Nothing on our side marks the paste that fails. Three ways of typing the
 * same 4000 letters, one new document each:
 *
 *   plain   one paste per letter, nothing else
 *   read    the same, and every 8 letters the check deleteBack() does:
 *           Shift+ArrowLeft x4, a synthetic copy, ArrowRight
 *   slip    the same, and every 8 letters two wrong letters and two Backspaces
 *
 * Prereqs: profile signed into Google. No model quota. ~15 minutes.
 * Run: node scripts/probe-docs-letter-loss.mjs [letters]
 */
import { launch, newDoc, isSignedIn, readDoc, clickIntoDoc } from './docs-harness.mjs';

const N = Number(process.argv[2] ?? 4000);
const sleep = (ms) => new Promise((s) => setTimeout(s, ms));
const ctx = await launch();
const page = ctx.pages()[0] ?? (await ctx.newPage());

try {
  if (!(await isSignedIn(page))) throw new Error('profile is not signed into Google');
  for (const arm of ['plain', 'read', 'slip']) {
    const docId = await newDoc(page);
    await sleep(3000);
    await clickIntoDoc(page);
    await sleep(500);
    const human = await page.evaluate(async ({ arm, n }) => {
      // A person's hand in the window looks exactly like the fault; count it.
      let human = 0;
      for (const t of ['mousedown', 'keydown']) window.addEventListener(t, (e) => e.isTrusted && human++, true);
      const iframe = document.querySelector('iframe.docs-texteventtarget-iframe');
      const doc = iframe.contentDocument;
      const el = doc.querySelector('[contenteditable="true"], [contenteditable=""]') ?? doc.body;
      iframe.contentWindow?.focus();
      const wait = (ms) => new Promise((s) => setTimeout(s, ms));
      const key = (init) => {
        const full = { bubbles: true, cancelable: true, ...init };
        el.dispatchEvent(new KeyboardEvent('keydown', full));
        el.dispatchEvent(new KeyboardEvent('keyup', full));
      };
      const clip = (type, t) => {
        const dt = new DataTransfer();
        dt.setData('text/plain', t);
        el.dispatchEvent(new ClipboardEvent(type, { clipboardData: dt, bubbles: true, cancelable: true }));
      };
      const beat = () => wait(45 + Math.random() * 50);
      for (let i = 0; i < n; i++) {
        clip('paste', 'abcdefghijklmnopqrstuvwxyz'[i % 26]);
        await beat();
        if (i % 104 === 103) { key({ key: 'Enter', code: 'Enter', keyCode: 13, which: 13 }); await wait(200); }
        else if (i % 8 === 7 && arm === 'read') {
          for (let k = 0; k < 4; k++) key({ key: 'ArrowLeft', code: 'ArrowLeft', keyCode: 37, which: 37, shiftKey: true });
          clip('copy', '');
          key({ key: 'ArrowRight', code: 'ArrowRight', keyCode: 39, which: 39 });
          await beat();
        } else if (i % 8 === 7 && arm === 'slip') {
          clip('paste', 'X'); await beat();
          clip('paste', 'X'); await beat();
          key({ key: 'Backspace', code: 'Backspace', keyCode: 8, which: 8 });
          key({ key: 'Backspace', code: 'Backspace', keyCode: 8, which: 8 });
          await beat();
        }
      }
      return human;
    }, { arm, n: N });
    await sleep(4000);
    const raw = await readDoc(ctx, docId);
    const zw = (raw.match(/[​﻿]/g) ?? []).length;
    const letters = raw.replace(/[^a-zX]/g, '');
    const odd = raw.split('\n').map((l) => l.replace(/[^a-z]/g, '').length).filter((n) => n > 0 && n !== 104).length;
    console.log(`  ${arm.padEnd(6)} real clicks/keys ${human}   lines of the wrong length ${odd}`);
    console.log(`  ${arm.padEnd(6)} typed ${N}   in the document ${letters.replace(/X/g, '').length}   lost ${N - letters.replace(/X/g, '').length}   zero-width ${zw}   slips left ${(letters.match(/X/g) ?? []).length}   https://docs.google.com/document/d/${docId}/edit`);
  }
} catch (err) {
  console.log(`  FAILED: ${err?.message ?? err}`);
} finally {
  await ctx.close();
}
