export type EditorKind = 'plain' | 'contenteditable' | 'gdocs';

export interface InsertResult {
  ok: boolean;
  /** false when the adapter cannot observe the editor's state (Google Docs). */
  verified: boolean;
  reason?: string;
}

/**
 * One adapter per editor family — a deliberate architecture decision, not
 * over-engineering: plain fields, contenteditable frameworks and Google Docs
 * fail in genuinely different ways (see .planning/research/ARCHITECTURE.md).
 */
export interface InsertionAdapter {
  readonly kind: EditorKind;
  /** Focus the target, restore the saved cursor, snapshot state for undo. */
  prepare(): InsertResult;
  /** Insert one chunk at the current position. Must verify when possible. */
  insert(chunk: string): InsertResult;
  /** Undo everything this session inserted, as one user-visible step. */
  undoAll(): InsertResult;
  /**
   * Confirm the inserted-so-far text is still where the adapter believes it
   * is. Called before resume — the user may have edited the document while
   * paused (Pitfall 3), and writing at stale offsets corrupts their text.
   * Absent on adapters that cannot observe the editor (Google Docs).
   */
  verifyIntact?(): InsertResult;
  /** The element that receives user keystrokes (for typing-race detection). */
  eventTarget(): EventTarget | null;
}

export interface PacingConfig {
  mode: 'cps' | 'wps';
  /** characters or words per second */
  rate: number;
  sentencePauseMs: number;
  paragraphPauseMs: number;
}

export const DEFAULT_PACING: PacingConfig = {
  mode: 'cps',
  rate: 40,
  sentencePauseMs: 250,
  paragraphPauseMs: 500,
};

export type InsertionState = 'idle' | 'running' | 'paused' | 'stopped' | 'done' | 'error';

export interface InsertionCallbacks {
  onState: (state: InsertionState, detail?: string) => void;
  onProgress: (insertedChars: number, totalChars: number) => void;
}
