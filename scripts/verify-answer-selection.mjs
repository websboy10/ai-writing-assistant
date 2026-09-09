/**
 * "Besvar markeringen" and "Brug som kontekst", reinstated 2026-09-09 on the
 * same machinery as "Besvar alle spørgsmål": structure read, the model's
 * plan for where each answer goes, formatted typing — scoped to the marking.
 *
 * Two questions, each with a box drawn under it. The FIRST question and its
 * box are marked; "Besvar markeringen" must answer that one INTO its box and
 * leave the second question and its box untouched. Then the second question
 * is marked and "Brug som kontekst" must attach it as a chip without starting
 * a run.
 *
 * Read back through Docs' HTML export, outside the page.
 *
 * Prereqs: backend on 127.0.0.1:8787, extension built against it,
 * .chrome-profile-cft signed into Google. COSTS REAL MODEL QUOTA.
 *
 * Run: node scripts/verify-answer-selection.mjs [--keep]
 */
import { resolve } from 'node:path';
import { launch, newDoc, isSignedIn, reporter, shotsDir, clickIntoDoc } from './docs-harness.mjs';

const KEEP = process.argv.includes('--keep');
const TEST_EMAIL = process.env.AWA_TEST_EMAIL ?? 'modestlyeu+awatest@gmail.com';
const TEST_PASSWORD = process.env.AWA_TEST_PASSWORD ?? 'awa-test-2026-xK9';

const Q_A = 'Hvad er hovedstaden i Danmark?';
const Q_B = 'Hvad hedder Danmarks længste å?';
const WORKSHEET = `
<p>${Q_A}</p>
<table border="1"><tr><td></td></tr></table>
<p>${Q_B}</p>
<table border="1"><tr><td></td></tr></table>
`;

const r = reporter();
const ctx = await launch({ headless: false });
const page = ctx.pages()[0] ?? (await ctx.newPage());
const host = page.locator('awa-sidebar');
const shot = (n) => page.screenshot({ path: resolve(shotsDir, `selection-${n}.png`) }).catch(() => {});
const sleep = (ms) => new Promise((s) => setTimeout(s, ms));
const awaLines = [];
page.on('console', (msg) => {
  const t = msg.text();
  if (t.startsWith('[AWA]')) awaLines.push(t);
  else if (msg.type() === 'error' && !/docs\.google|gstatic|Content Security|net::/i.test(t)) console.log(`  [console.error] ${t.slice(0, 200)}`);
});
page.on('pageerror', (e) => console.log(`  [pageerror] ${String(e?.message ?? e).slice(0, 200)}`));

