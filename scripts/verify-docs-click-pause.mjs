/**
 * A click in the document while an answer is being typed.
 *
 * Docs writes wherever its caret stands, so a click mid-run used to send the
 * rest of the answer to the clicked spot (2026-10-08: half an answer on the
 * end of another question). The run must pause on the click, write nothing
 * more, refuse to go on from the wrong place, and go on correctly once the
 * caret is back.
 *
 * Prereqs: backend on 127.0.0.1:8787, extension built against it, profile
 * signed into Google. COSTS REAL MODEL QUOTA (two runs).
 *
 * Run: node scripts/verify-docs-click-pause.mjs
 */
import { resolve } from 'node:path';
import { writeFileSync } from 'node:fs';
import { launch, newDoc, isSignedIn, readDoc, reporter, shotsDir, clickIntoDoc } from './docs-harness.mjs';

const TEST_EMAIL = process.env.AWA_TEST_EMAIL ?? 'modestlyeu+awatest@gmail.com';
const TEST_PASSWORD = process.env.AWA_TEST_PASSWORD ?? 'awa-test-2026-xK9';
const FIRST = 'Denne linje skal ingen skrive i.';
const QUESTION = 'Forklar med tre hele sætninger, hvad fotosyntese er.';

const r = reporter();
const ctx = await launch();
const page = ctx.pages()[0] ?? (await ctx.newPage());
const host = page.locator('awa-sidebar');
const sleep = (ms) => new Promise((s) => setTimeout(s, ms));
const awaLines = [];
page.on('console', (m) => m.text().startsWith('[AWA]') && awaLines.push(m.text()));
const panel = () => page.evaluate(() => document.querySelector('awa-sidebar')?.shadowRoot?.textContent ?? '');
const caret = () =>
  page.evaluate(() => {
    const c = document.querySelector('.kix-cursor-caret')?.getBoundingClientRect();
    return c && c.height > 0 ? { x: c.left, y: c.top + c.height / 2 } : null;
  });
const flat = (s) => s.replace(/\s+/g, ' ').trim();

async function paste(html) {
  await page.evaluate((h) => {
    const iframe = document.querySelector('iframe.docs-texteventtarget-iframe');
    const doc = iframe.contentDocument;
    const el = doc.querySelector('[contenteditable="true"], [contenteditable=""]') ?? doc.body;
    iframe.contentWindow?.focus();
    const dt = new DataTransfer();
    dt.setData('text/plain', '');
    dt.setData('text/html', h);
    el.dispatchEvent(new ClipboardEvent('paste', { clipboardData: dt, bubbles: true, cancelable: true }));
  }, html);
}

async function signIn() {
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

/** Starts a slow run, lets it type for a while, clicks on the first line. Returns where the caret was. */
async function startAndClickAway(name) {
  const docId = await newDoc(page);
  console.log(`\n  [${name}] https://docs.google.com/document/d/${docId}/edit`);
  await sleep(3000);
  for (let i = 0; i < 4 && !flat(await readDoc(ctx, docId)).includes(QUESTION); i++) {
    await clickIntoDoc(page);
    await paste(`<p>${FIRST}</p><p>${QUESTION}</p>`);
    await sleep(3500);
  }
  await signIn();
  await clickIntoDoc(page);
  await host.locator('button', { hasText: 'Besvar alle spørgsmål' }).click();
  await host.locator('button', { hasText: 'Langsomt' }).first().click();
  // The engine's own word for it: the panel's help text says "skriver" too.
  const starts = awaLines.filter((l) => l.includes('engine.start')).length;
  for (let i = 0; i < 240 && awaLines.filter((l) => l.includes('engine.start')).length === starts; i++) await sleep(500);
  await sleep(6000); // a few words in
  const at = await caret();
  if (!at) throw new Error('no caret on screen while typing');
  // The first line: two lines of body text above the answer's line.
  const box = await page.locator('[class*="kix-page"]').first().boundingBox();
  await page.mouse.click(at.x + 80, Math.max(box.y + 20, at.y - 70));
  await sleep(1500);
  r.ok(`[${name}] the run paused on the click and says why`, /du klikkede i dokumentet/.test(await panel()), (await panel()).slice(0, 200));
  const then = flat(await readDoc(ctx, docId));
  await sleep(5000);
  const later = flat(await readDoc(ctx, docId));
  r.ok(`[${name}] nothing more was written while paused`, then === later, JSON.stringify(later.slice(0, 200)));
  return { docId, at };
}

const finished = async () => {
  for (let i = 0; i < 480 && !/Færdig|Fejl|Fortryd alle svar/i.test(await panel()); i++) await sleep(500);
  await sleep(2500);
  return panel();
};

try {
  if (!(await isSignedIn(page))) throw new Error('.chrome-profile-cft is not signed into Google');

  // 1 — going on from the wrong place is refused, and the clicked line stays clean.
  let run = await startAndClickAway('wrong place');
  await host.locator('button', { hasText: 'Fortsæt' }).first().click();
  await finished();
  let text = flat(await readDoc(ctx, run.docId));
  writeFileSync(resolve(shotsDir, 'click-pause-wrong.txt'), text);
  r.ok('[wrong place] the line that was clicked is untouched', text.includes(FIRST) && text.includes(QUESTION), JSON.stringify(text.slice(0, 260)));
  await page.screenshot({ path: resolve(shotsDir, 'click-pause-wrong.png') }).catch(() => {});
  await host.locator('button', { hasText: 'Skjul' }).first().click().catch(() => {});

  // 2 — caret put back where it was: the run goes on and the answer is whole.
  run = await startAndClickAway('caret back');
  await page.mouse.click(run.at.x + 1, run.at.y);
  await sleep(800);
  await host.locator('button', { hasText: 'Fortsæt' }).first().click();
  const end = await finished();
  text = flat(await readDoc(ctx, run.docId));
  r.ok('[caret back] the run finished', /Færdig/i.test(end), end.slice(0, 200));
  r.ok('[caret back] both lines of the form are untouched', text.includes(FIRST) && text.includes(QUESTION), JSON.stringify(text.slice(0, 260)));
  const answer = text.slice(text.indexOf(QUESTION) + QUESTION.length).trim();
  r.ok('[caret back] the answer is three whole sentences about photosynthesis', (answer.match(/[.!?](\s|$)/g) ?? []).length >= 3 && /lys|sol/i.test(answer), JSON.stringify(answer));
  console.log(`  answer: ${answer}`);
  await page.screenshot({ path: resolve(shotsDir, 'click-pause-back.png') }).catch(() => {});
} catch (err) {
  r.ok('run completed', false, String(err?.message ?? err));
  await page.screenshot({ path: resolve(shotsDir, 'click-pause-failure.png') }).catch(() => {});
} finally {
  writeFileSync(resolve(shotsDir, 'click-pause-awa.log'), awaLines.join('\n'));
  if (r.results.some((x) => !x.cond)) console.log(awaLines.filter((l) => /pause|verifyIntact|engine\.(fail|start|done)|locate/.test(l)).join('\n').slice(0, 3000));
  await ctx.close();
}
process.exit(r.summary() ? 1 : 0);
