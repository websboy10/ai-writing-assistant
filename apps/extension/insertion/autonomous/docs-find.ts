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
 * Docs' match counter for the current query — "2 af 5": the match the cursor
 * is on, and how many there are — or null when no counter can be read (an
 * older find bar, or the bar is closed).
 *
 * The total tells "no such text in the document" apart from "not confirmed
 * yet", which the selection channel alone never could: while the find bar is
 * open, focus and the selection mirror belong to the find field, so a read
 * there times out even on a perfectly good match.
 *
 * The current index is what makes a repeated line reachable. Measured
 * 2026-09-09 (scratchpad probe-find-tab.mjs): typing the query selects the
 * first match AFTER THE CARET, wrapping; every Enter moves one on; and the
 * counter's first number is the match's position in the DOCUMENT, wherever
 * the caret was. Until then this file pressed Enter once per wanted
 * occurrence, which landed on the second copy of any repeated line — the
 * observation left open in 07-FINDINGS-docs.md F-8.
 *
 * It is only half the confirmation. The counter belongs to whatever query the
 * bar last ran, so on its own it happily reports a stale match for a search
 * that never happened — measured 2026-08-18, that put a second question's
 * answer underneath the first. attemptFind clears the field before typing and
 * still verifies the cursor afterwards.
 */
function findMatchState(): { current: number; total: number } | null {
  const bar = document.querySelector<HTMLElement>(FIND_BAR_CONTAINER_SELECTOR);
  if (!bar) return null;
  // Digits can only come from the counter — the query lives in an <input>,
  // whose value is not part of innerText.
  const m = bar.innerText.match(/(\d+)\D+(\d+)/);
  return m ? { current: Number(m[1]), total: Number(m[2]) } : null;
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
 * `occurrence`-th match in the document, close the bar, and only then confirm
 * that the document's cursor really moved there.
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
  const escape = () => dispatchKey(input, { key: 'Escape', code: 'Escape', keyCode: 27, which: 27, bubbles: true, cancelable: true });
  const matched = await waitFor(() => (findMatchState()?.total ?? 0) > 0, SELECTION_TIMEOUT_MS);
  if (!matched) {
    escape();
    return { ok: false, reason: `Docs fandt ingen forekomst af "${query.slice(0, 60)}" i dokumentet.` };
  }

  // Typing the query already put the cursor on a match — the first one after
  // the caret. The counter says which one that is in the document, and Enter
  // moves one on, wrapping, so the wanted match is a known number of presses
  // away. Confirmed on the counter before the bar closes.
  const state = findMatchState()!;
  if (state.total < occurrence) {
    escape();
    return {
      ok: false,
      reason: `"${query.slice(0, 60)}" findes ${state.total} gange i dokumentet, men svaret skulle ved forekomst ${occurrence}.`,
    };
  }
  const presses = (occurrence - state.current + state.total) % state.total;
  for (let i = 0; i < presses; i++) {
    dispatchKey(input, { key: 'Enter', code: 'Enter', keyCode: 13, which: 13, bubbles: true, cancelable: true });
    await new Promise((resolve) => setTimeout(resolve, OCCURRENCE_ADVANCE_DELAY_MS));
  }
  const arrived = await waitFor(() => findMatchState()?.current === occurrence, SELECTION_TIMEOUT_MS);
  escape();
  if (!arrived) {
    return {
      ok: false,
      reason: `Docs nåede ikke frem til forekomst ${occurrence} af "${query.slice(0, 60)}" — markøren stod på en anden.`,
    };
  }

  const norm = (t: string) => t.replace(/\s+/g, ' ').trim().toLowerCase();
  const wanted = norm(query);
  const landed = await waitFor(() => norm(gdocsSelectionTextNow()) === wanted, SELECTION_TIMEOUT_MS);
  if (!landed) {
    return {
      ok: false,
      reason: `Docs fandt "${query.slice(0, 60)}", men markøren stod ikke på træffet bagefter — svaret ville være havnet et forkert sted.`,
    };
  }

  // Collapse the match to its end, HERE, where we have just proven a selection
  // exists — the line above returns only when the mirrored selection equals the
  // query exactly.
  //
  // Find leaves its match selected; that is this function's confirmation
  // channel. Whoever writes next must therefore collapse it first, or the paste
  // REPLACES the question it was meant to answer — the question disappears from
  // the user's document and the answer stands in its place. That is the worst
  // failure this product has: it destroys text the user wrote.
  //
  // It used to be the adapter's job, conditional on its own re-read of the
  // selection (adapters/gdocs.ts prepare()). Re-asking a question we already
  // know the answer to is a race, and it lost again on 2026-08-25 against
  // production: "every question survives the run verbatim — [true,true,false]".
  // Doing it at the one moment the state is certain removes the guess. The
  // adapter's conditional collapse stays as a second line of defence for the
  // paths that do not come through Find, and is simply a no-op after this.
  const target = gdocsEventTarget();
  if (!target) return { ok: true }; // no channel to collapse through; prepare() still tries

  // Wait for the collapse to be OBSERVABLE, not for a guessed number of
  // milliseconds. Docs applies a synthetic keystroke on its own schedule, and a
  // fixed 60ms settle was enough for the marked-selection path but not for
  // Langsomt over a whole document — where the very next thing to happen is the
  // first letter being pasted. Measured against production 2026-08-26: the
  // marked-selection path went 7/7 three times running while a whole-document
  // Langsomt run still lost "Beskriv dine tre vigtigste resultater i år".
  //
  // The mirror going empty is the same channel that proved the selection
  // existed four lines up, so this asks the question the same way it was
  // answered.
  for (let attempt = 0; attempt < 3; attempt++) {
    dispatchKey(target, { key: 'ArrowRight', code: 'ArrowRight', keyCode: 39, which: 39, bubbles: true, cancelable: true });
    if (await waitFor(() => gdocsSelectionTextNow() === '', SELECTION_TIMEOUT_MS)) {
      // The match may be a prefix of the question (see findAndPlaceCursor), so
      // the caret is at the end of the MATCH, not of the line. End moves it to
      // the end of the line the question is on — where an answer belongs, and
      // where the box-below and Tab routes already expect it.
      dispatchKey(target, { key: 'End', code: 'End', keyCode: 35, which: 35, bubbles: true, cancelable: true });
      await new Promise((resolve) => setTimeout(resolve, OCCURRENCE_ADVANCE_DELAY_MS));
      return { ok: true };
    }
  }

  // Three tries and the match is still selected. Writing now would delete the
  // question, so refuse: the run reports this answer as unplaced, the question
  // survives, and the user can see what happened. A gap is recoverable; a
  // deleted question is not.
  return {
    ok: false,
    reason: `Docs ville ikke slippe markeringen af "${query.slice(0, 40)}", og et svar ville have slettet spørgsmålet.`,
  };
}

