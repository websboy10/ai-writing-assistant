/**
 * Which synthetic deletion does Google Docs never drop?
 *
 * probe-docs-backspace-race.mjs (2026-09-08) showed a synthetic Backspace
 * keydown gets LOST about one time in fifty when the page's main thread is
 * half busy — at any spacing from 40 to 200 ms. During a real run the
 * sidebar's own progress rendering is that load, so the spacing cannot be the
 * fix; the channel has to be. Round one of this probe: keydown-only and
 * keydown+beforeinput lose at the same rate, and a synthetic beforeinput
 * deleteContentBackward on its own is ignored outright. In the same runs no
 * paste and no Enter was ever lost.
 *
 * Round two, below: deletions built from what IS reliable. Select the slip
 * with Shift+ArrowLeft, then remove it with a cut, a single Backspace, or a
 * paste that replaces the selection. Plus a read: does a synthetic copy right
 * after selecting report the selection, which would let the adapter verify
 * before it deletes anything.
 *
 * Each cell under the same load: type N slip letters, delete them through
 * the channel, type "ok", Enter. Read back; a line other than "ok" is a lost
 * (x left over) or extra (a letter of "ok" or a newline gone) deletion.
 *
 * Prereqs: .chrome-profile-cft signed into Google. No model quota.
 * Run: node scripts/probe-docs-delete-channel.mjs
 */
import { launch, newDoc, isSignedIn, clickIntoDoc } from './docs-harness.mjs';

const sleep = (ms) => new Promise((s) => setTimeout(s, ms));
const ctx = await launch({ headless: false });
const page = ctx.pages()[0] ?? (await ctx.newPage());

const CELLS = [
  { channel: 'backspace keydown', gap: 40, n: 7 },
  { channel: 'select + cut', gap: 40, n: 7 },
  { channel: 'select + cut', gap: 40, n: 1 },
  { channel: 'select + backspace', gap: 40, n: 7 },
  { channel: 'select + paste over', gap: 40, n: 7 },
  { channel: 'execCommand delete', gap: 40, n: 7 },
];
const REPS = 10;

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
    const mac = navigator.platform.toLowerCase().includes('mac');
    const cmd = mac ? { metaKey: true } : { ctrlKey: true };
    const key = (init) => {
      const full = { bubbles: true, cancelable: true, ...init };
      el.dispatchEvent(new KeyboardEvent('keydown', full));
      el.dispatchEvent(new KeyboardEvent('keyup', full));
    };
    const BS = { key: 'Backspace', code: 'Backspace', keyCode: 8, which: 8 };
    const SHIFT_LEFT = { key: 'ArrowLeft', code: 'ArrowLeft', keyCode: 37, which: 37, shiftKey: true };
    const clip = (type) => {
      const dt = new DataTransfer();
      dt.setData('text/plain', '');
      el.dispatchEvent(new ClipboardEvent(type, { clipboardData: dt, bubbles: true, cancelable: true }));
      return dt.getData('text/plain');
    };
    const paste = (t) => {
      const dt = new DataTransfer();
      dt.setData('text/plain', t);
      el.dispatchEvent(new ClipboardEvent('paste', { clipboardData: dt, bubbles: true, cancelable: true }));
    };

    const reads = {};
    for (const { channel, gap, n } of cells) {
      const readsHere = [];
      for (let r = 0; r < reps; r++) {
        for (let i = 0; i < n; i++) { paste('x'); await wait(130); }
        await wait(250);
        let typedO = false;
        if (channel === 'backspace keydown') {
          for (let i = 0; i < n; i++) { key(BS); await wait(gap); }
        } else if (channel === 'execCommand delete') {
          for (let i = 0; i < n; i++) { doc.execCommand('delete'); await wait(gap); }
        } else {
          for (let i = 0; i < n; i++) { key(SHIFT_LEFT); await wait(gap); }
          // What a copy reports right now, before anything is deleted.
          readsHere.push(clip('copy'));
          if (channel === 'select + cut') clip('cut');
          else if (channel === 'select + backspace') key(BS);
          else { paste('o'); typedO = true; }
        }
        await wait(60);
        if (!typedO) { paste('o'); await wait(130); }
        paste('k'); await wait(130);
        key({ key: 'Enter', code: 'Enter', keyCode: 13, which: 13 }); await wait(300);
      }
      reads[`${channel}/${n}`] = readsHere;
      paste('='); await wait(130);
      key({ key: 'Enter', code: 'Enter', keyCode: 13, which: 13 }); await wait(300);
    }
    await wait(1500);
    key({ key: 'a', code: 'KeyA', keyCode: 65, which: 65, ...cmd });
    const text = clip('copy');
    key({ key: 'ArrowRight', code: 'ArrowRight', keyCode: 39, which: 39 });
    return { text, reads };
  }, { cells: CELLS, reps: REPS });

  const groups = out.text.replace(/[​﻿\r]/g, '').split('\n=\n');
  console.log('  (main thread ~50% busy)');
  console.log('  channel               N    correct    copy read the selection    what went wrong');
  CELLS.forEach(({ channel, n }, i) => {
    const got = (groups[i] ?? '').split('\n').map((l) => l.trim()).filter(Boolean);
    const good = got.filter((l) => l === 'ok').length;
    const bad = [...new Set(got.filter((l) => l !== 'ok'))].slice(0, 4);
    const missing = REPS - got.length;
    const reads = out.reads[`${channel}/${n}`] ?? [];
    const readOk = reads.filter((t) => t === 'x'.repeat(n)).length;
    const readCol = reads.length ? `${String(readOk).padStart(2)}/${reads.length} (${[...new Set(reads.filter((t) => t !== 'x'.repeat(n)))].map((t) => JSON.stringify(t)).slice(0, 3).join(' ')})` : '-';
    console.log(`  ${channel.padEnd(21)} ${String(n).padStart(2)}    ${String(good).padStart(2)}/${REPS}      ${readCol.padEnd(26)} ${[...bad, ...(missing > 0 ? [`${missing} line(s) missing`] : [])].join(', ')}`);
  });
} catch (err) {
  console.log(`\n  FAILED: ${err?.message ?? err}`);
} finally {
  await ctx.close();
}
