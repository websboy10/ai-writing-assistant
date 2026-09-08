import type { FormatKey, InsertionAdapter, InsertResult } from '../types';
import { awaLog, describeNode } from '../debug';
import { gdocsCommandKey, gdocsMarkedTextNow, gdocsSelectionTextNow, pressGdocsKey } from '../target';

/**
 * Google Docs adapter — the fragile one, by design kept fully isolated.
 *
 * Docs renders the document to <canvas>; there is no DOM to write into. All
 * keyboard/paste input is captured by a hidden same-origin iframe
 * (`iframe.docs-texteventtarget-iframe`). Dispatching a synthetic paste event
 * with plain text at that iframe's document inserts at the live cursor.
 *
 * This mechanism is UNDOCUMENTED and Google can break it without notice
 * (they shipped exactly such a change with the 2021 canvas migration). Hence:
 * - selfTest() runs before every session; failure → visible message +
 *   clipboard fallback, never a silent no-op (INST-13).
 * - insertion is UNVERIFIABLE from outside the canvas — results are reported
 *   as unverified and the UI says so honestly.
 * - undo is best-effort: one synthetic Cmd/Ctrl+Z per paste chunk — or, once
 *   the session has deleted anything itself ("Skriv som et menneske"), one
 *   synthetic Backspace per character still in the document. Docs' history
 *   may fold a run of backspaces into one step or into the paste before it,
 *   and one Cmd+Z too many would take the USER's earlier edit with it;
 *   counting characters depends on nothing but the caret still standing
 *   where the session left it, which is the same assumption every write
 *   already makes.
 */
export class GDocsAdapter implements InsertionAdapter {
  readonly kind = 'gdocs' as const;
  /**
   * Docs applies the paste on its own schedule and only then does the browser
   * report an `input` — after insert() has returned. Without this, the paced
   * path mistook its own echo for the user and paused after one letter, while
   * instant insertion (which never arms the guard) worked fine. See
   * InsertionAdapter.echoesAsync.
   */
  readonly echoesAsync = true;
  private chunksInserted = 0;
  /** Characters this session has in the document right now: pasted minus deleted. */
  private netChars = 0;
  private deletions = 0;
  /** Any formatting or Enter/space key pressed this session — decides how undo works. */
  private usedKeys = false;
  /** The last characters this session put in the document, newest last — what a deletion must find marked before anything is replaced. */
  private tail = '';
  /** Characters deleteBack() has left marked for the next write to replace. */
  private marked = 0;
  private lastEl: HTMLElement | null = null;
  private lastIframe: HTMLIFrameElement | null = null;

  private iframe(): HTMLIFrameElement | null {
    return document.querySelector<HTMLIFrameElement>('iframe.docs-texteventtarget-iframe');
  }

  private targetDoc(): Document | null {
    try {
      return this.iframe()?.contentDocument ?? null;
    } catch {
      return null; // cross-origin would throw — that means the mechanism changed
    }
  }

  /**
   * The element Docs actually listens on — its contenteditable inside the
   * hidden frame — NOT whatever happens to be focused.
   *
   * Measured 2026-08-07: `doc.activeElement` is sometimes that contenteditable
   * and sometimes the frame's `<body>`, depending on whether anything inside
   * the frame holds focus. Dispatching at `<body>` cannot work: the paste
   * propagates body → html → document, so a listener bound to a contenteditable
   * *inside* body never sees it. A 70-letter run logged `activeIsBody: true`
   * for every chunk and put nothing in the document, while a run that resolved
   * to `div[ce]` did reach Docs. That is the whole difference.
   *
   * Falls back to activeElement, then body, so a Docs restructure degrades to
   * the old behaviour rather than to nothing at all.
   */
  private targetEl(): HTMLElement | null {
    const doc = this.targetDoc();
    if (!doc) return null;
    const editable = doc.querySelector<HTMLElement>('[contenteditable="true"], [contenteditable=""]');
    if (editable) return editable;
    const active = doc.activeElement as HTMLElement | null;
    if (active && active !== doc.body) return active;
    return doc.body ?? null;
  }

  /** Which branch of targetEl() produced the element — diagnostics only. */
  private targetPick(el: HTMLElement | null): string {
    const doc = this.targetDoc();
    if (!doc || !el) return 'none';
    if (el.isContentEditable) return 'contenteditable';
    if (el === doc.body) return 'body(fallback)';
    return 'activeElement';
  }

