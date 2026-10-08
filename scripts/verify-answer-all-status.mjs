/**
 * "Besvar alle spørgsmål" says what it is doing while it works.
 *
 * The run is one request of 10-60s. Until 0.2.5 the panel said "Finder
 * spørgsmål" for all of it, and the request was a one-shot message that Chrome
 * kills with the service worker after 30s. It is now a stream of stages, and
 * this is the check that a person actually sees them: polled off the screen
 * while the run is out, in a real browser, against a real model.
 *
 * A textarea, not a Google Doc: the stages come from the server and the panel,
 * neither of which knows what editor is underneath, and a textarea needs no
 * Google session.
 *
 * Prereqs: backend on 127.0.0.1:8787, extension built against it.
 * COSTS REAL MODEL QUOTA (one run).
 *
 * Run: node scripts/verify-answer-all-status.mjs
 */
import { createServer } from 'node:http';
import { resolve } from 'node:path';
import { launch, reporter, shotsDir } from './docs-harness.mjs';

const EMAIL = process.env.AWA_TEST_EMAIL ?? 'modestlyeu+awatest@gmail.com';
const PASSWORD = process.env.AWA_TEST_PASSWORD ?? 'awa-test-2026-xK9';
const r = reporter();

const QUESTIONS = [
  { text: 'Hvad er hovedstaden i Danmark?', expect: /k[øo]benhavn/i },
  { text: 'Hvor mange dage har en uge?', expect: /\b7\b|syv/i },
  { text: 'Hvilken farve får man af blå og gul?', expect: /gr[øo]n/i },
];

const FIXTURE_HTML = `<!doctype html><meta charset="utf-8"><title>Opgaveark</title>
<body style="font:16px/1.6 system-ui;max-width:40rem;margin:3rem">
<h1>Opgaveark</h1><textarea id="editor" rows="14" style="width:100%">${QUESTIONS.map((q) => q.text).join('\n\n')}\n</textarea></body>`;

const server = createServer((_req, res) => {
  res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
  res.end(FIXTURE_HTML);
});
await new Promise((ok) => server.listen(0, '127.0.0.1', ok));
const FIXTURE = `http://127.0.0.1:${server.address().port}/`;

const ctx = await launch();
const page = ctx.pages()[0] ?? (await ctx.newPage());
const host = page.locator('awa-sidebar');
const panelText = () => page.evaluate(() => document.querySelector('awa-sidebar')?.shadowRoot?.textContent ?? '');

try {
  await page.goto(FIXTURE, { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(1200);
  await page.locator('#editor').click();
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

  await host.locator('button', { hasText: 'Besvar alle spørgsmål' }).first().click();
  await host.locator('button', { hasText: 'Straks' }).first().click();

  // Every stage that was ever on screen, in the order it first appeared.
  const STAGES = [
    ['read', /Læste dokumentet · \d+ linjer/],
    ['finding', /Finder spørgsmålene/],
    ['found', /Fandt 3 spørgsmål/],
    ['answering', /Formulerer svarene · \d+ af \d+/],
  ];
  const seen = [];
  let finished = false;
  for (let i = 0; i < 480 && !finished; i++) {
    const t = await panelText();
    for (const [name, re] of STAGES) {
      if (re.test(t) && !seen.includes(name)) {
        seen.push(name);
        await page.screenshot({ path: resolve(shotsDir, `answer-all-status-${seen.length}-${name}.png`) }).catch(() => {});
      }
    }
    finished = /Færdig|Fejl|blev fundet|ikke fundet/.test(t);
    if (!finished) await page.waitForTimeout(250);
  }
  const end = await panelText();
  await page.screenshot({ path: resolve(shotsDir, 'answer-all-status-end.png') }).catch(() => {});

  for (const [name] of STAGES) r.ok(`the panel said: ${name}`, seen.includes(name), seen.join(' → ') || 'nothing seen');
  r.ok('the run finished', /Færdig/.test(end), end.slice(-200));
  r.ok('no stage list left over once it was writing', !/Finder spørgsmålene|Formulerer svarene/.test(end));

  const value = await page.locator('#editor').inputValue();
  for (const [i, q] of QUESTIONS.entries()) {
    const from = value.indexOf(q.text);
    const to = i + 1 < QUESTIONS.length ? value.indexOf(QUESTIONS[i + 1].text) : value.length;
    const under = from < 0 ? '' : value.slice(from + q.text.length, to);
    r.ok(`answer under its own question: ${q.text}`, q.expect.test(under), JSON.stringify(under.slice(0, 120)));
  }
} catch (err) {
  r.ok('run completed', false, err instanceof Error ? err.message : String(err));
} finally {
  await ctx.close();
  server.close();
}
process.exit(r.summary() ? 1 : 0);
