/**
 * Can "Skriv som et menneske" delete with plain Backspaces and still never
 * leave a slip behind — without anything ever showing as marked?
 *
 * The 2026-09-08 fix for the dropped Backspace (adapters/gdocs.ts deleteBack)
 * marks the slip with Shift+ArrowLeft and lets the next paste replace it. The
 * operator saw the marking on screen on 2026-09-09: a person backspaces, they
 * do not mark three letters and type over them, and the highlight gives the
 * run away. So the deletion has to be Backspace presses — and the drop (one
 * in fifty under load) still has to be caught.
 *
 * The idea under test: N Backspaces, then, IN THE SAME SYNCHRONOUS TASK, a
 * check that reads what now stands before the caret (Shift+ArrowLeft, copy,
 * ArrowRight to collapse) and presses Backspace again for anything left over.
 * Docs updates its model on the keydown itself (probe-docs-select-read.mjs:
 * a copy in the same call stack read the selection 108 of 108) but paints on
 * a later frame, so a selection made and collapsed inside one task should
 * never reach the screen.
 *
 * Measured two ways, under the same half-busy main thread as the earlier
 * probes: the document text at the end (every line must read exactly as
 * typed), and the canvas itself — Docs paints to canvas tiles, and a
 * selection is a wash of blue over the letters. Every animation frame for
 * 350 ms after each deletion the visible tiles are read back and their
 * bluish pixels counted. A control cell that leaves a selection standing
 * proves the counter sees one.
 *
 * Prereqs: .chrome-profile-cft signed into Google. No model quota.
 * Run: node scripts/probe-docs-backspace-verify.mjs
 */
import { launch, newDoc, isSignedIn, clickIntoDoc } from './docs-harness.mjs';

const sleep = (ms) => new Promise((s) => setTimeout(s, ms));
const ctx = await launch({ headless: false });
const page = ctx.pages()[0] ?? (await ctx.newPage());

