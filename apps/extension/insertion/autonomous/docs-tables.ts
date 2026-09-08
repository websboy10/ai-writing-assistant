import type { AutonomousParagraph } from '@awa/shared';

/**
 * Where the answer belongs when the question sits in — or above — a table.
 *
 * A questionnaire in Docs is almost always a table: the question in one cell,
 * an empty cell beside it or beneath it; or the question as a line of text
 * with a one-cell box under it. Docs paints the document to <canvas>, so the
 * page itself cannot see that structure — but Docs' own copy html can
 * (docs-structure.ts), and it needs no Google permission of any kind.
 *
 * Until 2026-09-08 the cells came from Docs' `/export?format=html`, fetched
 * with the browser's cookies. That asked for no scope, but it only worked in a
 * browser signed into an account with access to the file, and it was the one
 * Google-shaped capability left in the package. The copy html carries the same
 * cells and depends on nothing, so the export path is gone.
 *
 * Two things this file exists to protect, and neither bends:
 *
 * - It reports "the box is occupied" rather than an answer position. Writing
 *   over text the user wrote is worse than not answering, and it is not
 *   recoverable by anyone who did not notice.
 * - Every uncertain read is reported as "no box for this question", which puts
 *   the run back on exactly the behaviour it had before tables were understood
 *   at all: the answer on the line below the question. A document without
 *   tables must not notice that any of this exists.
 */

/** `&nbsp;` is U+00A0 in Docs' html; Docs' own padding is zero-width. Neither is content, so a cell holding only those is empty. */
const BLANK_CHARS = /[ ​﻿]/g;

export function normalizeCellText(raw: string): string {
  return raw.replace(BLANK_CHARS, ' ').replace(/\s+/g, ' ').trim();
}

export type AnswerCellVerdict =
  /** Not in a table, or the question matched no cell — place the answer exactly as before. */
  | { kind: 'outside-table' }
  /** The cell after the question is empty: one Tab and the answer lands in it. */
  | { kind: 'empty-next-cell' }
  /** The cell after the question holds the user's own text. */
  | { kind: 'occupied-next-cell'; text: string }
  /** The question is in the document's last cell, so there is no cell to answer in. */
  | { kind: 'last-cell' };

/**
 * Which cell — if any — this question's answer belongs in.
 *
 * The match is "the cell whose text contains the question", because Docs'
 * paragraph text and its cell text normalise whitespace differently and an
 * equality test loses on that alone. `occurrence` mirrors the Find path: the
 * second ask for the same question text means the second matching cell, so two
 * identical questions in one table do not both resolve to the first.
 *
 * A question matching more cells than it has occurrences is fine; one matching
 * fewer is reported as `outside-table`, so an uncertain read costs the old
 * behaviour rather than a guessed position.
 *
 * "Next cell in document order" covers both shapes a form uses — the box
 * beside the question and the box beneath it in a one-column table — because
 * that is the order Docs' own Tab walks (scripts/probe-docs-placement.mjs,
 * 2026-09-08: both landed).
 */
export function answerCellFor(cells: string[], questionText: string, occurrence = 1): AnswerCellVerdict {
  const wanted = normalizeCellText(questionText).toLowerCase();
  if (!wanted || cells.length === 0) return { kind: 'outside-table' };

  let seen = 0;
  for (let i = 0; i < cells.length; i++) {
    if (!cells[i].toLowerCase().includes(wanted)) continue;
    if (++seen < occurrence) continue;
    if (i + 1 >= cells.length) return { kind: 'last-cell' };
    const next = cells[i + 1];
    return next ? { kind: 'occupied-next-cell', text: next } : { kind: 'empty-next-cell' };
  }
  return { kind: 'outside-table' };
}

export type BoxBelowVerdict =
  /** No box under this line of text. */
  | { kind: 'none' }
  /** The paragraph right after the question is the empty first cell of a table: End, ArrowDown, and the caret is in it. */
  | { kind: 'empty-box-below'; via?: string }
  /** There is a box below, and the user has already written in it. */
  | { kind: 'occupied-box-below'; text: string }
  /**
   * The line under the question is an EMPTY list item — the worksheet drew
   * "1." or "•" and left it blank. Same keys as the box, and the answer then
   * continues that list instead of starting a second one beside it.
   */
  | { kind: 'empty-list-item-below'; list: 'bullet' | 'numbered'; via?: string };

/**
 * The worksheet shape: a question as ORDINARY TEXT with a box drawn under it.
 *
 * The question is in no cell, so `answerCellFor` cannot see it, and Tab from a
 * paragraph inserts a tab character rather than moving anywhere. What does
 * move is End then ArrowDown — from the end of the line above a table the
 * caret walks into the table's first cell (measured 2026-09-08, both with and
 * without other paragraphs around it).
 *
 * The question is found by index first, and the index is trusted only if its
 * text agrees: the model quotes the question verbatim and the index is
 * validated server-side, but a mismatch here would send an answer into the
 * wrong box, so the text is the tie-breaker, never the index alone.
 */
export function boxBelowFor(
  paragraphs: AutonomousParagraph[],
  q: { paragraphIndex: number; questionText: string },
): BoxBelowVerdict {
  const wanted = normalizeCellText(q.questionText).toLowerCase();
  if (!wanted) return { kind: 'none' };

  const byIndex = paragraphs[q.paragraphIndex];
  const question =
    byIndex && byIndex.text.toLowerCase().includes(wanted)
      ? byIndex
      : paragraphs.find((p) => p.kind !== 'cell' && p.text.toLowerCase().includes(wanted));
  if (!question || question.kind === 'cell') return { kind: 'none' };

  // Guidance between the question and its box — "Tænk på både faglige og
  // personlige resultater", as bullet points — is skipped, and the caret is
  // taken to the box FROM THE LAST GUIDANCE LINE (`via`), not from the
  // question: ArrowDown moves one visual line and a hint may wrap, so counting
  // lines from the question is a guess, and Find on the last hint is not.
  // Measured 2026-09-08 on a real form: without this the answer went between
  // the question and its hints and the box below stayed empty.
  let i = question.index + 1;
  let via: string | undefined;
  while (paragraphs[i] && (paragraphs[i].kind === 'bullet' || paragraphs[i].kind === 'numbered') && paragraphs[i].text) {
    via = paragraphs[i].text;
    i += 1;
  }
  const next = paragraphs[i];
  if (!next) return { kind: 'none' };
  if ((next.kind === 'bullet' || next.kind === 'numbered') && !next.text) {
    return { kind: 'empty-list-item-below', list: next.kind, ...(via ? { via } : {}) };
  }
  if (next.kind !== 'cell' || !next.cell || next.cell.row !== 0 || next.cell.col !== 0) return { kind: 'none' };
  return next.text ? { kind: 'occupied-box-below', text: next.text } : { kind: 'empty-box-below', ...(via ? { via } : {}) };
}
