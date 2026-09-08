import type { OneShotResponse } from '@/utils/protocol';
import { awaLog } from '../debug';

/**
 * Where the answer belongs when the question sits in a table.
 *
 * A questionnaire in Docs is almost always a table: the question in one cell,
 * an empty cell beside it. Docs paints the document to <canvas>, so the page
 * itself cannot see that structure at all — but Docs' own HTML export can, and
 * it needs no Google permission of any kind, only the cookies the browser
 * already has (measured against a real document 2026-09-08: 1 table, 2 rows,
 * 4 cells, read back in document order as
 * `["Hvad hedder du?", "", "Hvor bor du?", ""]`).
 *
 * Two things this file exists to protect, and neither bends:
 *
 * - It reports "the next cell is occupied" rather than an answer position.
 *   Writing over text the user wrote is worse than not answering, and it is
 *   not recoverable by anyone who did not notice.
 * - Every failure here — no export, no tables, a question that is not in a
 *   cell — is reported as "this question has no answer cell", which puts the
 *   run back on exactly the behaviour it had before this file existed. A
 *   document without tables must not notice that any of this happened.
 */

/** Docs' export decodes `&nbsp;` to U+00A0; Docs' own padding is zero-width. Neither is content, so a cell holding only those is empty. */
const BLANK_CHARS = /[\u00A0\u200B\uFEFF]/g;

export function normalizeCellText(raw: string): string {
  return raw.replace(BLANK_CHARS, ' ').replace(/\s+/g, ' ').trim();
}

/**
 * The little of a parsed document the cell walk needs.
 *
 * A real `Document` satisfies it. It is spelled out as a structural type
 * because node:test has no DOM at all, so this is the seam the unit tests get
 * to reach — see docs-tables.test.ts.
 */
export interface CellHost {
  querySelectorAll(selectors: string): ArrayLike<{ textContent: string | null }>;
}

/** Every table cell in the document, in document order — the same order a person tabs through. */
export function tableCellsFrom(host: CellHost): string[] {
  return Array.from(host.querySelectorAll('td, th'), (cell) => normalizeCellText(cell.textContent ?? ''));
}

/**
 * Parses the exported HTML.
 *
 * `DOMParser` and not a regex: the export is real markup — nested spans,
 * inline styles, entities — and reading it with a pattern would work on the
 * document it was written against and quietly mis-read the next one.
 */
export function tableCellsFromHtml(html: string): string[] {
  return tableCellsFrom(new DOMParser().parseFromString(html, 'text/html'));
}

/** `/document/d/<id>/edit` — the id is the segment after `/d/`. */
export function documentIdFromPath(pathname: string): string | null {
  const m = pathname.match(/\/document\/d\/([^/]+)/);
  return m ? m[1] : null;
}

export type AnswerCellVerdict =
  /** Not in a table, no table read, or the question matched no cell — place the answer exactly as before. */
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
 * The match is "the cell whose text contains the question", because Docs' own
 * paragraph read and Docs' HTML export normalise whitespace differently and an
 * equality test loses on that alone. `occurrence` mirrors the Find path: the
 * second ask for the same question text means the second matching cell, so two
 * identical questions in one table do not both resolve to the first.
 *
 * A question matching more cells than it has occurrences is fine; one matching
 * fewer is reported as `outside-table`, so an uncertain read costs the old
 * behaviour rather than a guessed position.
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

/**
 * The document's table cells, read once for a whole run.
 *
 * Once, because the export is an HTTP round trip and asking for it per
 * question would be a fetch inside a loop. It goes stale as answers land,
 * which is harmless: the only thing read out of it is which cell a question
 * sits in and whether the cell beside it was empty when the run started, and
 * the run itself is the only thing filling those cells in.
 *
 * Returns `[]` for every failure, which every caller treats as "no tables
 * here" — this must never be the thing that breaks a plain document.
 */
export async function readDocTableCells(pathname = location.pathname): Promise<string[]> {
  const documentId = documentIdFromPath(pathname);
  if (!documentId) {
    awaLog('docs.tables', { cells: 0, reason: 'no-document-id' });
    return [];
  }
  const res = (await chrome.runtime
    .sendMessage({ kind: 'docs-export-html', documentId })
    .catch(() => null)) as OneShotResponse | null;
  if (!res?.ok) {
    awaLog('docs.tables', { cells: 0, reason: res?.error ?? 'no-response' });
    return [];
  }
  const html = (res.data as { html?: unknown } | undefined)?.html;
  if (typeof html !== 'string') {
    awaLog('docs.tables', { cells: 0, reason: 'no-html' });
    return [];
  }
  let cells: string[] = [];
  try {
    cells = tableCellsFromHtml(html);
  } catch {
    awaLog('docs.tables', { cells: 0, reason: 'parse-failed' });
    return [];
  }
  awaLog('docs.tables', { cells: cells.length, empty: cells.filter((c) => !c).length });
  return cells;
}
