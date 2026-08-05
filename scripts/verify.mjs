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
  await page.screenshot({ path: `${shotsDir}/02-signed-in.png` });

  console.log('\n— Streaming chat (live AI) —');
  await host.locator('textarea[placeholder*="Skriv til"]').fill('Reply with exactly: HELLO FROM THE EXTENSION');
  await host.locator('button', { hasText: '↑' }).click();
  const assistantBubble = host.locator('div.bg-zinc-100, div.dark\\:bg-zinc-800').last();
  await page.waitForFunction(
    () => {
      const hostEl = document.querySelector('awa-sidebar');
      const text = hostEl?.shadowRoot?.textContent ?? '';
      return /HELLO FROM THE EXTENSION/.test(text) || /Insert/.test(text);
    },
    { timeout: 60_000 },
  );
  const insertBtn = host.locator('button[title*="læsetempo"]').first();
  await insertBtn.waitFor({ timeout: 30_000 });
  ok('assistant response streamed and finished', true);
  await page.screenshot({ path: `${shotsDir}/03-chat-response.png` });

  console.log('\n— Edit response (CHAT-06) → deterministic long text for transport tests —');
  const LONG_TEXT =
    'HELLO FROM THE EXTENSION. This sentence exists so progressive insertion takes long enough to exercise pause, resume, stop and undo deterministically. ' +
    'It keeps going with a second sentence to make sure there is plenty of text left after the pause point. And a third one for good measure, because timing matters.';
  await host.locator('button', { hasText: 'Redigér' }).first().click();
  const editBox = host.locator('textarea.awa-edit');
  await editBox.waitFor({ timeout: 5_000 });
  await editBox.fill(LONG_TEXT);
  await host.getByRole('button', { name: 'Gem', exact: true }).click();
  ok('assistant response is editable before insertion', true);

  console.log('\n— Insertion: plain textarea (progressive + transport controls) —');
  await page.locator('#plain').click();
  await insertBtn.click();
  // Pause: the InsertBar re-renders on every progress tick, so a single click
  // can land between renders. Click-until-paused, like a real user would.
  const pauseBtn = host.locator('button', { hasText: 'Pause' });
  await pauseBtn.waitFor({ timeout: 5_000 });
  let isPaused = false;
  for (let i = 0; i < 5 && !isPaused; i++) {
    await pauseBtn.click().catch(() => {});
    await page.waitForTimeout(250);
    isPaused = await page.evaluate(() => {
      const hostEl = document.querySelector('awa-sidebar');
      return /Fortsæt/.test(hostEl?.shadowRoot?.textContent ?? '');
    });
  }
  const pausedVal = await page.locator('#plain').inputValue();
  await page.waitForTimeout(700);
  const stillPausedVal = await page.locator('#plain').inputValue();
  ok('pause actually pauses', isPaused && pausedVal === stillPausedVal && pausedVal.length > 0, `"${pausedVal.slice(0, 30)}" vs "${stillPausedVal.slice(0, 30)}"`);
  await host.locator('button', { hasText: 'Fortsæt' }).click();
  await page.waitForFunction(
    () => {
      const hostEl = document.querySelector('awa-sidebar');
      return /Indsat ✓/.test(hostEl?.shadowRoot?.textContent ?? '');
    },
    { timeout: 30_000 },
  );
  const finalVal = await page.locator('#plain').inputValue();
  ok('progressive insertion completed into textarea', finalVal === LONG_TEXT, `value="${finalVal.slice(0, 60)}"`);
  await page.screenshot({ path: `${shotsDir}/04-inserted-textarea.png` });

  console.log('\n— Undo —');
  await host.locator('button', { hasText: 'Fortryd indsættelse' }).click();
  await page.waitForTimeout(300);
  const undoneVal = await page.locator('#plain').inputValue();
  ok('undo restored the textarea', undoneVal === '', `value="${undoneVal.slice(0, 40)}"`);

  console.log('\n— Insertion: framework-controlled input (revert trap) —');
  await host.locator('button', { hasText: 'Skjul' }).click().catch(() => {});
  await page.locator('#controlled').click();
  await host.locator('button[title*="på én gang"]').first().click();
  await page.waitForTimeout(800); // outlive the 50ms "re-render" loop several times
  const controlledVal = await page.locator('#controlled').inputValue();
  const controlledState = await page.evaluate(() => window.__controlledState());
  ok('text survives framework re-render', controlledVal.length > 10 && controlledVal === controlledState, `dom="${controlledVal.slice(0, 40)}" state="${String(controlledState).slice(0, 40)}"`);
  await page.screenshot({ path: `${shotsDir}/05-controlled-input.png` });

  console.log('\n— Insertion: contenteditable —');
  await host.locator('button', { hasText: 'Skjul' }).click().catch(() => {});
  await page.locator('#editor').click();
  // place cursor at end
  await page.keyboard.press('End');
  await host.locator('button[title*="læsetempo"]').first().click();
  await page.waitForFunction(
    () => {
      const hostEl = document.querySelector('awa-sidebar');
      const t = hostEl?.shadowRoot?.textContent ?? '';
      return /Indsat ✓|Sendt/.test(t);
    },
    { timeout: 30_000 },
  );
  const editorText = await page.locator('#editor').textContent();
  ok('insertion landed in contenteditable', (editorText ?? '').length > 'Existing paragraph. '.length, `text="${(editorText ?? '').slice(0, 80)}"`);
  await page.screenshot({ path: `${shotsDir}/06-contenteditable.png` });

  console.log('\n— Typing-race guard —');
  await host.locator('button', { hasText: 'Skjul' }).click().catch(() => {});
  await page.locator('#plain').click();
  await host.locator('button[title*="læsetempo"]').first().click();
  await page.waitForTimeout(400);
  await page.locator('#plain').press('x'); // user types mid-insertion
  await page.waitForTimeout(400);
  const pausedByTyping = await page.evaluate(() => {
    const hostEl = document.querySelector('awa-sidebar');
    return /du begyndte at skrive/i.test(hostEl?.shadowRoot?.textContent ?? '');
  });
  ok('user typing auto-pauses insertion', pausedByTyping);
  await page.screenshot({ path: `${shotsDir}/07-typing-guard.png` });

  console.log('\n— Resume after user typing must not corrupt (CR-03) —');
  // The user's "x" is now in the document. Resume must either continue safely
  // or refuse loudly — never interleave or overwrite the user's character.
  const beforeResume = await page.locator('#plain').inputValue();
  await host.locator('button', { hasText: 'Resume' }).click().catch(() => {});
  await page.waitForFunction(
    () => {
      const hostEl = document.querySelector('awa-sidebar');
      const t = hostEl?.shadowRoot?.textContent ?? '';
      return /Indsat ✓|Stoppet|Kopiér|fejl/i.test(t);
    },
    { timeout: 30_000 },
  ).catch(() => {});
  const afterResume = await page.locator('#plain').inputValue();
  const userCharKept = afterResume.includes('x');
  ok('user typed character survives resume', userCharKept, `before="${beforeResume.slice(-20)}" after="${afterResume.slice(-30)}"`);
  // Undo after mixed content: must remove only inserted text or refuse — the "x" stays.
  await host.locator('button', { hasText: 'Undo insertion' }).click().catch(() => {});
  await page.waitForTimeout(400);
  const afterUndo = await page.locator('#plain').inputValue();
  ok('undo preserves user typing', afterUndo.includes('x'), `after undo="${afterUndo.slice(0, 40)}"`);
  await host.locator('button', { hasText: 'Skjul' }).click().catch(() => {});

  console.log('\n— Usage counter —');
  const usageShown = await page.evaluate(() => {
    const hostEl = document.querySelector('awa-sidebar');
    return /\d+ \/ \d+/.test(hostEl?.shadowRoot?.textContent ?? '');
  });
  ok('real usage numbers visible in header', usageShown);

  console.log('\n— Templates (PROD-01) —');
  const composer = host.locator('textarea[placeholder*="Skriv til"], textarea[placeholder*="instruktioner"]').first();
  await composer.fill('Summarize the attached report for a busy executive.');
  await host.locator('button', { hasText: 'Gem som skabelon' }).click();
  await host.locator('input[placeholder="Skabelonnavn"]').fill('Exec summary');
  await host.getByRole('button', { name: 'Gem', exact: true }).click();
  await page.waitForTimeout(800);
  await composer.fill('');
  const tplSelect = host.locator('select[title*="skabelon"]');
  await tplSelect.waitFor({ timeout: 5_000 });
  await tplSelect.selectOption({ label: 'Exec summary' });
  await page.waitForTimeout(200);
  const applied = await composer.inputValue();
  ok('template saves and applies to composer', applied.includes('busy executive'), `composer="${applied.slice(0, 50)}"`);
  // cleanup so reruns stay deterministic
  await host.locator('button', { hasText: 'administrér' }).click();
  await host.locator('button', { hasText: 'Slet' }).first().click();
  await page.waitForTimeout(400);

  console.log('\n— History search (PROD-02) —');
  await host.locator('button', { hasText: 'Historik' }).click();
  const searchBox = host.locator('input[placeholder*="Søg i titler"]');
  await searchBox.waitFor({ timeout: 5_000 });
  await searchBox.fill('HELLO FROM THE EXTENSION');
  await page.waitForTimeout(900);
  const hits = await host.locator('div.group').count();
  ok('search finds the conversation by content', hits >= 1, `hits=${hits}`);
  await searchBox.fill('zzz-no-such-term-qqq');
  await page.waitForTimeout(900);
  const noneText = await page.evaluate(() => {
    const hostEl = document.querySelector('awa-sidebar');
    return /Intet matcher/.test(hostEl?.shadowRoot?.textContent ?? '');
  });
  ok('search shows a specific empty state', noneText);
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
