import type { AutonomousParagraph } from '@awa/shared';
import type { EditorKind } from '../types';
import type { SavedTarget } from '../target';
import { gdocsEventTarget, gdocsMarkedTextNow, gdocsSelectionNow, gdocsWholeDocumentNow, pressGdocsKey, type GDocsRead } from '../target';
import { GDocsAdapter } from '../adapters/gdocs';
import { findAndPlaceCursor } from './docs-find';
import { boxBelowFor, findLine, normalizeCellText, slotPlanFor, type SlotPlan } from './docs-tables';
import { markedRange, parseDocsHtml } from './docs-structure';
import type { FillTarget, QuestionSource } from './locator';
import { awaLog } from '../debug';

/**
 * The Google Docs read/write path (D-05, D-16) — two sources and the resolver
 * that picks between them, never silently.
 *
 * Neither source asks Google for anything. There used to be a third, which
 * read the document and wrote the answers over the Docs REST API; it was
 * deleted 2026-09-08 with the rest of that path, because its `auth/documents`
 * OAuth scope forced Google verification and so blocked publishing the
 * extension at all. What remains is what needs no
 * permission: Docs' own Find bar for placing the cursor (docs-find.ts), Docs'
 * own select-all + copy for reading the document (`gdocsWholeDocumentText`),
 * and a paste-at-the-cursor fallback that says out loud that it is one.
 *
 * The consequence is deliberate and must not be softened: with no index-based
 * writer left, a question Find cannot locate is reported UNPLACED. Nothing
 * writes an answer at an approximate position — a misplaced answer corrupts a
 * document the user wrote.
 */

/**
 * Docs hands the marked text over through a synthetic `copy` (F-1,
 * 07-FINDINGS-docs.md). The gated variant of this read went with the selection
 * poll it existed for; this is the one-shot read, which is all a run needs.
 */
const markedMirror = gdocsSelectionNow;

/**
 * Structure when Docs gave it, lines when it did not.
 *
 * The html flavour carries what a questionnaire is made of — the cells, the
 * headings, the empty boxes — and it is what the model and the placement
 * logic read from now on. It is not assumed: a copy that came back without
 * html falls back to the line split this always used, so a document Docs
 * serialises oddly is still answered, on the old terms, rather than not at all.
 */
function readToParagraphs(read: GDocsRead): AutonomousParagraph[] {
  if (read.html) {
    const paragraphs = parseDocsHtml(read.html);
    if (paragraphs.length) return paragraphs;
  }
  return linesToParagraphs(read.text);
}

/** Local copy of locator.ts's private helper — DomSource's selection-text splitting, reused for the two Docs sources that read their text out of Docs itself. */
function linesToParagraphs(text: string): AutonomousParagraph[] {
  const out: AutonomousParagraph[] = [];
  for (const raw of text.split('\n')) {
    const line = raw.trim();
    if (line) out.push({ index: out.length, text: line });
  }
  return out;
}

/** How long Docs is given to act on the synthetic Tab before the first letter is typed — matches docs-find.ts' own OCCURRENCE_ADVANCE_DELAY_MS. */
const TAB_SETTLE_MS = 150;

const KEY = {
  end: { key: 'End', code: 'End', keyCode: 35, which: 35 },
  down: { key: 'ArrowDown', code: 'ArrowDown', keyCode: 40, which: 40 },
  left: { key: 'ArrowLeft', code: 'ArrowLeft', keyCode: 37, which: 37 },
  right: { key: 'ArrowRight', code: 'ArrowRight', keyCode: 39, which: 39 },
  tab: { key: 'Tab', code: 'Tab', keyCode: 9, which: 9 },
} as const;

/** How many lines below the anchor a box may sit. A form's blank lines are one or two; six is already a different section. */
const WALK_MAX_LINES = 6;
const WALK_SETTLE_MS = 120;
const settle = (ms = WALK_SETTLE_MS) => new Promise<void>((resolve) => setTimeout(resolve, ms));

/**
 * From the caret at the end of a line, down INTO the next table or list item,
 * past any number of blank lines.
 *
 * Docs' copy html leaves empty paragraphs out and its text flavour draws a
 * one-cell table as three empty lines, so neither says how many lines down
 * the box is; Docs' own "next table" chord is ignored when synthetic
 * (scripts/probe-docs-box-kinds.mjs, -text-lines, -next-table, 2026-09-09).
 * What does work: extend the selection one line at a time with
 * Shift+ArrowDown and ask Docs what is marked — the html holds a <table> the
 * moment the selection touches one, because Docs takes a table into a
 * selection whole. That step count is the number of ArrowDowns to the box.
 * An EMPTY list item has nothing to serialise, so its list appears one step
 * late. Measured 5/5, through one, two and three blank lines and past a hint
 * (scripts/probe-docs-extend-into-box.mjs).
 *
 * Text met on the way down means the box is not directly below after all,
 * and the walk stops rather than carry an answer past someone's line.
 */
