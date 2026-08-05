import type { InsertionAdapter, InsertResult } from '../types';
import type { SavedTarget } from '../target';

/**
 * Plain <input>/<textarea>, including React/Vue-controlled fields.
 *
 * The trap (research pitfall #2): assigning `.value` directly updates the DOM
 * but not the framework's internal state — the next re-render silently reverts
 * it. The fix is the native prototype setter followed by a real bubbling
 * InputEvent, which walks the framework's own onChange path.
 */
export class PlainAdapter implements InsertionAdapter {
  readonly kind = 'plain' as const;
  private el: HTMLInputElement | HTMLTextAreaElement;
  private insertPos = 0;
  private inserted = 0;
  private snapshot: { value: string; selStart: number; selEnd: number } | null = null;

  constructor(target: SavedTarget) {
    this.el = target.element as HTMLInputElement | HTMLTextAreaElement;
    this.insertPos = target.selStart ?? this.el.value.length;
  }

  eventTarget(): EventTarget {
    return this.el;
  }

  prepare(): InsertResult {
    if (!this.el.isConnected) return { ok: false, verified: true, reason: 'The target field is no longer on the page.' };
    this.snapshot = {
      value: this.el.value,
      selStart: this.el.selectionStart ?? 0,
      selEnd: this.el.selectionEnd ?? 0,
    };
    this.el.focus();
    // If the user had a selection, the insertion replaces it — like typing.
    const selStart = this.snapshot.selStart;
    const selEnd = this.snapshot.selEnd;
    if (selEnd > selStart) {
      this.setValue(this.el.value.slice(0, selStart) + this.el.value.slice(selEnd), selStart);
    }
    this.insertPos = selStart;
    this.inserted = 0;
    return { ok: true, verified: true };
  }

  insert(chunk: string): InsertResult {
    if (!this.el.isConnected) return { ok: false, verified: true, reason: 'The target field disappeared mid-insertion.' };
    const v = this.el.value;
    const pos = this.insertPos + this.inserted;
    const next = v.slice(0, pos) + chunk + v.slice(pos);
    this.setValue(next, pos + chunk.length, chunk);
    // Post-write verification (INST-11): read back what we wrote.
    const readBack = this.el.value.slice(pos, pos + chunk.length);
    if (readBack !== chunk) {
      return { ok: false, verified: true, reason: 'The field rejected the inserted text (it was reverted).' };
    }
    this.inserted += chunk.length;
    return { ok: true, verified: true };
  }

  undoAll(): InsertResult {
    if (!this.snapshot) return { ok: false, verified: true, reason: 'Nothing to undo.' };
    if (!this.el.isConnected) return { ok: false, verified: true, reason: 'The target field is no longer on the page.' };
    this.setValue(this.snapshot.value, this.snapshot.selStart);
    const ok = this.el.value === this.snapshot.value;
    this.inserted = 0;
    return { ok, verified: true, reason: ok ? undefined : 'The field did not accept the undo.' };
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
