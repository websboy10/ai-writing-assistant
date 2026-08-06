import { defineConfig } from 'wxt';
import tailwindcss from '@tailwindcss/vite';

export default defineConfig({
  modules: ['@wxt-dev/module-react'],
  vite: () => ({
    plugins: [tailwindcss()],
  }),
  manifest: {
    name: 'AI Skriveassistent',
    description: 'AI-skriveassistent med styrbar indsættelse direkte i det tekstfelt, du allerede skriver i.',
    version: '0.1.0',
    // No 'tabs' permission: tabs.query/sendMessage work without it (only URL/
    // title access needs it) and captureVisibleTab is covered by activeTab —
    // requesting it would only add a store-review warning surface (WR-17).
    permissions: ['storage', 'activeTab', 'clipboardWrite', 'identity'],
    // Universal insertion is the product's single purpose; the backend origin
    // is needed for API/SSE. Narrow-permission rationale lives in PRIVACY.md.
    host_permissions: [
      '<all_urls>',
      'https://ai-skriveassistent-api.vercel.app/*',
      'http://localhost:8787/*',
      'http://127.0.0.1:8787/*',
    ],
    commands: {
      'toggle-sidebar': {
        suggested_key: { default: 'Alt+Shift+A' },
        description: 'Åbn/luk AI Skriveassistenten',
      },
    },
    action: { default_title: 'AI Skriveassistent' },
  },
});
