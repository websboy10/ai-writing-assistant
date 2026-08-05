/**
 * End-to-end verification: loads the BUILT extension into real Chromium and
 * walks the actual user flow against the running backend + live AI.
 *
 * Not a unit test — this is the "walk the actual user flow in a real browser"
 * proof the operator requires before anything is called done.
 *
 * Prereqs: backend running on 127.0.0.1:8787, extension built (.output/chrome-mv3).
 * Run: node scripts/verify.mjs
 */
import { chromium } from 'playwright';
import { createServer } from 'node:http';
import { readFileSync, mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const extPath = resolve(root, 'apps/extension/.output/chrome-mv3');
const shotsDir = resolve(root, 'test-results');
mkdirSync(shotsDir, { recursive: true });

const TEST_EMAIL = 'tester@example.com';
const TEST_PASSWORD = 'awa-test-2026';

let passed = 0;
let failed = 0;
const failures = [];

function ok(name, cond, detail = '') {
  if (cond) {
    passed++;
    console.log(`  ✓ ${name}`);
  } else {
    failed++;
    failures.push({ name, detail });
    console.log(`  ✗ ${name}${detail ? ` — ${detail}` : ''}`);
  }
}

// ---- serve the harness on http (content scripts don't run on file:// by default) ----
const harness = readFileSync(resolve(root, 'test-pages/harness.html'));
const server = createServer((_req, res) => {
  res.writeHead(200, { 'Content-Type': 'text/html' });
  res.end(harness);
});
await new Promise((r) => server.listen(8788, '127.0.0.1', r));

const ctx = await chromium.launchPersistentContext('', {
  channel: 'chromium',
  headless: true,
  args: [`--disable-extensions-except=${extPath}`, `--load-extension=${extPath}`],
});

const page = await ctx.newPage();
const consoleErrors = [];
page.on('console', (m) => {
  if (m.type() === 'error') consoleErrors.push(m.text());
});

const shadowText = () => page.evaluate(() => document.querySelector('awa-sidebar')?.shadowRoot?.textContent ?? '');

try {
  console.log('\n— Sidebar injection —');
  await page.goto('http://127.0.0.1:8788/');
  const host = page.locator('awa-sidebar');
  await host.waitFor({ state: 'attached', timeout: 10_000 });
  ok('shadow host injected', true);

  const fab = host.locator('button[title*="Skriveassistent"]');
  await fab.waitFor({ timeout: 5_000 });
  ok('floating button visible', await fab.isVisible());
  await fab.click();

  const aside = host.locator('aside');
  await aside.waitFor({ timeout: 5_000 });
  ok('sidebar opens on click', await aside.isVisible());
  await page.screenshot({ path: `${shotsDir}/01-sidebar-open.png` });

  console.log('\n— Auth —');
  await host.locator('input[type="email"]').fill(TEST_EMAIL);
  await host.locator('input[type="password"]').fill(TEST_PASSWORD);
  await host.locator('button', { hasText: 'Log ind' }).click();
  await host.locator('textarea[placeholder*="Skriv til"]').waitFor({ timeout: 15_000 });
  ok('signed in → chat view', true);
  ok('no settings tab — only Log ud', /Log ud/.test(await shadowText()) && !/Indstillinger/.test(await shadowText()));
  await page.screenshot({ path: `${shotsDir}/02-signed-in.png` });

  console.log('\n— Streaming chat (live AI) —');
  await host.locator('textarea[placeholder*="Skriv til"]').fill('Reply with exactly: HELLO FROM THE EXTENSION');
  await host.locator('button', { hasText: '↑' }).click();
  const insertSlow = host.locator('button[title*="bogstav for bogstav"]').first();
  const insertNow = host.locator('button[title*="på én gang"]').first();
  await insertSlow.waitFor({ timeout: 60_000 });
  ok('assistant response streamed and finished', true);
  ok('exactly two insert modes: Straks + Langsomt', (await insertNow.count()) >= 1 && (await insertSlow.count()) >= 1);
  await page.screenshot({ path: `${shotsDir}/03-chat-response.png` });

  console.log('\n— Edit response (CHAT-06) → deterministic text for transport tests —');
  // Slow mode is letter-by-letter at ~30 wpm, so keep the text short enough
  // for a CI-friendly wall clock while still outliving pause/resume clicks.
  const LONG_TEXT = 'HELLO FROM THE EXTENSION. Pausen skal kunne nå at ske her.';
  await host.locator('button', { hasText: 'Redigér' }).first().click();
  const editBox = host.locator('textarea.awa-edit');
  await editBox.waitFor({ timeout: 5_000 });
  await editBox.fill(LONG_TEXT);
  await host.getByRole('button', { name: 'Gem', exact: true }).click();
  ok('assistant response is editable before insertion', true);

  console.log('\n— Insertion: plain textarea (slow letter-by-letter + transport controls) —');
  await page.locator('#plain').click();
  await insertSlow.click();
  // Pause: the InsertBar re-renders on every progress tick, so a single click
  // can land between renders. Click-until-paused, like a real user would.
  const pauseBtn = host.locator('button', { hasText: 'Pause' });
  await pauseBtn.waitFor({ timeout: 5_000 });
  let isPaused = false;
  for (let i = 0; i < 5 && !isPaused; i++) {
    await pauseBtn.click().catch(() => {});
    await page.waitForTimeout(250);
    isPaused = /Fortsæt/.test(await shadowText());
  }
  const pausedVal = await page.locator('#plain').inputValue();
  await page.waitForTimeout(900);
  const stillPausedVal = await page.locator('#plain').inputValue();
  ok('pause actually pauses', isPaused && pausedVal === stillPausedVal && pausedVal.length > 0, `"${pausedVal.slice(0, 30)}" vs "${stillPausedVal.slice(0, 30)}"`);
  const t0 = Date.now();
  await host.locator('button', { hasText: 'Fortsæt' }).click();
  await page.waitForFunction(
    () => /Indsat ✓/.test(document.querySelector('awa-sidebar')?.shadowRoot?.textContent ?? ''),
    { timeout: 120_000 },
  );
  const elapsed = (Date.now() - t0) / 1000;
  const finalVal = await page.locator('#plain').inputValue();
  ok('slow insertion completed into textarea, letter-perfect', finalVal === LONG_TEXT, `value="${finalVal.slice(0, 60)}"`);
  // Human tempo: the post-pause remainder must arrive at seconds-scale, not instantly.
  ok('slow mode is actually human-paced', elapsed > 3, `remainder took ${elapsed.toFixed(1)}s`);
  await page.screenshot({ path: `${shotsDir}/04-inserted-textarea.png` });

  console.log('\n— Undo —');
  await host.locator('button', { hasText: 'Fortryd indsættelse' }).click();
  await page.waitForTimeout(300);
  const undoneVal = await page.locator('#plain').inputValue();
  ok('undo restored the textarea', undoneVal === '', `value="${undoneVal.slice(0, 40)}"`);
  await host.locator('button', { hasText: 'Skjul' }).click().catch(() => {});

  console.log('\n— Marked text: two clearly-stated functions —');
  await page.locator('#plain').fill('Hvad er status på projektet?');
  await page.locator('#plain').click();
  await page.locator('#plain').press('ControlOrMeta+a');
  await page.waitForTimeout(1400); // selection poll runs every second
  const selBarText = await shadowText();
  ok('selection bar appears with both actions', /Du har markeret tekst/.test(selBarText) && /Besvar markeringen/.test(selBarText) && /Brug som kontekst/.test(selBarText));
  ok('the two functions are explained in words', /svaret skrives lige under markeringen/i.test(selBarText) && /baggrundsviden/.test(selBarText));

  // Function 2: use as context → a small chip with a corner ✕
  await host.locator('button', { hasText: 'Brug som kontekst' }).click();
  await page.waitForTimeout(300);
  ok('selection became a context chip', /Markeret tekst \(/.test(await shadowText()));
  await host.locator('button[title^="Fjern"]').first().click();
  await page.waitForTimeout(300);
  ok('chip removable via corner ✕', !/Markeret tekst \(/.test(await shadowText()));

  console.log('\n— Insertion lands BELOW the marked text, never on it —');
  // The field still holds a full selection; insert must go under it, not replace it.
  await insertNow.click();
  await page.waitForFunction(
    () => /Indsat ✓/.test(document.querySelector('awa-sidebar')?.shadowRoot?.textContent ?? ''),
    { timeout: 15_000 },
  );
  const belowVal = await page.locator('#plain').inputValue();
  ok(
    'marked text kept, answer on the line below',
    belowVal === `Hvad er status på projektet?\n${LONG_TEXT}`,
    `value="${belowVal.slice(0, 80)}"`,
  );
  await host.locator('button', { hasText: 'Fortryd indsættelse' }).click();
  await page.waitForTimeout(300);
  ok('undo removes only the answer, marked text stays', (await page.locator('#plain').inputValue()) === 'Hvad er status på projektet?');
  await host.locator('button', { hasText: 'Skjul' }).click().catch(() => {});

  console.log('\n— Insertion: framework-controlled input (revert trap) —');
  await page.locator('#controlled').click();
  await insertNow.click();
  await page.waitForTimeout(800); // outlive the 50ms "re-render" loop several times
  const controlledVal = await page.locator('#controlled').inputValue();
  const controlledState = await page.evaluate(() => window.__controlledState());
  ok('text survives framework re-render', controlledVal.length > 10 && controlledVal === controlledState, `dom="${controlledVal.slice(0, 40)}" state="${String(controlledState).slice(0, 40)}"`);
  await page.screenshot({ path: `${shotsDir}/05-controlled-input.png` });

  console.log('\n— Insertion: contenteditable, below a marked paragraph —');
  await host.locator('button', { hasText: 'Skjul' }).click().catch(() => {});
  const shortText = 'Ord et to.';
  await host.locator('button', { hasText: 'Redigér' }).first().click();
  await editBox.waitFor({ timeout: 5_000 });
  await editBox.fill(shortText);
  await host.getByRole('button', { name: 'Gem', exact: true }).click();
  await page.locator('#editor').click({ clickCount: 3 }); // mark the existing paragraph
  await insertSlow.click();
  await page.waitForFunction(
    () => /Indsat ✓|Sendt/.test(document.querySelector('awa-sidebar')?.shadowRoot?.textContent ?? ''),
    { timeout: 60_000 },
  );
  const editorText = (await page.locator('#editor').textContent()) ?? '';
  ok('marked paragraph survived', editorText.includes('Existing paragraph.'), `text="${editorText.slice(0, 80)}"`);
  ok('answer landed below it, letters spaced correctly', editorText.includes(shortText), `text="${editorText.slice(0, 80)}"`);
  await page.screenshot({ path: `${shotsDir}/06-contenteditable.png` });
  await host.locator('button', { hasText: 'Skjul' }).click().catch(() => {});

  console.log('\n— Typing-race guard —');
  await page.locator('#plain').click();
  await page.locator('#plain').press('ControlOrMeta+a');
  await page.locator('#plain').press('Delete');
  await insertSlow.click();
  await page.waitForTimeout(900);
  await page.locator('#plain').press('x'); // user types mid-insertion
  await page.waitForTimeout(500);
  ok('user typing auto-pauses insertion', /du begyndte at skrive/i.test(await shadowText()));
  await page.screenshot({ path: `${shotsDir}/07-typing-guard.png` });

  console.log('\n— Resume after user typing must not corrupt (CR-03) —');
  await host.locator('button', { hasText: 'Fortsæt' }).click().catch(() => {});
  await page.waitForFunction(
    () => /Indsat ✓|Stoppet|Kopiér|fejl/i.test(document.querySelector('awa-sidebar')?.shadowRoot?.textContent ?? ''),
    { timeout: 60_000 },
  ).catch(() => {});
  const afterResume = await page.locator('#plain').inputValue();
  ok('user typed character survives resume', afterResume.includes('x'), `after="${afterResume.slice(-30)}"`);
  await host.locator('button', { hasText: 'Fortryd indsættelse' }).click().catch(() => {});
  await page.waitForTimeout(400);
  const afterUndo = await page.locator('#plain').inputValue();
  ok('undo preserves user typing', afterUndo.includes('x'), `after undo="${afterUndo.slice(0, 40)}"`);
  await host.locator('button', { hasText: 'Skjul' }).click().catch(() => {});

  console.log('\n— The one output setting: length —');
  await host.locator('button', { hasText: 'Kortere' }).click();
  const shorterActive = await page.evaluate(() => {
    const hostEl = document.querySelector('awa-sidebar');
    const btn = [...(hostEl?.shadowRoot?.querySelectorAll('button') ?? [])].find((b) => b.textContent === 'Kortere');
    return btn?.className.includes('bg-ink') ?? false;
  });
  ok('length is a single tap (Kortere/Samme/Længere)', shorterActive);
  ok('no tone/template/operation controls left', !/Skabelon|Formel|Selvsikker|rigtige data/.test(await shadowText()));

  console.log('\n— Usage counter —');
  ok('real usage numbers visible in header', /\d+ \/ \d+/.test(await shadowText()));

  console.log('\n— History search (PROD-02) —');
  await host.locator('button', { hasText: 'Historik' }).click();
  const searchBox = host.locator('input[placeholder*="Søg i titler"]');
  await searchBox.waitFor({ timeout: 5_000 });
  await searchBox.fill('HELLO FROM THE EXTENSION');
  // Poll instead of a fixed sleep — content search fans out across messages
  // server-side and can take a couple of seconds.
  let hits = 0;
  for (let i = 0; i < 20 && hits === 0; i++) {
    await page.waitForTimeout(500);
    hits = await host.locator('div.group').count();
  }
  ok('search finds the conversation by content', hits >= 1, `hits=${hits}`);
  await searchBox.fill('zzz-no-such-term-qqq');
  let emptyShown = false;
  for (let i = 0; i < 10 && !emptyShown; i++) {
    await page.waitForTimeout(500);
    emptyShown = /Intet matcher/.test(await shadowText());
  }
  ok('search shows a specific empty state', emptyShown);
  await searchBox.fill('');
  await page.waitForTimeout(900);

  console.log('\n— Export (PROD-03) —');
  const row = host.locator('div.group').first();
  await row.hover();
  const downloadPromise = page.waitForEvent('download', { timeout: 10_000 });
  await row.locator('button', { hasText: 'Eksportér' }).click();
  const download = await downloadPromise;
  const fname = download.suggestedFilename();
  ok('conversation exports as a markdown download', fname.endsWith('.md'), `filename=${fname}`);

  console.log('\n— Log ud —');
  await host.locator('button', { hasText: 'Log ud' }).click();
  await host.locator('input[type="email"]').waitFor({ timeout: 10_000 });
  ok('sign out returns to the sign-in form', true);
} catch (err) {
  failed++;
  failures.push({ name: 'unexpected failure', detail: String(err) });
  console.error('  ✗ unexpected failure:', err);
  await page.screenshot({ path: `${shotsDir}/99-failure.png` }).catch(() => {});
} finally {
  await ctx.close();
  server.close();
}

console.log(`\n========================================`);
console.log(`  ${passed} passed, ${failed} failed`);
if (consoleErrors.length) {
  console.log(`  page console errors (${consoleErrors.length}):`);
  consoleErrors.slice(0, 5).forEach((e) => console.log(`    - ${e.slice(0, 160)}`));
}
if (failures.length) {
  console.log('  failures:');
  failures.forEach((f) => console.log(`    - ${f.name}: ${f.detail.slice(0, 200)}`));
  process.exit(1);
}
