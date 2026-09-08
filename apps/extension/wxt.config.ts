import { defineConfig } from 'wxt';
import tailwindcss from '@tailwindcss/vite';

// Localhost is only reachable by a build that actually points at localhost.
// A store package that carries http://localhost host permissions it never uses
// is unjustifiable permission surface in review — and the reviewer cannot see
// the build flag, only the manifest. Tracks VITE_BACKEND_URL, the same switch
// that decides the backend origin in utils/protocol.ts.
const backendUrl = process.env.VITE_BACKEND_URL ?? '';
const isLocalBackend = /localhost|127\.0\.0\.1/.test(backendUrl);

// Set by `pnpm zip:store`. The only thing it changes is the manifest `key`
// below, which the Chrome Web Store rejects outright.
const isStoreBuild = process.env.AWA_STORE_BUILD === '1';

/**
 * "Besvar alle spørgsmål" is finished and proven against real documents, and it
 * is deliberately NOT in the store build yet (operator's call, 2026-09-08): it
 * is the least settled of the three features and is still being improved, so it
 * should not be what a reviewer or a new user meets first.
 *
 * Held back with a flag rather than by reverting the code, because reverting
 * would throw away work that is measured and working, and re-applying it later
 * is where the mistakes get made. `pnpm zip:store` sets AWA_STORE_BUILD, so the
 * package that goes to the store has no entry point to the feature; every other
 * build keeps it, which is what development and the verify scripts run against.
 *
 * The trade is stated plainly: the shipped package is therefore NOT byte-identical
 * to the one the verify scripts drove. Everything else in it is, and the
 * difference is exactly one hidden button.
 */
const answerAllEnabled = !isStoreBuild;

export default defineConfig({
  modules: ['@wxt-dev/module-react'],
  vite: () => ({
    plugins: [tailwindcss()],
    define: {
      __AWA_ANSWER_ALL__: JSON.stringify(answerAllEnabled),
    },
  }),
  manifest: {
    name: 'ChatBot Skriv',
    description: 'AI-skriveassistent med styrbar indsættelse direkte i det tekstfelt, du allerede skriver i.',
    version: '0.2.0',
    // Pins the extension ID to foidkbeinmfolejjjfjcokmmknimohof for LOCAL
    // installs. Without it Chrome derives a different ID on every unpacked
    // install, and both the Google OAuth client and Supabase's redirect
    // allow-list must name one exact address (https://<id>.chromiumapp.org/).
    // An ID that moves makes Google sign-in unconfigurable, which is what
    // stalled SETUP.md Job 4.
    //
    // BUT THE CHROME WEB STORE REFUSES IT. Measured on upload 2026-09-04:
    // "Feltet key er ikke tilladt i manifestet." The store assigns the item's
    // ID itself and rejects a package that tries to claim one. So the key is
    // omitted whenever AWA_STORE_BUILD is set, which is exactly what
    // `pnpm zip:store` does — and nothing else changes between the two builds.
    //
    // CONSEQUENCE, and it is not optional: the published extension gets a
    // DIFFERENT id from the local one, so after the first upload the store's
    // id must be added to Supabase's redirect allow-list and to the Google
    // OAuth client, or Google sign-in is broken for every store install.
    // docs/GOOGLE-SETUP.md carries the steps.
    ...(isStoreBuild
      ? {}
      : {
          key: 'MIIBIjANBgkqhkiG9w0BAQEFAAOCAQ8AMIIBCgKCAQEA1wgQoLfkhlhucd10O3P10aa28um16IBOB9tjzwnUxGNq9G4CIt5qvchs+0zOegtGrJSZ+zuYionyRHSKWxxf+ozPOFNjdc5yydD0KbHs9Z8XcntYFIReWfj3x5b5za6x8p9FXKLlcywHgk/fxPMmi2Gx22x03++pCCqtaxQ6LrITV3X6NZdRqNyezbYclpFWOxG6ZCtyhDxSVnt6I6OXfoEOuUintNXCenjnEiujhFyebJEhfIKhPoDBxOi3NDDPPG+dMfn2lutUIdUtSDEPbrodrCy5TaPg3OAxjT2aDqQNM3DEbpgMzH9Wzs0buciGvzt1/WX2LsHCkh4w4P12OQIDAQAB',
        }),
    // No 'tabs' permission: tabs.query/sendMessage work without it (only URL/
    // title access needs it) and captureVisibleTab is covered by activeTab —
    // requesting it would only add a store-review warning surface (WR-17).
    permissions: ['storage', 'activeTab', 'clipboardWrite', 'identity'],
    // Universal insertion is the product's single purpose; the backend origin
    // is needed for API/SSE. Narrow-permission rationale lives in PRIVACY.md.
    host_permissions: [
      '<all_urls>',
      'https://ai-skriveassistent-api.vercel.app/*',
      ...(isLocalBackend ? ['http://localhost:8787/*', 'http://127.0.0.1:8787/*'] : []),
    ],
    commands: {
      'toggle-sidebar': {
        suggested_key: { default: 'Alt+Shift+A' },
        description: 'Åbn/luk ChatBot Skriv',
      },
    },
    action: { default_title: 'ChatBot Skriv' },
  },
});
