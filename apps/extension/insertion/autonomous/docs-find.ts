import { gdocsEventTarget } from '../target';
import { GDocsAdapter } from '../adapters/gdocs';

/**
 * Positions the cursor in a Google Doc by driving Docs' own Find (Ctrl+F).
 *
 * SPIKED, NOT ASSUMED (D-16a). Docs renders the document body to <canvas>,
 * so there is no DOM range to place a cursor into directly — but the find
 * bar is real DOM. Typing a question into it and pressing Enter is Docs'
 * OWN mechanism for locating text and moving the cursor there, so this
 * reuses Docs' own search instead of reimplementing text-finding against
 * pixels (D-16). Once the cursor is there, the existing
 * `InsertionSession` + `GDocsAdapter` types the answer in letter by letter,
 * completely unmodified — `GDocsAdapter.prepare()` already collapses a
 * selection to its end before typing (gdocs.ts:88-102), which is exactly
 * the state Find leaves behind.
 *
 * Positioning can only be confirmed through the one read channel that
 * exists on a canvas-rendered page: `GDocsAdapter.hasSelection()`
 * (gdocs.ts:67), the hidden-mirror iframe that Docs itself mirrors the live
 * selection into. If that never flips true, this returns `ok: false` with a
 * reason — a timeout NEVER reports success, because a silent no-op here
 * would type the answer at the wrong place in the user's document.
 */

// Best-known selector for Docs' find-bar input, covering the English and
// Danish aria-labels observed in the wild, plus the class names historically
// used by Docs' find UI. UNVERIFIED against a live document until this
// file's own spike run (07-SPIKE.md) — proving or disproving this selector
// is that run's entire purpose.
export const FIND_INPUT_SELECTOR =
  '.docs-findbar-input input, input.docs-findbar-input-typebox, input[aria-label="Find in document" i], input[aria-label="Søg i dokument" i]';

const FIND_BAR_TIMEOUT_MS = 2000;
const SELECTION_TIMEOUT_MS = 2000;
const POLL_INTERVAL_MS = 50;
// Google's find field is not documented to have a hard limit, but nothing
// resembling a real question needs more than this — truncating avoids
// sending a query so long Docs silently mishandles it.
const FIND_QUERY_MAX_LENGTH = 300;

function isMacPlatform(): boolean {
  const platform =
    (navigator as Navigator & { userAgentData?: { platform?: string } }).userAgentData?.platform ??
    navigator.platform;
  return platform.toLowerCase().includes('mac');
}

/** Docs' find field is a single line; searching across a paragraph break never matches. */
function firstLine(text: string): string {
  const idx = text.indexOf('\n');
  return idx === -1 ? text : text.slice(0, idx);
}

async function waitFor(check: () => boolean, timeoutMs: number): Promise<boolean> {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    if (check()) return true;
    await new Promise((resolve) => setTimeout(resolve, POLL_INTERVAL_MS));
  }
  return check();
}

function dispatchKey(target: EventTarget, init: KeyboardEventInit): void {
  target.dispatchEvent(new KeyboardEvent('keydown', init));
  target.dispatchEvent(new KeyboardEvent('keyup', init));
}

/**
 * Native-setter + bubbling InputEvent — Docs' find box is a
 * framework-controlled input that ignores a plain `.value =` assignment,
 * the same trap `PlainAdapter.setValue` (adapters/plain.ts:112-125) exists
 * to work around.
 */
function setFindValue(input: HTMLInputElement, value: string): void {
  const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set;
  if (setter) setter.call(input, value);
  else input.value = value;
  input.dispatchEvent(new InputEvent('input', { bubbles: true, inputType: 'insertText', data: value }));
}

export async function findAndPlaceCursor(questionText: string): Promise<{ ok: boolean; reason?: string }> {
  const eventTarget = gdocsEventTarget();
  if (!eventTarget) {
    return { ok: false, reason: 'Google Docs input target not found — is this a Docs tab with a document open?' };
  }

  const query = firstLine(questionText).slice(0, FIND_QUERY_MAX_LENGTH);
  if (!query.trim()) {
    return { ok: false, reason: 'Question text was empty after truncating to its first line.' };
  }

  const isMac = isMacPlatform();
  dispatchKey(eventTarget, {
    key: 'f',
    code: 'KeyF',
    keyCode: 70,
    which: 70,
    bubbles: true,
    cancelable: true,
    ...(isMac ? { metaKey: true } : { ctrlKey: true }),
  });

  const barAppeared = await waitFor(
    () => !!document.querySelector<HTMLInputElement>(FIND_INPUT_SELECTOR),
    FIND_BAR_TIMEOUT_MS,
  );
  if (!barAppeared) {
    return {
      ok: false,
      reason:
        "Docs' find bar did not appear within 2s — Ctrl/Cmd+F may not have reached the document, or Docs changed its find-bar markup (FIND_INPUT_SELECTOR is stale).",
    };
  }

  const input = document.querySelector<HTMLInputElement>(FIND_INPUT_SELECTOR);
  if (!input) {
    return { ok: false, reason: 'Find bar input vanished immediately after appearing.' };
  }

  setFindValue(input, query);
  dispatchKey(input, { key: 'Enter', code: 'Enter', keyCode: 13, which: 13, bubbles: true, cancelable: true });

  const selected = await waitFor(() => GDocsAdapter.hasSelection(), SELECTION_TIMEOUT_MS);

  // Close the find bar either way so the document keeps keyboard focus —
  // leaving it open would make the next typed character search instead of
  // insert.
  dispatchKey(input, { key: 'Escape', code: 'Escape', keyCode: 27, which: 27, bubbles: true, cancelable: true });

  if (!selected) {
    return {
      ok: false,
      reason: `Docs never reported a selection after searching for "${query.slice(0, 60)}" — Find may not have matched the text, or the hidden mirror channel (GDocsAdapter.hasSelection) did not update in time.`,
    };
  }

  return { ok: true };
}
