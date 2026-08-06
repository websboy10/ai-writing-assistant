import ReactDOM from 'react-dom/client';
import { App } from '@/sidebar/components/App';
import { inserter } from '@/sidebar/inserter';
import { findAndPlaceCursor } from '@/insertion/autonomous/docs-find';
import { GDocsAdapter } from '@/insertion/adapters/gdocs';
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
