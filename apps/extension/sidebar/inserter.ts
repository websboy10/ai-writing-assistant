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

  selectionText(): string {
    return this.tracker?.selectionText() ?? '';
  }

  /** INST-13: on Docs, self-test before promising anything. */
  targetStatus(): { label: string; ok: boolean; reason?: string } | null {
    if (isGoogleDocs()) {
      const test = GDocsAdapter.selfTest();
      return { label: 'Google Docs document', ok: test.ok, reason: test.reason };
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
          'No editor selected on the page. Click into the text field or document where the text should go, then press Insert.',
      });
      return;
    }

    this.session?.destroy();
    const adapter = adapterFor(target);
    const unverified = adapter.kind === 'gdocs';

    this.session = new InsertionSession(adapter, text, store.pacing, {
      onState: (state, detail) => {
        const s = useStore.getState();
        if (state === 'error') {
          s.set({
            insertStatus: null,
            error: `${detail ?? 'Insertion failed.'} The text is still in the sidebar — use Copy as a fallback.`,
          });
          void navigator.clipboard.writeText(text).catch(() => {});
          return;
        }
        s.set({
          insertStatus: {
            state,
            detail:
              detail === 'user-typing'
                ? 'Paused — you started typing. Resume when ready.'
                : detail === 'undone'
                  ? 'Insertion undone.'
                  : undefined,
            progress: state === 'done' ? 1 : (s.insertStatus?.progress ?? 0),
            targetLabel: target.label,
            unverified,
          },
          ...(state === 'done' && unverified
            ? { notice: 'Sent to Google Docs. Docs cannot confirm receipt — check the document.' }
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
      useStore.getState().set({ error: res.reason ?? 'Undo failed.' });
    }
  }
  dismiss(): void {
    this.session?.destroy();
    this.session = null;
    useStore.getState().set({ insertStatus: null });
  }
}

export const inserter = new Inserter();
