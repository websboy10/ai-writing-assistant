import type { InsertionAdapter, InsertResult } from '../types';
import type { SavedTarget } from '../target';

/**
 * Plain <input>/<textarea>, including React/Vue-controlled fields.
 *
 * The trap (research pitfall #2): assigning `.value` directly updates the DOM
 * but not the framework's internal state — the next re-render silently reverts
 * it. The fix is the native prototype setter followed by a real bubbling
 * InputEvent, which walks the framework's own onChange path.
 *
 * Position safety (research pitfall #3): offsets captured at prepare() go
 * stale the moment the user edits while paused. Every write and the undo
 * first re-verify that the inserted-so-far text is still at the tracked
 * offset — relocating it if it moved, refusing loudly if it's gone — so we
 * never splice into the wrong place or delete the user's own typing.
 */
export class PlainAdapter implements InsertionAdapter {
  readonly kind = 'plain' as const;
  private el: HTMLInputElement | HTMLTextAreaElement;
  private insertPos = 0;
  /** Exactly what this session has written so far — the undo target. */
  private insertedText = '';

  constructor(target: SavedTarget) {
    this.el = target.element as HTMLInputElement | HTMLTextAreaElement;
    this.insertPos = target.selStart ?? this.el.value.length;
  }

  eventTarget(): EventTarget {
    return this.el;
  }

  prepare(): InsertResult {
    if (!this.el.isConnected) return { ok: false, verified: true, reason: 'The target field is no longer on the page.' };
    this.el.focus();
    // A marked selection is never replaced — the answer lands BELOW it, so
    // the caret goes to the selection's end (the inserter prefixes a newline).
    this.insertPos = this.el.selectionEnd ?? this.el.value.length;
    try {
      this.el.setSelectionRange(this.insertPos, this.insertPos);
    } catch {
      /* some input types disallow selection */
    }
    this.insertedText = '';
    return { ok: true, verified: true };
  }

  insert(chunk: string): InsertResult {
    if (!this.el.isConnected) return { ok: false, verified: true, reason: 'The target field disappeared mid-insertion.' };
    const loc = this.locateInserted();
    if (!loc.ok) return { ok: false, verified: true, reason: loc.reason };
    const v = this.el.value;
    const pos = this.insertPos + this.insertedText.length;
    const next = v.slice(0, pos) + chunk + v.slice(pos);
    this.setValue(next, pos + chunk.length, chunk);
    // Post-write verification (INST-11): read back what we wrote.
    const readBack = this.el.value.slice(pos, pos + chunk.length);
    if (readBack !== chunk) {
      return { ok: false, verified: true, reason: 'The field rejected the inserted text (it was reverted).' };
    }
    this.insertedText += chunk;
    return { ok: true, verified: true };
  }

  verifyIntact(): InsertResult {
    if (!this.el.isConnected) return { ok: false, verified: true, reason: 'The target field is no longer on the page.' };
    const loc = this.locateInserted();
    return loc.ok ? { ok: true, verified: true } : { ok: false, verified: true, reason: loc.reason };
  }

  undoAll(): InsertResult {
    if (!this.el.isConnected) return { ok: false, verified: true, reason: 'The target field is no longer on the page.' };
    if (!this.insertedText) return { ok: true, verified: true };
    const loc = this.locateInserted();
    if (!loc.ok) {
      // Never fall back to a snapshot restore here: that would also erase
      // everything the user typed since the insertion began.
      return { ok: false, verified: true, reason: loc.reason };
    }
    const v = this.el.value;
    const next = v.slice(0, this.insertPos) + v.slice(this.insertPos + this.insertedText.length);
    this.setValue(next, this.insertPos);
    const ok = this.el.value === next;
    if (ok) this.insertedText = '';
    return { ok, verified: true, reason: ok ? undefined : 'The field did not accept the undo.' };
  }

  /**
   * Re-anchor insertPos to wherever the inserted text now lives. A unique
   * match after the user's edits is safe to keep working with; anything
   * ambiguous or missing means our offsets are meaningless — refuse.
   */
  private locateInserted(): { ok: boolean; reason?: string } {
    if (!this.insertedText) return { ok: true };
    const v = this.el.value;
    if (v.slice(this.insertPos, this.insertPos + this.insertedText.length) === this.insertedText) {
      return { ok: true };
    }
    const first = v.indexOf(this.insertedText);
    if (first !== -1 && first === v.lastIndexOf(this.insertedText)) {
      this.insertPos = first;
      return { ok: true };
    }
    return {
      ok: false,
      reason:
        'The field changed while insertion was paused and the inserted text could not be found again. Remove or keep it manually.',
    };
  }

  private setValue(value: string, caret: number, data?: string): void {
    const proto = this.el instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
    const setter = Object.getOwnPropertyDescriptor(proto, 'value')?.set;
    if (setter) setter.call(this.el, value);
    else this.el.value = value;
    try {
      this.el.setSelectionRange(caret, caret);
    } catch {
      /* some input types disallow selection */
    }
    this.el.dispatchEvent(
      new InputEvent('input', { bubbles: true, inputType: data ? 'insertText' : 'deleteContent', data }),
    );
  }
}