async function walkIntoBox(el: HTMLElement, into: 'table' | 'list'): Promise<boolean> {
  const pattern = into === 'table' ? /<t(?:able|d)\b/i : /<(?:ol|ul|li)\b/i;
  pressGdocsKey(el, KEY.end);
  await settle();
  for (let line = 1; line <= WALK_MAX_LINES; line++) {
    pressGdocsKey(el, { ...KEY.down, shiftKey: true });
    await settle();
    const marked = gdocsSelectionNow();
    const hit = pattern.test(marked.html);
    if (!hit && marked.text.replace(/\s/g, '')) break;
    if (hit) {
      pressGdocsKey(el, KEY.left);
      await settle();
      pressGdocsKey(el, KEY.end);
      await settle();
      const down = into === 'table' ? line : line - 1;
      for (let i = 0; i < down; i++) {
        pressGdocsKey(el, KEY.down);
        await settle();
      }
      awaLog('docs.walk', { into, line, down });
      return true;
    }
  }
  pressGdocsKey(el, KEY.left);
  await settle();
  awaLog('docs.walk', { into, line: 0 });
  return false;
}

async function tabs(el: HTMLElement, times: number): Promise<void> {
  for (let i = 0; i < times; i++) {
    pressGdocsKey(el, KEY.tab);
    await settle(TAB_SETTLE_MS);
  }
}

/** Non-overlapping occurrences of `needle` in `hay`, both normalised the way Docs' Find matches: whitespace collapsed, case ignored. */
function countMatches(hay: string, needle: string): number {
  const h = normalizeCellText(hay).toLowerCase();
  const n = normalizeCellText(needle).toLowerCase();
  if (!n) return 0;
  let count = 0;
  for (let i = h.indexOf(n); i !== -1; i = h.indexOf(n, i + n.length)) count += 1;
  return count;
}

// ---- GDocsFindSource — the primary path (D-16 steps 2-3): zero writes ----

/**
 * Positions the cursor by TEXT (Docs' own Find), so it needs no stored
 * document indices at all — the same mechanism works whether the paragraphs
 * came from the whole document or from the marked selection.
 */
class GDocsFindSource implements QuestionSource {
  readonly sourceName = 'GDocsFindSource';
  readonly kind: EditorKind = 'gdocs';
  readonly label = 'Google Docs-dokument';
  readonly placement = 'in-place' as const;
  readonly canReplace = true;
  private reason = '';
  /**
   * What this run has already typed, by the paragraph it went at or under.
   * Find counts every copy of a line in the document, and by the time the
   * tenth cell of a grid is placed, nine answers stand between the top of
   * the document and its anchor — any of them may repeat the anchor's words.
   * The last located fill is added here the moment the NEXT locate() is
   * asked for: the orchestrator only asks once the previous answer is fully
   * in the document, and a fill it could not place typed nothing.
   */
  private typed: { at: number; text: string }[] = [];
  private pending: { at: number; text: string; piece?: string } | null = null;

  constructor(
    private paragraphs: AutonomousParagraph[],
    /** "Besvar markeringen": where in `paragraphs` (the whole document) the marking sits. See QuestionSource. */
    readonly marked?: { from: number; to: number },
  ) {}

  async read(): Promise<AutonomousParagraph[]> {
    return this.paragraphs;
  }

  lastLocateReason(): string {
    return this.reason;
  }

  /**
   * Which match of `query` the anchor paragraph holds, counted through every
   * paragraph and every typed answer that stands before it in the document.
   * Docs' Find lands by document position (docs-find.ts findMatchState), so
   * this is the one number that reaches the right copy of a repeated line
   * wherever the caret is.
   */
  private occurrenceOf(query: string, anchorIndex: number): number {
    let before = 0;
    for (const p of this.paragraphs) if (p.index < anchorIndex) before += countMatches(p.text, query);
    for (const t of this.typed) if (t.at < anchorIndex) before += countMatches(t.text, query);
    return before + 1;
  }

  private find(anchor: string, anchorIndex: number) {
    return findAndPlaceCursor(anchor, (q) => this.occurrenceOf(q, anchorIndex));
  }