  /** INST-13: prove the mechanism exists before promising insertion. */
  static selfTest(): { ok: boolean; reason?: string } {
    if (location.host !== 'docs.google.com') return { ok: false, reason: 'Dette er ikke et Google Docs-dokument.' };
    const iframe = document.querySelector<HTMLIFrameElement>('iframe.docs-texteventtarget-iframe');
    if (!iframe) {
      return {
        ok: false,
        reason:
          'Indsættelse i Google Docs virker ikke lige nu — Google har sandsynligvis ændret måden Docs modtager tekst på. Brug Kopiér i stedet.',
      };
    }
    try {
      const doc = iframe.contentDocument;
      if (!doc || !doc.body) {
        return { ok: false, reason: "Google Docs’ skrivefelt kan ikke nås lige nu. Brug Kopiér i stedet." };
      }
    } catch {
      return { ok: false, reason: "Google Docs’ skrivefelt kan ikke nås lige nu. Brug Kopiér i stedet." };
    }
    return { ok: true };
  }

  /**
   * Is text marked in the document? Docs hands the marked text over through a
   * synthetic copy (target.ts); non-empty means marked. One-shot, called from
   * prepare() and by the inserter before a run — never on a poll, which is
   * the use that corrupted a document (see target.ts).
   */
  static hasSelection(): boolean {
    return !!gdocsSelectionTextNow();
  }

  eventTarget(): EventTarget | null {
    return this.targetDoc() ?? null;
  }

  /**
   * Docs discards a space that sits at either edge of an individual paste, so
   * the engine's default split — one letter carrying its leading whitespace —
   * loses every inter-word space and lands "Hejmeddigverden."
   *
   * Measured against a live document on 2026-08-18, reading the result back
   * through Docs' own text export (no OAuth needed) rather than trusting the
   * adapter, which cannot see its own writes:
   *
   *   ['A ', 'B ', 'C']        -> "ABC"                  space at the end: trimmed
   *   ['D', ' E', ' F']        -> "DEF"                  space at the front: trimmed
   *   ['He', 'j med di', 'g.'] -> "Hej med dig."         interior space: KEPT
   *   ['Baz', '\nQux']         -> "Baz\nQux"             newline at the front: KEPT
   *
   * So the rule is narrower than "Docs trims whitespace": it trims *spaces* at
   * a paste edge and leaves newlines alone. A space therefore survives whenever
   * it is interior to one paste — which needs no NBSP substitution and no
   * change to the engine, only a split that never breaks next to a space.
   *
   * Chunks stay one code point wherever that is legal, so paced mode still
   * reads as typing; near a space the chunk grows to swallow the space and the
   * character after it. Text with no breakable position (e.g. "A B C")
   * collapses to a single paste, which is correct — that is what Straks does,
   * and it keeps its spaces.
   */
  chunkText(text: string): string[] {
    const cp = [...text]; // code points, so surrogate pairs never split
    const isSpace = (c: string | undefined) => c === ' ' || c === '\t';
    const isWs = (c: string | undefined) => c !== undefined && /\s/.test(c);
    const out: string[] = [];
    let start = 0;
    let i = 0;
    while (i < cp.length) {
      i += 1; // every chunk carries at least one code point
      // Breaking here is legal only when it leaves no whitespace at this
      // chunk's end and puts no space at the next chunk's start.
      while (i < cp.length && (isWs(cp[i - 1]) || isSpace(cp[i]))) i += 1;
      out.push(cp.slice(start, i).join(''));
      start = i;
    }
    return out;
  }

  prepare(): InsertResult {
    const test = GDocsAdapter.selfTest();
    if (!test.ok) return { ok: false, verified: true, reason: test.reason };
    this.chunksInserted = 0;
    this.netChars = 0;
    this.deletions = 0;
    this.usedKeys = false;
    this.tail = '';
    this.marked = 0;
    // Make sure the doc has keyboard focus (the user may be in our sidebar).
    this.iframe()?.contentWindow?.focus();
    // A marked selection must not be replaced by the paste — ArrowRight
    // collapses it to its end (same synthetic-keystroke channel as undo).
    if (GDocsAdapter.hasSelection()) {
      const el = this.targetEl();
      if (el) pressGdocsKey(el, { key: 'ArrowRight', code: 'ArrowRight', keyCode: 39, which: 39 });
    }
    return { ok: true, verified: false };
  }

