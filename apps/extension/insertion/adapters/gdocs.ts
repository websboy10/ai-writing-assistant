import type { InsertionAdapter, InsertResult } from '../types';
import { awaLog, describeNode } from '../debug';
import { gdocsSelectionText } from '../target';

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
 * - undo is best-effort: one synthetic Cmd/Ctrl+Z per paste chunk.
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
    if (location.host !== 'docs.google.com') return { ok: false, reason: 'Not a Google Docs page.' };
    const iframe = document.querySelector<HTMLIFrameElement>('iframe.docs-texteventtarget-iframe');
    if (!iframe) {
      return {
        ok: false,
        reason:
          "Google Docs insertion isn't working right now — Google appears to have changed how Docs receives input. Use Copy instead.",
      };
    }
    try {
      const doc = iframe.contentDocument;
      if (!doc || !doc.body) {
        return { ok: false, reason: "Google Docs' input target is not accessible. Use Copy instead." };
      }
    } catch {
      return { ok: false, reason: "Google Docs' input target is not accessible. Use Copy instead." };
    }
    return { ok: true };
  }

  /**
   * Docs mirrors the current document selection into the hidden input iframe
   * (that's how native copy works) — non-empty mirrored text means text is
   * marked. Delegates to target.ts so the mirror is read in exactly one place.
   */
  static hasSelection(): boolean {
    return !!gdocsSelectionText();
  }

  eventTarget(): EventTarget | null {
    return this.targetDoc() ?? null;
  }

  prepare(): InsertResult {
    const test = GDocsAdapter.selfTest();
    if (!test.ok) return { ok: false, verified: true, reason: test.reason };
    this.chunksInserted = 0;
    // Make sure the doc has keyboard focus (the user may be in our sidebar).
    this.iframe()?.contentWindow?.focus();
    // A marked selection must not be replaced by the paste — ArrowRight
    // collapses it to its end (same synthetic-keystroke channel as undo).
    if (GDocsAdapter.hasSelection()) {
      const el = this.targetEl();
      if (el) {
        const init: KeyboardEventInit = {
          key: 'ArrowRight',
          code: 'ArrowRight',
          keyCode: 39,
          which: 39,
          bubbles: true,
          cancelable: true,
        };
        el.dispatchEvent(new KeyboardEvent('keydown', init));
        el.dispatchEvent(new KeyboardEvent('keyup', init));
      }
    }
    return { ok: true, verified: false };
  }

  insert(chunk: string): InsertResult {
    const el = this.targetEl();
    if (!el) {
      awaLog('gdocs.insert.no-target', { chunkIndex: this.chunksInserted });
      return { ok: false, verified: true, reason: 'Google Docs input target vanished mid-insertion.' };
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
    return { ok: true, verified: false };
  }

  undoAll(): InsertResult {
    const el = this.targetEl();
    if (!el) return { ok: false, verified: true, reason: 'Google Docs input target is gone.' };
    const platform =
      (navigator as Navigator & { userAgentData?: { platform?: string } }).userAgentData?.platform ??
      navigator.platform;
    const isMac = platform.toLowerCase().includes('mac');
    for (let i = 0; i < this.chunksInserted; i++) {
      const init: KeyboardEventInit = {
        key: 'z',
        code: 'KeyZ',
        keyCode: 90,
        which: 90,
        bubbles: true,
        cancelable: true,
        ...(isMac ? { metaKey: true } : { ctrlKey: true }),
      };
      el.dispatchEvent(new KeyboardEvent('keydown', init));
      el.dispatchEvent(new KeyboardEvent('keyup', init));
    }
    this.chunksInserted = 0;
    return { ok: true, verified: false };
  }
}