  async locate(fill: FillTarget): Promise<SavedTarget | null> {
    this.reason = '';
    if (this.pending) {
      // An answer written INTO a line changed that line; one written under it
      // added text of its own. Find has to be told about both.
      const { at, text, piece } = this.pending;
      const p = this.paragraphs[at];
      if (piece && p) p.text = p.text.replace(piece, () => text);
      else this.typed.push(this.pending);
      this.pending = null;
    }
    const target = await this.place(fill);
    awaLog('docs.locate', { q: (fill.task ?? fill.questionText).slice(0, 40), index: fill.paragraphIndex, at: fill.at, mode: fill.mode, placed: !!target, inBox: !!target?.inBox });
    if (target) this.pending = { at: fill.at, text: fill.answer, ...(target.removedText ? { piece: target.removedText } : {}) };
    return target;
  }

  private async place(fill: FillTarget): Promise<SavedTarget | null> {
    if (fill.mode === 'fill') {
      // The model's plan first: it read the whole form and named the empty
      // place this answer belongs in. Checked here against the same
      // paragraphs it saw, and carried out only by moves that are known to
      // arrive; anything else goes under the question, as before the plan.
      const plan = slotPlanFor(this.paragraphs, fill);
      if (plan.kind === 'occupied') {
        this.reason =
          `Svarfeltet til "${fill.task ?? fill.questionText}" er ikke tomt — der står "${plan.text}" i det. ` +
          'Svaret blev ikke skrevet, for det ville have overskrevet din egen tekst.';
        return null;
      }
      if (plan.kind !== 'none') {
        const placed = await this.placeByPlan(plan);
        awaLog('docs.plan', { at: fill.at, plan: plan.kind, anchor: plan.anchor.slice(0, 40), placed: !!placed });
        if (placed) return placed;
      }
      return this.placeUnderQuestion(fill);
    }
    if (fill.mode === 'replace') return this.placeInLine(fill);
    if (fill.mode === 'below' && fill.at === fill.paragraphIndex) return this.placeUnderQuestion(fill);
    // "below" or "inline" at a line of the document's own text: the end of
    // that line, found by its last line when the cell has several.
    const p = this.paragraphs[fill.at];
    if (!p || !p.text) {
      this.reason = `Stedet til "${fill.task ?? fill.questionText}" blev ikke fundet i dokumentet.`;
      return null;
    }
    const target = await this.atEndOf(findLine(p), fill.at);
    if (!target || fill.mode !== 'inline') return target;
    // The space between "Navn:" and the answer is pressed here, not pasted:
    // Docs discards a space at the edge of a paste (adapters/gdocs.ts), and
    // the first live run read back "Navn:Christian Jensen". The caret then
    // stands where the answer starts, like inside a box.
    new GDocsAdapter().pressKey('space');
    await settle(TAB_SETTLE_MS);
    return { ...target, inBox: true, placementEdits: 1 };
  }

  /**
   * In place of a blank, a tick box or a "Sandt / Falsk" on the line itself.
   * Docs hands out no ranges, so: the end of the line by Find, back over what
   * follows the piece, mark the piece — and only when Docs says the marked
   * text IS the piece is it handed over to be typed over. Anything else is
   * left alone and reported unplaced: an arrow dropped (7 of 396 measured) would
   * otherwise delete the user's own words.
   */
  private async placeInLine(fill: FillTarget): Promise<SavedTarget | null> {
    const p = this.paragraphs[fill.at];
    const piece = fill.target ?? '';
    const from = p && piece ? p.text.indexOf(piece) : -1;
    if (!p || from === -1) {
      this.reason = `Stedet til "${fill.task ?? fill.questionText}" blev ikke fundet i linjen.`;
      return null;
    }
    const after = [...p.text.slice(from + piece.length)].length;
    for (let attempt = 0; attempt < 3; attempt++) {
      const target = await this.atEndOf(findLine(p), fill.at);
      if (!target) return null;
      const el = target.element as HTMLElement;
      for (let i = 0; i < after; i++) pressGdocsKey(el, KEY.left);
      for (let i = 0; i < [...piece].length; i++) pressGdocsKey(el, { ...KEY.left, shiftKey: true });
      await settle(TAB_SETTLE_MS);
      // Left marked, not deleted: Backspace over a marked word takes the
      // space beside it too ("erKøbenhavn", 2026-10-08); a paste over it does not.
      if (gdocsMarkedTextNow() === piece) return { ...target, inBox: true, removedText: piece };
      awaLog('docs.inline.miss', { attempt, piece, read: gdocsMarkedTextNow().slice(0, 40) });
      pressGdocsKey(el, KEY.right);
      await settle(TAB_SETTLE_MS);
    }
    this.reason = `Feltet "${piece.slice(0, 20)}" i linjen kunne ikke rammes præcist, så svaret blev ikke skrevet.`;
    return null;
  }

