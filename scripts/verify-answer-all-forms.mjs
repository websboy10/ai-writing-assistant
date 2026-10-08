/**
 * "Besvar alle" on a form that is answered INSIDE its lines.
 *
 * scripts/eval-forms.mjs proves the server PLANS a blank, a tick box and a
 * "Sandt / Falsk" as places to write into. This proves the other half: that
 * the extension writes there, in a real browser, and that "Fortryd alle svar"
 * puts back exactly what was written over. Once in a textarea and once in a
 * contenteditable, the two editor families that can do it.
 *
 * Prereqs: backend on 127.0.0.1:8787, extension built against it.
 * COSTS REAL MODEL QUOTA (two runs).
 *
 * Run: node scripts/verify-answer-all-forms.mjs
 */
import { createServer } from 'node:http';
import { resolve } from 'node:path';
import { launch, reporter, shotsDir } from './docs-harness.mjs';

const EMAIL = process.env.AWA_TEST_EMAIL ?? 'modestlyeu+awatest@gmail.com';
const PASSWORD = process.env.AWA_TEST_PASSWORD ?? 'awa-test-2026-xK9';
const r = reporter();

const LINES = [
  'Udfyld de tomme felter.',
  'Danmarks hovedstad er __________.',
  'En uge har ____ dage.',
  'Hvilke af disse er frugter? Sæt kryds.',
  '☐ Æble',
  '☐ Gulerod',
  '☐ Banan',
  'Hvad er hovedstaden i Sverige?',
  'a) Oslo',
  'b) Stockholm',
  'c) Helsinki',
  'Sandt eller falsk?',
  'Hvaler er fisk. Sandt / Falsk',
  'Forklar kort, hvad fotosyntese er.',
];

const FIXTURE_HTML = `<!doctype html><meta charset="utf-8"><title>Opgaveark</title>
<body style="font:16px/1.6 system-ui;max-width:40rem;margin:3rem">
<textarea id="plain" rows="18" style="width:100%">${LINES.join('\n')}\n</textarea>
<div id="rich" contenteditable="true" style="border:1px solid #999;padding:8px;margin-top:2rem">${LINES.map((l) => `<p>${l}</p>`).join('')}</div>
</body>`;

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
const awaLines = [];
page.on('console', (msg) => {
  const t = msg.text();
  if (t.startsWith('[AWA]')) awaLines.push(t);
});

/** The editor's lines as a person reads them, blank lines dropped. */
const read = (id) =>
  page.evaluate((id) => {
    const el = document.getElementById(id);
    const text = el instanceof HTMLTextAreaElement ? el.value : [...el.querySelectorAll('p, div')].map((b) => b.textContent).join('\n');
    return text.split('\n').map((l) => l.replace(/ /g, ' ').trim()).filter(Boolean);
  }, id);

async function waitForPanel(re, ms = 120_000) {
  for (let i = 0; i < ms / 250; i++) {
    const t = await panelText();
    if (re.test(t)) return t;
    await page.waitForTimeout(250);
  }
  return panelText();
}

try {
  await page.goto(FIXTURE, { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(1200);
  await page.locator('#plain').click();
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

  for (const id of ['plain', 'rich']) {
    console.log(`\n— ${id} —`);
    await page.locator(`#${id}`).click();
    await page.waitForTimeout(300);
    const before = await read(id);

    await host.locator('button', { hasText: 'Besvar alle spørgsmål' }).first().click();
    await host.locator('button', { hasText: 'Straks' }).first().click();
    const end = await waitForPanel(/Færdig|Fejl|blev fundet|ikke fundet/);
    await page.screenshot({ path: resolve(shotsDir, `answer-all-forms-${id}.png`) }).catch(() => {});
    r.ok(`${id}: the run finished`, /Færdig/.test(end), end.slice(0, 300));
    r.ok(`${id}: nothing was left unplaced`, !/Kunne ikke placeres/.test(end), end.slice(0, 400));

    const after = await read(id);
    const line = (re) => after.find((l) => re.test(l)) ?? '';
    const has = (name, re, not) => {
      const l = line(re);
      r.ok(`${id}: ${name}`, !!l && !(not && not.test(l)), JSON.stringify(l || after.slice(0, 16)));
    };
    has('the blank in a sentence was written into', /^Danmarks hovedstad er k[øo]benhavn\.$/i);
    has('a second blank, mid-sentence', /^En uge har (7|syv) dage\.$/i);
    has('the right boxes are ticked: Æble', /^☒ Æble$/);
    has('the right boxes are ticked: Banan', /^☒ Banan$/);
    has('the wrong box is left empty', /^☐ Gulerod$/);
    has('the right option is marked', /^b\) Stockholm ✓$/);
    has('the wrong options are untouched', /^a\) Oslo$/);
    has('"Sandt / Falsk" is settled on the line', /^Hvaler er fisk\. Falsk$/);
    const photo = after.indexOf('Forklar kort, hvad fotosyntese er.');
    r.ok(`${id}: an open question still gets its answer on the line below`, photo >= 0 && /lys|sol/i.test(after[photo + 1] ?? ''), JSON.stringify(after.slice(photo, photo + 2)));

    await host.locator('button', { hasText: 'Fortryd alle svar' }).first().click();
    await page.waitForTimeout(1200);
    const undone = await read(id);
    r.ok(`${id}: undo puts back exactly what was there`, undone.join('\n') === before.join('\n'), JSON.stringify(undone.filter((l, i) => l !== before[i]).slice(0, 4)));
    await host.locator('button', { hasText: 'Skjul' }).first().click().catch(() => {});
    await page.waitForTimeout(400);
  }
} catch (err) {
  r.ok('run completed', false, err instanceof Error ? err.message : String(err));
} finally {
  if (r.results.some((x) => !x.cond)) console.log(awaLines.filter((l) => /autonomous\.answers|engine\.fail/.test(l)).join('\n').slice(0, 3000));
  await ctx.close();
  server.close();
}
process.exit(r.summary() ? 1 : 0);
