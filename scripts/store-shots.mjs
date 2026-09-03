/**
 * The four Chrome Web Store screenshots, taken from the real product.
 *
 * Not mockups and not the test fixture. Every shot is this extension doing the
 * thing the listing claims, in a real Google document, at exactly 1280x800 —
 * the store rejects anything else at upload.
 *
 * WHY GOOGLE DOCS AND NOT THE LOCAL FIXTURE: two reasons, and the second is the
 * one that decided it. The listing's strongest claim is that this writes into
 * Google Docs, which most extensions cannot, so showing it four times is worth
 * more than any wording. And the panel's footer names its insertion target: on
 * a locally served page that reads "text area — 127.0.0.1:53211", which is a
 * developer's machine leaking into a store listing. In a Google document the
 * same line reads "Google Docs-dokument".
 *
 * ORDER IS LOAD BEARING. The transport bar stays on screen after a run until
 * it is dismissed, so the clean states are photographed first and the
 * insertion last.
 *
 * Prereqs: extension built (production, no VITE_BACKEND_URL) and the
 * .chrome-profile-cft profile signed into Google.
 *
 * Run: node scripts/store-shots.mjs
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { launch, root, clickIntoDoc, typeIntoDoc, newDoc, isSignedIn } from './docs-harness.mjs';

const EMAIL = process.env.AWA_EMAIL ?? 'tester@example.com';
const PASSWORD = process.env.AWA_PASSWORD ?? 'awa-test-2026';
const OUT = resolve(root, 'store-assets');
mkdirSync(OUT, { recursive: true });

// Ordinary Danish office material, so a reviewer sees the product used for
// what it is for, and short enough that the answers stay on one screen.
const DOC_TEXT = [
  'Medarbejdersamtale 2026',
  '',
  'Hvad er status på dine opgaver?',
  '',
  'Hvad vil du gerne blive bedre til?',
  '',
  'Hvad har du brug for fra din leder?',
  '',
].join('\n');

// The signed-in Google account's photo sits in the Docs header, and a store
// listing is a public page. Hiding the avatar removes a real person from a
// marketing asset; it changes nothing about the product being shown.
const HIDE_AVATAR = 'img[src*="googleusercontent.com"]{visibility:hidden!important}';

const shots = [];
async function shot(name, page, note) {
  await page.addStyleTag({ content: HIDE_AVATAR }).catch(() => {});
  await page.screenshot({ path: resolve(OUT, `${name}.png`) });
  shots.push(name);
  console.log(`  ✓ ${name}.png — ${note}`);
}

const ctx = await launch({ viewport: { width: 1280, height: 800 }, windowSize: '1360,900' });
const page = ctx.pages()[0] ?? (await ctx.newPage());
const host = page.locator('awa-sidebar');
const btn = (name) => host.getByRole('button', { name, exact: true });

async function openPanelAndSignIn() {
  await host.locator('button[title*="Skriveassistent"]').first().click();
  await page.waitForTimeout(1200);
  const emailField = host.locator('input[type="email"]');
  if (await emailField.count()) {
    await emailField.fill(EMAIL);
    await host.locator('input[type="password"]').fill(PASSWORD);
    await btn('Log ind').click();
    await page.waitForTimeout(4000);
  }
}

try {
  // isSignedIn navigates to the Docs home to read the URL, so it has to run
  // before newDoc — after it, the new document is simply gone.
  if (!(await isSignedIn(page))) {
    throw new Error('the .chrome-profile-cft profile is not signed into Google — open it once and sign in');
  }

  // ============ Document A: the panel's everyday states ==================
  await newDoc(page);
  await page.waitForTimeout(4000);
  await clickIntoDoc(page);
  await typeIntoDoc(page, DOC_TEXT);
  await page.waitForTimeout(1500);
  await openPanelAndSignIn();

  // ---- 1. the panel introducing itself, on a document with text in it -----
  await page.waitForTimeout(800);
  await shot('01-klar', page, 'the panel open on a document, before the first question');

  // ---- 2. the hero: a draft, and the choice of how it goes in ------------
  await clickIntoDoc(page);
  await page.waitForTimeout(600);
  const composer = host.locator('textarea').first();
  await composer.fill('Skriv en kort og venlig indledning til en medarbejdersamtale.');
  await composer.press('Enter');
  await btn('Indsæt straks').waitFor({ timeout: 120_000 });
  await page.waitForTimeout(900);
  await shot('02-udkast', page, 'draft ready, with the four ways to use it');

  // ---- 3. attached context, still with no transport bar in the way -------
  const notePath = resolve(OUT, 'Kvartalsnotat.txt');
  writeFileSync(
    notePath,
    'Kvartalsnotat Q3\n\nOmsætningen landede på 4,2 mio. kr., 8 procent over budget.\n' +
      'Fejlraten faldt til 0,4 procent. Tolv nye kunder kom til i perioden.\n',
  );
  await host.locator('input[type="file"]').first().setInputFiles(notePath);
  await page.waitForTimeout(3500);
  await shot('03-vedhaeft-filer', page, 'files attached as background, readable before sending');

  // ---- 4. the tempo: slow insertion, caught mid-run ----------------------
  await clickIntoDoc(page);
  await page.waitForTimeout(500);
  await btn('Indsæt langsomt').click();
  // Long enough that the document visibly has words in it. At 5s the bar read
  // 6% and the page held four words, which shows the control but not the point
  // of it. Slow mode runs at about 30 words a minute by design.
  await page.waitForTimeout(14_000);
  await shot('04-indsaet-langsomt', page, 'letter-by-letter insertion, pausable mid-run');

  console.log(`\n${shots.length}/4 screenshots written to store-assets/`);
} catch (err) {
  await page.screenshot({ path: resolve(OUT, '99-crash.png') }).catch(() => {});
  console.error(`\nFAILED after ${shots.length} shot(s): ${err.message}`);
  process.exitCode = 1;
} finally {
  await ctx.close();
}
