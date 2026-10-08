/**
 * The one browser the Google Docs suites run in.
 *
 * Starts Chrome for Testing on the test profile as a PLAIN browser — not
 * through Playwright — and leaves it open. Two things were measured on
 * 2026-10-08 and both decide its shape:
 *
 *   - Google refuses a sign-in in a browser Playwright started ("Denne browser
 *     eller app er muligvis ikke sikker"), so nothing may be attached while a
 *     person signs in. The debugging port alone is not an attachment.
 *   - A session did not survive closing the browser, so it is not closed: the
 *     suites attach to this one over that port (docs-harness.mjs,
 *     attachToRunningBrowser) and leave it running.
 *
 * Run: node scripts/docs-browser.mjs      stop: quit the browser
 */
import { spawn } from 'node:child_process';
import { BROWSER_PORT, GOOGLE_ACCOUNT, chromeForTestingPath, extPath, profilePath } from './docs-harness.mjs';

spawn(
  chromeForTestingPath(),
  [
    `--user-data-dir=${profilePath}`,
    `--disable-extensions-except=${extPath}`,
    `--load-extension=${extPath}`,
    `--remote-debugging-port=${BROWSER_PORT}`,
    '--use-mock-keychain',
    '--password-store=basic',
    '--no-first-run',
    '--no-default-browser-check',
    '--window-size=1512,982',
    '--new-window',
    // Docs itself, not a sign-in address: with a live session this simply
    // opens, and without one Google sends the person to sign in. AddSession
    // asked for the password even when the session was good.
    'https://docs.google.com/document/',
  ],
  { detached: true, stdio: 'ignore' },
).unref();
console.log(`browser open — if Google asks, sign in as ${GOOGLE_ACCOUNT}; leave the window open`);
