import type { AutonomousParagraph } from '@awa/shared';
import type { EditorKind } from '../types';
import type { SavedTarget } from '../target';
import { gdocsEventTarget, gdocsSelectionNow, gdocsWholeDocumentNow, pressGdocsKey, type GDocsRead } from '../target';
import { GDocsAdapter } from '../adapters/gdocs';
import { findAndPlaceCursor } from './docs-find';
import { answerCellFor, boxBelowFor, slotPlanFor, type SlotPlan } from './docs-tables';
import { markedRange, parseDocsHtml } from './docs-structure';
import type { QuestionSource } from './locator';
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
function readToParagraphs(read: GDocsRead): { paragraphs: AutonomousParagraph[]; cells: string[] } {
  if (read.html) {
    const structure = parseDocsHtml(read.html);
    if (structure.paragraphs.length) return structure;
  }
  return { paragraphs: linesToParagraphs(read.text), cells: [] };
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
  private reason = '';
  // Duplicate question text within one run must resolve to the SECOND match
  // on its SECOND locate() call, not the first again (07-05-PLAN.md task 2).
  private occurrenceSeen = new Map<string, number>();

  /** `tableCells` is empty for every document without tables, and for every failed read — both mean "place the answer exactly as before". */
  constructor(
    private paragraphs: AutonomousParagraph[],
    private tableCells: string[] = [],
    /** "Besvar markeringen": where in `paragraphs` (the whole document) the marking sits. See QuestionSource. */
    readonly marked?: { from: number; to: number },
  ) {}

  async read(): Promise<AutonomousParagraph[]> {
    return this.paragraphs;
  }

  lastLocateReason(): string {
    return this.reason;
  }

  async locate(q: { paragraphIndex: number; questionText: string; answerAt?: number }): Promise<SavedTarget | null> {
    this.reason = '';
    const occurrence = (this.occurrenceSeen.get(q.questionText) ?? 0) + 1;
    this.occurrenceSeen.set(q.questionText, occurrence);

    // The model's plan first: it read the whole form and named the empty
    // place this answer belongs in (AutonomousAnswer.answerAt). Checked here
    // against the same paragraphs it saw, and carried out only by moves that
    // are known to arrive; anything else falls through to the rules below.
    const plan = slotPlanFor(this.paragraphs, q);
    if (plan.kind === 'occupied') {
      this.reason =
        `Svarfeltet til "${q.questionText}" er ikke tomt — der står "${plan.text}" i det. ` +
        'Svaret blev ikke skrevet, for det ville have overskrevet din egen tekst.';
      return null;
    }
    if (plan.kind !== 'none') {
      const placed = await this.placeByPlan(plan);
      awaLog('docs.locate', { q: q.questionText.slice(0, 40), index: q.paragraphIndex, plan: plan.kind, answerAt: q.answerAt, placed: !!placed });
      if (placed) return placed;
    }

    // Decided BEFORE Find, so a question whose answer box is occupied costs
    // nothing at all: no search, no cursor moved, no keystroke sent into the
    // user's document. Refusing after the fact would leave the caret parked in
    // their text with nothing to show for it.
    const verdict = answerCellFor(this.tableCells, q.questionText, occurrence);
    if (verdict.kind === 'occupied-next-cell') {
      this.reason =
        `Svarfeltet ved siden af "${q.questionText}" er ikke tomt — der står "${verdict.text}" i det. ` +
        'Svaret blev ikke skrevet, for det ville have overskrevet din egen tekst.';
      return null;
    }
    if (verdict.kind === 'last-cell') {
      this.reason = `"${q.questionText}" står i tabellens sidste celle, så der er ingen celle at skrive svaret i.`;
      return null;
    }
    // The worksheet shape — the question as a line of text, a box drawn under
    // it. Only looked at when the question is in no cell at all.
    const below = verdict.kind === 'outside-table' ? boxBelowFor(this.paragraphs, q) : { kind: 'none' as const };
    awaLog('docs.locate', { q: q.questionText.slice(0, 40), index: q.paragraphIndex, cell: verdict.kind, below: below.kind });
    if (below.kind === 'occupied-box-below') {
      this.reason =
        `Svarboksen under "${q.questionText}" er ikke tom — der står "${below.text}" i den. ` +
        'Svaret blev ikke skrevet, for det ville have overskrevet din egen tekst.';
      return null;
    }

    // D-03: re-run Find for THIS question right now — the document grows as
    // answers land, so a position measured earlier would be stale. When the
    // box sits past a run of guidance lines, Find lands on the LAST of those
    // instead (docs-tables.ts `via`), so ArrowDown walks into the box from
    // the line directly above it.
    const via = 'via' in below ? below.via : undefined;
    const found = await findAndPlaceCursor(via ?? q.questionText, via ? 1 : occurrence);
    if (!found.ok) {
      this.reason = found.reason ?? `Spørgsmålet "${q.questionText}" kunne ikke findes i dokumentet.`;
      return null; // never a bare cursor target on a find failure
    }
    const el = gdocsEventTarget();
    if (!el) {
      this.reason = 'Google Docs-inputmålet blev ikke fundet efter positionering.';
      return null;
    }

    if (verdict.kind === 'empty-next-cell') {
      // Find leaves the caret at the end of the question, inside the question's
      // OWN cell (docs-find.ts collapses the match there). One Tab is what
      // moves it on to the next cell in document order — Docs' own behaviour,
      // measured 2026-09-08, and the same order a person tabbing through the
      // form would follow. No heuristic decides which cell belongs to which
      // question, because Tab already answers that.
      pressGdocsKey(el, { key: 'Tab', code: 'Tab', keyCode: 9, which: 9 });
      // A fixed wait, unlike every other settle in this path, because there is
      // nothing to observe: the selection mirror is empty on both sides of the
      // Tab, so it cannot say whether the caret moved. It is the same interval
      // Find already allows Docs between its own keystrokes.
      await new Promise((resolve) => setTimeout(resolve, TAB_SETTLE_MS));
      return { kind: 'gdocs', element: el, label: this.label, inBox: true };
    }

    if (below.kind === 'empty-box-below' || below.kind === 'empty-list-item-below') {
      // The box is the next STRUCTURE below, but the html cannot say how many
      // blank lines sit before it — one ArrowDown landed on such a blank line
      // in the operator's own form (2026-09-08). The walk measures it.
      const into = below.kind === 'empty-box-below' ? 'table' : 'list';
      if (await walkIntoBox(el, into)) {
        return {
          kind: 'gdocs',
          element: el,
          label: this.label,
          inBox: true,
          ...(below.kind === 'empty-list-item-below' ? { inList: below.list } : {}),
        };
      }
    }

    return { kind: 'gdocs', element: el, label: this.label };
  }

  /** The plan's keystrokes, from its anchor. Null when the anchor cannot be found or the walk finds no box, so the rules in locate() take over. */
  private async placeByPlan(plan: Exclude<SlotPlan, { kind: 'none' | 'occupied' }>): Promise<SavedTarget | null> {
    const found = await findAndPlaceCursor(plan.anchor, plan.occurrence);
    if (!found.ok) return null;
    const el = gdocsEventTarget();
    if (!el) return null;
    const target: SavedTarget = { kind: 'gdocs', element: el, label: this.label, inBox: true };
    if (plan.kind === 'tab') {
      pressGdocsKey(el, KEY.tab);
      await settle(TAB_SETTLE_MS);
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
    return plan.into === 'list' && plan.list ? { ...target, inList: plan.list } : target;
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

  let { paragraphs, cells } = readToParagraphs(scope === 'selection' ? markedMirror() : gdocsWholeDocumentNow());
  let marked: { from: number; to: number } | undefined;
  if (scope === 'selection' && paragraphs.length) {
    // The marking is read BEFORE the whole document: select-all replaces it.
    const whole = readToParagraphs(gdocsWholeDocumentNow());
    const range = markedRange(whole.paragraphs, paragraphs);
    awaLog('docs.marked', { markedLines: paragraphs.length, wholeLines: whole.paragraphs.length, range });
    if (range) {
      ({ paragraphs, cells } = whole);
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
  if (!probeText) return new GDocsFindSource(paragraphs, cells, marked);

  const probe = await findAndPlaceCursor(probeText);
  if (probe.ok) return new GDocsFindSource(paragraphs, cells, marked);
  return new GDocsPasteSource(paragraphs, pasteReasonForFindFailure(probe.reason));
}