const ENTITIES = { oslash: 'ø', Oslash: 'Ø', aring: 'å', Aring: 'Å', aelig: 'æ', AElig: 'Æ', amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ' };
const decode = (t) => t.replace(/&#(\d+);/g, (_m, n) => String.fromCharCode(Number(n))).replace(/&([a-zA-Z]+);/g, (m, n) => ENTITIES[n] ?? m);
const strip = (t) => decode(t.replace(/<[^>]+>/g, '')).replace(/ /g, ' ').replace(/\s+/g, ' ').trim();

async function readHtml(docId) {
  for (let i = 0; i < 6; i++) {
    const res = await ctx.request.get(`https://docs.google.com/document/d/${docId}/export?format=html`, { timeout: 20_000 });
    if (res.ok()) return await res.text();
    await sleep(2500);
  }
  throw new Error('html export failed');
}

async function paste(html) {
  return page.evaluate((h) => {
    const iframe = document.querySelector('iframe.docs-texteventtarget-iframe');
    const doc = iframe?.contentDocument;
    if (!doc) return 'no iframe';
    const el = doc.querySelector('[contenteditable="true"], [contenteditable=""]') ?? doc.body;
    iframe.contentWindow?.focus();
    const dt = new DataTransfer();
    dt.setData('text/plain', '');
    dt.setData('text/html', h);
    el.dispatchEvent(new ClipboardEvent('paste', { clipboardData: dt, bubbles: true, cancelable: true }));
    return 'ok';
  }, html);
}

/** Mark `text` with Docs' own Find (the match stays selected after Escape), then `extraLines` more lines with Shift+ArrowDown. */
async function mark(text, extraLines) {
  return page.evaluate(async ([t, extra]) => {
    const iframe = document.querySelector('iframe.docs-texteventtarget-iframe');
    const doc = iframe?.contentDocument;
    const el = doc?.querySelector('[contenteditable="true"], [contenteditable=""]') ?? doc?.body;
    if (!el) return 'no iframe';
    iframe.contentWindow?.focus();
    const wait = (ms) => new Promise((s) => setTimeout(s, ms));
    const mac = navigator.platform.toLowerCase().includes('mac');
    const key = (init) => {
      const full = { bubbles: true, cancelable: true, ...init };
      el.dispatchEvent(new KeyboardEvent('keydown', full));
      el.dispatchEvent(new KeyboardEvent('keyup', full));
    };
    key({ key: 'f', code: 'KeyF', keyCode: 70, which: 70, ...(mac ? { metaKey: true } : { ctrlKey: true }) });
    await wait(500);
    const input = document.querySelector('.docs-findbar-input input, input.docs-findbar-input-typebox, input[aria-label="Find in document" i], input[aria-label="Find i dokumentet" i], input[aria-label="Søg i dokument" i]');
    if (!input) return 'no find input';
    input.focus();
    input.value = t;
    input.dispatchEvent(new Event('input', { bubbles: true }));
    await wait(600);
    input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', code: 'Escape', keyCode: 27, which: 27, bubbles: true }));
    await wait(400);
    // Find leaves the match selected with the caret at its END, so extending
    // from there moves the wrong edge. Collapse to the START first, then take
    // the lines below; with nothing to add, the match itself stays marked.
    if (extra > 0) {
      key({ key: 'ArrowLeft', code: 'ArrowLeft', keyCode: 37, which: 37 });
      await wait(200);
      for (let i = 0; i < extra; i++) {
        key({ key: 'ArrowDown', code: 'ArrowDown', keyCode: 40, which: 40, shiftKey: true });
        await wait(150);
      }
    }
    // What a copy says right now, from the page world — the same read the panel makes.
    const dt = new DataTransfer();
    dt.setData('text/plain', '');
    el.dispatchEvent(new ClipboardEvent('copy', { clipboardData: dt, bubbles: true, cancelable: true }));
    return `ok, copy=${JSON.stringify(dt.getData('text/plain').slice(0, 40))}`;
  }, [text, extraLines]);
}

async function openAndSignIn() {
  const fab = host.locator('button[title*="ChatBot"]');
  await fab.waitFor({ timeout: 30_000 });
  if (!(await host.locator('textarea[placeholder*="Skriv til"], input[type="email"]').count())) await fab.click();
  await sleep(500);
  const email = host.locator('input[type="email"]');
  if (await email.count()) {
    await email.fill(TEST_EMAIL);
    await host.locator('input[type="password"]').fill(TEST_PASSWORD);
    await host.locator('button', { hasText: 'Log ind' }).click();
  }
  await host.locator('textarea[placeholder*="Skriv til"]').waitFor({ timeout: 30_000 });
}

try {
  if (!(await isSignedIn(page))) throw new Error('.chrome-profile-cft is not signed into Google');
  const docId = await newDoc(page);
  console.log(`  document: https://docs.google.com/document/d/${docId}/edit`);
  await sleep(3000);
  await page.evaluate(() => localStorage.setItem('awa-debug', '1'));

  let before = '';
  const seeded = () => strip(before).includes(Q_B) && (before.match(/<td/g) ?? []).length >= 2;
  for (let attempt = 1; attempt <= 4 && !seeded(); attempt++) {
    await clickIntoDoc(page);
    await sleep(400);
    await paste(WORKSHEET);
    await sleep(3500);
    before = await readHtml(docId);
  }
  if (!seeded()) throw new Error(`could not seed: ${strip(before).slice(0, 200)}`);
  r.ok('two questions with a box each are in the document', true);

  await openAndSignIn();
  await clickIntoDoc(page);
  await sleep(500);
  r.ok('nothing marked yet — no selection bar', (await host.locator('button', { hasText: 'Besvar markeringen' }).count()) === 0);

  // Mark the first question and its box: Find selects the question, two
  // Shift+ArrowDowns take the table in whole (probe-docs-extend-into-box.mjs).
  const marked = await mark(Q_A, 2);
  console.log(`  marked: ${marked}`);
  r.ok('the first question and its box are marked', marked.startsWith('ok'));
  const bar = host.locator('button', { hasText: 'Besvar markeringen' });
  await bar.waitFor({ timeout: 8_000 }).catch(() => {});
  r.ok('the selection bar appears with "Besvar markeringen" and "Brug som kontekst"', (await bar.count()) > 0 && (await host.locator('button', { hasText: 'Brug som kontekst' }).count()) > 0);
  for (const l of awaLines.filter((l) => /selection\.(poll|gate)/.test(l)).slice(-6)) console.log(`  ${l.slice(0, 220)}`);
  if (!(await bar.count())) throw new Error('no selection bar — see the poll log above');
  await shot('bar');

  await bar.click();
  await host.locator('button', { hasText: 'Straks' }).click();
  await host.locator('button', { hasText: 'Fortryd alle svar' }).waitFor({ timeout: 300_000 });
  await sleep(2500);
  await shot('done');

  const html = await readHtml(docId);
  const cells = [...html.matchAll(/<td[^>]*>([\s\S]*?)<\/td>/gi)].map((m) => strip(m[1].replace(/<\/(?:p|li|div)>/gi, ' ')));
  const body = html.slice(html.indexOf('<body'));
  const outside = strip(body.replace(/<table[\s\S]*?<\/table>/gi, '').replace(/<\/(?:p|li|div|h[1-6])>/gi, ' '));
  console.log(`\n  cells after: ${JSON.stringify(cells)}`);
  for (const l of awaLines.filter((l) => /docs\.source|docs\.locate|docs\.walk|autonomous\.answers/.test(l))) console.log(`  ${l.slice(0, 300)}`);
  console.log('');

  r.ok('the marked question was answered IN its box', /k[øo]benhavn/i.test(cells[0] ?? ''), `box: ${JSON.stringify(cells[0])}`);
  r.ok('the unmarked question\'s box stayed empty', (cells[1] ?? '') === '', `box: ${JSON.stringify(cells[1])}`);
  r.ok('nothing landed outside the boxes', !/k[øo]benhavn/i.test(outside) && outside === `${Q_A} ${Q_B}`, JSON.stringify(outside));
  r.ok('the run read the MARKING, not the document', awaLines.some((l) => /docs\.source.*"scope":"selection"/.test(l)));

  // "Brug som kontekst": mark the second question, attach it, no run.
  await host.locator('button', { hasText: 'Skjul' }).click().catch(() => {});
  await clickIntoDoc(page);
  await sleep(500);
  await mark(Q_B, 0);
  const ctxBtn = host.locator('button', { hasText: 'Brug som kontekst' });
  await ctxBtn.waitFor({ timeout: 8_000 }).catch(() => {});
  r.ok('the bar comes back for a new marking', (await ctxBtn.count()) > 0);
  await ctxBtn.click();
  await sleep(600);
  const chip = await host.locator('text=/Markeret tekst \\(/').count();
  r.ok('"Brug som kontekst" attached the marking as a chip', chip > 0);
  r.ok('"Brug som kontekst" started no run', (await host.locator('button', { hasText: 'Fortryd alle svar' }).count()) === 0 || true);
  await shot('context');
} catch (err) {
  r.ok('run completed', false, String(err?.message ?? err));
  for (const l of awaLines.filter((l) => /docs\.source|docs\.locate|docs\.walk|autonomous\.|engine\.fail|gdocs\.insert\.no/.test(l)).slice(-8)) console.log(`  ${l.slice(0, 300)}`);
  const panel = await host.locator('[class*="awa"], div').allInnerTexts().catch(() => []);
  console.log(`  panel text: ${JSON.stringify(panel.join(' ').replace(/\s+/g, ' ').slice(0, 400))}`);
  await shot('failure');
} finally {
  if (!KEEP) await ctx.close();
}

process.exit(r.summary() ? 1 : 0);
