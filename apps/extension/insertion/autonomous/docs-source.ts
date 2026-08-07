import type { AutonomousParagraph } from '@awa/shared';
import type { DocsParagraph, OneShotRequest, OneShotResponse } from '@/utils/protocol';
import type { EditorKind } from '../types';
import type { SavedTarget } from '../target';
import { gdocsEventTarget } from '../target';
import { GDocsAdapter } from '../adapters/gdocs';
import { findAndPlaceCursor } from './docs-find';
import type { QuestionSource } from './locator';

/**
 * The Google Docs read path (D-05, D-16 steps 1-2) — GDocsFindSource (the
 * primary, zero-write path) and GDocsPasteSource (D-02/D-06's honest
 * fallback when Google access is not granted at all), plus the resolver
 * that picks between them, never silently.
 *
 * 07-SPIKE.md was never produced (07-FINDINGS-docs.md: the operator's Phase 3
 * spike task was never run — no real Google account/document was available
 * to drive it here, and this project never drives a browser without
 * explicit permission). D-16a's static "read a verdict file" plan therefore
 * cannot be followed literally. What replaces it: `resolveDocsSource` probes
 * Find LIVE, once, per run — a harmless Ctrl/Cmd+F + Escape with no insert()
 * call, so a failed probe leaves nothing behind to undo — before trusting it
 * as the placement mechanism. Task 3 (07-05-PLAN.md) adds the third source,
 * GDocsApiWriteSource, for when that probe fails on a granted document.
 * UNVERIFIED against a real Google Doc — see 07-05-SUMMARY.md.
 */

function oneShot(req: OneShotRequest): Promise<OneShotResponse> {
  return chrome.runtime.sendMessage(req);
}

function parseDocumentId(): string | null {
  const m = location.href.match(/\/document\/d\/([a-zA-Z0-9_-]+)/);
  return m ? m[1] : null;
}

/**
 * Docs mirrors the live selection's TEXT (not just a boolean) into the same
 * hidden iframe `GDocsAdapter.hasSelection()` already reads (F-1,
 * 07-FINDINGS-docs.md) — read directly here rather than through
 * `TargetTracker.selectionText()`, which does not yet have this branch (a
 * separate, still-open fix outside this plan's file list).
 */
function markedMirrorText(): string {
  try {
    const doc = document.querySelector<HTMLIFrameElement>('iframe.docs-texteventtarget-iframe')?.contentDocument;
    return doc?.body?.textContent?.trim() ?? '';
  } catch {
    return '';
  }
}

/** Local copy of locator.ts's private helper — DomSource's selection-text splitting, reused for the two Docs sources that read from the hidden mirror instead of the API. */
function linesToParagraphs(text: string): AutonomousParagraph[] {
  const out: AutonomousParagraph[] = [];
  for (const raw of text.split('\n')) {
    const line = raw.trim();
    if (line) out.push({ index: out.length, text: line });
  }
  return out;
}

/**
 * One `docs-get` call (D-16 step 1 — one read request per run, zero writes
 * on the primary path). `AutonomousParagraph.index` is `DocsParagraph.index`
 * unchanged: `background.ts`'s `extractDocsParagraphs` already skips empty
 * paragraphs and assigns a dense 0-based index, so the index the model
 * receives is already the index this source can resolve back into a real
 * document range — never renumbered again here.
 */
async function readDocsParagraphs(
  documentId: string,
): Promise<
  | { paragraphs: AutonomousParagraph[]; ranges: Map<number, { startIndex: number; endIndex: number }> }
  | { error: string }
> {
  const res = await oneShot({ kind: 'docs-get', documentId });
  if (!res.ok) return { error: res.error ?? 'Dokumentet kunne ikke læses.' };
  const { paragraphs: docsParagraphs } = res.data as { title: string; paragraphs: DocsParagraph[] };
  const paragraphs: AutonomousParagraph[] = [];
  const ranges = new Map<number, { startIndex: number; endIndex: number }>();
  for (const p of docsParagraphs) {
    paragraphs.push({ index: p.index, text: p.text.trim() });
    ranges.set(p.index, { startIndex: p.startIndex, endIndex: p.endIndex });
  }
  return { paragraphs, ranges };
}

// ---- GDocsFindSource — the primary path (D-16 steps 2-3): zero writes ----

/**
 * Positions the cursor by TEXT (Docs' own Find), so it needs no stored
 * document indices at all — the same mechanism works whether the paragraphs
 * came from the API (`document` scope) or the hidden mirror
 * (`selection` scope).
 */
class GDocsFindSource implements QuestionSource {
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
  readonly kind: EditorKind = 'gdocs';
  readonly label = 'Google Docs-dokument';
  readonly placement = 'block' as const;
  readonly degradedReason: string;
  private reason = '';

  constructor(
    private scope: 'document' | 'selection',
    degradedReason: string,
  ) {
    this.degradedReason = degradedReason;
  }

