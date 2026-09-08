export type EditorKind = 'plain' | 'contenteditable' | 'gdocs';

/**
 * The keystrokes a formatted paced run is made of, besides the text itself.
 *
 * `enter` and `space` are here because the paste channel cannot deliver them
 * where they matter: Enter inside a list is what makes the next item (a pasted
 * newline does not), and a space at a formatting boundary sits at a paste
 * edge, which Docs trims (scripts/probe-docs-space.mjs — `beforeinput` puts a
 * real U+0020 there).
 */
export type FormatKey = 'bold' | 'italic' | 'h1' | 'h2' | 'h3' | 'normal' | 'bullets' | 'numbered' | 'enter' | 'space';

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
  /**
   * Insert the whole text as REAL formatting — headings, bold, actual list
   * items — instead of characters that merely look like them.
   *
   * Present only on adapters whose editor can hold structure at all. A
   * <textarea> physically cannot, so PlainAdapter omits it and nothing
   * changes there.
   *
   * Only "Indsæt straks" uses it, and that is not a temporary limitation:
   * paced mode types one code point at a time, and half a bold sentence is
   * not a thing that can be inserted. `plain` is carried alongside so the
   * adapter can hand the editor both flavours in one paste and let it choose.
   */
  insertRich?(html: string, plain: string): InsertResult;
  /**
   * Press one formatting shortcut, or one of the two keys the paste channel
   * cannot deliver. This is how paced mode carries formatting at all: the
   * engine keeps typing characters and, between them, does what a person
   * does — Cmd+B, type the word, Cmd+B again.
   *
   * Measured against a live document 2026-09-08 (scripts/probe-docs-typing-format.mjs):
   * every key below produced the real thing in Docs, 8 of 8. Only editors that
   * honour synthetic shortcuts implement it; the engine types plain text
   * everywhere else, exactly as before.
   */
  pressKey?(key: FormatKey): InsertResult;
  /**
   * Remove the last `count` characters this session wrote, the way Backspace
   * would. Only "Skriv som et menneske" calls it: a slip is deleted before
   * the real text resumes, and a rewrite takes back the last word or two.
   * Never reaches past what the session itself inserted.
   */
  deleteBack(count: number): InsertResult;
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
 * How slow mode types. `wpm` is words per minute on the standard
 * five-letters-per-word measure, so 30 is 2.5 letters a second: deliberately
 * unhurried, the user reads along as if a person were typing. The slider in
 * the panel moves it between MIN_WPM and MAX_WPM. `human` adds slips that get
 * corrected and words that get typed again (see human.ts); the text still
 * ends up exactly as the draft.
 */
export interface PacingConfig {
  wpm: number;
  human: boolean;
}

export const MIN_WPM = 10;
export const MAX_WPM = 200;
export const DEFAULT_PACING: PacingConfig = { wpm: 30, human: false };

/**
 * Milliseconds a single character costs in paced mode, before jitter.
 *
 * The engine's own tick rate (engine.ts delayAfter) and anything that wants to
 * tell the user how long a run will take must not each carry their own copy of
 * this: an estimate that disagrees with the engine is worse than no estimate,
 * because it is believed. Jitter averages out over any run long enough to be
 * worth estimating, and the per-sentence pauses only ever make it slower — so
 * this is a floor, and a caller phrasing it as such ("ca.") is telling the
 * truth.
 */
export function paceDelayMs(wpm: number): number {
  return 60_000 / (Math.max(1, wpm) * 5);
}

export type InsertionState = 'idle' | 'running' | 'paused' | 'stopped' | 'done' | 'error';

export interface InsertionCallbacks {
  onState: (state: InsertionState, detail?: string) => void;
  onProgress: (insertedChars: number, totalChars: number) => void;
}
