import type { InsertionAdapter, InsertResult } from '../types';

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
  private chunksInserted = 0;

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

  eventTarget(): EventTarget | null {
    return this.targetDoc() ?? null;
  }

  prepare(): InsertResult {
    const test = GDocsAdapter.selfTest();
    if (!test.ok) return { ok: false, verified: true, reason: test.reason };
    this.chunksInserted = 0;
    // Make sure the doc has keyboard focus (the user may be in our sidebar).
    this.iframe()?.contentWindow?.focus();
    return { ok: true, verified: false };
  }

  insert(chunk: string): InsertResult {
    const el = this.targetEl();
    if (!el) {
      return { ok: false, verified: true, reason: 'Google Docs input target vanished mid-insertion.' };
    }
    const dt = new DataTransfer();
    dt.setData('text/plain', chunk);
    const delivered = el.dispatchEvent(
      new ClipboardEvent('paste', { clipboardData: dt, bubbles: true, cancelable: true }),
    );
    // `delivered === false` means some listener called preventDefault — for
    // Docs that's exactly what its paste handler does, so it's our best signal
    // that the event was consumed. We still cannot read the canvas back.
    this.chunksInserted += 1;
    return { ok: true, verified: false, reason: delivered ? 'Docs did not consume the paste event.' : undefined };
  }

  undoAll(): InsertResult {
    const el = this.targetEl();
    if (!el) return { ok: false, verified: true, reason: 'Google Docs input target is gone.' };
    const isMac = navigator.platform.toLowerCase().includes('mac');
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
