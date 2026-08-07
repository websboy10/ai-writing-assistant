import ReactDOM from 'react-dom/client';
import type { AutonomousRequest, AutonomousResponse } from '@awa/shared';
import type { OneShotRequest, OneShotResponse } from '@/utils/protocol';
import { App } from '@/sidebar/components/App';
import { inserter } from '@/sidebar/inserter';
import { findAndPlaceCursor } from '@/insertion/autonomous/docs-find';
import { GDocsAdapter } from '@/insertion/adapters/gdocs';
import { resolveDocsSource } from '@/insertion/autonomous/docs-source';
import { AutonomousRun } from '@/insertion/autonomous/orchestrator';
import './style.css';

// Spike-only probe message (07-01, D-16a). The spike page
// (chrome-extension://<id>/spike.html) messages the Docs tab directly
// because Find + the paste mechanism can only run inside the page that
// owns the live cursor — a background service worker has no DOM to
// dispatch keyboard events into. Reused unmodified by plan 07-05's real
// autonomous-mode driver, just under a different trigger than this probe.
interface DocsSpikeProbeMsg {
  type: 'awa-docs-spike';
  questionText: string;
}

function isDocsSpikeProbeMsg(msg: unknown): msg is DocsSpikeProbeMsg {
  return !!msg && typeof msg === 'object' && (msg as { type?: unknown }).type === 'awa-docs-spike';
}

/**
 * 07-05's own diagnostic probe, added to this ALREADY-established
 * spike-message pattern (07-01) for the same reason: resolveDocsSource() and
 * AutonomousRun both need a live document's DOM, which only exists inside
 * this content script, never inside the spike page itself. This is "the
 * only automatable proof available for the Docs path" the plan asks for —
 * not a feature, and not linked from the sidebar UI.
 */
interface DocsFullTestMsg {
  type: 'awa-docs-full-test';
}

function isDocsFullTestMsg(msg: unknown): msg is DocsFullTestMsg {
  return !!msg && typeof msg === 'object' && (msg as { type?: unknown }).type === 'awa-docs-full-test';
}

interface DocsFullTestResult {
  ok: boolean;
  stage?: string;
  reason?: string;
  mechanism?: string;
  degradedReason?: string;
  detected?: number;
  placed?: number;
  unplaced?: number;
  elapsedMs?: number;
}

async function runDocsFullTest(): Promise<DocsFullTestResult> {
  const startedAt = Date.now();
  let source;
  try {
    source = await resolveDocsSource('document', 'instant');
  } catch (e) {
    return { ok: false, stage: 'resolve', reason: e instanceof Error ? e.message : String(e) };
  }
  // No degradedReason + in-place → the primary Find path was chosen live;
  // otherwise the report names which fallback and why (never silent).
  let mechanism: string;
  if (!source.degradedReason) {
    mechanism = 'GDocsFindSource (primær vej, Find virkede)';
  } else if (source.placement === 'in-place') {
    mechanism = 'GDocsApiWriteSource (API, bund-til-top)';
  } else {
    mechanism = 'blok-tilstand (GDocsPasteSource eller GDocsApiWriteSource-Langsomt)';
  }

  const paragraphs = await source.read();
  if (paragraphs.length === 0) {
    return {
      ok: true,
      mechanism,
      degradedReason: source.degradedReason,
      detected: 0,
      placed: 0,
      unplaced: 0,
      elapsedMs: Date.now() - startedAt,
    };
  }

  const body: AutonomousRequest = { scope: 'document', paragraphs };
  const req: OneShotRequest = { kind: 'api', path: '/api/autonomous/answer', method: 'POST', body };
  const res: OneShotResponse = await chrome.runtime.sendMessage(req);
  if (!res.ok) return { ok: false, stage: 'backend', reason: res.error };
  const data = res.data as AutonomousResponse;
  if (!data.answers || data.answers.length === 0) {
    return {
      ok: true,
      mechanism,
      degradedReason: source.degradedReason,
      detected: data.detected,
      placed: 0,
      unplaced: 0,
      elapsedMs: Date.now() - startedAt,
    };
  }

  let placed = 0;
  const unplacedQuestions: string[] = [];
  const run = new AutonomousRun(source, data.answers, 'instant', {
    onRunState: () => {},
    onProgress: (p) => {
      placed = p.answersDone;
    },
    onUnplaced: (q) => unplacedQuestions.push(q.questionText),
  });
  await run.start();

  return {
    ok: true,
    mechanism,
    degradedReason: source.degradedReason,
    detected: data.detected,
    placed,
    unplaced: unplacedQuestions.length,
    elapsedMs: Date.now() - startedAt,
  };
}

export default defineContentScript({
  matches: ['<all_urls>'],
  cssInjectionMode: 'ui',

  async main(ctx) {
    const ui = await createShadowRootUi(ctx, {
      name: 'awa-sidebar',
      position: 'inline',
      anchor: 'html',
      onMount(container) {
        // Target tracking must know our own host so clicks inside the sidebar
        // never overwrite the user's chosen insertion target.
        inserter.init(() => container.closest('awa-sidebar') ?? host());
        const root = ReactDOM.createRoot(container);
        root.render(<App />);
        return root;
      },
      onRemove(root) {
        root?.unmount();
      },
    });

    ui.mount();

    // Guarded to docs.google.com so this listener is a no-op everywhere
    // else the content script also runs (matches: <all_urls>).
    if (location.host === 'docs.google.com') {
      chrome.runtime.onMessage.addListener((msg: unknown, _sender, sendResponse) => {
        if (!isDocsSpikeProbeMsg(msg)) return;
        void (async () => {
          const find = await findAndPlaceCursor(msg.questionText);
          if (!find.ok) {
            sendResponse({ ok: false, stage: 'find', reason: find.reason });
            return;
          }
          const adapter = new GDocsAdapter();
          const prep = adapter.prepare();
          if (!prep.ok) {
            sendResponse({ ok: false, stage: 'prepare', reason: prep.reason });
            return;
          }
          const insertResult = adapter.insert('⟪AWA-SPIKE⟫');
          if (!insertResult.ok) {
            sendResponse({ ok: false, stage: 'insert', reason: insertResult.reason });
            return;
          }
          sendResponse({ ok: true });
        })();
        return true; // async response
      });

      chrome.runtime.onMessage.addListener((msg: unknown, _sender, sendResponse) => {
        if (!isDocsFullTestMsg(msg)) return;
        void runDocsFullTest().then(sendResponse);
        return true; // async response
      });
    }

    // SPA-navigation survival (SIDE-06): if a framework tears out our host
    // element during a route change, remount.
    const observer = new MutationObserver(() => {
      if (!host()) {
        observer.disconnect();
        // Re-arm even if mount throws — otherwise one failed recovery kills
        // sidebar recovery for the rest of the page's life.
        try {
          ui.mount();
        } finally {
          observe();
        }
      }
    });
    const observe = () =>
      observer.observe(document.documentElement, { childList: true, subtree: false });
    observe();

    function host(): Element | null {
      return document.querySelector('awa-sidebar');
    }
  },
});
