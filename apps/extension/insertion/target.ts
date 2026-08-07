import type { EditorKind } from './types';

export interface SavedTarget {
  kind: EditorKind;
  element: HTMLElement; // for gdocs: the texteventtarget iframe's body
  /** plain fields: selection offsets at capture time */
  selStart?: number;
  selEnd?: number;
  /** contenteditable: cloned range at capture time */
  range?: Range;
  /** human label for the UI ("Where will this go?") */
  label: string;
}

const GDOCS_IFRAME = 'iframe.docs-texteventtarget-iframe';

export function isGoogleDocs(): boolean {
  return location.host === 'docs.google.com' && !!document.querySelector(GDOCS_IFRAME);
}

/**
 * The element Docs actually listens on, NOT whatever happens to be focused.
 *
 * `doc.activeElement` is sometimes Docs' contenteditable and sometimes the
 * frame's `<body>`. An event dispatched at `<body>` propagates
 * body → html → document and never reaches a listener bound to the
 * contenteditable *inside* body, so it is silently ignored — measured against
 * live Docs 2026-08-07 (see adapters/gdocs.ts:targetEl and the phase-07
 * findings note, 07-FINDINGS-docs.md).
 *
 * This bug had two homes: the adapter's own targetEl() and this function.
 * Fixing only the adapter left the Find-based cursor positioning
 * (autonomous/docs-find.ts) still aiming at `<body>`, which is why the spike's
 * P3 probe reported "the find bar did not appear" — Ctrl/Cmd+F was going
 * nowhere. Keep the two resolutions in step; they must not drift again.
 */
export function gdocsEventTarget(): HTMLElement | null {
  const iframe = document.querySelector<HTMLIFrameElement>(GDOCS_IFRAME);
  const doc = iframe?.contentDocument;
  if (!doc) return null;
  const editable = doc.querySelector<HTMLElement>('[contenteditable="true"], [contenteditable=""]');
  if (editable) return editable;
  const active = doc.activeElement as HTMLElement | null;
  if (active && active !== doc.body) return active;
  return doc.body;
}

function isTextInput(el: Element): el is HTMLInputElement | HTMLTextAreaElement {
  if (el instanceof HTMLTextAreaElement) return !el.readOnly && !el.disabled;
  if (el instanceof HTMLInputElement) {
    const type = el.type.toLowerCase();
    return (
      ['text', 'search', 'url', 'email', 'tel', ''].includes(type) && !el.readOnly && !el.disabled
    );
  }
  return false;
}

/** Climb to the outermost contenteditable element (the editor root). */
function contentEditableRoot(el: HTMLElement): HTMLElement {
  let root = el;
  let cur: HTMLElement | null = el;
  while (cur) {
    if (cur.isContentEditable) root = cur;
    cur = cur.parentElement;
  }
  return root;
}

/**
 * Tracks the last editable element the USER focused on the host page, so
 * "Insert" knows where to go after they've clicked into our sidebar.
 * The shadow host (our UI) is explicitly excluded.
 */
export class TargetTracker {
  private saved: SavedTarget | null = null;

  constructor(private shadowHost: () => Element | null) {
    document.addEventListener('focusin', this.onFocus, true);
    document.addEventListener('selectionchange', this.onSelectionChange, true);
  }

  destroy(): void {
    document.removeEventListener('focusin', this.onFocus, true);
    document.removeEventListener('selectionchange', this.onSelectionChange, true);
  }

  private onFocus = (e: FocusEvent): void => {
    const t = e.target;
    if (!(t instanceof HTMLElement)) return;
    const host = this.shadowHost();
    if (host && (t === host || host.contains(t))) return; // our own UI

    if (isTextInput(t)) {
      this.saved = {
        kind: 'plain',
        element: t,
        selStart: t.selectionStart ?? t.value.length,
        selEnd: t.selectionEnd ?? t.value.length,
        label: describePlain(t),
      };
      return;
    }
    if (t.isContentEditable) {
      const root = contentEditableRoot(t);
      this.saved = { kind: 'contenteditable', element: root, label: describeCE(root) };
      this.captureRange();
    }
  };

  private onSelectionChange = (): void => {
    if (!this.saved) return;
    const active = document.activeElement;
    if (this.saved.kind === 'plain' && active === this.saved.element) {
      const el = this.saved.element as HTMLInputElement | HTMLTextAreaElement;
      this.saved.selStart = el.selectionStart ?? this.saved.selStart;
      this.saved.selEnd = el.selectionEnd ?? this.saved.selEnd;
    } else if (this.saved.kind === 'contenteditable' && active && this.saved.element.contains(active)) {
      this.captureRange();
    }
  };

  private captureRange(): void {
    const sel = document.getSelection();
    if (sel && sel.rangeCount > 0 && this.saved) {
      const r = sel.getRangeAt(0);
      if (this.saved.element.contains(r.startContainer)) {
        this.saved.range = r.cloneRange();
      }
    }
  }

  /** Current best target. Google Docs overrides DOM focus tracking. */
  get(): SavedTarget | null {
    if (isGoogleDocs()) {
      const el = gdocsEventTarget();
      if (el) return { kind: 'gdocs', element: el, label: 'Google Docs document' };
    }
    const s = this.saved;
    if (!s) return null;
    if (!s.element.isConnected) return null; // SPA removed it
    return s;
  }

  /** Text currently selected on the host page (PROM-02). */
  selectionText(): string {
    const s = this.saved;
    if (s?.kind === 'plain') {
      const el = s.element as HTMLInputElement | HTMLTextAreaElement;
      const a = el.selectionStart ?? 0;
      const b = el.selectionEnd ?? 0;
      if (b > a) return el.value.slice(a, b);
    }
    return document.getSelection()?.toString() ?? '';
  }
}

function describePlain(el: HTMLInputElement | HTMLTextAreaElement): string {
  const name =
    el.getAttribute('aria-label') || el.placeholder || el.name || (el instanceof HTMLTextAreaElement ? 'text area' : 'text field');
  return `${name} — ${location.host}`;
}

function describeCE(el: HTMLElement): string {
  const name = el.getAttribute('aria-label') || 'rich-text editor';
  return `${name} — ${location.host}`;
}
