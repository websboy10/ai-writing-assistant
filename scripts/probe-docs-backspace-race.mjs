/**
 * "Skriv som et menneske" in Google Docs: do consecutive synthetic Backspaces
 * survive, and does a Backspace ever land after the paste that follows it?
 *
 * Seen on a real form 2026-09-08 at 90 words a minute: "derude" came out
 * "drerude" — one of the two Backspaces that should have removed the slip
 * "re" never happened — and "Søren" came out "Sren", a Backspace applied
 * after the "ø" that followed it had landed. The engine sends every deletion
 * as its own Backspace 40-110 ms apart (engine.ts delayAfter); a single
 * Backspace followed by a paste 40 ms later was measured 20/20 correct, so the
 * question is runs of them.
 *
 * Each cell: ten times, type N slip letters, then N Backspaces `gap` ms apart,
 * wait `settle`, then type "ok". Read back; anything but "ok" on a line is a
 * lost or late Backspace. The (gap, settle) that never loses one is what the
 * engine should use on Docs.
 *
 * Prereqs: .chrome-profile-cft signed into Google. No model quota.
 * Run: node scripts/probe-docs-backspace-race.mjs
 */
import { launch, newDoc, isSignedIn, clickIntoDoc } from './docs-harness.mjs';

const sleep = (ms) => new Promise((s) => setTimeout(s, ms));
const ctx = await launch({ headless: false });
const page = ctx.pages()[0] ?? (await ctx.newPage());

// AWA_LOAD=1 keeps the page's main thread half busy, the way the extension's
// own progress rendering does during a real run — the sidebar is a content
// script in Docs' page, so its React work and Docs' key handling share a thread.
const LOAD = process.env.AWA_LOAD === '1';
const CELLS = [];
const GAPS = LOAD ? [40, 120, 200] : [40, 80, 150, 250];
for (const gap of GAPS) for (const settle of [40, 150]) for (const n of LOAD ? [2, 7] : [2, 3, 7]) CELLS.push({ gap, settle, n });
const REPS = 6;

try {
  if (!(await isSignedIn(page))) throw new Error('.chrome-profile-cft is not signed into Google');
  const docId = await newDoc(page);
  console.log(`  doc: https://docs.google.com/document/d/${docId}/edit\n`);
  await sleep(3000);
  await clickIntoDoc(page);
  await sleep(500);

  const text = await page.evaluate(async ({ cells, reps, load }) => {
    if (load) setInterval(() => { const t = performance.now(); while (performance.now() - t < 8) { /* burn */ } }, 16);
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
    const paste = (t) => {
      const dt = new DataTransfer();
      dt.setData('text/plain', t);
      el.dispatchEvent(new ClipboardEvent('paste', { clipboardData: dt, bubbles: true, cancelable: true }));
    };

    for (const { gap, settle, n } of cells) {
      for (let r = 0; r < reps; r++) {
        for (let i = 0; i < n; i++) { paste('x'); await wait(130); }
        await wait(250); // the "noticed it" pause before a correction
        for (let i = 0; i < n; i++) { key(BS); await wait(gap); }
        await wait(settle);
        paste('o'); await wait(130);
        paste('k'); await wait(130);
        key({ key: 'Enter', code: 'Enter', keyCode: 13, which: 13 }); await wait(300);
      }
    }
    await wait(1500);
    key({ key: 'a', code: 'KeyA', keyCode: 65, which: 65, ...cmd });
    const dt = new DataTransfer();
    dt.setData('text/plain', '');
    el.dispatchEvent(new ClipboardEvent('copy', { clipboardData: dt, bubbles: true, cancelable: true }));
    key({ key: 'ArrowRight', code: 'ArrowRight', keyCode: 39, which: 39 });
    return dt.getData('text/plain');
  }, { cells: CELLS, reps: REPS, load: LOAD });

  const lines = text.replace(/[​﻿\r]/g, '').split('\n');
  if (LOAD) console.log('  (main thread ~50% busy)');
  console.log('  gap between Backspaces   settle before retyping   N deleted   correct   what went wrong');
  let at = 0;
  for (const { gap, settle, n } of CELLS) {
    const got = lines.slice(at, at + REPS);
    at += REPS;
    const good = got.filter((l) => l.trim() === 'ok').length;
    const bad = [...new Set(got.map((l) => l.trim()).filter((l) => l !== 'ok'))].slice(0, 4);
    console.log(`  ${String(gap).padStart(4)} ms                  ${String(settle).padStart(4)} ms                 ${String(n).padStart(2)}         ${good}/${REPS}      ${bad.join(', ')}`);
  }
} catch (err) {
  console.log(`\n  FAILED: ${err?.message ?? err}`);
} finally {
  await ctx.close();
}
