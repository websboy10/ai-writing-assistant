import type { InsertionAdapter, InsertionCallbacks, InsertionState, PacingConfig } from './types';
import { awaLog } from './debug';

/**
 * The insertion state machine. Lives in the content script (the only context
 * with both DOM access and a stable lifetime) and is fully decoupled from AI
 * generation: it consumes a finished string, and stopping it never touches
 * the generation stream (INST-10).
 *
 * States: idle → running ⇄ paused → done | stopped | error
 *
 * Typing-race guard (INST-12): any trusted input event on the target while a
 * session is running — i.e. keystrokes we didn't synthesize — auto-pauses the
 * session so the user's typing and ours never interleave.
 */
export class InsertionSession {
  private state: InsertionState = 'idle';
  private queue: string[] = [];
  private queueIndex = 0;
  private insertedChars = 0;
  private totalChars: number;
  private timer: number | null = null;
  private inOwnDispatch = false;
  private guardTarget: EventTarget | null = null;

  constructor(
    private adapter: InsertionAdapter,
    private text: string,
    private pacing: PacingConfig,
    private cb: InsertionCallbacks,
  ) {
    this.totalChars = text.length;
    this.queue = adapter.chunkText?.(text) ?? chunkText(text);
  }

  getState(): InsertionState {
    return this.state;
  }

  /** Instant mode: one prepared write, still verified and undoable. */
  insertInstant(): void {
    const prep = this.adapter.prepare();
    if (!prep.ok) return this.fail(prep.reason);
    this.inOwnDispatch = true;
    const res = this.adapter.insert(this.text);
    this.inOwnDispatch = false;
    if (!res.ok) return this.fail(res.reason);
    this.insertedChars = this.totalChars;
    this.cb.onProgress(this.insertedChars, this.totalChars);
    this.setState('done', res.verified ? undefined : 'unverified');
  }

  start(): void {
    const prep = this.adapter.prepare();
    if (!prep.ok) return this.fail(prep.reason);
    awaLog('engine.start', {
      kind: this.adapter.kind,
      echoesAsync: !!this.adapter.echoesAsync,
      chunks: this.queue.length,
    });
    this.attachGuard();
    this.setState('running');
    this.tick();
  }

  pause(detail?: string): void {
    if (this.state !== 'running') return;
    this.clearTimer();
    this.setState('paused', detail);
  }

  resume(): void {
    if (this.state !== 'paused') return;
    // Pitfall 3: the document may have changed while paused. Never write at
    // stale offsets — refusing loudly beats corrupting the user's text.
    const check = this.adapter.verifyIntact?.();
    if (check && !check.ok) {
      this.detachGuard();
      return this.fail(check.reason ?? 'Teksten blev ændret undervejs — indsættelsen kan ikke fortsættes sikkert.');
    }
    this.setState('running');
    this.tick();
  }

  /** Stop leaves partial text in place (INST-08). */
  stop(): void {
    if (this.state !== 'running' && this.state !== 'paused') return;
    this.clearTimer();
    this.detachGuard();
    this.setState('stopped');
  }

  /** Undo removes everything this session inserted — complete or partial (INST-09). */
  undo(): { ok: boolean; reason?: string } {
    this.clearTimer();
    this.detachGuard();
    this.inOwnDispatch = true;
    const res = this.adapter.undoAll();
    this.inOwnDispatch = false;
    if (res.ok) {
      this.insertedChars = 0;
      this.setState('idle', 'undone');
    }
    return { ok: res.ok, reason: res.reason };
  }

  destroy(): void {
    this.clearTimer();
    this.detachGuard();
  }

  // ---- internals ----

  private clearTimer(): void {
    if (this.timer !== null) {
      window.clearTimeout(this.timer);
      this.timer = null;
    }
  }

