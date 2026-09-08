/**
 * How soon after a burst of Shift+ArrowLeft does a synthetic copy report the
 * new selection in Google Docs?
 *
 * probe-docs-delete-channel.mjs (2026-09-08) found the one deletion Docs
 * never drops under load: select the slip with Shift+ArrowLeft, then paste
 * over it. The adapter wants to VERIFY the selection before the paste — read
 * it with a copy and compare it to the slip it typed — and retry a dropped
 * arrow. That only works if the read is accurate at the moment the adapter
 * does it, inside one synchronous deleteBack() call, or a tick later.
 *
 * Under load, N arrows dispatched back to back, then a copy read after 0 ms
 * (same call stack), 16 ms and 60 ms. Expect the read to equal the N letters
 * typed just before.
 *
 * Prereqs: .chrome-profile-cft signed into Google. No model quota.
 * Run: node scripts/probe-docs-select-read.mjs
 */
import { launch, newDoc, isSignedIn, clickIntoDoc } from './docs-harness.mjs';

const sleep = (ms) => new Promise((s) => setTimeout(s, ms));
const ctx = await launch({ headless: false });
const page = ctx.pages()[0] ?? (await ctx.newPage());

const CELLS = [];
for (const after of [0, 16, 60]) for (const n of [1, 3, 7]) CELLS.push({ after, n });
const REPS = 12;

try {
  if (!(await isSignedIn(page))) throw new Error('.chrome-profile-cft is not signed into Google');
  const docId = await newDoc(page);
  console.log(`  doc: https://docs.google.com/document/d/${docId}/edit\n`);
  await sleep(3000);
  await clickIntoDoc(page);
  await sleep(500);

  const out = await page.evaluate(async ({ cells, reps }) => {
    setInterval(() => { const t = performance.now(); while (performance.now() - t < 8) { /* burn */ } }, 16);
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
    const SHIFT_LEFT = { key: 'ArrowLeft', code: 'ArrowLeft', keyCode: 37, which: 37, shiftKey: true };
    const copy = () => {
      const dt = new DataTransfer();
      dt.setData('text/plain', '');
      el.dispatchEvent(new ClipboardEvent('copy', { clipboardData: dt, bubbles: true, cancelable: true }));
      return dt.getData('text/plain').replace(/[​﻿]/g, '');
    };
    const paste = (t) => {
      const dt = new DataTransfer();
      dt.setData('text/plain', t);
      el.dispatchEvent(new ClipboardEvent('paste', { clipboardData: dt, bubbles: true, cancelable: true }));
    };

    const results = [];
    const letters = 'abcdefg';
    for (const { after, n } of cells) {
      const reads = [];
      for (let r = 0; r < reps; r++) {
        for (let i = 0; i < n; i++) { paste(letters[i]); await wait(130); }
        await wait(250);
        for (let i = 0; i < n; i++) key(SHIFT_LEFT);
        if (after > 0) await wait(after);
        reads.push(copy());
        await wait(100);
        paste('ok');
        await wait(130);
        key({ key: 'Enter', code: 'Enter', keyCode: 13, which: 13 });
        await wait(300);
      }
      results.push({ after, n, reads });
    }
    return results;
  }, { cells: CELLS, reps: REPS });

  console.log('  (main thread ~50% busy)');
  console.log('  read after   N arrows   accurate    what the copy said instead');
  for (const { after, n, reads } of out) {
    const want = 'abcdefg'.slice(0, n);
    const good = reads.filter((t) => t === want).length;
    const bad = [...new Set(reads.filter((t) => t !== want))].map((t) => JSON.stringify(t)).slice(0, 5);
    console.log(`  ${String(after).padStart(4)} ms       ${n}          ${String(good).padStart(2)}/${REPS}      ${bad.join(' ')}`);
  }
} catch (err) {
  console.log(`\n  FAILED: ${err?.message ?? err}`);
} finally {
  await ctx.close();
}
