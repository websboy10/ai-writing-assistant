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
  /**
   * Split the text into paced-mode chunks, when the editor cannot accept the
   * default one-letter-with-leading-whitespace split. Only Google Docs needs
   * this; everything else omits it and gets chunkText().
   */
  chunkText?(text: string): string[];
  /**
   * True when the editor applies our write on its own schedule, so the
   * browser's edit report lands AFTER insert() has returned.
   *
   * Google Docs does this: the synthetic paste hands text to Docs, Docs
   * updates its model and repaints its canvas, and only then does an `input`
   * event appear — by which point the engine's "this write is mine" flag is
   * already down. The guard then reads our own echo as the user typing and
   * pauses the run after a single letter (INST-12 misfiring on itself).
   *
   * On these adapters the engine drops `input` from the typing-race guard and
   * relies on `keydown` alone, which separates the two cleanly: a person
   * typing always produces a trusted keydown, and a synthetic paste never
   * does. A timing window would have had to choose between swallowing real
   * keystrokes and re-admitting the echo; this needs no window at all.
   */
  readonly echoesAsync?: boolean;
}

/**
 * One knob, no settings UI: slow mode types letter by letter at a human tempo.
 * 30 words/minute (the standard 5-chars-per-word measure → 2.5 letters/sec)
 * is deliberately unhurried — the user reads along as if a person were typing.
 */
export interface PacingConfig {
  wpm: number;
}

export const DEFAULT_PACING: PacingConfig = { wpm: 30 };

export type InsertionState = 'idle' | 'running' | 'paused' | 'stopped' | 'done' | 'error';

export interface InsertionCallbacks {
  onState: (state: InsertionState, detail?: string) => void;
  onProgress: (insertedChars: number, totalChars: number) => void;
}
