/** Which requests actually fail on a Docs page with the extension loaded?
 *  "Failed to load resource" in the console names no URL; requestfailed does. */
import { launch, newDoc } from './docs-harness.mjs';

const ctx = await launch({ headless: false });
const page = ctx.pages()[0] ?? (await ctx.newPage());
const failed = [];
page.on('requestfailed', (req) =>
  failed.push({ url: req.url(), type: req.resourceType(), err: req.failure()?.errorText }),
);

try {
  const id = await newDoc(page);
  console.log(`doc: ${id}`);
  // Give the extension time to mount and settle.
  await page.waitForTimeout(12_000);

  console.log(`\n${failed.length} failed requests:\n`);
  for (const f of failed) console.log(`  [${f.type}] ${f.err}\n    ${f.url}\n`);

  const ext = failed.filter((f) => f.url.startsWith('chrome-extension://'));
  console.log(`extension-origin failures: ${ext.length}`);
} finally {
  await ctx.close();
}
