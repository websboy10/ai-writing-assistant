/**
 * Spike: a Google Doc whose task IS a picture.
 *
 * Everything about the image path was proved against the backend by posting a
 * data URL straight at /api/autonomous/answer. That proves the half I wrote the
 * prompt for and none of the half that matters most: whether the extension can
 * SEE an inline image in a real document at all. Google returns pictures as an
 * `inlineObjects` map keyed by id, with the bytes behind a short-lived
 * `contentUri` that needs the same bearer token as the read. If any link in
 * that chain is wrong, the feature is worth nothing and every other test in the
 * repo still passes.
 *
 * So: a real document, a real picture, the real extension, read back through
 * the export channel that needs no OAuth.
 *
 * Run: node scripts/spike-docs-image.mjs
 */
import { launch, newDoc, readDoc, isSignedIn, reporter, shotsDir, clickIntoDoc } from './docs-harness.mjs';
import { resolve } from 'node:path';

const EMAIL = process.env.AWA_EMAIL ?? 'tester@example.com';
const PASSWORD = process.env.AWA_PASSWORD ?? 'awa-test-2026';

// A public URL because Google's servers fetch it, not this machine — localhost
// cannot work here. Synthetic maths, no user data.
const IMAGE_URL =
  'https://placehold.co/1000x400/FFFFFF/000000.png?text=Opgave+3%0A480+kr+minus+15+procent%0AHvad+koster+varen+nu%3F&font=roboto';

const r = reporter();
const ctx = await launch({ headless: false });
const page = ctx.pages()[0] ?? (await ctx.newPage());

// What the extension itself says about the read. Which write path it picked and
// how many paragraphs came back is the whole question here, and guessing at it
// from the outside is how the last hour was spent.
page.on('console', (m) => {
  const t = m.text();
  if (/awa|docs\.source|paragraph|image/i.test(t)) console.log(`    [page] ${t.slice(0, 300)}`);
});

// The request the panel actually sends. If images never leave the extension,
// nothing on the backend can be at fault and the log below says so outright.
await ctx.route('**/api/autonomous/answer', async (route) => {
  try {
    const body = JSON.parse(route.request().postData() ?? '{}');
    const imgs = (body.paragraphs ?? []).filter((p) => p.images?.length);
    console.log(
      `    [sent] ${body.paragraphs?.length ?? 0} paragraphs, ${imgs.length} with images` +
        `${imgs.length ? ` (${imgs.map((p) => `p${p.index}:${Math.round((p.images[0]?.length ?? 0) / 1024)}KB`).join(', ')})` : ''}`,
    );
  } catch (err) {
    console.log(`    [sent] unreadable body: ${String(err).slice(0, 80)}`);
  }
  await route.continue();
});
const host = page.locator('awa-sidebar');
const shot = (n) => page.screenshot({ path: resolve(shotsDir, `spike-img-${n}.png`) }).catch(() => {});

let docId = '';

