// Proves the edge-circle drop flow: attract on page drag, grow on hover,
// ingest on drop, count badge after.
import { chromium } from 'playwright';
import { createServer } from 'node:http';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
const root = process.cwd();
const extPath = resolve(root, 'apps/extension/.output/chrome-mv3');
const harness = readFileSync(resolve(root, 'test-pages/harness.html'));
const server = createServer((_q, r) => { r.writeHead(200, {'Content-Type':'text/html'}); r.end(harness); });
await new Promise((r) => server.listen(8788, '127.0.0.1', r));
const ctx = await chromium.launchPersistentContext('', { channel: 'chromium', headless: true, args: [`--disable-extensions-except=${extPath}`, `--load-extension=${extPath}`] });
const page = await ctx.newPage();
await page.goto('http://127.0.0.1:8788/');
const host = page.locator('awa-sidebar');
const fab = host.locator('button[title*="AI Writing Assistant"]');
await fab.waitFor({ timeout: 10000 });

// sign in first (upload requires auth)
await fab.click();
await host.locator('input[type="email"]').fill('tester@example.com');
await host.locator('input[type="password"]').fill('awa-test-2026');
await host.locator('button', { hasText: 'Sign in' }).click();
await host.locator('textarea[placeholder*="Message"]').waitFor({ timeout: 15000 });
await host.locator('button[title="Collapse sidebar"]').click();
await fab.waitFor({ timeout: 5000 });

const baseBox = await fab.boundingBox();

const dropResult = await page.evaluate(async () => {
  const hostEl = document.querySelector('awa-sidebar');
  const btn = hostEl.shadowRoot.querySelector('button[title*="AI Writing Assistant"]');
  const dt = new DataTransfer();
  dt.items.add(new File(['Quarterly revenue grew twelve percent according to the drop test.'], 'drop-test.txt', { type: 'text/plain' }));
  const fire = (target, type) => target.dispatchEvent(new DragEvent(type, { bubbles: true, cancelable: true, dataTransfer: dt, composed: true }));
  fire(document.body, 'dragenter');
  await new Promise((r) => setTimeout(r, 350));
  const attractSize = btn.getBoundingClientRect().width;
  fire(btn, 'dragover');
  await new Promise((r) => setTimeout(r, 350));
  const hoverSize = btn.getBoundingClientRect().width;
  fire(btn, 'drop');
  return { attractSize, hoverSize };
});

console.log('base width:', baseBox.width, '| attract:', dropResult.attractSize.toFixed(1), '| hover:', dropResult.hoverSize.toFixed(1));
console.log('grows on page drag:', dropResult.attractSize > baseBox.width + 4);
console.log('grows more on hover:', dropResult.hoverSize > dropResult.attractSize + 4);

// wait for upload to land, badge to appear
await page.waitForFunction(() => {
  const hostEl = document.querySelector('awa-sidebar');
  const btn = hostEl?.shadowRoot?.querySelector('button[title*="AI Writing Assistant"]');
  return /\d/.test(btn?.textContent ?? '') || /✓/.test(btn?.textContent ?? '');
}, { timeout: 30000 });
await page.waitForTimeout(2000); // let the ✓ settle into the badge
const badge = await page.evaluate(() => {
  const hostEl = document.querySelector('awa-sidebar');
  return hostEl.shadowRoot.querySelector('button[title*="AI Writing Assistant"]').textContent;
});
console.log('badge after drop:', JSON.stringify(badge), '→ context attached:', /1/.test(badge));
await page.screenshot({ path: 'test-results/drop-badge.png' });

// open modal, confirm the item is in the context list
await page.evaluate(() => {
  const hostEl = document.querySelector('awa-sidebar');
  hostEl.shadowRoot.querySelector('button[title*="AI Writing Assistant"]').click();
});
await host.locator('button', { hasText: 'Context' }).click();
const listed = await page.evaluate(() => {
  const hostEl = document.querySelector('awa-sidebar');
  return /drop-test\.txt/.test(hostEl.shadowRoot.textContent);
});
console.log('file listed in context panel:', listed);
await page.screenshot({ path: 'test-results/drop-context.png' });
await ctx.close(); server.close();
