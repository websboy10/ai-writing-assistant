import { chromium } from 'playwright';
import { createServer } from 'node:http';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const root = process.cwd();
const extPath = resolve(root, 'apps/extension/.output/chrome-mv3');
const harness = readFileSync(resolve(root, 'test-pages/harness.html'));
const server = createServer((_q, r) => { r.writeHead(200, {'Content-Type':'text/html'}); r.end(harness); });
await new Promise((r) => server.listen(8788, '127.0.0.1', r));

const ctx = await chromium.launchPersistentContext('', {
  channel: 'chromium', headless: true,
  args: [`--disable-extensions-except=${extPath}`, `--load-extension=${extPath}`],
});
const page = await ctx.newPage();
page.on('console', (m) => { if (m.text().includes('[AWA]')) console.log('CONSOLE:', m.text()); });

await page.goto('http://127.0.0.1:8788/');
const host = page.locator('awa-sidebar');
await host.locator('button[title*="AI Writing Assistant"]').click();
await host.locator('input[type="email"]').fill('tester@example.com');
await host.locator('input[type="password"]').fill('awa-test-2026');
await host.locator('button', { hasText: 'Sign in' }).click();
await host.locator('textarea[placeholder*="Message"]').waitFor({ timeout: 15000 });
await host.locator('textarea[placeholder*="Message"]').fill('Reply with exactly: HELLO WORLD TEST');
await host.locator('button', { hasText: '↑' }).click();
const insertBtn = host.locator('button[title*="readable pace"]').first();
await insertBtn.waitFor({ timeout: 60000 });

// edit to long text
await host.locator('button', { hasText: 'Edit' }).first().click();
const editBox = host.locator('textarea.border-indigo-400');
await editBox.fill('One two three four five six seven eight nine ten eleven twelve thirteen fourteen fifteen sixteen seventeen eighteen nineteen twenty. Second sentence goes here with more words to insert progressively over several seconds.');
await host.locator('button', { hasText: 'Save' }).click();

await page.locator('#plain').click();
await insertBtn.click();
await page.waitForTimeout(500);
console.log('--- clicking pause ---');
const pauseBtn = host.locator('button', { hasText: 'Pause' });
console.log('pause btn count:', await pauseBtn.count());
await pauseBtn.click();
console.log('--- pause clicked ---');
await page.waitForTimeout(1000);
console.log('value now:', JSON.stringify(await page.locator('#plain').inputValue()));
await page.waitForTimeout(1500);
console.log('value later:', JSON.stringify(await page.locator('#plain').inputValue()));
const text = await page.evaluate(() => document.querySelector('awa-sidebar')?.shadowRoot?.textContent ?? '');
console.log('sidebar contains Resume:', /Resume/.test(text), '| contains Paused:', /Paused/.test(text), '| contains Inserting:', /Inserting/.test(text));
await ctx.close(); server.close();
