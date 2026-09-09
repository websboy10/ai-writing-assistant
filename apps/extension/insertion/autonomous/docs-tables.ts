import type { AutonomousParagraph } from '@awa/shared';

/**
 * Where the answer belongs when the place is in — or under — a table.
 *
 * A questionnaire in Docs is almost always a table: the question in one cell,
 * an empty cell beside it or beneath it; or the question as a line of text
 * with a one-cell box under it; or a grid of empty cells under a header row.
 * Docs paints the document to <canvas>, so the page itself cannot see that
 * structure — but Docs' own copy html can (docs-structure.ts), and it needs
 * no Google permission of any kind.
 *
 * Two things this file exists to protect, and neither bends:
 *
 * - It reports "the box is occupied" rather than an answer position. Writing
 *   over text the user wrote is worse than not answering, and it is not
 *   recoverable by anyone who did not notice.
 * - Every uncertain read is reported as "no plan", which puts the run back on
 *   exactly the behaviour it had before tables were understood at all: the
 *   answer on the line below the question. A document without tables must
 *   not notice that any of this exists.
 */

/** `&nbsp;` is U+00A0 in Docs' html; Docs' own padding is zero-width. Neither is content, so a cell holding only those is empty. */
const BLANK_CHARS = /[ ​﻿]/g;

export function normalizeCellText(raw: string): string {
  return raw.replace(BLANK_CHARS, ' ').replace(/\s+/g, ' ').trim();
}

/** The one line of a paragraph Docs' Find is given: the last line of a many-line cell, else the text. */
export function findLine(p: AutonomousParagraph): string {
  return p.lastLine ?? p.text;
}

/**
 * How to reach the place the MODEL chose for a fill (AutonomousAnswer.at,
 * mode `fill`).
 *
 * The model reads the whole form — every box, every empty point, which
 * question each belongs to — and names the empty paragraph the answer goes
 * in. This turns that index into keystrokes that are known to arrive, from an
 * ANCHOR: a line of the document's ORIGINAL text before the place, found with
 * Docs' Find. The anchor's paragraph index rides along so the caller can work
 * out which occurrence of that line it is (docs-source.ts occurrenceOf).
 */
export type SlotPlan =
  /** No plan, or one this code cannot carry out safely — the rules below decide instead. */
  | { kind: 'none' }
  /** The chosen place already holds text. */
  | { kind: 'occupied'; text: string }
  /**
   * A cell in the same table as the anchor, `times` Tabs on. Tab walks cells
   * in document order and crosses filled cells and row ends alike — measured
   * 2026-09-09 (scratchpad probe-find-tab.mjs): five Tabs from A1 of a 3x3
   * table landed in B3, past our own typed cells too. So a grid is filled
   * from the last line of ORIGINAL text before each cell, however many of
   * the cells between were typed into by this run.
   */
  | { kind: 'tab'; anchor: string; anchorIndex: number; times: number }
  /** An empty item in the same list as the anchor: Find, End, ArrowDown — a list has no blank lines inside it. */
  | { kind: 'down'; anchor: string; anchorIndex: number; list: 'bullet' | 'numbered' }
  /**
   * A table or list below the anchor with any number of blank lines between
   * (Docs' copy html does not show blank lines at all): Find the anchor, then
   * extend the selection down until it reaches the structure and walk the
   * caret that far — docs-source.ts walkIntoBox, measured 5/5 on 2026-09-09.
   * A walk enters a table at its first cell; `tabs` Tabs reach the chosen one.
   */
  | { kind: 'walk'; anchor: string; anchorIndex: number; into: 'table' | 'list'; list?: 'bullet' | 'numbered'; tabs?: number };

const SLOT_KINDS = new Set(['cell', 'bullet', 'numbered']);