  insert(chunk: string): InsertResult {
    const el = this.targetEl();
    if (!el) {
      awaLog('gdocs.insert.no-target', { chunkIndex: this.chunksInserted });
      return { ok: false, verified: true, reason: 'Google Docs’ skrivefelt forsvandt midt i indsættelsen.' };
    }
    // Docs is suspected of swapping the element (or the whole iframe) between
    // writes; sameEl/sameIframe is the evidence that settles it.
    awaLog('gdocs.insert.target', {
      chunkIndex: this.chunksInserted,
      chunk,
      el: describeNode(el),
      sameEl: el === this.lastEl,
      sameIframe: this.iframe() === this.lastIframe,
      activeIsBody: el === this.targetDoc()?.body,
      picked: this.targetPick(el),
      // Focus evidence. prepare() asks the frame to take focus and pastes
      // immediately; if Docs only processes a paste while its editor really
      // holds focus, a not-yet-settled focus would look exactly like "Docs
      // stopped consuming pastes" — and would explain why the same code
      // succeeded on one run and failed on the next.
      docHasFocus: this.targetDoc()?.hasFocus() ?? null,
      topActive: describeNode(document.activeElement),
      iframeIsTopActive: document.activeElement === this.iframe(),
    });
    this.lastEl = el;
    this.lastIframe = this.iframe();
    const dt = new DataTransfer();
    dt.setData('text/plain', chunk);
    const delivered = el.dispatchEvent(
      new ClipboardEvent('paste', { clipboardData: dt, bubbles: true, cancelable: true }),
    );
    awaLog('gdocs.insert.result', { chunkIndex: this.chunksInserted, notCancelled: delivered });
    // `delivered` (dispatchEvent's return) is NOT a success signal, and must
    // never be treated as one again.
    //
    // It reports only whether some listener called preventDefault(). Measured
    // against live Google Docs on 2026-08-07: Docs consumes the paste and the
    // text lands in the document, while dispatchEvent still returns true —
    // Docs simply does not cancel the event. The operator watched the letter
    // appear on screen in the same run that logged `delivered: true`.
    //
    // A code review added a fail-on-`delivered` branch (350d8ce, WR-01)
    // reasoning that an uncancelled paste meant Docs had ignored it. That
    // premise is false. The branch reported failure on every successful write,
    // which aborted the paced run after its first letter and made instant
    // insertion show an error over text that had actually arrived. It was the
    // whole of the "Google Docs is broken" symptom.
    //
    // This adapter cannot confirm its own writes — Docs paints to canvas, so
    // there is nothing to read back. That is why it returns verified:false and
    // the UI says so honestly. The mechanism's real guard is selfTest() in
    // prepare(), which fails loudly when the input frame is gone (INST-13).
    // Do not reintroduce a success check here from reasoning; only from a
    // signal actually observed against a live document.
    this.chunksInserted += 1;
    this.netChars += [...chunk].length;
    this.wrote(chunk);
    return { ok: true, verified: false };
  }

  /** Every write replaces whatever deleteBack() left marked, and extends the remembered tail. */
  private wrote(text: string): void {
    this.marked = 0;
    this.tail = (this.tail + text).slice(-TAIL_CHARS);
  }

  /**
   * The same synthetic paste as insert(), carrying `text/html` as well.
   *
   * Docs reads the HTML flavour and builds real structure from it — measured
   * against a live document 2026-09-08, where a pasted <h1>/<b>/<ul>/<ol> came
   * back out of Docs' own HTML export as a genuine heading, genuine bold and
   * genuine lists rather than as characters.
   *
   * `text/plain` is set too and is not redundant: it is what Docs falls back to
   * if it ever stops honouring the HTML flavour, which would otherwise turn
   * this into a silent no-op — the one failure mode this adapter's whole
   * design exists to avoid.
   *
   * Counted as ONE chunk, which is what makes undo correct: undoAll() sends one
   * Cmd+Z per chunk, and Docs treats a paste as a single history step.
   */
  insertRich(html: string, plain: string): InsertResult {
    const el = this.targetEl();
    if (!el) {
      return { ok: false, verified: true, reason: 'Google Docs’ skrivefelt forsvandt midt i indsættelsen.' };
    }
    const dt = new DataTransfer();
    dt.setData('text/plain', plain);
    dt.setData('text/html', html);
    el.dispatchEvent(new ClipboardEvent('paste', { clipboardData: dt, bubbles: true, cancelable: true }));
    awaLog('gdocs.insertRich', { htmlLength: html.length, plainLength: plain.length });
    this.chunksInserted += 1;
    this.netChars += [...plain].length;
    this.wrote(plain);
    return { ok: true, verified: false };
  }

