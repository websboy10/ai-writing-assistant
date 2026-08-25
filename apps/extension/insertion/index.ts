import type { SavedTarget } from './target';
import type { InsertionAdapter } from './types';
import { PlainAdapter } from './adapters/plain';
import { ContentEditableAdapter } from './adapters/contenteditable';
import { GDocsAdapter } from './adapters/gdocs';

export { TargetTracker, isGoogleDocs } from './target';
export { InsertionSession } from './engine';
export { GDocsAdapter } from './adapters/gdocs';
export { DEFAULT_PACING } from './types';
// Everything written to an editor goes through text/plain, which renders
// markdown literally — see plaintext.ts for the measurement.
export { stripMarkdown } from './plaintext';
export type { PacingConfig, InsertionState } from './types';
export type { SavedTarget } from './target';

// Autonomous mode (07-03): one run, many InsertionSessions, driven over
// whatever QuestionSource the caller builds — whole document or marked
// selection, plain or contenteditable today, Docs in 07-05.
export { AutonomousRun } from './autonomous/orchestrator';
export type { RunState, RunProgress, RunCallbacks } from './autonomous/orchestrator';
export { sourceFor } from './autonomous/locator';
export type { QuestionSource } from './autonomous/locator';

/** INST-04: pick the right adapter for the detected editor automatically. */
export function adapterFor(target: SavedTarget): InsertionAdapter {
  switch (target.kind) {
    case 'plain':
      return new PlainAdapter(target);
    case 'contenteditable':
      return new ContentEditableAdapter(target);
    case 'gdocs':
      return new GDocsAdapter();
  }
}