  /**
   * Under the question: into the empty box or list item drawn under it when
   * there is one (the worksheet shape, docs-tables.ts boxBelowFor), else on
   * the line below it.
   */
  private async placeUnderQuestion(fill: FillTarget): Promise<SavedTarget | null> {
    const below = boxBelowFor(this.paragraphs, fill);
    if (below.kind !== 'none') {
      const found = await this.find(below.anchor, below.anchorIndex);
      const el = found.ok ? gdocsEventTarget() : null;
      // The box is the next STRUCTURE below, but the html cannot say how many
      // blank lines sit before it — one ArrowDown landed on such a blank line
      // in the operator's own form (2026-09-08). The walk measures it.
      if (el && (await walkIntoBox(el, below.kind === 'empty-box-below' ? 'table' : 'list'))) {
        return {
          kind: 'gdocs',
          element: el,
          label: this.label,
          inBox: true,
          ...(below.kind === 'empty-list-item-below' ? { inList: below.list } : {}),
        };
      }
    }
    // The question by index, trusted only when its text agrees with what
    // the model quoted; else by the quote itself.
    const p = this.paragraphs[fill.paragraphIndex];
    const wanted = normalizeCellText(fill.questionText).toLowerCase();
    const anchor = p && p.text.toLowerCase().includes(wanted) ? findLine(p) : fill.questionText;
    return this.atEndOf(anchor, fill.paragraphIndex);
  }

  /** The caret at the end of `anchor`'s line — the D-03 re-run of Find for THIS fill, right now, since the document grows as answers land. */
  private async atEndOf(anchor: string, anchorIndex: number): Promise<SavedTarget | null> {
    const found = await this.find(anchor, anchorIndex);
    if (!found.ok) {
      this.reason = found.reason ?? `"${anchor}" kunne ikke findes i dokumentet.`;
      return null; // never a bare cursor target on a find failure
    }
    const el = gdocsEventTarget();
    if (!el) {
      this.reason = 'Google Docs-inputmålet blev ikke fundet efter positionering.';
      return null;
    }
    return { kind: 'gdocs', element: el, label: this.label };
  }

  /** The plan's keystrokes, from its anchor. Null when the anchor cannot be found or the walk finds no box, so the caller falls back. */
  private async placeByPlan(plan: Exclude<SlotPlan, { kind: 'none' | 'occupied' }>): Promise<SavedTarget | null> {
    const found = await this.find(plan.anchor, plan.anchorIndex);
    if (!found.ok) return null;
    const el = gdocsEventTarget();
    if (!el) return null;
    const target: SavedTarget = { kind: 'gdocs', element: el, label: this.label, inBox: true };
    if (plan.kind === 'tab') {
      await tabs(el, plan.times);
      return target;
    }
    if (plan.kind === 'down') {
      pressGdocsKey(el, KEY.end);
      await settle(TAB_SETTLE_MS);
      pressGdocsKey(el, KEY.down);
      await settle(TAB_SETTLE_MS);
      return { ...target, inList: plan.list };
    }
    if (!(await walkIntoBox(el, plan.into))) return null;
    if (plan.into === 'table') {
      await tabs(el, plan.tabs ?? 0);
      return target;
    }
    return plan.list ? { ...target, inList: plan.list } : target;
  }
}

// ---- GDocsPasteSource — no Google access at all (D-02, D-06) ----

class GDocsPasteSource implements QuestionSource {
  readonly sourceName = 'GDocsPasteSource';
  readonly kind: EditorKind = 'gdocs';
  readonly label = 'Google Docs-dokument';
  readonly placement = 'block' as const;
  readonly degradedReason: string;
  private reason = '';

  constructor(
    private paragraphs: AutonomousParagraph[],
    degradedReason: string,
  ) {
    this.degradedReason = degradedReason;
  }

  async read(): Promise<AutonomousParagraph[]> {
    return this.paragraphs;
  }

  lastLocateReason(): string {
    return this.reason;
  }

