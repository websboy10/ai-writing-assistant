/**
 * "Tænker" and "Søger på internettet" — on screen, in a real browser.
 *
 * The backend emitting a status event proves nothing about what a person sees.
 * The wait before the first word is now made of two parts the user has no other
 * way to know about (deciding ~0.8s, searching 2-4s), and this is the check
 * that the panel actually says which one is happening — and then stops saying
 * it the instant there are words to show instead.
 *
 * Two questions, chosen so one searches and one cannot:
 *   1  a maths question   → "Tænker" only
 *   2  a current-events question → "Tænker", then "Søger på internettet"
 *
 * Prereqs: backend on 127.0.0.1:8787, extension built against it.
 * COSTS REAL MODEL QUOTA (two answers, one of them a search).
 *
 * Run: node scripts/verify-status.mjs
 */
import { createServer } from 'node:http';
import { resolve } from 'node:path';
import { launch, reporter, shotsDir } from './docs-harness.mjs';

const EMAIL = process.env.AWA_EMAIL ?? 'tester@example.com';
const PASSWORD = process.env.AWA_PASSWORD ?? 'awa-test-2026';
const r = reporter();

const FIXTURE_HTML = `<!doctype html><meta charset="utf-8"><title>Notat</title>
<body style="font:16px/1.6 system-ui;max-width:40rem;margin:3rem">
<h1>Notat</h1><textarea id="editor" rows="6" style="width:100%"></textarea></body>`;

const server = createServer((_req, res) => {
  res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
  res.end(FIXTURE_HTML);
});
await new Promise((ok) => server.listen(0, '127.0.0.1', ok));
const FIXTURE = `http://127.0.0.1:${server.address().port}/`;

const ctx = await launch();
const page = ctx.pages()[0] ?? (await ctx.newPage());
const host = page.locator('awa-sidebar');
const shot = (n) => page.screenshot({ path: resolve(shotsDir, `status-${n}.png`) }).catch(() => {});
const panelText = () => page.evaluate(() => document.querySelector('awa-sidebar')?.shadowRoot?.textContent ?? '');

/**
 * Poll the panel while the answer is being produced and record every status
 * label that was ever on screen, plus whether one was still there once the
 * draft had words in it. Polling beats waiting for one moment: "Tænker" can be
 * gone in under a second and a single well-timed look would miss it.
 */
async function askAndWatch(prompt, tag) {
  await host.locator('textarea').first().fill(prompt);
  await host.locator('button[title="Send"]').first().click();

  const seen = new Set();
  let statusWhileText = null;
  for (let i = 0; i < 120; i++) {
    const t = await panelText();
    // A screenshot the first time each label appears. The label can be gone in
    // under a second, so a shot taken after the run would never catch it — and
    // "the operator can see what it looks like" is half the point of this file.
    for (const [label, file] of [['Tænker', 'thinking'], ['Søger på internettet', 'searching']]) {
      if (new RegExp(label).test(t) && !seen.has(label)) {
        seen.add(label);
        await shot(`${tag}-${file}`);
      }
    }
    // The draft area has real words AND a status label is still showing.
    const draft = await host.locator('.whitespace-pre-wrap').last().innerText().catch(() => '');
    if (draft.length > 40 && /Tænker|Søger på internettet/.test(draft)) statusWhileText = draft.slice(0, 80);
    if (draft.length > 120) break;
    await page.waitForTimeout(250);
  }
  return { seen, statusWhileText };
}

try {
  await page.goto(FIXTURE, { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(1200);
  const fab = host.locator('button[title*="ChatBot"]');
  await fab.waitFor({ timeout: 30_000 });
  await fab.click();
  await page.waitForTimeout(700);

  const emailField = host.locator('input[type="email"]');
  if (await emailField.count()) {
    await emailField.fill(EMAIL);
    await host.locator('input[type="password"]').fill(PASSWORD);
    await host.getByRole('button', { name: 'Log ind', exact: true }).click();
    await page.waitForTimeout(3500);
  }
  r.ok('signed in — the composer is on screen', (await host.locator('textarea').count()) > 0);

  // ---- a question it can answer from memory --------------------------------
  const maths = await askAndWatch('Hvad er 17 gange 24? Svar kort.', '01-maths');
  await shot('01-maths');
  r.ok('said "Tænker" while waiting', maths.seen.has('Tænker'), [...maths.seen].join(', ') || 'nothing seen');
  r.ok('did NOT claim to search', !maths.seen.has('Søger på internettet'), [...maths.seen].join(', '));
  r.ok('no label left over once the draft had words', maths.statusWhileText === null, maths.statusWhileText ?? '');

  await host.locator('button', { hasText: 'Ny samtale' }).first().click().catch(() => {});
  await page.waitForTimeout(800);

  // ---- a question that has to be looked up ---------------------------------
  const news = await askAndWatch('Hvad er der sket med elpriserne i Danmark for nylig?', '02-search');
  await shot('02-search');
  r.ok('said "Tænker" first', news.seen.has('Tænker'), [...news.seen].join(', ') || 'nothing seen');
  r.ok('then said "Søger på internettet"', news.seen.has('Søger på internettet'), [...news.seen].join(', '));
  r.ok('no label left over once the draft had words', news.statusWhileText === null, news.statusWhileText ?? '');

  const after = await panelText();
  r.ok('the sources line appeared under the searched answer', /Kilder/.test(after), after.slice(-160));
} catch (err) {
  r.ok('run completed', false, String(err?.message ?? err));
  await shot('failure');
} finally {
  await ctx.close();
  server.close();
}

process.exit(r.summary() ? 1 : 0);
