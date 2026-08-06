import type { AutonomousAnswer } from '@awa/shared';

/**
 * Pure ordering rules for an autonomous run — no DOM.
 *
 * 'top-down' is the only direction this plan uses: D-04 requires Langsomt to
 * start at the first question and work downward while the user watches.
 * 'bottom-up' exists for one caller only — the Google Docs `batchUpdate`
 * fallback in 07-05, where writing highest-index-first keeps earlier indices
 * valid (D-16a).
 */
export type RunDirection = 'top-down' | 'bottom-up';

/**
 * Sort by `paragraphIndex`, stable for ties. The comparator's sign flips
 * with direction rather than sorting-then-reversing, so tie order is
 * preserved (not inverted) regardless of direction.
 */
export function orderForRun(answers: AutonomousAnswer[], direction: RunDirection = 'top-down'): AutonomousAnswer[] {
  const factor = direction === 'top-down' ? 1 : -1;
  return [...answers].sort((a, b) => factor * (a.paragraphIndex - b.paragraphIndex));
}

/**
 * Undo must remove the LAST-inserted answer first: removing a later answer
 * can never invalidate an earlier one's offsets, but removing an earlier one
 * first would shift every later offset out from under itself.
 */
export function orderForUndo<T>(completed: T[]): T[] {
  return [...completed].reverse();
}
