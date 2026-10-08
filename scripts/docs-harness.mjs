/**
 * Shared plumbing for driving the extension against a REAL Google Doc.
 *
 * Everything here exists because Docs paints to <canvas>: nothing in the page
 * can be read back, so every assertion has to come from Docs' own text export
 * (see readDoc). Without that channel a synthetic paste reports success whether
 * or not the text arrived — which is how four wrong fixes got written before
 * 2026-08-18.
 */
import { chromium } from 'playwright';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { mkdirSync, readdirSync, existsSync, rmSync } from 'node:fs';

export const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
export const extPath = resolve(root, 'apps/extension/.output/chrome-mv3');
// AWA_PROFILE points at a COPY when the real profile is held open by a demo browser (readback-doc.mjs).
export const profilePath = process.env.AWA_PROFILE ?? resolve(root, '.chrome-profile-cft');
export const shotsDir = resolve(root, 'test-results');
mkdirSync(shotsDir, { recursive: true });

/**
 * Branded Chrome dropped --load-extension in 137, so the extension silently
 * never loads there. Chrome for Testing keeps the flag; Playwright ships it.
 */
export function chromeForTestingPath() {
  const cache = `${process.env.HOME}/Library/Caches/ms-playwright`;
  // Only the full chromium-<rev> builds ship the .app; the headless-shell
  // package does not, and picking it silently loses extension support.
  const builds = readdirSync(cache)
    .filter((d) => /^chromium-\d+$/.test(d))
    .sort();
  for (const build of builds.reverse()) {
    for (const arch of ['chrome-mac-arm64', 'chrome-mac']) {
      const bin = `${cache}/${build}/${arch}/Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing`;
      if (existsSync(bin)) return bin;
    }
  }
  throw new Error('Chrome for Testing not found — run: pnpm exec playwright install chromium');
}

/**
 * Throws away the profile's cached MV3 service worker.
 *
 * The profile persists so the Google session does, and Chrome persists the
 * extension's service worker with it. A rebuilt background.js then does NOT
 * take effect: the content script is fresh, the worker is last week's, and the
 * two disagree in ways that look exactly like a product bug. It cost this
 * project a whole session once (see the stale-worker note in verify-ui.mjs) and
 * four runs of spike-docs-image.mjs on 2026-08-26, where a working feature
 * reported "no questions found" because the old worker was still reading
 * documents the old way.
 *
 * Cookies live elsewhere, so the Google sign-in survives this.
 */
function dropCachedServiceWorkers() {
  rmSync(resolve(profilePath, 'Default/Service Worker'), { recursive: true, force: true });
}

/**
 * Every script here used to open a real 1512x982 Chrome window. A tuning run is
 * dozens of launches, so the operator's screen spent the afternoon with a
 * browser flashing open and shut over whatever he was doing — and the windows
 * steal keyboard focus while they live. Headless is now the default and the
 * window is opt-in: `AWA_HEADED=1 node scripts/verify-docs.mjs` when you
 * genuinely need to watch it. Verified 2026-09-08 that the MV3 service worker
 * registers and the content script mounts in headless, which is the only thing
 * the window was ever needed for.
 *
 * To drive the extension by hand, use scripts/launch-chrome.sh — that one is
 * meant to be seen and is deliberately unaffected.
 */
const headless = process.env.AWA_HEADED !== '1';

/**
 * `viewport` is for the store screenshots and nothing else. The Chrome Web
 * Store accepts exactly 1280x800 or 640x400, and a shot that is one pixel off
 * is rejected at upload — so that one caller needs a viewport Playwright
 * enforces, not a window size the OS is free to adjust. Every test caller
 * leaves it null and keeps the real window it has always had.
 */
/**
 * Where scripts/docs-browser.mjs listens. When that browser is up, every
 * suite attaches to it instead of starting its own: one window signed into
 * once, rather than a sign-in that has to survive each relaunch. Without it a
 * suite starts its own browser on the same profile, as it always did.
 */
export const BROWSER_PORT = 9333;

async function attachToRunningBrowser() {
  const browser = await chromium.connectOverCDP(`http://127.0.0.1:${BROWSER_PORT}`).catch(() => null);
  if (!browser) return null;
  const ctx = browser.contexts()[0];
  // A suite owns a tab, not the browser: closing "the context" here would end
  // the signed-in session every other suite depends on.
  const page = await ctx.newPage();
  // The browser holds the build it started with. Reloading the extension is
  // what a relaunch used to do for a rebuilt one — through the extensions
  // page, the way its own reload button does it. chrome.runtime.reload() from
  // the worker left the extension DISABLED (measured 2026-10-08), so the
  // sidebar never mounted and the suite timed out waiting for it.
  await page.goto('chrome://extensions/');
  await page.evaluate(async () => {
    // A plain Chrome keeps an unpacked extension DISABLED until developer mode
    // is on ("unsupportedDeveloperExtension"); Playwright's own launch hid
    // that, and a browser started by hand has it off.
    await chrome.developerPrivate.updateProfileConfiguration({ inDeveloperMode: true });
    for (const e of await chrome.management.getAll()) {
      if (e.installType !== 'development') continue;
      if (!e.enabled) await chrome.management.setEnabled(e.id, true);
      await chrome.developerPrivate.reload(e.id, { failQuietly: true });
    }
  });
  await page.waitForTimeout(1500);
  await page.goto('about:blank');
  for (const other of ctx.pages()) if (other !== page) await other.close().catch(() => {});
  return inSuiteAccount(ctx, async () => void (await browser.close().catch(() => {})));
}

