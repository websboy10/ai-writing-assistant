/**
 * Why do raw keystrokes not reach the Docs canvas any more?
 *
 * On 2026-08-26 verify-docs.mjs stopped being able to CLEAR a document
 * (`⌘A` then Backspace left the text in place) and spike-docs-image.mjs could
 * not type a heading, while the extension's own insertion kept working
 * perfectly in the same runs. That split matters: the product writes through a
 * synthetic paste aimed at the contenteditable, whereas Playwright's keyboard
 * goes to whatever the page has focused. So the suspicion is focus, not Docs.
 *
 * This prints where focus actually is, before and after a click into the page,
 * and whether Docs' tab rail is on screen — it appeared in this profile at some
 * point and shifts the page box right by ~300px.
 *
 * Run: node scripts/spike-docs-focus.mjs
 */
import { launch, newDoc, readDoc, shotsDir } from './docs-harness.mjs';
import { resolve } from 'node:path';

const ctx = await launch();
const page = ctx.pages()[0] ?? (await ctx.newPage());

const focusReport = () =>
  page.evaluate(() => {
    const el = document.activeElement;
    return {
      tag: el?.tagName ?? null,
      cls: (el?.className ?? '').toString().slice(0, 60),
      isIframe: el?.tagName === 'IFRAME',
      hasFocus: document.hasFocus(),
      frames: window.frames.length,
    };
  });

try {
  const docId = await newDoc(page);
  console.log(`document: https://docs.google.com/document/d/${docId}/edit`);

  const tabRail = await page.getByText(/Dokumentfaner|Document tabs/).count();
  console.log(`tab rail on screen: ${tabRail > 0 ? 'YES — this shifts the page box' : 'no'}`);

  const box = await page.locator('[class*="kix-page"]').first().boundingBox();
  const view = page.viewportSize() ?? (await page.evaluate(() => ({ width: innerWidth, height: innerHeight })));
  console.log(`viewport ${view.width}x${view.height} · page box ${Math.round(box.x)},${Math.round(box.y)} ${Math.round(box.width)}x${Math.round(box.height)}`);

  console.log(`focus BEFORE click: ${JSON.stringify(await focusReport())}`);
  const y = Math.min(box.y + box.height - 140, view.height - 60);
  await page.mouse.click(box.x + box.width / 2, y);
  await page.waitForTimeout(600);
  console.log(`focus AFTER  click: ${JSON.stringify(await focusReport())}`);

  await page.keyboard.type('FOKUSTEST', { delay: 30 });
  await page.waitForTimeout(2500);
  await page.screenshot({ path: resolve(shotsDir, 'focus-after-type.png') });
  const got = await readDoc(ctx, docId);
  console.log(`typed text arrived: ${got.includes('FOKUSTEST') ? 'YES' : 'NO'} (export: ${JSON.stringify(got.slice(0, 60))})`);

  // If the rail is the culprit, closing it should restore typing. Visning /
  // View holds the toggle.
  if (tabRail > 0) {
    console.log('\nclosing the tab rail and trying again…');
    await page.getByRole('menuitem', { name: /^(Visning|View)$/ }).click();
    await page.waitForTimeout(400);
    const item = page.getByRole('menuitemcheckbox', { name: /dokumentfaner|document tabs/i });
    if (await item.count()) {
      await item.first().click();
    } else {
      await page.getByRole('menuitem', { name: /dokumentfaner|document tabs/i }).first().click();
    }
    await page.waitForTimeout(1500);
    const box2 = await page.locator('[class*="kix-page"]').first().boundingBox();
    console.log(`page box now ${Math.round(box2.x)},${Math.round(box2.y)} ${Math.round(box2.width)}x${Math.round(box2.height)}`);
    const y2 = Math.min(box2.y + box2.height - 140, view.height - 60);
    await page.mouse.click(box2.x + box2.width / 2, y2);
    await page.waitForTimeout(600);
    console.log(`focus AFTER  click: ${JSON.stringify(await focusReport())}`);
    await page.keyboard.type('FOKUSTEST2', { delay: 30 });
    await page.waitForTimeout(2500);
    await page.screenshot({ path: resolve(shotsDir, 'focus-after-close-rail.png') });
    const got2 = await readDoc(ctx, docId);
    console.log(`typed text arrived: ${got2.includes('FOKUSTEST2') ? 'YES' : 'NO'} (export: ${JSON.stringify(got2.slice(0, 60))})`);
  }
} catch (err) {
  console.log(`FAILED: ${String(err).slice(0, 300)}`);
  await page.screenshot({ path: resolve(shotsDir, 'focus-crash.png') }).catch(() => {});
} finally {
  await ctx.close();
}
