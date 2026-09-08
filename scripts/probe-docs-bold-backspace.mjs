/**
 * Does a Backspace right after Cmd+B throw the pending bold away?
 *
 * The first formatted run on a real worksheet (2026-09-08) pressed Cmd+B, typed,
 * pressed Cmd+B again — the adapter log shows both presses — and the word came
 * out plain. The one thing that run did which the 8/8 probe did not was "Skriv
 * som et menneske": a slip typed and Backspaced INSIDE the bold run. If Docs
 * drops a pending toggle on Backspace, that is the whole difference, and the
 * fix is in richsteps.ts (no slips inside a marked run), not in the adapter.
 *
 * Four sequences, each between "a " and " b", each read back for bold runs.
 *
 * Prereqs: .chrome-profile-cft signed into Google.
 * Run: node scripts/probe-docs-bold-backspace.mjs
 */
import { launch, newDoc, isSignedIn, clickIntoDoc } from './docs-harness.mjs';

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
    const BOLD = { key: 'b', code: 'KeyB', keyCode: 66, which: 66, ...cmd };
    const BS = { key: 'Backspace', code: 'Backspace', keyCode: 8, which: 8 };
    const paste = (t) => {
      const dt = new DataTransfer();
      dt.setData('text/plain', t);
      el.dispatchEvent(new ClipboardEvent('paste', { clipboardData: dt, bubbles: true, cancelable: true }));
    };
    const space = () => el.dispatchEvent(new InputEvent('beforeinput', { inputType: 'insertText', data: ' ', bubbles: true, cancelable: true }));

    const SEQ = {
      'clean: B, "Vigtigt", B': async () => { key(BOLD); await wait(100); paste('Vig'); await wait(80); paste('tigt'); await wait(100); key(BOLD); },
      'slip inside: B, "Vig", "u", Backspace, "tigt", B': async () => {
        key(BOLD); await wait(100); paste('Vig'); await wait(80); paste('u'); await wait(80); key(BS); await wait(80); paste('tigt'); await wait(100); key(BOLD);
      },
      'slip at start: B, "u", Backspace, "Vigtigt", B': async () => {
        key(BOLD); await wait(100); paste('u'); await wait(80); key(BS); await wait(80); paste('Vig'); await wait(80); paste('tigt'); await wait(100); key(BOLD);
      },
      'B pressed, then a 700ms pause, then text': async () => {
        key(BOLD); await wait(700); paste('Vig'); await wait(80); paste('tigt'); await wait(100); key(BOLD);
      },
      'B, Enter first (as the run does: newline then bold), text': async () => {
        key({ key: 'Enter', code: 'Enter', keyCode: 13, which: 13 }); await wait(150); key(BOLD); await wait(100); paste('Vig'); await wait(80); paste('tigt'); await wait(100); key(BOLD);
      },
    };
    const names = Object.keys(SEQ);
    for (const n of names) {
      paste('a'); await wait(80); space(); await wait(80);
      await SEQ[n]();
      await wait(100); space(); await wait(80); paste('b'); await wait(100);
      key({ key: 'Enter', code: 'Enter', keyCode: 13, which: 13 }); await wait(200);
    }
    await wait(1200);
    key({ key: 'a', code: 'KeyA', keyCode: 65, which: 65, ...cmd });
    const dt = new DataTransfer();
    dt.setData('text/plain', '');
    el.dispatchEvent(new ClipboardEvent('copy', { clipboardData: dt, bubbles: true, cancelable: true }));
    const html = dt.getData('text/html');
    key({ key: 'ArrowRight', code: 'ArrowRight', keyCode: 39, which: 39 });
    return { names, html };
  });

  console.log('  sequences, in order:');
  out.names.forEach((n, i) => console.log(`    ${i + 1}. ${n}`));
  console.log('\n  every paragraph Docs holds (the Enter case splits into two):');
  const paras = [...out.html.matchAll(/<p[^>]*>([\s\S]*?)<\/p>/gi)].map((m) => m[1]);
  paras.forEach((p, i) => {
    const bold = [...p.matchAll(/<span[^>]*font-weight:\s*(?:700|bold)[^>]*>([\s\S]*?)<\/span>/gi)].map((m) => m[1].replace(/<[^>]+>/g, ''));
    const text = p.replace(/<[^>]+>/g, '').replace(/&nbsp;/g, ' ');
    console.log(`    p${i}  text ${JSON.stringify(text).padEnd(16)} bold ${JSON.stringify(bold)}`);
  });
} catch (err) {
  console.log(`\n  FAILED: ${err?.message ?? err}`);
} finally {
  await ctx.close();
}