  async read(): Promise<AutonomousParagraph[]> {
    if (this.scope === 'document') {
      // Cannot read the whole document honestly without the API — return
      // empty so the panel shows this source's degradedReason (see
      // sidebar/autonomous.ts's empty-read handling) rather than pretending
      // to have scanned a document it never touched.
      return [];
    }
    return linesToParagraphs(markedMirrorText());
  }

  lastLocateReason(): string {
    return this.reason;
  }

  /** Block placement: always "wherever the cursor already is" — task 3 composes the whole block, not this. */
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

function pasteReasonForNoAuth(authError: string | undefined): string {
  return (
    `${authError ?? 'Google-adgang blev ikke givet.'} Svarene samles i én blok ved markøren, med hvert ` +
    'spørgsmål gentaget ovenover sit svar, i stedet for at blive skrevet direkte under hvert spørgsmål. ' +
    'Giv adgangen fra Google Docs-fanens tilladelser for i stedet at få svarene skrevet direkte ind under hvert spørgsmål.'
  );
}

function pasteReasonForFindFailure(findReason: string | undefined): string {
  return (
    `Positionering med Docs' søgefunktion virker ikke lige nu (${findReason ?? 'ukendt årsag'}), og uden ` +
    "hele dokumentets struktur kan den markerede tekst ikke besvares præcist ét spørgsmål ad gangen. " +
    'Svarene samles i én blok ved markøren i stedet, med hvert spørgsmål gentaget ovenover sit svar.'
  );
}

/**
 * Picks the Google Docs source for this run, never silently:
 * 1. `GDocsAdapter.selfTest()` fails → the DOM mechanism every fallback also
 *    needs is broken; no source can work, so this throws (matching the
 *    pre-07-05 refusal `sourceFor` already made for a gdocs target) and the
 *    caller shows the existing INST-13 message + clipboard fallback.
 * 2. `documents` access not granted (asked for HERE, the first moment it is
 *    actually needed — incremental consent, D-17) → `GDocsPasteSource`.
 * 3. `selection` scope: the Docs API has no cheap way to resolve a canvas
 *    selection's index bounds (F-1), so paragraphs come from the hidden
 *    mirror text and only the text-based Find mechanism can place answers
 *    in place; if Find fails, straight to the paste fallback.
 * 4. `document` scope, granted: one `docs-get` read, then a LIVE Find probe
 *    (see file header — replaces the never-produced 07-SPIKE.md verdict)
 *    decides `GDocsFindSource` or the paste fallback — task 3
 *    (07-05-PLAN.md) replaces that fallback branch with `GDocsApiWriteSource`.
 */
export async function resolveDocsSource(
  scope: 'document' | 'selection',
  mode: 'instant' | 'progressive',
): Promise<QuestionSource> {
  const selfTest = GDocsAdapter.selfTest();
  if (!selfTest.ok) {
    throw new Error(selfTest.reason ?? 'Google Docs-indsættelse virker ikke lige nu.');
  }

  const auth = await oneShot({ kind: 'docs-auth', interactive: true });
  if (!auth.ok) {
    return new GDocsPasteSource(scope, pasteReasonForNoAuth(auth.error));
  }

  if (scope === 'selection') {
    const paragraphs = linesToParagraphs(markedMirrorText());
    const probeText = paragraphs[0]?.text;
    if (!probeText) return new GDocsFindSource(paragraphs); // empty — let the normal "nothing to answer" flow run
    const probe = await findAndPlaceCursor(probeText);
    if (probe.ok) return new GDocsFindSource(paragraphs);
    return new GDocsPasteSource(scope, pasteReasonForFindFailure(probe.reason));
  }

  const documentId = parseDocumentId();
  if (!documentId) {
    return new GDocsPasteSource(
      scope,
      "Dokument-id'et kunne ikke findes i denne fanes adresse. Svarene samles i én blok ved markøren i stedet.",
    );
  }

  const read = await readDocsParagraphs(documentId);
  if ('error' in read) {
    return new GDocsPasteSource(
      scope,
      `Dokumentet kunne ikke læses via Google Docs API'et (${read.error}). Svarene samles i én blok ved markøren i stedet.`,
    );
  }

  const probeText = read.paragraphs[0]?.text;
  if (!probeText) return new GDocsFindSource(read.paragraphs); // empty document — normal "nothing found" flow

  const probe = await findAndPlaceCursor(probeText);
  if (probe.ok) return new GDocsFindSource(read.paragraphs);
  // Task 3 (07-05-PLAN.md) adds GDocsApiWriteSource here — the bottom-up
  // Docs API write fallback for when Find genuinely does not work. Task 1's
  // slice of the resolver falls back to the paste mechanism in the meantime.
  return new GDocsPasteSource(scope, pasteReasonForFindFailure(probe.reason));
}
