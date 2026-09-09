import { paceDelayMs, type FormatKey, type InsertionAdapter, type InsertionCallbacks, type InsertionState, type InsertResult, type PacingConfig } from './types';
import { awaLog } from './debug';
import { humanScript } from './human';
import { richPieces, type RichPiece } from './richsteps';

/**
 * The insertion state machine. Lives in the content script (the only context
 * with both DOM access and a stable lifetime) and is fully decoupled from AI
 * generation: it consumes a finished string, and stopping it never touches
 * the generation stream (INST-10).
 *
 * States: idle → running ⇄ paused → done | stopped | error
 *
 * A session runs a list of steps. Plain slow mode is one insert step per
 * chunk; "Skriv som et menneske" adds slips, deletions and pauses from
 * human.ts. Either way `committed` on each step is how much of the real text
 * is correctly in the document once the step has run, which is what the
 * progress bar shows — it dips during a rewrite and that is the honest figure.
 *
 * Typing-race guard (INST-12): any trusted input event on the target while a
 * session is running — i.e. keystrokes we didn't synthesize — auto-pauses the
 * session so the user's typing and ours never interleave.
 */

interface Step {
  insert?: string;
  /** Always one character, so a deletion looks like a held key, not a cut. */
  deleteBack?: number;
  /** A formatting shortcut, or an Enter/space the paste channel cannot carry. See richsteps.ts. */
  key?: FormatKey;
  /** Extra wait after this step, on top of the tempo. */
  pauseMs?: number;
  committed: number;
}

export interface SessionOptions {
  /** Injected for tests; human mode draws every decision from it. */
  rng?: () => number;
  /** Scales human-mode pauses. Tests pass 0 so a run takes milliseconds. */
  pauseScale?: number;
  /**
   * The same text as real formatting, for editors that can hold it.
   *
   * Used by "Indsæt straks" alone: one paste, one undo step.
   */
  html?: string;
  /**
   * The same text as markdown, for PACED mode on an editor that honours
   * formatting shortcuts (InsertionAdapter.pressKey).
   *
   * Until 2026-09-08 the comment above said a formatted sentence could not be
   * delivered one code point at a time. It can — by pressing the shortcut
   * before it and after it, which is what a person does, and what
   * richsteps.ts compiles this into. Ignored on adapters without pressKey,
   * which type `text`.
   */
  markdown?: string;
  /**
   * The caret already stands in an empty list item of this kind — a worksheet
   * that draws "1." under its question. The compiled run then continues that
   * list rather than starting a second one beside it. See richsteps.ts.
   */
  startInList?: 'bullet' | 'numbered';
}

export class InsertionSession {
  private state: InsertionState = 'idle';
  private steps: Step[] = [];
  private stepIndex = 0;
  private totalChars: number;
  private timer: number | null = null;
  private inOwnDispatch = false;
  private guardTarget: EventTarget | null = null;
  private html: string | undefined;

  constructor(
    private adapter: InsertionAdapter,
    private text: string,
    private pacing: PacingConfig,
    private cb: InsertionCallbacks,
    opts: SessionOptions = {},
  ) {
    this.totalChars = text.length;
    this.html = opts.html;
    const chunk = (t: string) => adapter.chunkText?.(t) ?? chunkText(t);
    const rich = !!opts.markdown && !!adapter.pressKey;
    const pieces: RichPiece[] = rich
      ? richPieces(opts.markdown!, { human: pacing.human, rng: opts.rng, startInList: opts.startInList })
      : pacing.human
        ? humanScript(text, { rng: opts.rng })
        : [{ kind: 'type', text, intended: true }];
    this.steps = planSteps(pieces, chunk, opts.pauseScale ?? 1);
    awaLog('engine.plan', {
      rich,
      keys: this.steps.filter((s) => s.key).map((s) => s.key),
      steps: this.steps.length,
    });
  }

  getState(): InsertionState {
    return this.state;
  }

  /** Instant mode: one prepared write, still verified and undoable. */
  insertInstant(): void {
    const prep = this.adapter.prepare();
    if (!prep.ok) return this.fail(prep.reason);
    this.inOwnDispatch = true;
    // Real formatting when the editor can hold it and there is any to give;
    // otherwise exactly what this always did. Both paths are one write, so
    // undo stays one user-visible step either way.
    const res =
      this.html && this.adapter.insertRich
        ? this.adapter.insertRich(this.html, this.text)
        : this.adapter.insert(this.text);
    this.inOwnDispatch = false;
    if (!res.ok) return this.fail(res.reason);
    this.cb.onProgress(this.totalChars, this.totalChars);
    this.setState('done', res.verified ? undefined : 'unverified');
  }

