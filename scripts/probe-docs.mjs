/** One-shot probe: is the test profile still signed into Google, can we make a
 *  document, and does the export read-back channel answer? */
import { launch, newDoc, readDoc, isSignedIn, shotsDir } from './docs-harness.mjs';
import { resolve } from 'node:path';

const ctx = await launch({ headless: false });
const page = ctx.pages()[0] ?? (await ctx.newPage());
try {
  const signed = await isSignedIn(page);
  console.log(`signed in: ${signed} (${page.url().slice(0, 80)})`);
  if (!signed) {
    await page.screenshot({ path: resolve(shotsDir, 'docs-signin.png') });
    console.log('→ screenshot: test-results/docs-signin.png');
    process.exit(2);
  }
  const id = await newDoc(page);
  console.log(`new doc: ${id}`);
  const text = await readDoc(ctx, id);
  console.log(`read-back ok, ${text.length} chars: ${JSON.stringify(text.slice(0, 60))}`);
  await page.screenshot({ path: resolve(shotsDir, 'docs-probe.png') });
  console.log(`DOC_ID=${id}`);
} catch (err) {
  console.log(`PROBE FAILED: ${String(err).slice(0, 300)}`);
  await page.screenshot({ path: resolve(shotsDir, 'docs-probe-failure.png') }).catch(() => {});
  process.exitCode = 1;
} finally {
  await ctx.close();
}
