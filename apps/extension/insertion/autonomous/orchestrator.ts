import type { AutonomousAnswer } from '@awa/shared';
import { InsertionSession } from '../engine';
import { adapterFor } from '../index';
import { DEFAULT_PACING } from '../types';
import type { SavedTarget } from '../target';
import type { QuestionSource } from './locator';
import { orderForRun, orderForUndo } from './plan';

export type RunState = 'idle' | 'writing' | 'paused' | 'stopped' | 'done' | 'error';

export interface RunProgress {
  answersDone: number;
  answersTotal: number;
  /** Progress of the CURRENT answer's InsertionSession, not the whole run. */
  charsInAnswer: number;
  charsTotal: number;
}

export interface RunCallbacks {
  onRunState(state: RunState, detail?: string): void;
  onProgress(p: RunProgress): void;
  onUnplaced(q: { questionText: string; reason: string }): void;
}

type SessionOutcome = 'done' | 'error' | 'stopped';

/**
 * One run, many InsertionSessions — the layer above the existing engine.
 *
 * This is the whole point of the plan: the orchestrator takes a *source*
 * (whatever holds the questions) and a list of answers, and drives the
 * existing `InsertionSession` once per answer. It knows nothing about
 * whether the questions came from a whole document or a marked selection,
 * or which editor is underneath — that split lives entirely in
 * `QuestionSource` (D-16 depends on this reuse being exact, not a second
 * insertion mechanism).
 *
 * Positions are resolved one at a time, immediately before each answer is
 * written (D-03): `source.locate()` is called inside the loop, never before
 * it, so an answer under question 1 cannot misplace the answer to
 * question 2. The per-session typing-race guard (INST-12/D-13) is reused
 * unmodified — this class never attaches its own input/keydown listeners.
 */
export class AutonomousRun {
  private state: RunState = 'idle';
  private queue: AutonomousAnswer[];
  private queueIndex = 0;
  private completed: { session: InsertionSession; answer: AutonomousAnswer }[] = [];
  private currentSession: InsertionSession | null = null;
  private stopped = false;

  constructor(
    private source: QuestionSource,
    answers: AutonomousAnswer[],
    private mode: 'instant' | 'progressive',
    private cb: RunCallbacks,
  ) {
    // Top-down only in this plan: Langsomt must start at the first question
    // and work downward while the user watches (D-04). 'bottom-up' is
    // 07-05's Docs-fallback caller.
    this.queue = orderForRun(answers, 'top-down');
  }

  async start(): Promise<void> {
    if (this.state !== 'idle') return;
    this.state = 'writing';
    this.cb.onRunState('writing');
    await this.loop();
  }

  pause(): void {
    this.currentSession?.pause();
  }

  resume(): void {
    this.currentSession?.resume();
  }

  /** Stops the whole run, leaving whatever the current session already wrote in place (INST-08). */
  stop(): void {
    if (this.state !== 'writing' && this.state !== 'paused') return;
    this.stopped = true;
    if (this.currentSession) {
      this.currentSession.stop();
    } else {
      // Between answers (e.g. mid-locate) — nothing running to stop.
      this.state = 'stopped';
      this.cb.onRunState('stopped');
    }
  }

  /**
   * Undoes the WHOLE run as one user-visible step (D-15), reversing
   * insertion order so removing a later answer never invalidates an
   * earlier one's offsets. Reports honestly which answers could not be
   * removed rather than claiming success.
   */
  undo(): { ok: boolean; reason?: string } {
    const failures: string[] = [];
    const stillCompleted: typeof this.completed = [];
    for (const item of orderForUndo(this.completed)) {
      const res = item.session.undo();
      if (!res.ok) {
        failures.push(`"${item.answer.questionText}": ${res.reason ?? 'ukendt årsag'}`);
        stillCompleted.push(item);
      }
    }
    this.completed = stillCompleted;
    if (failures.length === 0) return { ok: true };
    return { ok: false, reason: `Kunne ikke fjerne alle svar — ${failures.join('; ')}` };
  }

  destroy(): void {
    this.currentSession?.destroy();
    for (const item of this.completed) item.session.destroy();
  }

  // ---- internals ----

  private async loop(): Promise<void> {
    while (this.queueIndex < this.queue.length) {
      if (this.stopped) return;
      const answer = this.queue[this.queueIndex];
      this.queueIndex += 1;

      // D-03: locate() runs HERE, immediately before this answer is
      // written, against the document as it is right now — never resolved
      // for the whole queue up front.
      const target = await this.source.locate({
        paragraphIndex: answer.paragraphIndex,
        questionText: answer.questionText,
      });

      if (!target) {
        this.cb.onUnplaced({
          questionText: answer.questionText,
          reason:
            this.source.lastLocateReason?.() ||
            `Spørgsmålet "${answer.questionText}" kunne ikke placeres i teksten.`,
        });
        this.reportProgress();
        continue;
      }

      const outcome = await this.runOneSession(target, answer);
      if (outcome === 'error') {
        this.state = 'error';
        return;
      }
      if (outcome === 'stopped') {
        return; // stop() already set state + fired the callback
      }
      // 'done' — proceed to the next answer.
    }
    if (!this.stopped) {
      this.state = 'done';
      this.cb.onRunState('done');
    }
  }

  /** One InsertionSession, driven exactly like a manual insert (D-16). */
  private runOneSession(target: SavedTarget, answer: AutonomousAnswer): Promise<SessionOutcome> {
    return new Promise((resolve) => {
      const adapter = adapterFor(target);
      // The caret sits right after the question's text (locate() collapsed
      // it there) — prefixing a newline puts the answer on the line below,
      // never appended onto the question's own line.
      const text = `\n${answer.answer}`;

      const session = new InsertionSession(adapter, text, DEFAULT_PACING, {
        onState: (state, detail) => {
          if (state === 'paused') {
            // A trusted keystroke mid-run (INST-12) or an explicit pause()
            // call — either way, the WHOLE run pauses (D-13).
            this.state = 'paused';
            this.cb.onRunState('paused', detail);
            return;
          }
          if (state === 'running') {
            if (this.state !== 'writing') {
              this.state = 'writing';
              this.cb.onRunState('writing');
            }
            return;
          }
          if (state === 'done') {
            this.completed.push({ session, answer });
            this.currentSession = null;
            this.reportProgress();
            resolve('done');
            return;
          }
          if (state === 'error') {
            this.currentSession = null;
            this.cb.onRunState('error', detail);
            resolve('error');
            return;
          }
          if (state === 'stopped') {
            this.currentSession = null;
            resolve('stopped');
          }
        },
        onProgress: (inserted, total) => this.reportProgress(inserted, total),
      });

      this.currentSession = session;
      if (this.mode === 'instant') session.insertInstant();
      else session.start();
    });
  }

  private reportProgress(charsInAnswer = 0, charsTotal = 0): void {
    this.cb.onProgress({
      answersDone: this.completed.length,
      answersTotal: this.queue.length,
      charsInAnswer,
      charsTotal,
    });
  }
}
