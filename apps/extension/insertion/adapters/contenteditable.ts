import type { InsertionAdapter, InsertResult } from '../types';
import type { SavedTarget } from '../target';

/**
 * Contenteditable editors (Gmail, LinkedIn, Slack, Notion — ProseMirror,
 * Lexical, Quill, Draft.js and friends).
 *
 * These editors ignore direct DOM mutation: their internal document model is
 * the truth and re-normalizes the DOM under you. `execCommand('insertText')`
 * — deprecated but with no replacement — is the one entry point that walks
 * their transaction pipeline, because editors listen for the beforeinput
 * events it produces. Fallback: a synthetic paste event, which every major
 * editor also handles.
 *
 * Undo strategy: we record the absolute character offset where insertion
 * begins; undoAll() selects [start, start+inserted] by walking text nodes and
 * deletes via execCommand — one user-visible step, expressed through the
 * editor's own pipeline.
 *
 * Position safety (research pitfall #3): those offsets go stale if the user
 * edits while paused. Before writing or deleting we verify the span
 * [start, start+inserted] still holds the text we inserted (whitespace-
 * normalized, because editors re-normalize). On mismatch we refuse with a
 * visible message instead of deleting the user's own text.
 */
export class ContentEditableAdapter implements InsertionAdapter {
  readonly kind = 'contenteditable' as const;
  private el: HTMLElement;
  private savedRange: Range | null;
  private startOffset = 0;
  private inserted = 0;
  /** Exactly what this session has asked the editor to insert so far. */
  private insertedText = '';

  constructor(target: SavedTarget) {
    this.el = target.element;
    this.savedRange = target.range ?? null;
  }

  eventTarget(): EventTarget {
    return this.el;
  }

  prepare(): InsertResult {
    if (!this.el.isConnected) return { ok: false, verified: true, reason: 'The editor is no longer on the page.' };
    this.el.focus();
    const sel = document.getSelection();
    if (!sel) return { ok: false, verified: true, reason: 'Could not access the page selection.' };
    if (this.savedRange && this.el.contains(this.savedRange.startContainer)) {
      // A marked selection is never replaced — collapse to its END so the
      // answer lands below it (the inserter prefixes a newline).
      const r = this.savedRange.cloneRange();
      r.collapse(false);
      sel.removeAllRanges();
      sel.addRange(r);
    } else if (sel.rangeCount === 0 || !this.el.contains(sel.getRangeAt(0).startContainer)) {
      // No usable cursor — put it at the end of the editor.
      const r = document.createRange();
      r.selectNodeContents(this.el);
      r.collapse(false);
      sel.removeAllRanges();
      sel.addRange(r);
    }
    // A live (unsaved) selection must not be replaced either.
    if (!sel.isCollapsed) sel.collapseToEnd();
    this.startOffset = this.absoluteOffset(sel.getRangeAt(0));
    this.inserted = 0;
    this.insertedText = '';
    return { ok: true, verified: true };
  }

  insert(chunk: string): InsertResult {
    if (!this.el.isConnected) return { ok: false, verified: true, reason: 'The editor disappeared mid-insertion.' };
    const intact = this.verifyIntact();
    if (!intact.ok) return intact;
    if (document.activeElement !== this.el && !this.el.contains(document.activeElement)) {
      this.el.focus();
    }
    // Always write at the end of the inserted span, not wherever the cursor
    // drifted to — the user may have moved it while we were paused, and the
    // undo range assumes the span is contiguous.
    this.restoreCursor();

    const before = this.textLength();
    let ok = false;
    try {
      ok = document.execCommand('insertText', false, chunk);
    } catch {
      ok = false;
    }
    if (!ok || this.textLength() === before) {
      // Fallback: synthetic paste — DataTransfer is fully scriptable.
      const dt = new DataTransfer();
      dt.setData('text/plain', chunk);
      const pasteTarget = document.activeElement && this.el.contains(document.activeElement)
        ? (document.activeElement as HTMLElement)
        : this.el;
      pasteTarget.dispatchEvent(
        new ClipboardEvent('paste', { clipboardData: dt, bubbles: true, cancelable: true }),
      );
    }

    // Post-write verification (INST-11): the editor's text must have grown.
    // Length delta (not exact equality) because editors normalize whitespace.
    const after = this.textLength();
    const grewEnough = after - before >= Math.max(1, chunk.trim().length > 0 ? chunk.trim().length - 2 : 0);
    if (!grewEnough && chunk.trim().length > 0) {
      return { ok: false, verified: true, reason: 'This editor rejected the inserted text.' };
    }
    this.inserted += after - before;
    this.insertedText += chunk;
    return { ok: true, verified: true };
  }

