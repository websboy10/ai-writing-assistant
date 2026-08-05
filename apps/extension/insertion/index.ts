import type { SavedTarget } from './target';
import type { InsertionAdapter } from './types';
import { PlainAdapter } from './adapters/plain';
import { ContentEditableAdapter } from './adapters/contenteditable';
import { GDocsAdapter } from './adapters/gdocs';

export { TargetTracker, isGoogleDocs } from './target';
export { InsertionSession } from './engine';
export { GDocsAdapter } from './adapters/gdocs';
export { DEFAULT_PACING } from './types';
export type { PacingConfig, InsertionState } from './types';
export type { SavedTarget } from './target';

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
