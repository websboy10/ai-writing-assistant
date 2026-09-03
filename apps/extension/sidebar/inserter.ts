import {
  adapterFor,
  GDocsAdapter,
  InsertionSession,
  isGoogleDocs,
  TargetTracker,
  type SavedTarget,
} from '@/insertion';
import { useStore } from './store';

/**
 * Bridges the sidebar UI and the insertion engine. Both live in the content
 * script context, so this is direct function calls — no messaging, no
 * serialization, no service-worker lifetime risk in the write path.
 */
class Inserter {
  tracker: TargetTracker | null = null;
  private session: InsertionSession | null = null;

  init(shadowHost: () => Element | null): void {
    // SPA remounts call init() again — the old tracker's document-level
    // capture listeners would otherwise accumulate for the page's lifetime.
    this.tracker?.destroy();
    this.tracker = new TargetTracker(shadowHost);
  }

  target(): SavedTarget | null {
    return this.tracker?.get() ?? null;
  }

  /** INST-13: on Docs, self-test before promising anything. */
  targetStatus(): { label: string; ok: boolean; reason?: string } | null {
    if (isGoogleDocs()) {
      const test = GDocsAdapter.selfTest();
      return { label: 'Google Docs-dokument', ok: test.ok, reason: test.reason };
    }
    const t = this.target();
    if (!t) return null;
    return { label: t.label, ok: true };
  }

  start(text: string, mode: 'instant' | 'progressive'): void {
    const store = useStore.getState();
    const target = this.target();
    if (!target) {
      store.set({
        error:
          'Intet tekstfelt valgt på siden. Klik i det felt eller dokument, teksten skal ind i, og tryk så på Indsæt.',
      });
      return;
    }

    this.session?.destroy();
    const adapter = adapterFor(target);
    const unverified = adapter.kind === 'gdocs';

    // Marked text is never replaced — the answer lands on a new line BELOW it
    // (the adapters collapse the caret to the selection's end).
    const hasSelection =
      target.kind === 'gdocs'
        ? GDocsAdapter.hasSelection()
        : target.kind === 'plain'
          ? (target.selEnd ?? 0) > (target.selStart ?? 0)
          : !!target.range && !target.range.collapsed;
    const finalText = hasSelection ? `\n${text}` : text;

    this.session = new InsertionSession(adapter, finalText, store.pacing, {
      onState: (state, detail) => {
        const s = useStore.getState();
        if (state === 'error') {
          s.set({
            insertStatus: null,
            error: `${detail ?? 'Indsættelsen fejlede.'} Teksten er stadig i panelet — brug Kopiér i stedet.`,
          });
          void navigator.clipboard.writeText(text).catch(() => {});
          return;
        }
        s.set({
          insertStatus: {
            state,
            detail:
              detail === 'user-typing'
                ? 'På pause — du begyndte at skrive. Fortsæt når du er klar.'
                : detail === 'undone'
                  ? 'Indsættelsen er fortrudt.'
                  : undefined,
            progress: state === 'done' ? 1 : (s.insertStatus?.progress ?? 0),
            targetLabel: target.label,
            unverified,
          },
          ...(state === 'done' && unverified
            ? { notice: 'Sendt til Google Docs. Docs kan ikke bekræfte modtagelsen — tjek dokumentet.' }
            : {}),
        });
      },
      onProgress: (inserted, total) => {
        const s = useStore.getState();
        s.set({
          insertStatus: {
            ...(s.insertStatus ?? { state: 'running' as const }),
            state: s.insertStatus?.state ?? 'running',
            progress: total === 0 ? 1 : inserted / total,
            targetLabel: target.label,
            unverified,
          },
        });
      },
    });

    if (mode === 'instant') this.session.insertInstant();
    else this.session.start();
  }

  pause(): void {
    this.session?.pause();
  }
  resume(): void {
    this.session?.resume();
  }
  stop(): void {
    this.session?.stop();
  }
  undo(): void {
    const res = this.session?.undo();
    if (res && !res.ok) {
      useStore.getState().set({ error: res.reason ?? 'Fortryd fejlede.' });
    }
  }
  dismiss(): void {
    this.session?.destroy();
    this.session = null;
    useStore.getState().set({ insertStatus: null });
  }
}

export const inserter = new Inserter();
