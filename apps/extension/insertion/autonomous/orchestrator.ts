import type { AutonomousAnswer } from '@awa/shared';
import { InsertionSession } from '../engine';
import { adapterFor } from '../index';
import type { PacingConfig } from '../types';
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
 *
 * Panel independence (D-14): this class holds no reference to React and
 * nothing here depends on the sidebar being mounted — the caller
 * (`apps/extension/sidebar/autonomous.ts`) keeps the active instance in a
 * module-level singleton outside the component tree, so collapsing the
 * panel (which unmounts it) never calls `destroy()`. Honest limit: Chrome
 * throttles timers in a fully backgrounded TAB (not a collapsed panel — the
 * page itself stays foregrounded here), so a Langsomt run keeps going but
 * can slow down in that case. The transport bar must never show a countdown
 * or an ETA — either would become a lie the moment that throttling kicks in.
 */
/**
 * The block composition a 'block'-placement source gets: every question with
 * its own answer beneath it, in document order. The question is repeated
 * because a block lands at the cursor, far from the questions it answers —
 * without it the user gets a wall of answers with nothing to match them to.
 */
function composeBlockText(answers: AutonomousAnswer[]): string {
  return orderForRun(answers)
    .map((a) => `${a.questionText}\n${a.answer}`)
    .join('\n\n');
}

export class AutonomousRun {
  private state: RunState = 'idle';
  private queue: AutonomousAnswer[];
  private queueIndex = 0;
  private completed: { session: InsertionSession; label: string }[] = [];
  private currentSession: InsertionSession | null = null;
  private stopped = false;
  // A pause pressed BETWEEN two answers (no session currently running to
  // forward it to) must still hold the queue, not be silently swallowed —
  // resolved by making pause/resume flag-based here rather than only ever
  // forwarding to currentSession. resumeWaiters lets the loop `await` this
  // exactly like it awaits a session's own promise.
  private pausedBetween = false;
  private resumeWaiters: Array<() => void> = [];

  constructor(
    private source: QuestionSource,
    answers: AutonomousAnswer[],
    private mode: 'instant' | 'progressive',
    /**
     * The panel's own tempo and "Skriv som et menneske" switch. This was
     * hard-wired to DEFAULT_PACING until 2026-09-08, so a run ignored the
     * slider the user had just set for it.
     */
    private pacing: PacingConfig,
    private cb: RunCallbacks,
  ) {
    // Top-down: Langsomt must start at the first question and work downward
    // while the user watches (D-04).
    this.queue = orderForRun(answers);
  }

  /**
   * `startPaused` covers a real gap: the caller shows "Skriver" and a live
   * Pause button the instant it calls this class into existence, but a
   * pause pressed before the FIRST answer's session even starts has nothing
   * to forward to yet (there's no currentSession, and pausedBetween's own
   * "between two answers" check only exists once the loop is running). This
   * lets the caller apply an already-requested pause atomically with start,
   * rather than starting anyway and racing to catch up (AUTO-17).
   */
  async start(startPaused = false): Promise<void> {
    if (this.state !== 'idle') return;
    if (startPaused) {
      this.pausedBetween = true;
      this.state = 'paused';
      this.cb.onRunState('paused');
    } else {
      this.state = 'writing';
      this.cb.onRunState('writing');
    }
    await this.loop();
  }

  pause(): void {
    if (this.currentSession) {
      this.currentSession.pause();
      return;
    }
    // Between answers (e.g. right after one finishes, before the next is
    // located) — nothing running to forward to. Hold the queue here instead
    // of dropping the request silently.
    if (this.state === 'writing') {
      this.pausedBetween = true;
      this.state = 'paused';
      this.cb.onRunState('paused');
    }
  }

  resume(): void {
    if (this.currentSession) {
      this.currentSession.resume();
      return;
    }
    if (this.pausedBetween) {
      this.pausedBetween = false;
      this.state = 'writing';
      this.cb.onRunState('writing');
      this.releaseResumeWaiters();
    }
  }