  /** Block placement: always "wherever the cursor already is" — the orchestrator's block branch composes the whole block, not this. */
  async locate(): Promise<SavedTarget | null> {
    const el = gdocsEventTarget();
    if (!el) {
      this.reason = 'Google Docs-inputmålet blev ikke fundet.';
      return null;
    }
    return { kind: 'gdocs', element: el, label: this.label };
  }
}

// ---- the resolver ----

function pasteReasonForFindFailure(findReason: string | undefined): string {
  return (
    `Positionering med Docs' egen søgefunktion virker ikke lige nu (${findReason ?? 'ukendt årsag'}). ` +
    'Svarene samles derfor i én blok ved markøren, med hvert spørgsmål gentaget ovenover sit svar, ' +
    'i stedet for at blive skrevet direkte under hvert spørgsmål.'
  );
}

/**
 * Picks the Google Docs source for this run, never silently:
 * 1. `GDocsAdapter.selfTest()` fails → the DOM mechanism every fallback also
 *    needs is broken; no source can work, so this throws (matching the
 *    pre-07-05 refusal `sourceFor` already made for a gdocs target) and the
 *    caller shows the existing INST-13 message + clipboard fallback.
 * 2. The document's text is read from Docs itself — select-all + copy. Both
 *    scopes read the WHOLE document, so the model sees the same boxes either
 *    way; a marked run reads the marking first (the selection mirror) and
 *    finds it in the whole read (docs-structure.ts markedRange), and only
 *    the questions inside it are answered. Until 2026-09-09 a marked run
 *    sent the marked lines alone, and a question marked without its box was
 *    answered under the question because the box was never in view. When the
 *    marking cannot be found in the whole read, the marked lines alone are
 *    sent, as before. All of it is the user's own document coming back
 *    through the user's own browser; no Google account, no permission,
 *    nothing to verify.
 * 3. A LIVE Find probe (one Ctrl/Cmd+F + Escape, no insert() call, so a failed
 *    probe leaves nothing behind to undo) decides between placing each answer
 *    under its own question and falling back to one block at the cursor.
 *    There is no third option any more, which is why the probe result decides
 *    it rather than a hardcoded assumption.
 */
export async function resolveDocsSource(scope: 'document' | 'selection'): Promise<QuestionSource> {
  // Which write path a run took is the single most useful fact about it — Find
  // and paste fail in completely different ways — and a green run otherwise
  // proves only that "some path worked", which is not the same claim.
  const source = await pickDocsSource(scope);
  awaLog('docs.source', {
    source: source.sourceName,
    scope,
    placement: source.placement,
    degradedReason: source.degradedReason ?? null,
  });
  return source;
}

async function pickDocsSource(scope: 'document' | 'selection'): Promise<QuestionSource> {
  const selfTest = GDocsAdapter.selfTest();
  if (!selfTest.ok) {
    throw new Error(selfTest.reason ?? 'Google Docs-indsættelse virker ikke lige nu.');
  }

  let paragraphs = readToParagraphs(scope === 'selection' ? markedMirror() : gdocsWholeDocumentNow());
  let marked: { from: number; to: number } | undefined;
  if (scope === 'selection' && paragraphs.length) {
    // The marking is read BEFORE the whole document: select-all replaces it.
    const whole = readToParagraphs(gdocsWholeDocumentNow());
    const range = markedRange(whole, paragraphs);
    awaLog('docs.marked', { markedLines: paragraphs.length, wholeLines: whole.length, range });
    if (range) {
      paragraphs = whole;
      marked = range;
    }
  }

  // An empty read is Docs refusing to hand the text over, NOT an empty
  // document — the same '' comes back either way, so it must never be reported
  // as "ingen spørgsmål fundet".
  if (paragraphs.length === 0) {
    return new GDocsPasteSource(
      paragraphs,
      scope === 'selection'
        ? 'Der er ikke markeret nogen tekst i dokumentet.'
        : 'Dokumentets tekst kunne ikke læses fra Google Docs. Prøv at klikke ind i dokumentet først.',
    );
  }

  // The FIRST paragraph that actually has words in it, not simply the first.
  // A document that opens with a picture gave paragraphs[0].text === '' here,
  // which read as "empty document" and sent the whole run down the
  // nothing-found path.
  const probeText = paragraphs.find((p) => p.text.trim())?.text;
  if (!probeText) return new GDocsFindSource(paragraphs, marked);

  const probe = await findAndPlaceCursor(probeText);
  if (probe.ok) return new GDocsFindSource(paragraphs, marked);
  return new GDocsPasteSource(paragraphs, pasteReasonForFindFailure(probe.reason));
}