/** The context as the suites see it: export reads go to the suite's Google account, and `close` is ours to define. */
function inSuiteAccount(ctx, close) {
  const request = new Proxy(ctx.request, {
    get(target, prop) {
      if (prop === 'get') return (url, options) => target.get(inGoogleSlot(url), options);
      const value = Reflect.get(target, prop);
      return typeof value === 'function' ? value.bind(target) : value;
    },
  });
  return new Proxy(ctx, {
    get(target, prop) {
      if (prop === 'request') return request;
      if (prop === 'close' && close) return close;
      const value = Reflect.get(target, prop);
      return typeof value === 'function' ? value.bind(target) : value;
    },
  });
}

export async function launch({ viewport = null, windowSize = '1512,982', keepOpen = false } = {}) {
  if (!keepOpen) {
    const running = await attachToRunningBrowser();
    if (running) return running;
  }
  dropCachedServiceWorkers();
  const ctx = await chromium.launchPersistentContext(profilePath, {
    executablePath: chromeForTestingPath(),
    headless,
    viewport,
    args: [
      `--disable-extensions-except=${extPath}`,
      `--load-extension=${extPath}`,
      '--use-mock-keychain',
      '--password-store=basic',
      '--no-first-run',
      '--no-default-browser-check',
      // A real window, not the 800x513 default. The panel is ~400px wide by
      // design and its width persists in this profile, so on a small viewport
      // it covered most of the page and every "click into the document" landed
      // on the panel instead: focus stayed on BODY and the suite reported that
      // text never reached the document. Nobody edits a Google Doc in an 800px
      // window either, so the small one was never the honest test.
      `--window-size=${windowSize}`,
      ...(keepOpen ? [`--remote-debugging-port=${BROWSER_PORT}`] : []),
    ],
  });
  return inSuiteAccount(ctx);
}

/**
 * The read-back channel. Needs no OAuth — ordinary browser cookies are enough.
 * MUST be called from outside the Docs page: the page's own CSP blocks it.
 */
export async function readDoc(ctx, docId, { attempts = 6 } = {}) {
  let wait = 2000;
  let lastReason = '';
  for (let i = 1; i <= attempts; i++) {
    try {
      const res = await ctx.request.get(`https://docs.google.com/document/d/${docId}/export?format=txt`, {
        timeout: 20_000,
      });
      if (res.ok()) {
        // Docs' txt export opens with a BOM; normalise its CRLFs so assertions
        // can be written the way the text actually reads.
        return (await res.text()).replace(/^﻿/, '').replace(/\r\n/g, '\n');
      }
      // Polling the export too eagerly earns a 429 — Google's quota, not a
      // product failure — so back off rather than fail the run.
      if (res.status() !== 429) throw new Error(`HTTP ${res.status()}`);
      lastReason = 'HTTP 429';
    } catch (err) {
      // A dropped connection here says nothing about the extension. Retrying
      // it is the difference between a real result and a flaky suite.
      lastReason = String(err).slice(0, 120);
    }
    if (i === attempts) throw new Error(`export failed after ${attempts} attempts: ${lastReason}`);
    await new Promise((s) => setTimeout(s, wait));
    wait = Math.min(wait * 2, 16_000);
  }
}

/**
 * Clicks into the document page, away from anything that overlaps it.
 *
 * Three separate failures paid for the details here, all on 2026-08-26:
 *
 * - The element is `.kix-page-paginated`, not the `.kix-page` older notes name.
 *   Match the prefix so the next rename does not cost another session.
 * - Click the LEFT of the page, not the centre. With Docs' tab rail open the
 *   page box starts ~300px in, so its centre sits at x≈700 — underneath the
 *   extension's own sidebar in an 800px window. Every click landed on the
 *   panel, the caret never entered the document, and `⌘A` then selected
 *   nothing: `clearDoc` reported "document would not clear" about a document
 *   nothing was wrong with.
 * - Click the BOTTOM, not the top. A blank doc offers "building block" chips
 *   near the first line and hitting one inserts a whole email template, which
 *   then reads back as the extension having written it.
 *
 * Both coordinates are clamped to the viewport: the page box runs below and to
 * the right of an 800x513 window, and a click outside it silently does nothing.
 */