  private tick = (): void => {
    if (this.state !== 'running') return;
    if (this.queueIndex >= this.queue.length) {
      this.detachGuard();
      this.setState('done');
      return;
    }

    const chunk = this.queue[this.queueIndex];
    this.inOwnDispatch = true;
    const res = this.adapter.insert(chunk);
    this.inOwnDispatch = false;

    if (!res.ok) {
      awaLog('engine.fail', { chunkIndex: this.queueIndex, reason: res.reason });
      this.detachGuard();
      return this.fail(res.reason);
    }

    this.queueIndex += 1;
    this.insertedChars += chunk.length;
    this.cb.onProgress(this.insertedChars, this.totalChars);

    this.timer = window.setTimeout(this.tick, this.delayAfter(chunk, this.queue[this.queueIndex]));
  };

  private delayAfter(chunk: string, next: string | undefined): number {
    // Letter-by-letter at wpm words/min (5 chars/word), with human jitter —
    // a metronome-steady 400 ms tick reads as robotic, uneven strokes don't.
    const base = 60_000 / (Math.max(1, this.pacing.wpm) * 5);
    const jittered = base * (0.6 + Math.random() * 0.8);
    // Chunks carry LEADING whitespace, so a paragraph break lives at the start
    // of the next chunk and sentence punctuation at the end of this one.
    if (next && /^\s*\n\s*\n/.test(next)) return jittered + 700;
    if (/[.!?]["')\]]?$/.test(chunk)) return jittered + 350;
    return jittered;
  }

  private attachGuard(): void {
    this.guardTarget = this.adapter.eventTarget();
    // An async-echo editor (Google Docs) reports our own write as a trusted
    // `input` after insert() has returned, so listening for it here pauses the
    // run on its own first letter. `keydown` carries the same signal without
    // the ambiguity — a person typing always produces one, our synthetic paste
    // never does. See InsertionAdapter.echoesAsync.
    if (!this.adapter.echoesAsync) {
      this.guardTarget?.addEventListener('input', this.onUserInput, true);
    }
    this.guardTarget?.addEventListener('keydown', this.onUserKey, true);
  }

  private detachGuard(): void {
    // Unconditional: removing a listener that was never added is a no-op, and
    // keying this off echoesAsync would leak the listener if that ever changed
    // mid-session.
    this.guardTarget?.removeEventListener('input', this.onUserInput, true);
    this.guardTarget?.removeEventListener('keydown', this.onUserKey, true);
    this.guardTarget = null;
  }

  private onUserInput = (e: Event): void => {
    if (this.inOwnDispatch || !e.isTrusted) return;
    awaLog('engine.pause.input', { chunkIndex: this.queueIndex });
    this.pause('user-typing');
  };

  private onUserKey = (e: Event): void => {
    if (this.inOwnDispatch || !e.isTrusted) return;
    const ke = e as KeyboardEvent;
    if (ke.key.length === 1 || ['Backspace', 'Delete', 'Enter'].includes(ke.key)) {
      awaLog('engine.pause.keydown', { chunkIndex: this.queueIndex, key: ke.key });
      this.pause('user-typing');
    }
  };

  private setState(s: InsertionState, detail?: string): void {
    this.state = s;
    this.cb.onState(s, detail);
  }

  private fail(reason?: string): void {
    this.setState('error', reason ?? 'Insertion failed.');
  }
}

/**
 * Chunk text one LETTER at a time, whitespace LEADING each letter. Trailing
 * whitespace at a contenteditable block edge gets collapsed by the browser,
 * which jammed words together ("Alphabeta") under trailing-space chunking; a
 * leading space sits between two visible characters the moment the next
 * letter lands, so it survives. The /u flag keeps surrogate pairs (emoji,
 * non-Latin scripts) intact as single chunks.
 */
export function chunkText(text: string): string[] {
  const out: string[] = [];
  const re = /\s*\S/gu;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text))) out.push(m[0]);
  // Preserve any trailing whitespace so the full text is inserted exactly.
  const matched = out.reduce((n, c) => n + c.length, 0);
  if (matched < text.length) out.push(text.slice(matched));
  return out;
}
