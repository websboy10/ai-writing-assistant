import ReactDOM from 'react-dom/client';
import { App } from '@/sidebar/components/App';
import { inserter } from '@/sidebar/inserter';
import './style.css';

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

    // SPA-navigation survival (SIDE-06): if a framework tears out our host
    // element during a route change, remount.
    const observer = new MutationObserver(() => {
      if (!host()) {
        observer.disconnect();
        ui.mount();
        observe();
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
