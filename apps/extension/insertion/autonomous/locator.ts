import type { AutonomousParagraph } from '@awa/shared';
import type { EditorKind } from '../types';
import type { SavedTarget } from '../target';
import { resolveDocsSource } from './docs-source';

const BLOCK_SELECTOR = 'p, div, li, h1, h2, h3, h4, h5, h6';
const REASON_PREVIEW_LEN = 60;

/**
 * Reads questions out of a target and places the cursor under one.
 *
 * `locate()` is called once per answer, immediately before that answer is
 * written, never up front (D-03): writing under question 1 moves question 2
 * down the page, so only the CURRENT content can be trusted. A match that is
 * absent, or ambiguous within the remaining region, returns `null` — never a
 * guess. This is the same "re-anchor or refuse" rule
 * `PlainAdapter.locateInserted` already applies (T-07-11).
 */
export interface QuestionSource {
  readonly kind: EditorKind;
  readonly label: string;
  readonly placement: 'in-place' | 'block';
  readonly degradedReason?: string;
  read(): Promise<AutonomousParagraph[]>;
  locate(q: { paragraphIndex: number; questionText: string }): Promise<SavedTarget | null>;
  /**
   * Rule 2 addition (not in the plan's literal interface): a specific reason
   * for the most recent locate() miss, distinguishing "not found" from
   * "ambiguous" so the run can report something more useful than a generic
   * message (critical constraint: failures must be specific and visible).
   * Optional so any future QuestionSource implementation may omit it.
   */
  lastLocateReason?(): string;
}

function truncate(s: string): string {
  return s.length > REASON_PREVIEW_LEN ? `${s.slice(0, REASON_PREVIEW_LEN)}…` : s;
}

function linesToParagraphs(text: string): AutonomousParagraph[] {
  const out: AutonomousParagraph[] = [];
  for (const raw of text.split('\n')) {
    const line = raw.trim();
    if (line) out.push({ index: out.length, text: line });
  }
  return out;
}

/**
 * Implements QuestionSource for `plain` and `contenteditable` targets — the
 * two editor families this plan proves against. Google Docs is out of scope
 * here (07-05); `sourceFor` refuses a gdocs target explicitly rather than
 * silently mishandling it.
 */
class DomSource implements QuestionSource {
  readonly placement = 'in-place' as const;
  /** plain: char offset to search from. contenteditable: block index to search from. */
  private searchFromChar = 0;
  private searchFromBlock = 0;
  private reason = '';

  constructor(
    private target: SavedTarget,
    private scope: 'document' | 'selection',
  ) {
    if (scope === 'selection' && target.kind === 'plain') {
      this.searchFromChar = target.selStart ?? 0;
    }
  }

  get kind(): EditorKind {
    return this.target.kind;
  }

  get label(): string {
    return this.target.label;
  }

  lastLocateReason(): string {
    return this.reason;
  }

  async read(): Promise<AutonomousParagraph[]> {
    if (this.target.kind === 'plain') {
      const el = this.target.element as HTMLInputElement | HTMLTextAreaElement;
      let text = el.value;
      if (this.scope === 'selection') {
        const a = this.target.selStart ?? 0;
        const b = this.target.selEnd ?? text.length;
        text = text.slice(a, b);
      }
      return linesToParagraphs(text);
    }
    const blocks = this.currentBlocks();
    const out: AutonomousParagraph[] = [];
    for (const b of blocks) {
      const text = (b.textContent ?? '').trim();
      if (text) out.push({ index: out.length, text });
    }
    return out;
  }

  async locate(q: { paragraphIndex: number; questionText: string }): Promise<SavedTarget | null> {
    this.reason = '';
    if (this.target.kind === 'plain') return this.locatePlain(q.questionText);
    return this.locateCE(q.questionText);
  }

  // ---- plain ----

  private locatePlain(questionText: string): SavedTarget | null {
    const el = this.target.element as HTMLInputElement | HTMLTextAreaElement;
    if (!el.isConnected) {
      this.reason = 'Feltet er ikke længere på siden.';
      return null;
    }
    const value = el.value;
    const region = value.slice(this.searchFromChar);
    const idx = region.indexOf(questionText);
    if (idx === -1) {
      this.reason = `Spørgsmålet "${truncate(questionText)}" kunne ikke findes i teksten — det er måske blevet ændret.`;
      return null;
    }
    const nextIdx = region.indexOf(questionText, idx + questionText.length);
    if (nextIdx !== -1) {
      this.reason = `Spørgsmålet "${truncate(questionText)}" findes flere gange i den resterende tekst — placeringen er tvetydig.`;
      return null;
    }
    const absoluteStart = this.searchFromChar + idx;
    const absoluteEnd = absoluteStart + questionText.length;
    this.searchFromChar = absoluteEnd;

    // PlainAdapter.prepare() reads el.selectionEnd AT PREPARE TIME — setting
    // the real DOM selection here, immediately, is how the caret is placed.
    el.focus();
    try {
      el.setSelectionRange(absoluteEnd, absoluteEnd);
    } catch {
      /* some input types disallow selection */
    }
    return { kind: 'plain', element: el, selStart: absoluteEnd, selEnd: absoluteEnd, label: this.target.label };
  }

  // ---- contenteditable ----

  private currentBlocks(): HTMLElement[] {
    const root = this.target.element;
    let blocks = Array.from(root.querySelectorAll<HTMLElement>(BLOCK_SELECTOR));
    if (blocks.length === 0) blocks = [root];
    if (this.scope === 'selection' && this.target.range) {
      const range = this.target.range;
      blocks = blocks.filter((b) => range.intersectsNode(b));
    }
    return blocks;
  }

  private locateCE(questionText: string): SavedTarget | null {
    const root = this.target.element;
    if (!root.isConnected) {
      this.reason = 'Editoren er ikke længere på siden.';
      return null;
    }
    const blocks = this.currentBlocks();
    const matches: { i: number; block: HTMLElement }[] = [];
    for (let i = this.searchFromBlock; i < blocks.length; i++) {
      const text = (blocks[i].textContent ?? '').trim();
      if (text && text.includes(questionText)) matches.push({ i, block: blocks[i] });
    }
    if (matches.length === 0) {
      this.reason = `Spørgsmålet "${truncate(questionText)}" kunne ikke findes — det er måske blevet ændret.`;
      return null;
    }
    if (matches.length > 1) {
      this.reason = `Spørgsmålet "${truncate(questionText)}" findes flere gange — placeringen er tvetydig.`;
      return null;
    }
    const { i, block } = matches[0];
    this.searchFromBlock = i + 1;

    // ContentEditableAdapter.prepare() uses target.range, collapsed to its
    // end — no live-selection write needed here, unlike the plain case.
    const range = document.createRange();
    range.selectNodeContents(block);
    range.collapse(false);
    return { kind: 'contenteditable', element: root, range, label: this.target.label };
  }
}

/**
 * INST-04-style dispatch: pick the right source for the detected editor.
 * Async since the gdocs branch (07-05) may need to ask for the `documents`
 * permission and read the document before a QuestionSource can even be
 * constructed — `mode` is needed there too (GDocsApiWriteSource's fallback
 * behaves differently for Straks vs Langsomt), so it is threaded through
 * from the one call site (`sidebar/autonomous.ts`) that already knows it.
 */
export async function sourceFor(
  target: SavedTarget,
  scope: 'document' | 'selection',
  mode: 'instant' | 'progressive' = 'instant',
): Promise<QuestionSource> {
  if (target.kind === 'gdocs') {
    return resolveDocsSource(scope, mode);
  }
  return new DomSource(target, scope);
}