  start(): void {
    const prep = this.adapter.prepare();
    if (!prep.ok) return this.fail(prep.reason);
    awaLog('engine.start', {
      kind: this.adapter.kind,
      echoesAsync: !!this.adapter.echoesAsync,
      steps: this.steps.length,
      human: !!this.pacing.human,
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
    if (res.ok) this.setState('idle', 'undone');
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
    if (this.stepIndex >= this.steps.length) {
      this.detachGuard();
      // The end of a typing window, for a reading of the screen that must
      // tell this session's own keystrokes from the Find that placed the next
      // (scripts/verify-formatted-answers.mjs).
      awaLog('engine.done', { steps: this.steps.length });
      this.setState('done');
      return;
    }

    const step = this.steps[this.stepIndex];
    let res: InsertResult = { ok: true, verified: true };
    this.inOwnDispatch = true;
    if (step.insert !== undefined) res = this.adapter.insert(step.insert);
    else if (step.deleteBack) res = this.adapter.deleteBack(step.deleteBack);
    else if (step.key) res = this.adapter.pressKey?.(step.key) ?? { ok: false, verified: true, reason: 'Editoren kan ikke formatere tekst.' };
    this.inOwnDispatch = false;

    if (!res.ok) {
      awaLog('engine.fail', { stepIndex: this.stepIndex, reason: res.reason });
      this.detachGuard();
      return this.fail(res.reason);
    }

    this.stepIndex += 1;
    this.cb.onProgress(step.committed, this.totalChars);

    this.timer = window.setTimeout(this.tick, this.delayAfter(step, this.steps[this.stepIndex]));
  };

  private delayAfter(step: Step, next: Step | undefined): number {
    const extra = step.pauseMs ?? 0;
    if (step.deleteBack) {
      // A held backspace: quick, never metronome-steady, a beat longer for
      // each extra character it takes.
      return 40 + Math.random() * 70 + 25 * (step.deleteBack - 1) + extra;
    }
    if (step.key) {
      // A shortcut is a chord, not a thought: quick. Enter is a line and gets
      // the same beat a paragraph break gets below; a space is one keystroke.
      const base = paceDelayMs(this.pacing.wpm);
      if (step.key === 'enter') return base * (0.6 + Math.random() * 0.8) + 700 + extra;
      if (step.key === 'space') return base * (0.6 + Math.random() * 0.8) + extra;
      return 60 + Math.random() * 60 + extra;
    }
    if (step.insert === undefined) return extra;
    // Letter-by-letter at wpm words/min (5 chars/word), with human jitter —
    // a metronome-steady 400 ms tick reads as robotic, uneven strokes don't.
    const base = paceDelayMs(this.pacing.wpm);
    const jittered = base * (0.6 + Math.random() * 0.8);
    // Chunks carry LEADING whitespace, so a paragraph break lives at the start
    // of the next chunk and sentence punctuation at the end of this one.
    if (next?.insert && /^\s*\n\s*\n/.test(next.insert)) return jittered + 700 + extra;
    if (/[.!?]["')\]]?$/.test(step.insert)) return jittered + 350 + extra;
    return jittered + extra;
  }

  private attachGuard(): void {
    this.guardTarget = this.adapter.eventTarget();
    // An async-echo editor (Google Docs) reports our own write as a trusted
    // `input` after insert() has returned, so listening for it here pauses the
    // run on its own first letter. `keydown` carries the same signal without
    // the ambiguity — a person typing always produces one, our synthetic
    // paste and Backspace never do (both are untrusted events). See
    // InsertionAdapter.echoesAsync.
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
    awaLog('engine.pause.input', { stepIndex: this.stepIndex });
    this.pause('user-typing');
  };

  private onUserKey = (e: Event): void => {
    if (this.inOwnDispatch || !e.isTrusted) return;
    const ke = e as KeyboardEvent;
    if (ke.key.length === 1 || ['Backspace', 'Delete', 'Enter'].includes(ke.key)) {
      awaLog('engine.pause.keydown', { stepIndex: this.stepIndex, key: ke.key });
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
 * Pieces → steps. Consecutive runs of the real text are merged before
 * chunking, and a pause is attached to the chunk it falls inside, so a pause
 * never creates a chunk edge of its own — on Docs an edge next to a space
 * loses the space. A slip or a deletion does cut the text, at a spot human.ts
 * guarantees is safe.
 *
 * `good` is how much of the real text is correctly in the document, `bad`
 * how many slipped characters sit after it. A deletion eats the slip first,
 * then the real text (a rewrite).
 */
function planSteps(pieces: RichPiece[], chunk: (t: string) => string[], pauseScale: number): Step[] {
  const steps: Step[] = [];
  let good = 0;
  let bad = 0;
  let run = '';
  let runPauses: { offset: number; ms: number }[] = [];

  const flushRun = () => {
    if (!run) return;
    let offset = 0;
    for (const c of chunk(run)) {
      const start = offset;
      offset += c.length;
      good += c.length;
      const ms = runPauses.filter((p) => p.offset > start && p.offset <= offset).reduce((n, p) => n + p.ms, 0);
      steps.push({ insert: c, committed: good, ...(ms ? { pauseMs: ms * pauseScale } : {}) });
    }
    run = '';
    runPauses = [];
  };

  for (const p of pieces) {
    if (p.kind === 'type' && p.intended) {
      run += p.text;
      continue;
    }
    if (p.kind === 'pause') {
      if (run) runPauses.push({ offset: run.length, ms: p.ms });
      else steps.push({ committed: good, pauseMs: p.ms * pauseScale });
      continue;
    }
    flushRun();
    if (p.kind === 'key') {
      // Enter and space put a real character in the document; a toggle does
      // not, so only the former count towards what is committed.
      if (p.key === 'enter' || p.key === 'space') good += 1;
      steps.push({ key: p.key, committed: good });
      continue;
    }
    if (p.kind === 'type') {
      for (const c of chunk(p.text)) {
        bad += c.length;
        steps.push({ insert: c, committed: good });
      }
    } else {
      // The whole deletion as ONE step, so the adapter can check it as one:
      // on Docs that is the Backspaces and a same-task read of what is left
      // (adapters/gdocs.ts deleteBack). One Backspace per step, 40 ms apart
      // and unchecked, was how a dropped keystroke left "drerude" in a real
      // form (2026-09-08).
      for (let i = 0; i < p.count; i++) {
        if (bad > 0) bad -= 1;
        else good -= 1;
      }
      steps.push({ deleteBack: p.count, committed: good });
    }
  }
  flushRun();
  return steps;
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
