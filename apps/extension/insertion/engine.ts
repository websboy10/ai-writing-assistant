import type { InsertionAdapter, InsertionCallbacks, InsertionState, PacingConfig } from './types';

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
    this.queue = chunkText(text);
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
      this.detachGuard();
      return this.fail(res.reason);
    }

    this.queueIndex += 1;
    this.insertedChars += chunk.length;
    this.cb.onProgress(this.insertedChars, this.totalChars);

    this.timer = window.setTimeout(this.tick, this.delayAfter(chunk));
  };

  private delayAfter(chunk: string): number {
    const cps = this.pacing.mode === 'cps' ? this.pacing.rate : this.pacing.rate * 6; // avg word ≈ 6 chars incl. space
    const base = (chunk.length / Math.max(1, cps)) * 1000;
    if (/\n\s*\n\s*$/.test(chunk)) return base + this.pacing.paragraphPauseMs;
    if (/[.!?]["')\]]?\s*$/.test(chunk)) return base + this.pacing.sentencePauseMs;
    return base;
  }

  private attachGuard(): void {
    this.guardTarget = this.adapter.eventTarget();
    this.guardTarget?.addEventListener('input', this.onUserInput, true);
    this.guardTarget?.addEventListener('keydown', this.onUserKey, true);
  }

  private detachGuard(): void {
    this.guardTarget?.removeEventListener('input', this.onUserInput, true);
    this.guardTarget?.removeEventListener('keydown', this.onUserKey, true);
    this.guardTarget = null;
  }

  private onUserInput = (e: Event): void => {
    if (this.inOwnDispatch || !e.isTrusted) return;
    this.pause('user-typing');
  };

  private onUserKey = (e: Event): void => {
    if (this.inOwnDispatch || !e.isTrusted) return;
    const ke = e as KeyboardEvent;
    if (ke.key.length === 1 || ['Backspace', 'Delete', 'Enter'].includes(ke.key)) {
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
 * Chunk text at word boundaries. Words (with trailing whitespace) are the
 * insertion unit: fine enough to read along with, coarse enough to avoid the
 * per-character event flood the performance research warns about.
 */
export function chunkText(text: string): string[] {
  const out: string[] = [];
  const re = /\S+\s*/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text))) out.push(m[0]);
  return out;
}
