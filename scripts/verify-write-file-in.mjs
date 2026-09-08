/**
 * The proof for "Skriv ind i dokumentet".
 *
 * Drives the BUILT extension in a real Chrome against a REAL Google Doc, on the
 * path a user takes — attach a file, open the attachment, press the button —
 * and verifies the claim by reading the document back through Docs' own text
 * export. Nothing here trusts the extension's own report: Docs paints to
 * <canvas> and a synthetic paste reports success whether or not the text
 * arrived, so the read-back is the only honest channel.
 *
 * Prereqs: .chrome-profile-cft signed into Google, and a built extension.
 *
 * Which backend it runs against does not matter to what is being proved — this
 * feature makes NO model call, so the backend's only job is to turn the
 * attached file into text. It defaults to the production host because a local
 * backend needs SUPABASE_SERVICE_ROLE_KEY (Vercel marks it Sensitive and will
 * not hand it back), and without that key /api/files fails closed with 503.
 * Set AWA_BACKEND to assert against a local one instead.
 *
 * Run: node scripts/verify-write-file-in.mjs [--keep]
 */
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { launch, newDoc, readDoc, isSignedIn, reporter, shotsDir, clickIntoDoc } from './docs-harness.mjs';

const KEEP = process.argv.includes('--keep');
const TEST_EMAIL = process.env.AWA_TEST_EMAIL ?? 'modestlyeu+awatest@gmail.com';
const TEST_PASSWORD = process.env.AWA_TEST_PASSWORD ?? 'awa-test-2026-xK9';

/**
 * The fixture is short on purpose. Paced insertion runs at 30 ord/min — 400 ms
 * a character — so a 200-character file already takes 80 seconds to type. The
 * point being proved is that the FILE's text reaches the document, not that
 * the engine can sustain an hour; the engine's pacing has its own tests.
 *
 * Three distinct lines, because a single word could pass by accident: the
 * order and the line breaks have to survive too.
 */
const FIXTURE_LINES = [
  'Første linje fra den vedhæftede fil.',
  'Anden linje, med æ ø å og et komma.',
  'Tredje linje slutter her.',
];
const FIXTURE = FIXTURE_LINES.join('\n');

const r = reporter();
const ctx = await launch({ headless: false });
const page = ctx.pages()[0] ?? (await ctx.newPage());

const host = page.locator('awa-sidebar');
const shot = (name) => page.screenshot({ path: resolve(shotsDir, `writefile-${name}.png`) }).catch(() => {});
const sleep = (ms) => new Promise((s) => setTimeout(s, ms));

/** Which backend the extension actually reached — a cached service worker
 *  pointing at production has cost this project a whole afternoon before. */
const backendHosts = new Set();
await ctx.route('**/api/**', async (route) => {
  try {
    backendHosts.add(new URL(route.request().url()).host);
  } catch {}
  await route.continue();
});

async function openSidebar() {
  const fab = host.locator('button[title*="ChatBot"]');
  await fab.waitFor({ timeout: 30_000 });
  const open = await host.locator('textarea[placeholder*="Skriv til"], input[type="email"]').count();
  if (!open) await fab.click();
  await sleep(500);
}

async function signInIfNeeded() {
  const email = host.locator('input[type="email"]');
  if (await email.count()) {
    await email.fill(TEST_EMAIL);
    await host.locator('input[type="password"]').fill(TEST_PASSWORD);
    await host.locator('button', { hasText: 'Log ind' }).click();
  }
  await host.locator('textarea[placeholder*="Skriv til"]').waitFor({ timeout: 30_000 });
}

/** 4s between reads: Docs' export answers 429 if polled harder, and a
 *  rate-limited harness looks exactly like a broken product. */
async function waitForDoc(docId, predicate, { timeout = 180_000, label = '' } = {}) {
  const started = Date.now();
  let last = '';
  while (Date.now() - started < timeout) {
    last = await readDoc(ctx, docId);
    if (predicate(last)) return last;
    await sleep(4000);
  }
  throw new Error(`timeout waiting for ${label || 'document'}; last read: ${JSON.stringify(last.slice(0, 200))}`);
}

// ─────────────────────────────────────────────────────────────────────────────

const fixturePath = join(mkdtempSync(join(tmpdir(), 'awa-')), 'Vedhæftet fil.txt');
writeFileSync(fixturePath, FIXTURE, 'utf8');

try {
  if (!(await isSignedIn(page))) throw new Error('.chrome-profile-cft is not signed into Google');

  const docId = await newDoc(page);
  console.log(`  document: https://docs.google.com/document/d/${docId}/edit`);
  await sleep(3000);

  await openSidebar();
  await signInIfNeeded();
  r.ok('panel open and signed in', true);

  // ── attach ────────────────────────────────────────────────────────────────
  await host.locator('input[type="file"]').setInputFiles(fixturePath);
  const chip = host.locator('button[title*="tegn — klik for at læse"]');
  await chip.waitFor({ timeout: 60_000 });
  r.ok('file attached and parsed into a chip', true);

  // ── open the chip's read view, where the button lives ──────────────────────
  await chip.click();
  const writeBtn = host.locator('button', { hasText: 'Skriv ind i dokumentet' });
  await writeBtn.waitFor({ timeout: 10_000 });
  r.ok('"Skriv ind i dokumentet" is present in the read view', true);

  // The estimate is the feature's safety net — assert it is real text, not
  // "ca. NaN minutter" or a bare number. 108 characters at 30 ord/min is
  // under a minute, which is exactly what it must say.
  const note = await host.locator('p', { hasText: 'Langsomt tager' }).innerText();
  console.log(`  estimate line: ${JSON.stringify(note.replace(/\s+/g, ' ').trim())}`);
  if (/NaN|Infinity|undefined/.test(note)) throw new Error(`estimate is broken: ${note}`);
  if (!/Formatering følger ikke med/.test(note)) throw new Error('the formatting warning is missing');
  r.ok('estimate and formatting warning both render', true);

  await shot('read-view');

  // ── give it somewhere to write, then press it ─────────────────────────────
  await clickIntoDoc(page);
  await sleep(500);
  await writeBtn.click();
  r.ok('button pressed', true);

  // ── the only claim that counts: the file's text is IN the document ────────
  const text = await waitForDoc(docId, (t) => t.includes(FIXTURE_LINES[2]), {
    label: "the file's last line",
  });

  for (const line of FIXTURE_LINES) {
    if (!text.includes(line)) throw new Error(`missing from the document: ${JSON.stringify(line)}`);
  }
  r.ok('all three lines of the file reached the document', true);

  const [a, b, c] = FIXTURE_LINES.map((l) => text.indexOf(l));
  if (!(a < b && b < c)) throw new Error(`lines are out of order: ${a}, ${b}, ${c}`);
  r.ok("the lines are in the file's own order", true);

  console.log(`\n  document read back:\n${text.trim().split('\n').map((l) => `    | ${l}`).join('\n')}`);

  const expected = new URL(process.env.AWA_BACKEND ?? 'https://ai-skriveassistent-api.vercel.app').host;
  if (!backendHosts.has(expected)) {
    throw new Error(`extension never reached ${expected}; it reached: ${[...backendHosts].join(', ') || 'nothing'}`);
  }
  r.ok(`backend actually reached: ${[...backendHosts].join(', ')}`, true);

  await shot('done');
} catch (err) {
  r.ok('run completed', false, String(err?.message ?? err));
  await shot('failure');
} finally {
  if (!KEEP) await ctx.close();
}

r.summary();
