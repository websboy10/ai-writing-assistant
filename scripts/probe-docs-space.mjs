/**
 * How to get ONE SPACE into Docs at a formatting boundary.
 *
 * Docs trims a space at either edge of a paste (adapters/gdocs.ts). Inside a
 * run of plain text that never matters — the chunker just never breaks next to
 * a space. But a formatting toggle IS a break: "med" Cmd+B "fede" Cmd+B " og"
 * has to paste " og" with a leading space, and Docs drops it, giving
 * "fedeog". probe-docs-typing-format.mjs shows exactly that.
 *
 * Four candidate channels for a lone space, each tried between "a" and "b",
 * each read back. The winner becomes how the paced engine types a space next
 * to a toggle. If none works, the design has to route around it (type the
 * space INSIDE the formatted run, and accept a formatted space).
 *
 * Prereqs: .chrome-profile-cft signed into Google.
 * Run: node scripts/probe-docs-space.mjs [--keep]
 */
import { launch, newDoc, isSignedIn, clickIntoDoc } from './docs-harness.mjs';

const KEEP = process.argv.includes('--keep');
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
    const pastePlain = (t) => {
      const dt = new DataTransfer();
      dt.setData('text/plain', t);
      el.dispatchEvent(new ClipboardEvent('paste', { clipboardData: dt, bubbles: true, cancelable: true }));
    };
    const pasteHtml = (html, plain) => {
      const dt = new DataTransfer();
      dt.setData('text/plain', plain);
      dt.setData('text/html', html);
      el.dispatchEvent(new ClipboardEvent('paste', { clipboardData: dt, bubbles: true, cancelable: true }));
    };

    const VARIANTS = {
      'plain paste " "': () => pastePlain(' '),
      'html paste <span white-space:pre-wrap> </span>': () =>
        pasteHtml('<span style="white-space:pre-wrap"> </span>', ' '),
      'html paste &nbsp;': () => pasteHtml('<span>&nbsp;</span>', ' '),
      'beforeinput insertText " "': () =>
        el.dispatchEvent(new InputEvent('beforeinput', { inputType: 'insertText', data: ' ', bubbles: true, cancelable: true })),
      'keydown Space + keypress': () => {
        key({ key: ' ', code: 'Space', keyCode: 32, which: 32 });
        el.dispatchEvent(new KeyboardEvent('keypress', { key: ' ', code: 'Space', keyCode: 32, which: 32, charCode: 32, bubbles: true, cancelable: true }));
      },
      'textInput event': () => {
        const ev = doc.createEvent('TextEvent');
        ev.initTextEvent?.('textInput', true, true, iframe.contentWindow, ' ', 0, 'en-US');
        el.dispatchEvent(ev);
      },
      // The routing option: the space typed INSIDE the bold run, before the toggle.
      'space inside the bold run ("a" B "x " B "b")': async () => {
        key({ key: 'b', code: 'KeyB', keyCode: 66, which: 66, ...cmd });
        pastePlain('x');
        await wait(80);
        pastePlain(' ');
        await wait(80);
        key({ key: 'b', code: 'KeyB', keyCode: 66, which: 66, ...cmd });
      },
    };

    const names = Object.keys(VARIANTS);
    for (const name of names) {
      pastePlain('a');
      await wait(100);
      await VARIANTS[name]();
      await wait(100);
      pastePlain('b');
      await wait(100);
      pastePlain('\n');
      await wait(150);
    }
    await wait(1500);

    key({ key: 'a', code: 'KeyA', keyCode: 65, which: 65, ...cmd });
    const dt = new DataTransfer();
    dt.setData('text/plain', '');
    el.dispatchEvent(new ClipboardEvent('copy', { clipboardData: dt, bubbles: true, cancelable: true }));
    const html = dt.getData('text/html');
    const plain = dt.getData('text/plain');
    key({ key: 'ArrowRight', code: 'ArrowRight', keyCode: 39, which: 39 });
    return { names, plain, html };
  });

  const lines = out.plain.replace(/[​﻿]/g, '').split('\n').filter((l) => l.length);
  console.log('  variant                                               result       verdict');
  out.names.forEach((n, i) => {
    const line = lines[i] ?? '(missing)';
    const shown = JSON.stringify(line);
    const codes = [...line].map((c) => c.charCodeAt(0).toString(16).padStart(4, "0")).join(" ");
    const verdict = line === "a b" ? "SPACE KEPT (U+0020)" : line === "ab" ? "dropped" : /a\u00a0b/.test(line) ? "NBSP - WRONG CHARACTER" : "?";
    console.log(`  ${n.padEnd(54)} ${shown.padEnd(12)} ${codes.padEnd(16)} ${verdict}`);
  });
  const boldRuns = [...out.html.matchAll(/<span[^>]*font-weight:\s*(?:700|bold)[^>]*>([\s\S]*?)<\/span>/gi)].map((m) => JSON.stringify(m[1].replace(/<[^>]+>/g, '')));
  console.log(`\n  bold runs in the html: ${boldRuns.join(', ') || 'none'}`);
} catch (err) {
  console.log(`\n  FAILED: ${err?.message ?? err}`);
} finally {
  if (!KEEP) await ctx.close();
}