  verifyIntact(): InsertResult {
    if (!this.el.isConnected) return { ok: false, verified: true, reason: 'The editor is no longer on the page.' };
    if (this.inserted <= 0) return { ok: true, verified: true };
    const span = (this.el.textContent ?? '').slice(this.startOffset, this.startOffset + this.inserted);
    if (normalize(span) === normalize(this.insertedText)) return { ok: true, verified: true };
    // Offsets go stale not only from user edits — the editor's own insertText
    // normalization can drop/convert whitespace BEFORE our span (observed:
    // Chrome removes a pre-existing trailing space at the insertion point).
    // Re-locate our text before declaring the session unsafe.
    const loc = this.relocate();
    if (loc) {
      this.startOffset = loc.start;
      this.inserted = loc.length;
      return { ok: true, verified: true };
    }
    return {
      ok: false,
      verified: true,
      reason:
        'The editor content changed while insertion was paused, so continuing or undoing is no longer safe. Remove or keep the inserted text manually.',
    };
  }

  /**
   * Find the inserted text in the editor with every whitespace run flexible
   * (editors collapse spaces, convert to nbsp, drop them at block edges).
   * Only a UNIQUE match is trusted — zero or several means we can no longer
   * tell our text from the user's, and the caller must refuse.
   */
  private relocate(): { start: number; length: number } | null {
    const words = this.insertedText.trim().split(/\s+/).filter(Boolean);
    if (!words.length) return null;
    const pattern = new RegExp(words.map(escapeRe).join('\\s+'), 'g');
    const hay = this.el.textContent ?? '';
    const matches = [...hay.matchAll(pattern)];
    if (matches.length !== 1) return null;
    return { start: matches[0].index, length: matches[0][0].length };
  }

  undoAll(): InsertResult {
    if (!this.el.isConnected) return { ok: false, verified: true, reason: 'The editor is no longer on the page.' };
    if (this.inserted <= 0) return { ok: true, verified: true };
    // Deleting [start, start+inserted] is only safe while that range still
    // contains exactly our text — otherwise it would take the user's edits
    // with it.
    const intact = this.verifyIntact();
    if (!intact.ok) return intact;
    const range = this.rangeFromOffsets(this.startOffset, this.startOffset + this.inserted);
    if (!range) return { ok: false, verified: true, reason: 'Could not locate the inserted text to remove it.' };
    const sel = document.getSelection();
    if (!sel) return { ok: false, verified: true, reason: 'Could not access the page selection.' };
    this.el.focus();
    sel.removeAllRanges();
    sel.addRange(range);
    const before = this.textLength();
    let ok = false;
    try {
      ok = document.execCommand('delete');
    } catch {
      ok = false;
    }
    if (!ok || this.textLength() === before) {
      // Fallback: deleteContentBackward via beforeinput-compatible paste of nothing
      // is not a thing — use execCommand insertText with empty replacement.
      try {
        document.execCommand('insertText', false, '');
      } catch {
        /* ignore */
      }
    }
    const removed = before - this.textLength();
    const success = removed >= this.inserted - 2; // whitespace normalization tolerance
    if (success) {
      this.inserted = 0;
      this.insertedText = '';
    }
    return {
      ok: success,
      verified: true,
      reason: success ? undefined : 'The editor did not allow removing the inserted text.',
    };
  }

  // ---- text offset helpers ----

  private textLength(): number {
    return (this.el.textContent ?? '').length;
  }

  private absoluteOffset(range: Range): number {
    const r = document.createRange();
    r.selectNodeContents(this.el);
    r.setEnd(range.startContainer, range.startOffset);
    return r.toString().length;
  }

  private rangeFromOffsets(start: number, end: number): Range | null {
    const walker = document.createTreeWalker(this.el, NodeFilter.SHOW_TEXT);
    let pos = 0;
    let startNode: Node | null = null;
    let startOff = 0;
    let endNode: Node | null = null;
    let endOff = 0;
    let node: Node | null;
    while ((node = walker.nextNode())) {
      const len = node.textContent?.length ?? 0;
      if (!startNode && pos + len >= start) {
        startNode = node;
        startOff = start - pos;
      }
      if (pos + len >= end) {
        endNode = node;
        endOff = end - pos;
        break;
      }
      pos += len;
    }
    if (!startNode) return null;
    if (!endNode) {
      endNode = startNode;
      endOff = startNode.textContent?.length ?? 0;
    }
    const r = document.createRange();
    try {
      r.setStart(startNode, Math.max(0, Math.min(startOff, startNode.textContent?.length ?? 0)));
      r.setEnd(endNode, Math.max(0, Math.min(endOff, endNode.textContent?.length ?? 0)));
    } catch {
      return null;
    }
    return r;
  }

  private restoreCursor(): void {
    const range = this.rangeFromOffsets(
      this.startOffset + this.inserted,
      this.startOffset + this.inserted,
    );
    if (range) {
      const sel = document.getSelection();
      sel?.removeAllRanges();
      sel?.addRange(range);
    }
  }
}

/** Editors re-normalize whitespace under us — compare content, not spacing. */
function normalize(s: string): string {
  return s.replace(/\s+/g, ' ').trim();
}

function escapeRe(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}