  /** Stops the whole run, leaving whatever the current session already wrote in place (INST-08). */
  stop(): void {
    if (this.state !== 'writing' && this.state !== 'paused') return;
    this.stopped = true;
    if (this.currentSession) {
      this.currentSession.stop();
    } else {
      // Between answers (e.g. mid-locate, or paused-between) — nothing
      // running to stop. Release any pending pause-wait too, so a loop
      // blocked in waitIfPausedBetween() can see `stopped` and exit.
      this.pausedBetween = false;
      this.releaseResumeWaiters();
      this.state = 'stopped';
      this.cb.onRunState('stopped');
    }
  }

  /**
   * Answers not yet fully written — the one that just failed plus everything
   * still queued after it, in run order. Gives a failed run the same
   * "copied to the clipboard" courtesy inserter.ts already extends on a
   * failed insert (AUTO-17), computed here since only the orchestrator
   * knows exactly what remains.
   */
  remaining(): AutonomousAnswer[] {
    return this.queue.slice(Math.max(0, this.queueIndex - 1));
  }

  /**
   * Undoes the WHOLE run as one user-visible step (D-15), reversing
   * insertion order so removing a later answer never invalidates an
   * earlier one's offsets. Reports honestly which answers could not be
   * removed rather than claiming success.
   *
   * Async purely for its callers' sake: both (sidebar/autonomous.ts, and
   * ChatView.tsx's fire-and-forget `onClick={() => autonomous.undo()}`)
   * already await it.
   */
  async undo(): Promise<{ ok: boolean; reason?: string }> {
    const failures: string[] = [];
    const stillCompleted: typeof this.completed = [];
    for (const item of orderForUndo(this.completed)) {
      const res = item.session.undo();
      if (!res.ok) {
        failures.push(`"${item.label}": ${res.reason ?? 'ukendt årsag'}`);
        stillCompleted.push(item);
      }
    }
    this.completed = stillCompleted;
    this.reportProgress();
    if (failures.length === 0) {
      // Mirrors InsertionSession's own idle+'undone' pattern (INST-09) so
      // the transport bar reflects reality — "Fortryd alle svar" removed
      // everything, so the panel must stop claiming the run is still done.
      this.state = 'idle';
      this.cb.onRunState('idle', 'undone');
      return { ok: true };
    }
    return { ok: false, reason: `Kunne ikke fjerne alle svar — ${failures.join('; ')}` };
  }

  destroy(): void {
    this.currentSession?.destroy();
    for (const item of this.completed) item.session.destroy();
    this.releaseResumeWaiters();
  }

  // ---- internals ----

  /** Resolves once a between-answers pause is lifted (by resume() or stop()). No-op if not paused. */
  private waitIfPausedBetween(): Promise<void> {
    if (!this.pausedBetween) return Promise.resolve();
    return new Promise((resolve) => this.resumeWaiters.push(resolve));
  }

  private releaseResumeWaiters(): void {
    const waiters = this.resumeWaiters;
    this.resumeWaiters = [];
    waiters.forEach((fn) => fn());
  }