/**
 * Positions the cursor at the end of a match of `text`'s first line — the
 * `occurrenceOf(query)`-th match in the document (1-based), asked per query
 * because the shorter fallback queries below may match more lines than the
 * whole one does. Two identical lines in one document resolve to the same
 * query; the caller counts which one it means (docs-source.ts occurrenceOf),
 * so the run advances to the right copy instead of re-landing on the first
 * (07-05-PLAN.md task 2).
 */
export async function findAndPlaceCursor(
  text: string,
  occurrenceOf: (query: string) => number = () => 1,
): Promise<{ ok: boolean; reason?: string }> {
  const eventTarget = gdocsEventTarget();
  if (!eventTarget) {
    return { ok: false, reason: 'Google Docs’ skrivefelt blev ikke fundet — er dokumentet åbent i denne fane?' };
  }

  const line = firstLine(text).trim();
  if (!line) {
    return { ok: false, reason: 'Spørgsmålet var tomt efter første linje og kunne derfor ikke findes i dokumentet.' };
  }

  // The WHOLE line first. The 60-character prefix used to go first, on the
  // reasoning that a long exact query fails more often — true, but a failed
  // find is retried, while a prefix that matches leaves the caret at
  // character 60, in the middle of a word. Measured 2026-09-08 on a 77-character
  // question: the answer was typed into "kort sæ|tning", splitting the user's
  // own sentence. So the prefix and the first sentence are fallbacks, in that
  // order, and each is tried only if it is a genuinely different query.
  const queries = [line, line.slice(0, FIND_QUERY_SHORT_LEN), firstSentence(text)].filter(
    (q, i, all) => q.trim() && all.indexOf(q) === i,
  );
  let attempt: { ok: true } | { ok: false; reason: string } = { ok: false, reason: '' };
  for (const q of queries) {
    attempt = await attemptFind(eventTarget, q, occurrenceOf(q));
    if (attempt.ok) break;
  }
  return attempt.ok ? { ok: true } : { ok: false, reason: attempt.reason };
}