const CELLS = [];
for (const n of [1, 3, 7]) for (const trailing of [false, true]) CELLS.push({ n, trailing });
const REPS = 8;

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
    const frame = () => new Promise((s) => requestAnimationFrame(s));
    const mac = navigator.platform.toLowerCase().includes('mac');
    const cmd = mac ? { metaKey: true } : { ctrlKey: true };
    const key = (init) => {
      const full = { bubbles: true, cancelable: true, ...init };
      el.dispatchEvent(new KeyboardEvent('keydown', full));
      el.dispatchEvent(new KeyboardEvent('keyup', full));
    };
    const BS = { key: 'Backspace', code: 'Backspace', keyCode: 8, which: 8 };
    const LEFT = { key: 'ArrowLeft', code: 'ArrowLeft', keyCode: 37, which: 37 };
    const SHIFT_LEFT = { ...LEFT, shiftKey: true };
    const RIGHT = { key: 'ArrowRight', code: 'ArrowRight', keyCode: 39, which: 39 };
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

    // Bluish pixels on the CARET'S LINE of the visible canvas tiles: a
    // selection wash. Only that line, and only relative to a baseline read
    // just before the deletion: the first version of this probe scanned the
    // whole tile and counted Docs' blue grammar squiggles under every earlier
    // line as "marked", more of them each rep.
    const tiles = () => [...document.querySelectorAll('.kix-appview-editor canvas')].filter((c) => c.width > 0 && c.getBoundingClientRect().height > 0);
    // The line is remembered from BEFORE the deletion: Docs hides the caret
    // while text is marked, and a region read off a hidden caret is empty —
    // the second version of this probe was blind to its own control.
    let line = null;
    const rememberLine = () => {
      const caret = document.querySelector('.kix-cursor-caret')?.getBoundingClientRect();
      if (caret && caret.height > 0) line = { top: caret.top, bottom: caret.bottom };
    };
    const blueOnCaretLine = () => {
      const caret = line;
      if (!caret) return -1;
      let n = 0;
      for (const c of tiles()) {
        const r = c.getBoundingClientRect();
        if (caret.bottom < r.top || caret.top > r.bottom) continue;
        const scale = c.height / r.height;
        const y0 = Math.max(0, Math.floor((caret.top - 4 - r.top) * scale));
        const y1 = Math.min(c.height, Math.ceil((caret.bottom + 4 - r.top) * scale));
        if (y1 <= y0) continue;
        try {
          const d = c.getContext('2d').getImageData(0, y0, c.width, y1 - y0).data;
          for (let i = 0; i < d.length; i += 8) {
            // The selection is a LIGHT blue wash over white (measured on the
            // control: (167,201,255) and (185,212,255)); a grammar squiggle is
            // a thin saturated blue line, and it does not count.
            if (d[i] > 140 && d[i + 2] > 220 && d[i + 2] > d[i] + 40) n += 1;
          }
        } catch (err) {
          return -1; // tainted or unreadable: the detector is blind
        }
      }
      return n;
    };
    const baselineNow = async () => {
      let b = 0;
      for (let i = 0; i < 3; i++) { await frame(); rememberLine(); b = Math.max(b, blueOnCaretLine()); }
      return b;
    };
    // The colours actually on the caret line that are not white or grey —
    // printed for the control, so the wash criterion above rests on a
    // measurement rather than a guess.
    const lineColours = () => {
      const caret = line;
      const counts = new Map();
      for (const c of tiles()) {
        const r = c.getBoundingClientRect();
        if (!caret || caret.bottom < r.top || caret.top > r.bottom) continue;
        const scale = c.height / r.height;
        const y0 = Math.max(0, Math.floor((caret.top - 4 - r.top) * scale));
        const y1 = Math.min(c.height, Math.ceil((caret.bottom + 4 - r.top) * scale));
        const d = c.getContext('2d').getImageData(0, y0, c.width, y1 - y0).data;
        for (let i = 0; i < d.length; i += 8) {
          if (Math.abs(d[i] - d[i + 1]) < 12 && Math.abs(d[i + 1] - d[i + 2]) < 12) continue;
          const key = `${d[i]},${d[i + 1]},${d[i + 2]}`;
          counts.set(key, (counts.get(key) ?? 0) + 1);
        }
      }
      return [...counts.entries()].sort((a, b) => b[1] - a[1]).slice(0, 4);
    };
    const watch = async (ms, baseline) => {
      const t0 = performance.now();
      let frames = 0;
      let blueMs = 0;
      let peak = 0;
      let last = t0;
      while (performance.now() - t0 < ms) {
        await frame();
        const now = performance.now();
        const b = blueOnCaretLine();
        frames += 1;
        if (b < 0) return { frames, blueMs: -1, peak: -1 };
        const delta = b - baseline;
        if (delta > 25) blueMs += now - last;
        last = now;
        peak = Math.max(peak, delta);
      }
      return { frames, blueMs: Math.round(blueMs), peak };
    };

    /**
     * The candidate deleteBack: Backspace × n, then a same-task read of what
     * stands before the caret, compared with what should stand there, and one
     * more Backspace per character left over. `before` is the text known to
     * stand before the deleted characters, `deleted` the characters to remove.
     */
    const deleteVerified = (before, deleted) => {
      const n = deleted.length;
      const log = { backspaces: n, reads: [], extra: 0, arrowRetries: 0, verdict: 'unverified' };
      for (let i = 0; i < n; i++) key(BS);
      const k = Math.min(before.length, n + 2);
      if (k === 0) return log;
      for (let round = 0; round < 3; round++) {
        const expected = before.slice(-k);
        for (let i = 0; i < k; i++) key(SHIFT_LEFT);
        let read = copy();
        let retries = 0;
        while (read !== expected && read.length < k && expected.endsWith(read) && retries < 2) {
          key(SHIFT_LEFT);
          read = copy();
          retries += 1;
        }
        key(RIGHT);
        log.reads.push(read);
        log.arrowRetries += retries;
        if (read === expected) { log.verdict = 'ok'; return log; }
        // Some of the deleted characters survived: the text ends with
        // before + deleted.slice(0, d). Find d, press Backspace d more times.
        let d = 0;
        for (let cand = 1; cand <= n; cand++) {
          if ((before + deleted.slice(0, cand)).slice(-k) === read) { d = cand; break; }
        }
        if (d === 0) { log.verdict = `unexplained:${JSON.stringify(read)}`; return log; }
        for (let i = 0; i < d; i++) key(BS);
        log.extra += d;
      }
      log.verdict = 'gave-up';
      return log;
    };

    const results = [];

    // Control: a selection left standing must be SEEN by the detector, and
    // nothing marked must not be.
    paste('ab'); await wait(130);
    for (const ch of 'xxx') { paste(ch); await wait(130); }
    await wait(250);
    const base0 = await baselineNow();
    const quiet = await watch(350, base0);
    for (let i = 0; i < 3; i++) key(SHIFT_LEFT);
    const control = await watch(350, base0);
    const colours = lineColours();
    key(RIGHT);
    for (let i = 0; i < 3; i++) { key(BS); await wait(60); }
    paste('ok'); await wait(130);
    key({ key: 'Enter', code: 'Enter', keyCode: 13, which: 13 }); await wait(300);
    results.push({ cell: 'control', baseline: base0, quiet, control, colours, tiles: tiles().length });

    for (const { n, trailing } of cells) {
      const reps_ = [];
      for (let r = 0; r < reps; r++) {
        paste('ab'); await wait(130);
        let setup = 'ok';
        if (trailing) {
          paste('zz'); await wait(130);
          key(LEFT); key(LEFT);
          await wait(60);
          // Is the caret really before "zz"? Mark it, read, step back.
          key({ ...RIGHT, shiftKey: true }); key({ ...RIGHT, shiftKey: true });
          const after = copy();
          key(LEFT);
          if (after !== 'zz') setup = `caret not before zz (read ${JSON.stringify(after)})`;
          await wait(60);
        }
        const slip = 'x'.repeat(n);
        for (const ch of slip) { paste(ch); await wait(130); }
        await wait(250);
        const baseline = await baselineNow();
        const log = deleteVerified('ab', slip);
        const seen = await watch(350, baseline);
        paste('ok'); await wait(130);
        if (trailing) { key({ key: 'End', code: 'End', keyCode: 35, which: 35 }); await wait(60); }
        key({ key: 'Enter', code: 'Enter', keyCode: 13, which: 13 }); await wait(300);
        reps_.push({ ...log, seen, setup });
      }
      results.push({ cell: `n=${n}${trailing ? ' text after caret' : ''}`, reps: reps_ });
    }

    await wait(1500);
    key({ key: 'a', code: 'KeyA', keyCode: 65, which: 65, ...cmd });
    const text = copy();
    key(RIGHT);
    return { results, text };
  }, { cells: CELLS, reps: REPS });

  const lines = out.text.replace(/\r/g, '').split('\n').map((l) => l.trim()).filter(Boolean);
  const control = out.results[0];
  console.log('  (main thread ~50% busy)');
  console.log(`  canvas tiles read: ${control.tiles}, baseline ${control.baseline} blue px on the caret line`);
  console.log(`  control, nothing marked:   marked for ${control.quiet.blueMs} ms of 350, peak +${control.quiet.peak} px`);
  console.log(`  control, 3 letters marked: marked for ${control.control.blueMs} ms of 350, peak +${control.control.peak} px; colours on the line ${JSON.stringify(control.colours)}`);
  console.log(`  control line reads ${JSON.stringify(lines[0])} (want "abok")\n`);
  console.log('  cell                        lines right   verdicts                 extra BS   arrow retries   marked ms (worst rep, peak px)   setup');
  let at = 1;
  for (const cell of out.results.slice(1)) {
    const want = cell.cell.includes('after') ? 'abokzz' : 'abok';
    const got = lines.slice(at, at + REPS);
    at += REPS;
    const right = got.filter((l) => l === want).length;
    const verdicts = [...new Set(cell.reps.map((r) => r.verdict))].join(', ');
    const extra = cell.reps.reduce((s, r) => s + r.extra, 0);
    const arrows = cell.reps.reduce((s, r) => s + r.arrowRetries, 0);
    const blueMs = Math.max(...cell.reps.map((r) => r.seen.blueMs));
    const peak = Math.max(...cell.reps.map((r) => r.seen.peak));
    const setup = cell.reps.filter((r) => r.setup !== 'ok').map((r) => r.setup);
    const wrong = [...new Set(got.filter((l) => l !== want))].slice(0, 3).map((l) => JSON.stringify(l)).join(' ');
    console.log(`  ${cell.cell.padEnd(27)} ${String(right).padStart(2)}/${REPS}         ${verdicts.padEnd(24)} ${String(extra).padStart(3)}        ${String(arrows).padStart(3)}             ${String(blueMs).padStart(4)} (+${peak})                     ${setup.length ? setup.join('; ') : 'ok'}   ${wrong}`);
  }
} catch (err) {
  console.log(`\n  FAILED: ${err?.message ?? err}`);
} finally {
  await ctx.close();
}
