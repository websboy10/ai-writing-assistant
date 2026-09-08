/**
 * A worksheet for the operator to WATCH being answered.
 *
 * Not a verification — that is verify-formatted-answers.mjs. This builds a
 * realistic Danish form with every kind of formatting a real one carries,
 * prints its link BEFORE the run starts so the document can be opened and
 * watched while "Besvar alle spørgsmål" types into it slowly, and leaves the
 * browser open when it is done.
 *
 * The extension in .output must be a build WITH the feature (not the store
 * build), pointing at whatever backend it should demonstrate.
 *
 * Prereqs: .chrome-profile-cft signed into Google. COSTS REAL MODEL QUOTA.
 *
 * Run: node scripts/demo-worksheet.mjs [--wpm 60]
 */
import { launch, newDoc, isSignedIn, clickIntoDoc } from './docs-harness.mjs';

const TEST_EMAIL = process.env.AWA_TEST_EMAIL ?? 'modestlyeu+awatest@gmail.com';
const TEST_PASSWORD = process.env.AWA_TEST_PASSWORD ?? 'awa-test-2026-xK9';
const wpmArg = process.argv.indexOf('--wpm');
const WPM = wpmArg !== -1 ? Number(process.argv[wpmArg + 1]) : 80;

const WORKSHEET = `
<h1>Medarbejderudviklingssamtale 2026</h1>
<p><b>Udfyld skemaet nedenfor.</b> Svar så konkret som muligt, og brug gerne eksempler fra året.</p>

<h2>Del 1 — Året der gik</h2>
<p>1. Hvad er du mest stolt af i år?</p>
<ul><li>Tænk på både faglige og personlige resultater</li><li>Nævn gerne et konkret eksempel</li></ul>
<table border="1"><tr><td style="width:450pt;height:60pt"></td></tr></table>

<p>2. Nævn dine tre vigtigste mål for det kommende år:</p>
<ol><li></li></ol>

<h2>Del 2 — Samarbejde</h2>
<table border="1">
<tr><td style="width:200pt"><b>Spørgsmål</b></td><td style="width:250pt"><b>Dit svar</b></td></tr>
<tr><td style="width:200pt">3. Hvordan oplever du samarbejdet i teamet?</td><td style="width:250pt"></td></tr>
<tr><td style="width:200pt">4. Hvad har du brug for fra din leder?</td><td style="width:250pt"></td></tr>
</table>

<h2>Del 3 — Læring</h2>
<p>5. Beskriv kort en situation i år, hvor du lærte noget nyt. Skriv det vigtigste ord i sætningen med fed.</p>
<p>6. Hvilke to ting vil du gøre anderledes næste år? Skriv dem som punkter.</p>
`;

const ctx = await launch({ headless: false, windowSize: '1440,1000' });
const page = ctx.pages()[0] ?? (await ctx.newPage());
const host = page.locator('awa-sidebar');
const sleep = (ms) => new Promise((s) => setTimeout(s, ms));

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

try {
  if (!(await isSignedIn(page))) throw new Error('.chrome-profile-cft is not signed into Google');
  const docId = await newDoc(page);
  await sleep(3000);
  await clickIntoDoc(page);
  await sleep(400);
  await paste(WORKSHEET);
  await sleep(3000);
  // A title, so it is findable in Drive afterwards.
  await page.evaluate(() => {
    const t = document.querySelector('input.docs-title-input');
    if (t) {
      const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set;
      setter?.call(t, 'MUS 2026 — demo (ChatBot Skriv)');
      t.dispatchEvent(new Event('input', { bubbles: true }));
      t.dispatchEvent(new Event('change', { bubbles: true }));
      t.blur();
    }
  });
  await sleep(800);

  console.log(`\n  ÅBN OG SE MED:  https://docs.google.com/document/d/${docId}/edit\n`);

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

  // Tempo and human typing, as a person watching would want them.
  await host.locator('input[type="range"]').first().evaluate((el, v) => {
    const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set;
    setter?.call(el, String(v));
    el.dispatchEvent(new Event('input', { bubbles: true }));
    el.dispatchEvent(new Event('change', { bubbles: true }));
  }, WPM);
  const human = host.locator('input[type="checkbox"]').first();
  if (!(await human.isChecked())) await human.check();

  await clickIntoDoc(page);
  await sleep(500);
  await host.locator('button', { hasText: 'Besvar alle spørgsmål' }).click();
  await host.locator('button', { hasText: 'Langsomt' }).click();
  console.log(`  kører: Langsomt, ${WPM} ord/min, Skriv som et menneske til\n`);

  await host.locator('button', { hasText: 'Fortryd alle svar' }).waitFor({ timeout: 1_800_000 });
  const unplaced = await host.locator('text=Kunne ikke placeres').count();
  console.log(`  færdig.${unplaced ? '  (noget blev rapporteret som ikke placeret — se panelet)' : ''}`);
  console.log('  Browseren bliver stående åben. Luk den selv, når du er færdig med at kigge.\n');
  // Keep the browser open: the process stays alive until the operator closes it.
  await new Promise(() => {});
} catch (err) {
  console.log(`\n  FEJL: ${err?.message ?? err}`);
  await ctx.close();
}
