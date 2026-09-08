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
  /**
   * The caret already stands inside an empty answer box (a table cell), so the
   * answer starts right there. Without this the run prefixes a newline to put
   * the answer on the line BELOW the question — correct after Find, wrong
   * inside a box, where it would open with a blank line.
   */
  inBox?: boolean;
  /** The caret stands in an EMPTY LIST ITEM of this kind: the answer continues that list. */
  inList?: 'bullet' | 'numbered';
}

const GDOCS_IFRAME = 'iframe.docs-texteventtarget-iframe';

export function isGoogleDocs(): boolean {
  return location.host === 'docs.google.com' && !!document.querySelector(GDOCS_IFRAME);
}

/**
 * A synthetic keystroke aimed at the element Docs listens on.
 *
 * The one channel this codebase has for telling Docs to do something it has no
 * paste for: collapse a selection, undo, backspace, select all. Lives here
 * rather than in the adapter because three different callers need it and a
 * second copy of a Docs resolution has drifted out of step once already
 * (see gdocsEventTarget above).
 */
export function pressGdocsKey(el: HTMLElement, init: KeyboardEventInit): void {
  const full: KeyboardEventInit = { bubbles: true, cancelable: true, ...init };
  el.dispatchEvent(new KeyboardEvent('keydown', full));
  el.dispatchEvent(new KeyboardEvent('keyup', full));
}

/** Cmd on a Mac, Ctrl everywhere else — for the shortcuts Docs owns. */
export function gdocsCommandKey(): { metaKey: true } | { ctrlKey: true } {
  const platform =
    (navigator as Navigator & { userAgentData?: { platform?: string } }).userAgentData?.platform ??
    navigator.platform;
  return platform.toLowerCase().includes('mac') ? { metaKey: true } : { ctrlKey: true };
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
 * Keep the two resolutions in step; they must not drift again.
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

/** Zero-width space / BOM — Docs' own padding, never content we want. */
const ZERO_WIDTH = /[\u200B\uFEFF]/g;

/**
 * The text Docs currently has marked.
 *
 * The hidden input frame does NOT mirror the selection: with nothing marked it
 * holds two zero-width spaces, with text marked a single non-breaking space,
 * never the text itself (measured 2026-08-18). Docs will however hand the
 * selection over: dispatching a synthetic `copy` at the same element that
 * receives our synthetic paste makes Docs serialise the marked text into the
 * DataTransfer we supply. Nothing reaches the system clipboard — the event is
 * untrusted and the DataTransfer is our own.
 *
 * One-shot use only. Asking Docs for the selection repeatedly WHILE it is
 * being written to corrupted the document (measured 2026-08-18), which is why
 * there is no selection poll anywhere any more.
 */
export function gdocsSelectionTextNow(): string {
  return gdocsSelectionNow().text;
}

/** Both flavours of one synthetic copy: what the marked text says, and how it is built. */
export interface GDocsRead {
  text: string;
  /**
   * Docs' own serialisation of the marked text — tables, cells, headings, bold,
   * list items, all as real markup. Measured 2026-09-08 (scripts/probe-docs-html.mjs):
   * the same copy that returned 404 characters of text returned 9,087 of html,
   * and every empty answer box in it was a `<td><br/></td>`. Empty when Docs
   * offered no html flavour, which callers must treat as "structure unknown",
   * never as "no structure".
   */
  html: string;
}

/**
 * The same one-shot synthetic copy, reading BOTH flavours Docs writes into it.
 *
 * For a year this read `text/plain` alone and threw the rest away, which is
 * why "Besvar alle spørgsmål" could not tell an empty answer box from a blank
 * line — both were "". The html was in the same DataTransfer the whole time.
 * Reading it costs one extra getData and nothing else: no permission, no
 * request, no Google account, only the document the user is looking at.
 */
export function gdocsSelectionNow(): GDocsRead {
  const raw = copyNow();
  return { text: raw.text.trim(), html: raw.html };
}

/**
 * The marked text EXACTLY, edge whitespace included.
 *
 * For the adapter's own deletions (adapters/gdocs.ts deleteBack): a selection
 * meant to cover "re" that reached one character too far reads " re", and
 * trimming would make that look like the match it is not — then the paste
 * would eat the space before the word.
 */
export function gdocsMarkedTextNow(): string {
  return copyNow().text;
}

function copyNow(): GDocsRead {
  const el = gdocsEventTarget();
  if (!el) return { text: '', html: '' };
  try {
    const dt = new DataTransfer();
    dt.setData('text/plain', '');
    el.dispatchEvent(new ClipboardEvent('copy', { clipboardData: dt, bubbles: true, cancelable: true }));
    return {
      text: dt.getData('text/plain').replace(ZERO_WIDTH, ''),
      html: dt.getData('text/html'),
    };
  } catch {
    return { text: '', html: '' };
  }
}

/**
 * The whole document's text, with no Google account involved at any point.
 *
 * This used to fetch Docs' own `/export?format=txt` with the browser's
 * cookies. That asked for no permission, but it still only worked for a
 * browser signed into an account with access to the file — a dependency on
 * Google that the product is not willing to carry.
 *
 * So it does what a person does instead: select all, copy. Both halves already
 * exist and are proven. `pressGdocsKey` is the same channel that collapses a
 * selection before every insertion, and `gdocsSelectionTextNow` is the
 * synthetic-copy read the selection bar was built on — Docs serialises the
 * marked text into a DataTransfer we supply, and nothing reaches the system
 * clipboard because the event is untrusted and the DataTransfer is our own.
 *
 * The caret ends up at the end of the document, because collapsing a
 * select-all has nowhere else to put it. The caller says so out loud rather
 * than letting the user discover it when their next insertion lands somewhere
 * they did not expect.
 *
 * Returns '' when Docs gives nothing back, which the caller must treat as a
 * failure and never as an empty document.
 */
export function gdocsWholeDocumentText(): string {
  return gdocsWholeDocumentNow().text;
}

/** The whole document, both flavours — see gdocsSelectionNow for why html. */
export function gdocsWholeDocumentNow(): GDocsRead {
  const el = gdocsEventTarget();
  if (!el) return { text: '', html: '' };
  pressGdocsKey(el, { key: 'a', code: 'KeyA', keyCode: 65, which: 65, ...gdocsCommandKey() });
  const read = gdocsSelectionNow();
  // Collapse, whether or not the read worked: leaving the user's whole
  // document selected is how the next keystroke deletes all of it.
  pressGdocsKey(el, { key: 'ArrowRight', code: 'ArrowRight', keyCode: 39, which: 39 });
  return read;
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
