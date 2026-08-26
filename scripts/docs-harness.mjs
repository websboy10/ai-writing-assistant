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
export const profilePath = resolve(root, '.chrome-profile-cft');
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

export async function launch({ headless = false } = {}) {
  dropCachedServiceWorkers();
  return chromium.launchPersistentContext(profilePath, {
    executablePath: chromeForTestingPath(),
    headless,
    viewport: null,
    args: [
      `--disable-extensions-except=${extPath}`,
      `--load-extension=${extPath}`,
      '--use-mock-keychain',
      '--password-store=basic',
      '--no-first-run',
      '--no-default-browser-check',
    ],
  });
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

/** A fresh empty document per run — /create redirects to the new doc's URL. */
export async function newDoc(page) {
  await page.goto('https://docs.google.com/document/create', { waitUntil: 'domcontentloaded' });
  await page.waitForURL(/\/document\/d\/[a-zA-Z0-9_-]+/, { timeout: 60_000 });
  const id = page.url().match(/\/document\/d\/([a-zA-Z0-9_-]+)/)?.[1];
  if (!id) throw new Error(`no document id in ${page.url()}`);
  await page.waitForSelector('.kix-appview-editor', { timeout: 60_000 });
  return id;
}

export async function isSignedIn(page) {
  await page.goto('https://docs.google.com/', { waitUntil: 'domcontentloaded' });
  return !/accounts\.google\.com|ServiceLogin/.test(page.url());
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
