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

/**
 * The whitespace probe — the open defect where slow-typed text arrives on
 * Docs with its spaces gone ("detterikke"), and every Docs write path
 * inherits it.
 *
 * It is a probe and not a fix on purpose. Three fixes for the Docs adapter
 * have already been written from reasoning rather than observation, and all
 * three were wrong; the note in adapters/gdocs.ts about never reintroducing a
 * success check "from reasoning, only from a signal actually observed" applies
 * to this defect just as much. So this writes the SAME string three different
 * ways and lets the document say which one survives:
 *
 *   P-A  one single paste of the whole string — the control. Straks uses this.
 *   P-B  letter by letter with the space LEADING its letter (" B"), which is
 *        exactly what chunkText() produces today, and what Langsomt sends.
 *   P-C  letter by letter with the space as its OWN chunk (" ").
 *
 * Reading the result back through the Docs API rather than looking at the
 * screen matters: the adapter cannot verify its own writes (canvas), and a
 * space is precisely the character a person cannot reliably count by eye.
 *
 * What each outcome means, decided before the run so the answer can't be read
 * to suit a preferred fix:
 *   A keeps spaces, B loses them  → Docs trims each individual paste. Chunk
 *                                   Docs differently; do not touch the engine.
 *   A and B both keep them        → the defect is not in this channel at all.
 *   C keeps them, B does not      → send whitespace as its own chunk on Docs.
 *   nothing keeps them            → not trimming; stop and re-investigate.
 */
interface DocsSpaceProbeMsg {
  type: 'awa-docs-space-probe';
}

function isDocsSpaceProbeMsg(msg: unknown): msg is DocsSpaceProbeMsg {
  return !!msg && typeof msg === 'object' && (msg as { type?: unknown }).type === 'awa-docs-space-probe';
}

const SPACE_PROBE_TEXT = 'A B C';

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

/**
 * Docs throws a synthetic paste away when its hidden input frame is not
 * focused, and every signal we have still reports success — measured
 * 2026-08-17: chunks 0-4 of a probe run vanished with `notCancelled: true`
 * on each, and only the chunks written after the operator clicked into the
 * document survived. The probe is driven from the spike page in another tab,
 * so this is its default state, not an edge case.
 *
 * A run that writes some chunks unfocused produces data indistinguishable
 * from trimming — the exact wrong answer the probe exists to prevent.
 */
function docsFrameHasFocus(): boolean {
  if (!document.hasFocus()) return false;
  const frame = document.querySelector<HTMLIFrameElement>('iframe.docs-texteventtarget-iframe');
  try {
    return frame?.contentDocument?.hasFocus() ?? false;
  } catch {
    return false;
  }
}

const FOCUS_HINT =
  'Dokumentet havde ikke tastatur-fokus, og Docs smider indsættelser væk i den tilstand — uden at sige det. Klik ind i dokumentet, så det har markøren, og lad det blive liggende øverst mens prøven kører.';

async function runDocsSpaceProbe(): Promise<{ ok: boolean; stage?: string; reason?: string }> {
  const adapter = new GDocsAdapter();
  const prep = adapter.prepare();
  if (!prep.ok) return { ok: false, stage: 'prepare', reason: prep.reason };

  // prepare() asks the frame for focus but cannot make a background tab
  // active, and focus does not settle synchronously even when it can.
  for (let i = 0; i < 20 && !docsFrameHasFocus(); i++) await sleep(100);
  if (!docsFrameHasFocus()) return { ok: false, stage: 'fokus', reason: FOCUS_HINT };

  // Each variant sends its own marker first, as one paste, so the read-back
  // can find it however badly the payload after it is mangled.
  const variants: { marker: string; chunks: string[] }[] = [
    { marker: '⟪AWA-SP-A⟫', chunks: [SPACE_PROBE_TEXT] },
    { marker: '⟪AWA-SP-B⟫', chunks: ['A', ' B', ' C'] },
    { marker: '⟪AWA-SP-C⟫', chunks: ['A', ' ', 'B', ' ', 'C'] },
    // 2026-08-17: A survived with its spaces, B and C lost theirs — so Docs
    // trims each paste and only interior whitespace lives. B and C both put
    // the space at the FRONT of a chunk; nothing has tested the end, and that
    // decides whether any chunked path can keep a space at all (D) or whether
    // a character Docs does not treat as trimmable is needed (E, F).
    // Distinct letters per variant, because the markers themselves do not
    // survive the write: the run-on result has to identify its own variants.
    { marker: '⟪AWA-SP-D⟫', chunks: ['D ', 'E ', 'F'] },
    { marker: '⟪AWA-SP-E⟫', chunks: ['G\u00A0', 'H\u00A0', 'I'] },
    { marker: '⟪AWA-SP-F⟫', chunks: ['J', '\u00A0K', '\u00A0L'] },
  ];

  for (const v of variants) {
    // A newline first: each variant needs its own paragraph, or the read-back
    // cannot tell where one ends and the next begins.
    const head = adapter.insert(`\n${v.marker}`);
    if (!head.ok) return { ok: false, stage: `marker ${v.marker}`, reason: head.reason };
    for (const chunk of v.chunks) {
      // Re-checked per chunk, not just at the start: focus lost halfway
      // through is what produced the contaminated 2026-08-17 run, where two
      // variants were silently written into nothing and the third survived.
      if (!docsFrameHasFocus()) return { ok: false, stage: `fokus (ved "${chunk}" i ${v.marker})`, reason: FOCUS_HINT };
      const res = adapter.insert(chunk);
      if (!res.ok) return { ok: false, stage: `chunk "${chunk}" of ${v.marker}`, reason: res.reason };
      // Docs applies pastes on its own schedule (echoesAsync); at full speed
      // the variants can interleave and the read-back would be measuring the
      // race instead of the trimming.
      await sleep(120);
    }
    await sleep(400);
  }
  return { ok: true };
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

      chrome.runtime.onMessage.addListener((msg: unknown, _sender, sendResponse) => {
        if (!isDocsSpaceProbeMsg(msg)) return;
        void runDocsSpaceProbe().then(sendResponse);
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
