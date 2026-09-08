import type { AutonomousParagraph } from '@awa/shared';
import type { EditorKind } from '../types';
import type { SavedTarget } from '../target';
import { gdocsEventTarget, gdocsSelectionTextNow, gdocsWholeDocumentText } from '../target';
import { GDocsAdapter } from '../adapters/gdocs';
import { findAndPlaceCursor } from './docs-find';
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
const markedMirrorText = gdocsSelectionTextNow;

/** Local copy of locator.ts's private helper — DomSource's selection-text splitting, reused for the two Docs sources that read their text out of Docs itself. */
function linesToParagraphs(text: string): AutonomousParagraph[] {
  const out: AutonomousParagraph[] = [];
  for (const raw of text.split('\n')) {
    const line = raw.trim();
    if (line) out.push({ index: out.length, text: line });
  }
  return out;
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

  constructor(private paragraphs: AutonomousParagraph[]) {}

  async read(): Promise<AutonomousParagraph[]> {
    return this.paragraphs;
  }

  lastLocateReason(): string {
    return this.reason;
  }

  async locate(q: { paragraphIndex: number; questionText: string }): Promise<SavedTarget | null> {
    this.reason = '';
    const occurrence = (this.occurrenceSeen.get(q.questionText) ?? 0) + 1;
    this.occurrenceSeen.set(q.questionText, occurrence);
    // D-03: re-run Find for THIS question right now — the document grows as
    // answers land, so a position measured earlier would be stale.
    const found = await findAndPlaceCursor(q.questionText, occurrence);
    if (!found.ok) {
      this.reason = found.reason ?? `Spørgsmålet "${q.questionText}" kunne ikke findes i dokumentet.`;
      return null; // never a bare cursor target on a find failure
    }
    const el = gdocsEventTarget();
    if (!el) {
      this.reason = 'Google Docs-inputmålet blev ikke fundet efter positionering.';
      return null;
    }
    return { kind: 'gdocs', element: el, label: this.label };
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
 * 2. The document's text is read from Docs itself — select-all + copy for the
 *    whole document, the selection mirror for a marked one. Both are the
 *    user's own document coming back through the user's own browser; no
 *    Google account, no permission, nothing to verify.
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

  const text = scope === 'selection' ? markedMirrorText() : gdocsWholeDocumentText();
  const paragraphs = linesToParagraphs(text);

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
  if (!probeText) return new GDocsFindSource(paragraphs);

  const probe = await findAndPlaceCursor(probeText);
  if (probe.ok) return new GDocsFindSource(paragraphs);
  return new GDocsPasteSource(paragraphs, pasteReasonForFindFailure(probe.reason));
}