  /**
   * A formatting shortcut on the same keystroke channel as everything else
   * Docs is told to do here, plus the two keys a paste cannot carry.
   *
   * Every chord below was measured against a live document on 2026-09-08
   * (scripts/probe-docs-typing-format.mjs, 8 of 8): Docs treats a synthetic
   * Cmd+B exactly as it treats the real one. `space` is a `beforeinput`
   * rather than a keystroke because a synthetic Space keydown types nothing,
   * and a pasted lone space is trimmed — `beforeinput insertText` is the one
   * channel that measured a real U+0020 (scripts/probe-docs-space.mjs).
   *
   * Once any key has been pressed, undo switches to Backspace over the typed
   * characters (see undoAll): a toggle is not always a history step in Docs,
   * so counting Cmd+Z presses could reach past this session into the user's
   * own edits, and that is the one thing undo must never do.
   */
  pressKey(key: FormatKey): InsertResult {
    const el = this.targetEl();
    if (!el) return { ok: false, verified: true, reason: 'Google Docs’ skrivefelt forsvandt midt i indsættelsen.' };
    this.usedKeys = true;
    // A paste is handed to the element and Docs takes it whoever has focus; a
    // shortcut is a keystroke, and Docs only listens to those while its editor
    // is the focused thing. The panel the user just clicked in is not.
    this.iframe()?.contentWindow?.focus();
    if (key === 'space') {
      el.dispatchEvent(new InputEvent('beforeinput', { inputType: 'insertText', data: ' ', bubbles: true, cancelable: true }));
      this.netChars += 1;
      this.wrote(' ');
      return { ok: true, verified: false };
    }
    const cmd = gdocsCommandKey();
    const CHORDS: Record<Exclude<FormatKey, 'space'>, KeyboardEventInit> = {
      bold: { key: 'b', code: 'KeyB', keyCode: 66, which: 66, ...cmd },
      italic: { key: 'i', code: 'KeyI', keyCode: 73, which: 73, ...cmd },
      h1: { key: '1', code: 'Digit1', keyCode: 49, which: 49, ...cmd, altKey: true },
      h2: { key: '2', code: 'Digit2', keyCode: 50, which: 50, ...cmd, altKey: true },
      h3: { key: '3', code: 'Digit3', keyCode: 51, which: 51, ...cmd, altKey: true },
      normal: { key: '0', code: 'Digit0', keyCode: 48, which: 48, ...cmd, altKey: true },
      bullets: { key: '8', code: 'Digit8', keyCode: 56, which: 56, ...cmd, shiftKey: true },
      numbered: { key: '7', code: 'Digit7', keyCode: 55, which: 55, ...cmd, shiftKey: true },
      enter: { key: 'Enter', code: 'Enter', keyCode: 13, which: 13 },
    };
    pressGdocsKey(el, CHORDS[key]);
    if (key === 'enter') {
      this.netChars += 1;
      this.wrote('\n');
    }
    // The one write here that cannot be inferred from the text afterwards: a
    // toggle that Docs ignored leaves no trace but missing bold.
    awaLog('gdocs.pressKey', { key, el: describeNode(el), docHasFocus: this.targetDoc()?.hasFocus() ?? null });
    return { ok: true, verified: false };
  }

