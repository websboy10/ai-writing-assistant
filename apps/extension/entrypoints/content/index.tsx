import ReactDOM from 'react-dom/client';
import { App } from '@/sidebar/components/App';
import { inserter } from '@/sidebar/inserter';
import './style.css';

export default defineContentScript({
  matches: ['<all_urls>'],
  cssInjectionMode: 'ui',

  async main(ctx) {
    // An invitation link lands on our own site, and this script is the one
    // piece of the extension that can see that page. The landing page keeps
    // the code in localStorage, so it is still here on a visit after the
    // install; the panel redeems it at the next sign-in (sidebar/store.ts).
    if (/^(www\.)?chatbotskriv\.dk$/.test(location.hostname)) {
      const code = new URLSearchParams(location.search).get('r') ?? localStorage.getItem('awa_ref');
      if (code && /^[A-Za-z0-9]{4,12}$/.test(code)) void chrome.storage.local.set({ pendingReferral: code });
    }

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