/** Waits for the export channel to agree with what is on screen. */
async function waitForExport(re, what, attempts = 10) {
  let last = '';
  for (let i = 0; i < attempts; i++) {
    last = await readDoc(ctx, docId);
    if (re.test(last)) return last;
    await page.waitForTimeout(2000);
  }
  throw new Error(`gave up waiting for ${what}; export reads ${JSON.stringify(last.slice(0, 120))}`);
}
try {
  if (!(await isSignedIn(page))) throw new Error('the test profile is signed out of Google');

  docId = await newDoc(page);
  console.log(`  document: https://docs.google.com/document/d/${docId}/edit`);

  // No typed heading. Three runs were spent trying to get one in: this
  // profile has Docs' tab rail open, which places the caret happily enough but
  // swallows the keystrokes after it, and none of that is what the spike is
  // about. A document that is ONLY a picture is the harder case anyway, and it
  // is the one the feature exists for — a scanned worksheet has no typed line
  // to fall back on. It also forces the path under test: with no text to
  // search for, the run must take the index-based writer.

  // Insert > Image > By URL, through the menus a person would use. Both
  // languages, because the profile's locale is not this script's to decide.
  await page.getByRole('menuitem', { name: /^(Indsæt|Insert)$/ }).click();
  await page.waitForTimeout(400);
  await page.getByRole('menuitem', { name: /^(Billede|Image)/ }).click();
  await page.waitForTimeout(400);
  await page.getByRole('menuitem', { name: /(URL|webadresse)/i }).click();
  await page.waitForTimeout(800);
  await page.keyboard.type(IMAGE_URL);
  // The confirm button stays greyed until Docs has validated the URL, and its
  // label is localised. Enter submits the field either way and needs neither.
  await page.waitForTimeout(1500);
  await page.keyboard.press('Enter');
  await page.waitForTimeout(2000);
  const stillOpen = await page.getByRole('button', { name: /indsæt billede|insert image/i }).count();
  if (stillOpen) {
    await page.getByRole('button', { name: /indsæt billede|insert image/i }).last().click();
  }
  await page.waitForTimeout(5000);
  await shot('01-image-inserted');

  const withImage = await readDoc(ctx, docId);
  r.ok(
    'the picture is in the document and carries no text of its own',
    !/480|Opgave 3/.test(withImage),
    `export says: ${JSON.stringify(withImage.slice(0, 120))}`,
  );

  // ---- the extension ------------------------------------------------------
  await page.locator('button[title*="Skriveassistent"]').first().waitFor({ timeout: 30_000 });
  await page.locator('button[title*="Skriveassistent"]').first().click();
  await page.waitForTimeout(1000);
  if (await host.locator('input[type="email"]').count()) {
    await host.locator('input[type="email"]').fill(EMAIL);
    await host.locator('input[type="password"]').fill(PASSWORD);
    await host.getByRole('button', { name: 'Log ind', exact: true }).click();
    await page.waitForTimeout(3500);
  }

  await clickIntoDoc(page);
  await page.waitForTimeout(800);
  await host.getByRole('button', { name: 'Besvar alle spørgsmål', exact: true }).click();
  await host.getByRole('button', { name: 'Straks', exact: true }).click();

  await page.waitForFunction(
    () => {
      const root = document.querySelector('awa-sidebar')?.shadowRoot;
      const t = (root?.querySelector('aside') ?? root)?.textContent ?? '';
      return /Færdig ✓|Fejl|ingen kunne besvares|ikke fundet nogen/.test(t);
    },
    undefined,
    { timeout: 180_000 },
  );
  const panel = await page.evaluate(() => {
    const root = document.querySelector('awa-sidebar')?.shadowRoot;
    return (root?.querySelector('aside') ?? root)?.textContent ?? '';
  });
  await shot('02-after-run');

  console.log(`\n  panel said:\n    ${panel.replace(/\s+/g, ' ').slice(0, 500)}\n`);
  r.ok('the run reports finished rather than "no questions found"', /Færdig ✓/.test(panel), panel.replace(/\s+/g, ' ').slice(0, 300));

  const after = await readDoc(ctx, docId);
  console.log(`\n  document after the run:\n${after.split('\n').map((l) => `    ${l}`).join('\n')}\n`);

  r.ok('an answer was written into the document', after.trim().length > withImage.trim().length, `${withImage.length} -> ${after.length}`);
  r.ok('and it is the ANSWER to the picture, 408 kr', /408/.test(after), after.slice(0, 300));
  r.ok(
    'nothing hedged about a missing source reached the document',
    !/fremgår ikke|oplyser ikke|ingen oplysninger|kan ikke se|billedet/i.test(after),
    after.slice(0, 300),
  );
} catch (err) {
  r.ok('the spike ran to the end', false, String(err).slice(0, 400));
  await shot('99-crash');
} finally {
  if (docId) console.log(`  (document left in place: https://docs.google.com/document/d/${docId}/edit)`);
  await ctx.close();
}

process.exit(r.summary() ? 1 : 0);
