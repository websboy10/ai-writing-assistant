import { gdocsEventTarget, gdocsSelectionTextNow } from '../target';

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
 * Confirmation takes two signals, because neither alone is enough. Docs' own
 * match counter ("1 af 1" / "0 af 0") says whether the text EXISTS; the
 * document's selection, read once the find bar has closed, says whether the
 * CURSOR actually went there. A count without the selection check placed a
 * second question's answer under the first. A timeout NEVER reports success —
 * a silent no-op here types into the wrong part of the user's document.
 */

// The find-bar input. Run against a live document 2026-08-18 — the spike this
// file was waiting for — and every one of the four guessed selectors below
// matched NOTHING. Docs' find bar is now a Material "wiz" component:
//
//   div.appsDocsUiWizFindbarFindBarContainer
//     div.appsDocsUiWizFindbarFindInputContainer
//       input[aria-label="Find i dokumentet"]   <- Danish UI; label follows
//                                                  the user's Google account
//
// That is the whole reason Find "did not work": the synthetic Ctrl/Cmd+F DID
// open the bar and DID focus the input (measured — identical to a real
// keystroke), but nothing here could see it, so every run timed out and fell
// back. The container class is matched first because it carries no language;
// the aria-labels are kept only as a backstop, and the old class names remain
// so an older Docs still resolves.
//
// Note the input exists in the DOM even while the bar is closed, so its mere
// presence proves nothing — focus is the signal that the bar is really open.
export const FIND_INPUT_SELECTOR =
  '.appsDocsUiWizFindbarFindInputContainer input, [class*="FindbarFindInput"] input, ' +
  '.docs-findbar-input input, input.docs-findbar-input-typebox, ' +
  'input[aria-label="Find in document" i], input[aria-label="Find i dokumentet" i], ' +
  'input[aria-label="Søg i dokument" i]';

/**
 * Docs' find bar, whose own match counter is the confirmation channel.
 *
 * The container class carries no language; the counter inside it reads
 * "1 af 1" / "0 af 0" (Danish) or "1 of 1" / "0 of 0" (English), so only the
 * two numbers are read and the word between them is ignored.
 */
const FIND_BAR_CONTAINER_SELECTOR =
  '.appsDocsUiWizFindbarFindBarContainer, [class*="FindbarFindBarContainer"], .docs-findbar-container';

/**
 * How many matches Docs reports for the current query, or null when no
 * counter can be read (an older find bar, or the bar is closed).
 *
 * Used to tell "no such text in the document" apart from "not confirmed yet",
 * which the selection channel alone never could: while the find bar is open,
 * focus and the selection mirror belong to the find field, so a read there
 * times out even on a perfectly good match.
 *
 * It is only half the confirmation. The counter belongs to whatever query the
 * bar last ran, so on its own it happily reports a stale match for a search
 * that never happened — measured 2026-08-18, that put a second question's
 * answer underneath the first. attemptFind clears the field before typing and
 * still verifies the cursor afterwards.
 */
function findMatchTotal(): number | null {
  const bar = document.querySelector<HTMLElement>(FIND_BAR_CONTAINER_SELECTOR);
  if (!bar) return null;
  // Digits can only come from the counter — the query lives in an <input>,
  // whose value is not part of innerText.
  const m = bar.innerText.match(/(\d+)\D+(\d+)/);
  return m ? Number(m[2]) : null;
}

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
 * One search attempt: put `query` into the find bar, advance to the
 * `occurrence`-th match, close the bar, and only then confirm that the
 * document's cursor really moved there.
 *
 * The order matters and was arrived at by measurement, not preference:
 *
 * - The bar is opened with Ctrl/Cmd+F only when the input is not already
 *   focused. Sending it again while the bar is open TOGGLES IT CLOSED, and a
 *   closed bar still holds the previous query's match counter — which is how
 *   a second question could report a confident match while the cursor never
 *   moved, and its answer landed under the first question.
 * - The previous query is cleared before the new one is typed, so a counter
 *   left over from the last search can never be read as this search's result.
 * - Confirmation happens AFTER Escape. With the bar still open the focus and
 *   the selection mirror belong to the find field; once it closes, Docs
 *   reports the match as the document's own selection, and comparing that to
 *   the query proves the cursor is where the answer is about to be typed.
 *   A match count alone never proved that.
 */