  private async loop(): Promise<void> {
    // 'block' placement (D-02: no in-place mechanism available) composes
    // every answer into ONE session instead of locating each question —
    // still exactly one InsertionSession, still fully paced/pausable/
    // undoable, just carrying the whole run's text at once.
    if (this.source.placement === 'block') {
      await this.runBlockSession();
      return;
    }
    while (this.queueIndex < this.queue.length) {
      if (this.stopped) return;
      // Holds the queue for a pause pressed BETWEEN two answers (see
      // pause()) — never resolved for a pause pressed mid-session, which
      // InsertionSession itself already handles.
      await this.waitIfPausedBetween();
      if (this.stopped) return;
      const answer = this.queue[this.queueIndex];
      this.queueIndex += 1;

      // D-03: locate() runs HERE, immediately before this answer is
      // written, against the document as it is right now — never resolved
      // for the whole queue up front.
      const target = await this.source.locate({
        paragraphIndex: answer.paragraphIndex,
        questionText: answer.questionText,
        ...(answer.answerAt !== undefined ? { answerAt: answer.answerAt } : {}),
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
      // never appended onto the question's own line. Inside an answer box
      // the caret already stands where the answer starts, so no newline.
      const lead = target.inBox ? '' : '\n';
      const text = `${lead}${answer.answer}`;
      // The formatted form, for an editor that can type formatting (Google
      // Docs). Same leading newline, so the two never disagree about where the
      // answer starts.
      const markdown = answer.markdown ? `${lead}${answer.markdown}` : undefined;

      const session = new InsertionSession(adapter, text, this.pacing, {
        onState: (state, detail) => {
          if (state === 'paused') {
            // A trusted keystroke mid-run reports detail === 'user-typing'
            // (INST-12) — forwarded verbatim, never reworded, so the WHOLE
            // run pauses with that exact reason (D-13). An explicit pause()
            // call reports no detail at all; both land here identically,
            // and the awaited runOneSession() promise below stays pending
            // either way — the queue genuinely cannot advance until resume().
            this.state = 'paused';
            this.cb.onRunState('paused', detail); // detail is undefined or 'user-typing'
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
            this.completed.push({ session, label: answer.questionText });
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
      }, { markdown, startInList: target.inList });

      this.currentSession = session;
      if (this.mode === 'instant') session.insertInstant();
      else session.start();
    });
  }

  /**
   * D-02's block composition, driven as exactly ONE InsertionSession
   * (07-05-PLAN.md task 3: "the orchestrator's block branch produces exactly
   * one InsertionSession for the whole run"). `locate()` is called once, with
   * placeholder arguments a block-placement source (GDocsPasteSource) ignores
   * by contract — it returns "wherever the cursor already is" regardless of
   * what is passed in.
   */
  private runBlockSession(): Promise<void> {
    return new Promise((resolve) => {
      void (async () => {
        const target = await this.source.locate({ paragraphIndex: 0, questionText: '' });
        if (!target) {
          this.state = 'error';
          this.cb.onRunState(
            'error',
            this.source.lastLocateReason?.() || 'Der blev ikke fundet et sted at indsætte svarene.',
          );
          resolve();
          return;
        }

        const adapter = adapterFor(target);
        const text = composeBlockText(this.queue);

        const session = new InsertionSession(adapter, text, this.pacing, {
          onState: (state, detail) => {
            if (state === 'paused') {
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
              this.completed.push({ session, label: 'hele blokken' });
              this.currentSession = null;
              // One session covers the whole queue — report it as fully done
              // in one step rather than leaving answersDone at 0 (D-15: one
              // run, one undo, whatever the placement).
              this.reportProgress(0, 0, this.queue.length, this.queue.length);
              this.state = 'done';
              this.cb.onRunState('done');
              resolve();
              return;
            }
            if (state === 'error') {
              this.currentSession = null;
              this.state = 'error';
              this.cb.onRunState('error', detail);
              resolve();
              return;
            }
            if (state === 'stopped') {
              this.currentSession = null;
              this.state = 'stopped';
              this.cb.onRunState('stopped');
              resolve();
            }
          },
          onProgress: (inserted, total) => this.reportProgress(inserted, total),
        });

        this.currentSession = session;
        if (this.mode === 'instant') session.insertInstant();
        else session.start();
      })();
    });
  }

  private reportProgress(charsInAnswer = 0, charsTotal = 0, answersDoneOverride?: number, answersTotalOverride?: number): void {
    this.cb.onProgress({
      answersDone: answersDoneOverride ?? this.completed.length,
      answersTotal: answersTotalOverride ?? this.queue.length,
      charsInAnswer,
      charsTotal,
    });
  }
}
