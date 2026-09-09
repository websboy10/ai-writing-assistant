import type { AutonomousAnswer } from '@awa/shared';

/**
 * Pure ordering rules for an autonomous run — no DOM.
 *
 * Top-down is the only direction there is: D-04 requires Langsomt to start at
 * the first question and work downward while the user watches. A 'bottom-up'
 * option lived here for one caller only — the Google Docs `batchUpdate`
 * fallback, where writing highest-index-first kept the earlier indices valid.
 * That path was deleted 2026-09-08 with the Docs API, and the option went with
 * it rather than sitting here with nothing calling it.
 */

/**
 * Sort by the place each fill lands at (`at`), stable for ties. The place,
 * not the question: a grid's cells are filled row by row down the page, and
 * every Find on the way counts what stands above it (docs-source.ts).
 */
export function orderForRun(answers: AutonomousAnswer[]): AutonomousAnswer[] {
  return [...answers].sort((a, b) => a.at - b.at || a.paragraphIndex - b.paragraphIndex);
}

/**
 * Undo must remove the LAST-inserted answer first: removing a later answer
 * can never invalidate an earlier one's offsets, but removing an earlier one
 * first would shift every later offset out from under itself.
 */
export function orderForUndo<T>(completed: T[]): T[] {
  return [...completed].reverse();
}
