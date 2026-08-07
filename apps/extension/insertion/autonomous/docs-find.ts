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
const OCCURRENCE_ADVANCE_DELAY_MS = 150;
const POLL_INTERVAL_MS = 50;
// A short prefix is tried FIRST (07-05-PLAN.md task 2): a very long exact
// query is more likely to fail on a trailing-whitespace/formatting mismatch
// than a short one is to be ambiguous within a single question's own text.
const FIND_QUERY_SHORT_LEN = 60;

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

/** Second attempt when the short prefix doesn't match — more context, still one line. */
function firstSentence(text: string): string {
  const line = firstLine(text);
  const m = line.match(/^[^.!?]*[.!?]/);
  return (m ? m[0] : line).trim();
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

function openFindBar(eventTarget: EventTarget): void {
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
}

/**
 * One search attempt: type `query` into the find bar (opening it first if
 * `input` is not already supplied), press Enter, and confirm via
 * `hasSelection()`. Returns the input element on success so a caller can
 * reuse it (duplicate-occurrence advancing) without a second Ctrl/Cmd+F.
 */
async function attemptFind(
  eventTarget: EventTarget,
  query: string,
): Promise<{ ok: true; input: HTMLInputElement } | { ok: false; reason: string }> {
  openFindBar(eventTarget);
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
  if (!selected) {
    // Leave the bar open for the caller to retry a different query in —
    // closing and reopening between attempts risks racing Docs' own
    // open-animation. The caller (or the final Escape below) always closes it.
    return {
      ok: false,
      reason: `Docs never reported a selection after searching for "${query.slice(0, 60)}" — Find may not have matched the text, or the hidden mirror channel (GDocsAdapter.hasSelection) did not update in time.`,
    };
  }
  return { ok: true, input };
}

/**
 * Positions the cursor at the `occurrence`-th match of `questionText`
 * (1-based; default 1). Two identical questions in one run both resolve to
 * the same Find query — the second call passes `occurrence: 2` so the run
 * advances to the second match instead of re-landing on the first
 * (07-05-PLAN.md task 2: "advance Find's internal position by pressing
 * Enter again ... for the n-th duplicate").
 */
export async function findAndPlaceCursor(
  questionText: string,
  occurrence = 1,
): Promise<{ ok: boolean; reason?: string }> {
  const eventTarget = gdocsEventTarget();
  if (!eventTarget) {
    return { ok: false, reason: 'Google Docs input target not found — is this a Docs tab with a document open?' };
  }

  const shortQuery = firstLine(questionText).slice(0, FIND_QUERY_SHORT_LEN);
  if (!shortQuery.trim()) {
    return { ok: false, reason: 'Question text was empty after truncating to its first line.' };
  }

  let attempt = await attemptFind(eventTarget, shortQuery);
  if (!attempt.ok) {
    const sentenceQuery = firstSentence(questionText);
    // Only worth a second attempt if it is a genuinely different (longer) query.
    if (sentenceQuery && sentenceQuery !== shortQuery) {
      attempt = await attemptFind(eventTarget, sentenceQuery);
    }
  }

  if (!attempt.ok) {
    // Nothing to close on this path — attemptFind never leaves an input
    // reference behind when it fails at the "bar never appeared" stage, and
    // when it fails after the bar DID appear, Escape is still owed.
    const stale = document.querySelector<HTMLInputElement>(FIND_INPUT_SELECTOR);
    if (stale) {
      dispatchKey(stale, { key: 'Escape', code: 'Escape', keyCode: 27, which: 27, bubbles: true, cancelable: true });
    }
    return { ok: false, reason: attempt.reason };
  }

  const { input } = attempt;
  // Advance to the n-th occurrence: Find already sits on the first match —
  // press Enter (occurrence - 1) more times, reconfirming the mirror channel
  // moved each time, before trusting the final position.
  let ok = true;
  let reason: string | undefined;
  for (let i = 1; i < occurrence && ok; i++) {
    dispatchKey(input, { key: 'Enter', code: 'Enter', keyCode: 13, which: 13, bubbles: true, cancelable: true });
    // Sequential by nature — each Enter must land before the next is sent.
    await new Promise((resolve) => setTimeout(resolve, OCCURRENCE_ADVANCE_DELAY_MS));
    ok = await waitFor(() => GDocsAdapter.hasSelection(), SELECTION_TIMEOUT_MS);
    if (!ok) reason = `Kunne ikke avancere til forekomst ${i + 1} af "${shortQuery}" — Docs rapporterede ikke en ny markering.`;
  }

  // Close the find bar either way so the document keeps keyboard focus —
  // leaving it open would make the next typed character search instead of
  // insert. Every path above (success or failure) reaches this line.
  dispatchKey(input, { key: 'Escape', code: 'Escape', keyCode: 27, which: 27, bubbles: true, cancelable: true });

  if (!ok) return { ok: false, reason };
  return { ok: true };
}
