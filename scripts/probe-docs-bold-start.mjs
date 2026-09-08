/**
 * A bold word at the START of a paragraph, typed letter by letter after a
 * synthetic Cmd+B, while the page's main thread is half busy: does every
 * letter survive?
 *
 * verify-formatted-answers.mjs (2026-09-09) read back "V​​gtigt"
 * in real bold — the second letter replaced by two zero-width spaces, which
 * is exactly what Docs' hidden input frame holds when nothing is marked.
 * Once in two runs; the same word came out whole the run before.
 *
 * Twenty times: Enter, Cmd+B, "V" "i" "g" "t" pasted 130 ms apart, Cmd+B,
 * a space (beforeinput), "ok". Read back from the export; every paragraph
 * must be "Vigt ok" with "Vigt" bold.
 *
 * Prereqs: .chrome-profile-cft signed into Google. No model quota.
 * Run: node scripts/probe-docs-bold-start.mjs
 */
import { launch, newDoc, isSignedIn, clickIntoDoc } from './docs-harness.mjs';

const sleep = (ms) => new Promise((s) => setTimeout(s, ms));
const ctx = await launch({ headless: false });
const page = ctx.pages()[0] ?? (await ctx.newPage());
const REPS = 20;

try {
  if (!(await isSignedIn(page))) throw new Error('.chrome-profile-cft is not signed into Google');
  const docId = await newDoc(page);
  console.log(`  doc: https://docs.google.com/document/d/${docId}/edit\n`);
  await sleep(3000);
  await clickIntoDoc(page);
  await sleep(500);

  await page.evaluate(async (reps) => {
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
    const paste = (t) => {
      const dt = new DataTransfer();
      dt.setData('text/plain', t);
      el.dispatchEvent(new ClipboardEvent('paste', { clipboardData: dt, bubbles: true, cancelable: true }));
    };
    const bold = () => { iframe.contentWindow?.focus(); key({ key: 'b', code: 'KeyB', keyCode: 66, which: 66, ...cmd }); };
    for (let r = 0; r < reps; r++) {
      bold(); await wait(90);
      for (const ch of ['V', 'i', 'g', 't']) { paste(ch); await wait(130); }
      bold(); await wait(90);
      el.dispatchEvent(new InputEvent('beforeinput', { inputType: 'insertText', data: ' ', bubbles: true, cancelable: true }));
      await wait(130);
      paste('ok'); await wait(200);
      key({ key: 'Enter', code: 'Enter', keyCode: 13, which: 13 }); await wait(900);
    }
    await wait(1500);
  }, REPS);

  const res = await ctx.request.get(`https://docs.google.com/document/d/${docId}/export?format=html`, { timeout: 20_000 });
  const html = await res.text();
  const boldClasses = [...html.matchAll(/\.(c\d+)\{[^}]*font-weight:\s*(?:700|bold)/g)].map((m) => m[1]);
  const paras = [...html.matchAll(/<p[^>]*>([\s\S]*?)<\/p>/gi)].map((m) => m[1]);
  const show = (s) => s.replace(/&#8203;/g, '‹ZW›').replace(/&nbsp;/g, ' ').replace(/<span class="([^"]*)"[^>]*>([\s\S]*?)<\/span>/g, (_m, cls, t) => (cls.split(/\s+/).some((c) => boldClasses.includes(c)) ? `**${t}**` : t)).replace(/<[^>]+>/g, '').trim();
  const lines = paras.map(show).filter(Boolean);
  const good = lines.filter((l) => l === '**Vigt** ok').length;
  console.log(`  (main thread ~50% busy)  correct: ${good}/${lines.length}`);
  for (const l of lines.filter((l) => l !== '**Vigt** ok')) console.log(`    wrong: ${JSON.stringify(l)}`);
} catch (err) {
  console.log(`\n  FAILED: ${err?.message ?? err}`);
} finally {
  await ctx.close();
}