export async function clickIntoDoc(page) {
  const box = await page.locator('[class*="kix-page"]').first().boundingBox();
  if (!box) throw new Error('no [class*="kix-page"] — the document did not render');
  const view = page.viewportSize() ?? (await page.evaluate(() => ({ width: innerWidth, height: innerHeight })));

  // Where the panel actually is, measured, not assumed. Its width is a user
  // setting that persists in the profile, and verify-ui.mjs's resize check
  // widens it — after which it covered x=242..800 of an 800px window and every
  // "click into the document" landed on the panel instead. Focus stayed on
  // BODY, keystrokes went nowhere, and the suite reported that the questions
  // never reached the document. The panel is a shadow host with no size of its
  // own, so the <aside> inside it is what has to be measured.
  const panelLeft = await page.evaluate(() => {
    const el = document.querySelector('awa-sidebar')?.shadowRoot?.querySelector('aside');
    const r = el?.getBoundingClientRect();
    return r && r.width > 0 ? r.left : Infinity;
  });

  const left = box.x + 60;
  const right = Math.min(box.x + box.width - 60, view.width - 40);
  // Stay clear of the panel, and never leave the page to do it.
  const x = Math.max(box.x + 10, Math.min(left, right, panelLeft - 30));
  const y = Math.min(box.y + box.height - 140, view.height - 60);
  await page.mouse.click(x, y);
  await new Promise((r) => setTimeout(r, 300));
}

/**
 * Puts text in the document, as `insertText` rather than keystrokes.
 *
 * `page.keyboard.type` does NOT work against the Docs canvas here, at any
 * delay. Measured on a real document, typing "ABCDEFGHIJ": delay 12 left "A",
 * delay 150 left nothing at all, and a wake-up keystroke first left only the
 * wake-up. `insertText` put all ten characters in, every time — it delivers one
 * input event instead of ten key events, so there is no window for Docs to
 * re-render mid-word and drop the rest.
 *
 * Keep using real key presses where the TEST is about a keystroke (the
 * typing-race check needs a trusted event); use this everywhere else.
 */
export async function typeIntoDoc(page, text) {
  await clickIntoDoc(page);
  await page.keyboard.insertText(text);
  await new Promise((r) => setTimeout(r, 1200)); // let Docs commit before exporting
}

/**
 * The Google account the suites work in, and which of the profile's sign-in
 * slots it sits in.
 *
 * A bare docs.google.com address means slot 0, whoever that is. On 2026-10-08
 * slot 0 of this profile was an old school account whose session Google no
 * longer accepted, with the real one signed in beside it in slot 1: every
 * suite reported "signed out" and three sign-ins went by before anyone looked
 * at which account was being asked for. So the account is named, found by its
 * address, and every Docs URL the harness builds goes to its slot.
 */
export const GOOGLE_ACCOUNT = process.env.AWA_GOOGLE_ACCOUNT ?? 'sehitdd@gmail.com';
let googleSlot = null;

async function findGoogleSlot(page) {
  for (let n = 0; n < 4; n++) {
    await page.goto(`https://docs.google.com/document/u/${n}/`, { waitUntil: 'domcontentloaded' }).catch(() => {});
    if (!/^https:\/\/docs\.google\.com\//.test(page.url())) continue;
    const who = await page
      .waitForSelector('a[aria-label*="@"]', { timeout: 8000 })
      .then((el) => el.getAttribute('aria-label'))
      .catch(() => '');
    if (who?.includes(GOOGLE_ACCOUNT)) return n;
  }
  return null;
}

/** Docs addresses without a slot, sent to the suite's account. For the export read-back, which every suite builds by hand. */
function inGoogleSlot(url) {
  return googleSlot === null ? url : String(url).replace('docs.google.com/document/d/', `docs.google.com/document/u/${googleSlot}/d/`);
}

/** A fresh empty document per run — /create redirects to the new doc's URL. */
export async function newDoc(page) {
  if (googleSlot === null) googleSlot = await findGoogleSlot(page);
  if (googleSlot === null) throw new Error(`${GOOGLE_ACCOUNT} is not signed in — run: node scripts/docs-browser.mjs`);
  await page.goto(`https://docs.google.com/document/u/${googleSlot}/create`, { waitUntil: 'domcontentloaded' });
  await page.waitForURL(/\/document\/(?:u\/\d+\/)?d\/[a-zA-Z0-9_-]+/, { timeout: 60_000 });
  const id = page.url().match(/\/document\/(?:u\/\d+\/)?d\/([a-zA-Z0-9_-]+)/)?.[1];
  if (!id) throw new Error(`no document id in ${page.url()}`);
  await page.waitForSelector('.kix-appview-editor', { timeout: 60_000 });
  return id;
}

export async function isSignedIn(page) {
  googleSlot = await findGoogleSlot(page);
  return googleSlot !== null;
}

export function reporter() {
  const results = [];
  return {
    results,
    ok(name, cond, detail = '') {
      results.push({ name, cond: !!cond, detail });
      console.log(`  ${cond ? '✓' : '✗'} ${name}${!cond && detail ? ` — ${detail}` : ''}`);
      return !!cond;
    },
    summary() {
      const failed = results.filter((r) => !r.cond);
      console.log(`\n${results.length - failed.length} passed, ${failed.length} failed`);
      if (failed.length) {
        console.log('\nFailures:');
        for (const f of failed) console.log(`  ✗ ${f.name}${f.detail ? ` — ${f.detail}` : ''}`);
      }
      return failed.length;
    },
  };
}
