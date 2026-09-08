import type { InsertionAdapter, InsertResult } from '../types';
import { awaLog, describeNode } from '../debug';
import { gdocsCommandKey, gdocsSelectionTextNow, pressGdocsKey } from '../target';

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
    return { ok: true, verified: false };
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
    return { ok: true, verified: false };
  }

  /**
   * Synthetic Backspace, on the same keystroke channel prepare() uses for
   * ArrowRight and undoAll() for Cmd+Z. Unverifiable for the same reason
   * every write is: the canvas cannot be read back.
   */
  deleteBack(count: number): InsertResult {
    const el = this.targetEl();
    if (!el) return { ok: false, verified: true, reason: 'Google Docs’ skrivefelt forsvandt midt i indsættelsen.' };
    const n = Math.min(count, this.netChars);
    for (let i = 0; i < n; i++) pressGdocsKey(el, { key: 'Backspace', code: 'Backspace', keyCode: 8, which: 8 });
    this.netChars -= n;
    this.deletions += n;
    return { ok: true, verified: false };
  }

  undoAll(): InsertResult {
    const el = this.targetEl();
    if (!el) return { ok: false, verified: true, reason: 'Google Docs’ skrivefelt kan ikke nås længere.' };
    if (this.deletions > 0) {
      for (let i = 0; i < this.netChars; i++) pressGdocsKey(el, { key: 'Backspace', code: 'Backspace', keyCode: 8, which: 8 });
    } else {
      for (let i = 0; i < this.chunksInserted; i++) {
        pressGdocsKey(el, { key: 'z', code: 'KeyZ', keyCode: 90, which: 90, ...gdocsCommandKey() });
      }
    }
    this.chunksInserted = 0;
    this.netChars = 0;
    this.deletions = 0;
    return { ok: true, verified: false };
  }
}