export function slotPlanFor(paragraphs: AutonomousParagraph[], q: { paragraphIndex: number; at: number }): SlotPlan {
  const slot = paragraphs[q.at];
  if (!slot || q.at <= q.paragraphIndex || !SLOT_KINDS.has(slot.kind ?? '')) return { kind: 'none' };
  if (slot.text) return { kind: 'occupied', text: slot.text };

  if (slot.kind === 'cell' && slot.cell) {
    const table = slot.cell.table;
    const inTable = (p: AutonomousParagraph | undefined) => !!p && p.kind === 'cell' && p.cell?.table === table;
    const ordinal = (idx: number) => paragraphs.slice(0, idx).filter(inTable).length;
    // The last cell with text before the place, in the same table.
    let a = q.at - 1;
    while (a >= 0 && inTable(paragraphs[a]) && !paragraphs[a].text) a -= 1;
    if (inTable(paragraphs[a])) {
      return { kind: 'tab', anchor: findLine(paragraphs[a]), anchorIndex: a, times: ordinal(q.at) - ordinal(a) };
    }
    // Nothing in the table before the place: enter it from the last line of
    // text above it, at its first cell, and Tab from there.
    return walkFrom(paragraphs, a, { kind: 'walk', into: 'table', tabs: ordinal(q.at) });
  }

  let a = q.at - 1;
  while (a >= 0 && !paragraphs[a].text) a -= 1;
  if (a < 0) return { kind: 'none' };
  const anchor = paragraphs[a];
  // Only empty paragraphs sit between the anchor and the place, by the choice
  // of anchor. If any of them is a cell or a list item, the walk would stop at
  // THAT structure — an empty box before the chosen one — so the plan is off.
  if (paragraphs.slice(a + 1, q.at).some((p) => SLOT_KINDS.has(p.kind ?? ''))) return { kind: 'none' };
  if (anchor.kind === 'cell') return { kind: 'none' };
  if (anchor.kind === 'bullet' || anchor.kind === 'numbered') {
    return { kind: 'down', anchor: findLine(anchor), anchorIndex: a, list: slot.kind as 'bullet' | 'numbered' };
  }
  return { kind: 'walk', anchor: findLine(anchor), anchorIndex: a, into: 'list', list: slot.kind as 'bullet' | 'numbered' };
}

/** The walk plan from the last line of text at or before `a`, provided nothing a walk would stop at sits between it and the table. */
function walkFrom(
  paragraphs: AutonomousParagraph[],
  a: number,
  plan: { kind: 'walk'; into: 'table'; tabs: number },
): SlotPlan {
  let i = a;
  while (i >= 0 && !paragraphs[i].text) i -= 1;
  if (i < 0) return { kind: 'none' };
  const anchor = paragraphs[i];
  if (anchor.kind === 'cell') return { kind: 'none' };
  if (paragraphs.slice(i + 1, a + 1).some((p) => SLOT_KINDS.has(p.kind ?? ''))) return { kind: 'none' };
  return { ...plan, anchor: findLine(anchor), anchorIndex: i };
}

export type BoxBelowVerdict =
  /** No empty box under this line of text. */
  | { kind: 'none' }
  /** The paragraph after the question (past any guidance) is the empty first cell of a table: walk into it from `anchor`. */
  | { kind: 'empty-box-below'; anchor: string; anchorIndex: number }
  /**
   * The line under the question is an EMPTY list item — the worksheet drew
   * "1." or "•" and left it blank. Same keys as the box, and the answer then
   * continues that list instead of starting a second one beside it.
   */
  | { kind: 'empty-list-item-below'; list: 'bullet' | 'numbered'; anchor: string; anchorIndex: number };

/**
 * The worksheet shape: a question as ORDINARY TEXT with a box drawn under it,
 * when the model's plan named no place (or one that could not be reached).
 * The fallback, not the authority: an answer that would otherwise go under
 * the question goes into the empty box drawn for it instead.
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
  // taken to the box FROM THE LAST GUIDANCE LINE, not from the question:
  // ArrowDown moves one visual line and a hint may wrap, so counting lines
  // from the question is a guess, and Find on the last hint is not.
  // Measured 2026-09-08 on a real form: without this the answer went between
  // the question and its hints and the box below stayed empty.
  let i = question.index + 1;
  let from = question;
  while (paragraphs[i] && (paragraphs[i].kind === 'bullet' || paragraphs[i].kind === 'numbered') && paragraphs[i].text) {
    from = paragraphs[i];
    i += 1;
  }
  const next = paragraphs[i];
  if (!next || next.text) return { kind: 'none' };
  const anchor = { anchor: findLine(from), anchorIndex: from.index };
  if (next.kind === 'bullet' || next.kind === 'numbered') return { kind: 'empty-list-item-below', list: next.kind, ...anchor };
  if (next.kind !== 'cell' || !next.cell || next.cell.row !== 0 || next.cell.col !== 0) return { kind: 'none' };
  return { kind: 'empty-box-below', ...anchor };
}
