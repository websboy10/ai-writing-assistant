/**
 * The proof that "Indsæt straks" delivers REAL structure, not characters that
 * look like it.
 *
 * Checked through Docs' HTML export, because that is the only channel that can
 * tell the two apart: Docs' TEXT export renders a genuine bullet as "* ", which
 * is indistinguishable from leaked markdown. That trap cost time once already;
 * this file exists partly to keep it documented.
 *
 * Scope note, and it is deliberate: the prompt is UNCHANGED, so the model still
 * writes no headings and no bold. It does write numbered lists — the FORMAT
 * rules have always allowed "1. ", "2. " — so a real <ol> is the structure
 * under test here. Headings and bold need a prompt change that measurably
 * destabilised the model (see the plan), and are not part of this.
 *
 * Prereqs: backend on 127.0.0.1:8787, extension built against it,
 * .chrome-profile-cft signed into Google. COSTS REAL MODEL QUOTA.
 *
 * Run: node scripts/verify-rich-insert.mjs [--keep]
 */
import { resolve } from 'node:path';
import { launch, newDoc, isSignedIn, reporter, shotsDir, clickIntoDoc } from './docs-harness.mjs';

const KEEP = process.argv.includes('--keep');
const TEST_EMAIL = process.env.AWA_TEST_EMAIL ?? 'modestlyeu+awatest@gmail.com';
const TEST_PASSWORD = process.env.AWA_TEST_PASSWORD ?? 'awa-test-2026-xK9';
const ASK = 'Opsummer fordelene ved hjemmearbejde i punktform med fire punkter.';

const r = reporter();
const ctx = await launch();
const page = ctx.pages()[0] ?? (await ctx.newPage());

const host = page.locator('awa-sidebar');
const shot = (n) => page.screenshot({ path: resolve(shotsDir, `rich-${n}.png`) }).catch(() => {});
const sleep = (ms) => new Promise((s) => setTimeout(s, ms));

async function docHtml(docId) {
  const res = await ctx.request.get(`https://docs.google.com/document/d/${docId}/export?format=html`, {
    timeout: 20_000,
  });
  if (!res.ok()) throw new Error(`html export HTTP ${res.status()}`);
  return await res.text();
}

try {
  if (!(await isSignedIn(page))) throw new Error('.chrome-profile-cft is not signed into Google');

  const docId = await newDoc(page);
  console.log(`  document: https://docs.google.com/document/d/${docId}/edit`);
  await sleep(3000);

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
  const composer = host.locator('textarea[placeholder*="Skriv til"]');
  await composer.waitFor({ timeout: 30_000 });
  r.ok('panel open and signed in', true);

  await composer.fill(ASK);
  await composer.press('Enter');

  const insert = host.locator('button', { hasText: 'Indsæt straks' });
  await insert.waitFor({ timeout: 180_000 });
  await sleep(1500); // let the stream finish before reading the reply
  r.ok('a reply arrived with an insert button', true);

  const reply = await host.locator('div.whitespace-pre-wrap').last().innerText();
  const modelWroteList = /^\s*\d+[.)]\s+\S/m.test(reply);
  console.log(`\n  model's reply (first lines):\n${reply.split('\n').slice(0, 6).map((l) => `    | ${l}`).join('\n')}\n`);
  r.ok('the model wrote a numbered list', modelWroteList, 'the reply carried no list, so there is no structure to render');

  await clickIntoDoc(page);
  await sleep(500);
  await insert.click();
  await sleep(4000);
  await shot('inserted');

  const html = await docHtml(docId);
  const hasOl = /<ol[\s>]/i.test(html);
  const hasLi = /<li[\s>]/i.test(html);
  console.log(`  <ol> in document: ${hasOl}   <li> in document: ${hasLi}`);

  if (modelWroteList) {
    r.ok('the list arrived in Docs as a REAL list (<ol><li>)', hasOl && hasLi, 'it landed as plain paragraphs');
  }

  // The other half of the promise: no literal markdown characters left behind.
  const text = html.replace(/<[^>]+>/g, '');
  const leaked = /\*\*|(?:^|\s)#{1,6}\s/.test(text);
  r.ok('no literal markdown characters reached the document', !leaked, 'asterisks or hashes are visible in the text');
} catch (err) {
  r.ok('run completed', false, String(err?.message ?? err));
  await shot('failure');
} finally {
  if (!KEEP) await ctx.close();
}

process.exit(r.summary() ? 1 : 0);
