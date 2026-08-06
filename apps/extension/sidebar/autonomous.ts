import type { AutonomousRequest, AutonomousResponse } from '@awa/shared';
import { AutonomousRun, sourceFor, type RunCallbacks } from '@/insertion';
import { call } from './api';
import { inserter } from './inserter';
import { useStore } from './store';

/**
 * Bridges the panel and the autonomous run engine — mirrors inserter.ts's
 * shape: a small class with a module-level singleton, direct function
 * calls, no messaging (both live in the content script).
 *
 * `active` lives on THIS singleton, not in React state (D-14) — collapsing
 * the sidebar unmounts ChatView/AutoRunBar, but this module keeps running,
 * so a Langsomt run is untouched by the panel closing.
 */
class Autonomous {
  private active: AutonomousRun | null = null;
  // The panel shows "Skriver" and a live Pause button the instant run() is
  // called, but the /api/autonomous/answer call it awaits first (~20-25s)
  // has no AutonomousRun to pause yet — this.active still points at the
  // PREVIOUS run, if any. Without this flag, a pause pressed during that
  // window is a silent no-op (AUTO-17): forbidden. Remembered here and
  // applied the instant the new run object exists.
  private loadingRun = false;
  private pauseRequestedWhileLoading = false;

  async run(scope: 'document' | 'selection', mode: 'instant' | 'progressive'): Promise<void> {
    const store = useStore.getState();
    const target = inserter.target();
    if (!target) {
      store.set({
        error:
          'Intet tekstfelt valgt på siden. Klik i det felt eller dokument, spørgsmålene skal besvares i.',
      });
      return;
    }

    let source: ReturnType<typeof sourceFor>;
    try {
      source = sourceFor(target, scope);
    } catch (err) {
      store.set({ error: err instanceof Error ? err.message : 'Kunne ikke læse spørgsmål fra dette felt.' });
      return;
    }

    const paragraphs = await source.read();
    if (paragraphs.length === 0) {
      store.set({ notice: 'Der blev ikke fundet nogen tekst at besvare i det valgte felt.' });
      return;
    }

    const body: AutonomousRequest = {
      scope,
      paragraphs,
      context: useStore.getState().context.length ? useStore.getState().context : undefined,
      prefs: useStore.getState().prefs,
    };

    useStore.getState().set({
      error: null,
      notice: null,
      autoRun: {
        state: 'writing',
        answersDone: 0,
        answersTotal: 0,
        progress: 0,
        targetLabel: target.label,
        placement: source.placement,
        degradedReason: source.degradedReason,
        unplaced: [],
        ungrounded: [],
      },
    });

    this.loadingRun = true;
    this.pauseRequestedWhileLoading = false;
    const res = await call({ kind: 'api', path: '/api/autonomous/answer', method: 'POST', body });
    if (!res.ok) {
      this.loadingRun = false;
      useStore.getState().set({ autoRun: null, error: res.error ?? 'Autonom besvarelse fejlede.' });
      return;
    }

    const data = res.data as AutonomousResponse;
    if (!data || data.detected === 0) {
      this.loadingRun = false;
      useStore.getState().set({ autoRun: null, notice: 'Der blev ikke fundet nogen spørgsmål i denne tekst.' });
      return;
    }
    if (!data.answers || data.answers.length === 0) {
      this.loadingRun = false;
      useStore.getState().set({
        autoRun: null,
        notice: `${data.detected} spørgsmål blev fundet, men ingen kunne besvares lige nu. Prøv igen.`,
      });
      return;
    }

    const ungrounded = data.answers.filter((a) => !a.grounded).map((a) => a.questionText);

    const cb: RunCallbacks = {
      onRunState: (state, detail) => {
        const s = useStore.getState();
        if (!s.autoRun) return;
        s.set({ autoRun: { ...s.autoRun, state, detail } });
        // AUTO-17: a run that dies mid-flight must not just say "fejl" and
        // strand the rest — the same courtesy inserter.ts's onState error
        // handler already extends on a failed manual insert.
        if (state === 'error') {
          const left = this.active?.remaining() ?? [];
          if (left.length) {
            const text = left.map((a) => `${a.questionText}\n${a.answer}`).join('\n\n');
            void navigator.clipboard.writeText(text).catch(() => {});
          }
          useStore.getState().set({
            error:
              `${detail ?? 'Den automatiske besvarelse fejlede.'}` +
              (left.length ? ` De resterende ${left.length} svar er kopieret til udklipsholderen.` : ''),
          });
        }
      },
      onProgress: (p) => {
        const s = useStore.getState();
        if (!s.autoRun) return;
        s.set({
          autoRun: {
            ...s.autoRun,
            answersDone: p.answersDone,
            answersTotal: p.answersTotal,
            progress: p.answersTotal === 0 ? 0 : p.answersDone / p.answersTotal,
          },
        });
      },
      onUnplaced: (q) => {
        const s = useStore.getState();
        if (!s.autoRun) return;
        s.set({ autoRun: { ...s.autoRun, unplaced: [...s.autoRun.unplaced, q] } });
      },
    };

    this.active?.destroy();
    this.active = new AutonomousRun(source, data.answers, mode, cb);
    this.loadingRun = false;
    // A pause that arrived while we were still awaiting the answer batch
    // (see the loadingRun comment above) must hold the run from its very
    // first answer, not write one first and only then notice.
    const startPaused = this.pauseRequestedWhileLoading;
    this.pauseRequestedWhileLoading = false;

    useStore.getState().set({
      autoRun: {
        state: startPaused ? 'paused' : 'writing',
        answersDone: 0,
        answersTotal: data.answers.length,
        progress: 0,
        targetLabel: target.label,
        placement: source.placement,
        degradedReason: source.degradedReason,
        unplaced: [],
        ungrounded,
      },
    });

    await this.active.start(startPaused);
  }

  pause(): void {
    if (this.loadingRun) {
      this.pauseRequestedWhileLoading = true;
      return;
    }
    this.active?.pause();
  }
  resume(): void {
    this.active?.resume();
  }
  stop(): void {
    this.active?.stop();
  }
  undo(): void {
    const res = this.active?.undo();
    if (res && !res.ok) {
      useStore.getState().set({ error: res.reason ?? 'Fortryd fejlede.' });
    }
  }
  dismiss(): void {
    this.active?.destroy();
    this.active = null;
    useStore.getState().set({ autoRun: null });
  }
}

export const autonomous = new Autonomous();
