import type { InsertionAdapter, InsertResult } from '../types';
import { awaLog, describeNode } from '../debug';

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

  private targetEl(): HTMLElement | null {
    const doc = this.targetDoc();
    if (!doc) return null;
    return (doc.activeElement as HTMLElement) ?? doc.body ?? null;
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
   * (that's how native copy works) — non-empty body text means text is marked.
   */
  static hasSelection(): boolean {
    try {
      const doc = document.querySelector<HTMLIFrameElement>('iframe.docs-texteventtarget-iframe')?.contentDocument;
      return !!doc?.body?.textContent?.trim();
    } catch {
      return false;
    }
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
    });
    this.lastEl = el;
    this.lastIframe = this.iframe();
    const dt = new DataTransfer();
    dt.setData('text/plain', chunk);
    const delivered = el.dispatchEvent(
      new ClipboardEvent('paste', { clipboardData: dt, bubbles: true, cancelable: true }),
    );
    awaLog('gdocs.insert.result', {
      chunkIndex: this.chunksInserted,
      // true here means NOBODY called preventDefault — i.e. Docs did not
      // consume the paste, which this adapter treats as failure.
      delivered,
    });
    // dispatchEvent returns true when NO listener called preventDefault —
    // i.e. Docs did NOT consume the paste. That is the one affirmative
    // failure signal this adapter has (Pitfall 4: the iframe can survive
    // while Google removes the handler), so it must fail loudly, not report
    // a silent "success" for text that never entered the document.
    if (delivered) {
      return {
        ok: false,
        verified: true,
        reason:
          'Google Docs did not accept the inserted text — Google may have changed how Docs receives input. Use Copy instead.',
      };
    }
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
