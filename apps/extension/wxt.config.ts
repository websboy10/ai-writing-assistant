import { defineConfig } from 'wxt';
import tailwindcss from '@tailwindcss/vite';

export default defineConfig({
  modules: ['@wxt-dev/module-react'],
  vite: () => ({
    plugins: [tailwindcss()],
  }),
  manifest: {
    name: 'AI Writing Assistant',
    description: 'AI writing assistant with controllable insertion into the editor you are already in.',
    version: '0.1.0',
    permissions: ['storage', 'activeTab', 'clipboardWrite', 'tabs', 'identity'],
    // Universal insertion is the product's single purpose; the backend origin
    // is needed for API/SSE. Narrow-permission rationale lives in PRIVACY.md.
    host_permissions: ['<all_urls>', 'http://localhost:8787/*', 'http://127.0.0.1:8787/*'],
    commands: {
      'toggle-sidebar': {
        suggested_key: { default: 'Alt+Shift+A' },
        description: 'Toggle the AI Writing Assistant sidebar',
      },
    },
    action: { default_title: 'AI Writing Assistant' },
  },
});