  /**
   * A deletion is a SELECTION here — verified — that the next write replaces.
   *
   * A synthetic Backspace keydown is the one thing Docs drops: about one in
   * fifty while the page's main thread is busy, and during a run the
   * sidebar's own progress rendering is that load. Measured 2026-09-08
   * (scripts/probe-docs-backspace-race.mjs, probe-docs-delete-channel.mjs):
   * at every spacing from 40 to 200 ms, on keydown alone and on keydown with
   * beforeinput, while a beforeinput deleteContentBackward on its own is
   * ignored outright. On a real form that read "drerude" and "Sren". In the
   * same runs not one paste and not one Enter was lost, and a paste replaces
   * whatever is marked.
   *
   * So: Shift+ArrowLeft once per character, then ask Docs what is marked (the
   * same synthetic copy target.ts reads with) and compare it with what this
   * session typed last. An arrow can drop like any keydown (7 of 396 did), but
   * the read told the truth 108 times of 108 — exact on every whole selection,
   * different on every short one (scripts/probe-docs-select-read.mjs). A short
   * selection gets one more arrow and another read, twice at most. Only a
   * selection that reads back as exactly the text to delete is left standing
   * for the next write; anything else is collapsed and deleted the old way,
   * which is still right 49 times in 50.
   *
   * target.ts's rule of no selection polling while Docs is being written to
   * holds: at most three reads here, each after a keystroke of our own and
   * before the next write, and 148 such reads in the probes changed nothing.
   */
  deleteBack(count: number): InsertResult {
    const el = this.targetEl();
    if (!el) return { ok: false, verified: true, reason: 'Google Docs’ skrivefelt forsvandt midt i indsættelsen.' };
    const n = Math.min(count, this.netChars);
    if (n <= 0) return { ok: true, verified: false };
    const tail = [...this.tail];
    const expected = tail.slice(-n).join('');
    this.iframe()?.contentWindow?.focus();
    const SHIFT_LEFT: KeyboardEventInit = { key: 'ArrowLeft', code: 'ArrowLeft', keyCode: 37, which: 37, shiftKey: true };
    for (let i = 0; i < n; i++) pressGdocsKey(el, SHIFT_LEFT);
    let read = gdocsMarkedTextNow();
    let retries = 0;
    while (read !== expected && retries < 2 && tail.length > n + retries) {
      pressGdocsKey(el, SHIFT_LEFT);
      read = gdocsMarkedTextNow();
      retries += 1;
    }
    const ok = read === expected;
    awaLog('gdocs.deleteBack', { count: n, expected, read, retries, ok });
    if (ok) {
      this.marked = n;
    } else {
      pressGdocsKey(el, { key: 'ArrowRight', code: 'ArrowRight', keyCode: 39, which: 39 });
      for (let i = 0; i < n; i++) pressGdocsKey(el, { key: 'Backspace', code: 'Backspace', keyCode: 8, which: 8 });
    }
    this.netChars -= n;
    this.deletions += n;
    this.tail = tail.slice(0, tail.length - n).join('');
    return { ok: true, verified: false };
  }

  undoAll(): InsertResult {
    const el = this.targetEl();
    if (!el) return { ok: false, verified: true, reason: 'Google Docs’ skrivefelt kan ikke nås længere.' };
    if (this.deletions > 0 || this.usedKeys) {
      // A selection deleteBack() left standing goes with the first Backspace;
      // it is already off netChars.
      if (this.marked > 0) pressGdocsKey(el, { key: 'Backspace', code: 'Backspace', keyCode: 8, which: 8 });
      for (let i = 0; i < this.netChars; i++) pressGdocsKey(el, { key: 'Backspace', code: 'Backspace', keyCode: 8, which: 8 });
      // A list or heading style can outlive its text on the now-empty line.
      if (this.usedKeys) pressGdocsKey(el, { key: '0', code: 'Digit0', keyCode: 48, which: 48, ...gdocsCommandKey(), altKey: true });
    } else {
      for (let i = 0; i < this.chunksInserted; i++) {
        pressGdocsKey(el, { key: 'z', code: 'KeyZ', keyCode: 90, which: 90, ...gdocsCommandKey() });
      }
    }
    this.chunksInserted = 0;
    this.netChars = 0;
    this.deletions = 0;
    this.usedKeys = false;
    this.tail = '';
    this.marked = 0;
    return { ok: true, verified: false };
  }
}

/** How much of what was typed is remembered for deleteBack() to check against — far more than any slip or rewrite (human.ts MAX_REWRITE_CHARS). */
const TAIL_CHARS = 64;