async function attemptFind(
  eventTarget: EventTarget,
  query: string,
  occurrence = 1,
): Promise<{ ok: true } | { ok: false; reason: string }> {
  const findInput = () => document.querySelector<HTMLInputElement>(FIND_INPUT_SELECTOR);
  const barIsOpen = () => {
    const i = findInput();
    return !!i && document.activeElement === i;
  };

  if (!barIsOpen()) {
    openFindBar(eventTarget);
    await waitFor(barIsOpen, FIND_BAR_TIMEOUT_MS);
  }
  const input = findInput();
  if (!input || !barIsOpen()) {
    return {
      ok: false,
      reason:
        "Docs' søgefelt kunne ikke åbnes — Ctrl/Cmd+F nåede ikke frem til dokumentet, eller Docs har ændret sit søgefelt (FIND_INPUT_SELECTOR er forældet).",
    };
  }

  setFindValue(input, '');
  await new Promise((resolve) => setTimeout(resolve, OCCURRENCE_ADVANCE_DELAY_MS));
  setFindValue(input, query);
  const matched = await waitFor(() => (findMatchTotal() ?? 0) > 0, SELECTION_TIMEOUT_MS);
  if (!matched) {
    dispatchKey(input, { key: 'Escape', code: 'Escape', keyCode: 27, which: 27, bubbles: true, cancelable: true });
    return { ok: false, reason: `Docs fandt ingen forekomst af "${query.slice(0, 60)}" i dokumentet.` };
  }

  // Enter moves to a match; one press per occurrence, all before the bar closes.
  for (let i = 0; i < occurrence; i++) {
    dispatchKey(input, { key: 'Enter', code: 'Enter', keyCode: 13, which: 13, bubbles: true, cancelable: true });
    await new Promise((resolve) => setTimeout(resolve, OCCURRENCE_ADVANCE_DELAY_MS));
  }

  dispatchKey(input, { key: 'Escape', code: 'Escape', keyCode: 27, which: 27, bubbles: true, cancelable: true });

  const norm = (t: string) => t.replace(/\s+/g, ' ').trim().toLowerCase();
  const wanted = norm(query);
  const landed = await waitFor(() => norm(gdocsSelectionTextNow()) === wanted, SELECTION_TIMEOUT_MS);
  if (!landed) {
    return {
      ok: false,
      reason: `Docs fandt "${query.slice(0, 60)}", men markøren stod ikke på træffet bagefter — svaret ville være havnet et forkert sted.`,
    };
  }
  return { ok: true };
}

/**
 * Positions the cursor at the `occurrence`-th match of `questionText`
 * (1-based; default 1). Two identical questions in one run both resolve to
 * the same Find query — the second call passes `occurrence: 2` so the run
 * advances to the second match instead of re-landing on the first
 * (07-05-PLAN.md task 2).
 */
export async function findAndPlaceCursor(
  questionText: string,
  occurrence = 1,
): Promise<{ ok: boolean; reason?: string }> {
  const eventTarget = gdocsEventTarget();
  if (!eventTarget) {
    return { ok: false, reason: 'Google Docs’ skrivefelt blev ikke fundet — er dokumentet åbent i denne fane?' };
  }

  const shortQuery = firstLine(questionText).slice(0, FIND_QUERY_SHORT_LEN);
  if (!shortQuery.trim()) {
    return { ok: false, reason: 'Spørgsmålet var tomt efter første linje og kunne derfor ikke findes i dokumentet.' };
  }

  let attempt = await attemptFind(eventTarget, shortQuery, occurrence);
  if (!attempt.ok) {
    const sentenceQuery = firstSentence(questionText);
    // Only worth a second attempt if it is a genuinely different (longer) query.
    if (sentenceQuery && sentenceQuery !== shortQuery) {
      attempt = await attemptFind(eventTarget, sentenceQuery, occurrence);
    }
  }
  return attempt.ok ? { ok: true } : { ok: false, reason: attempt.reason };
}
