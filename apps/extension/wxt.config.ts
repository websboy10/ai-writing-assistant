import { defineConfig } from 'wxt';
import tailwindcss from '@tailwindcss/vite';

// Localhost is only reachable by a build that actually points at localhost.
// A store package that carries http://localhost host permissions it never uses
// is unjustifiable permission surface in review — and the reviewer cannot see
// the build flag, only the manifest. Tracks VITE_BACKEND_URL, the same switch
// that decides the backend origin in utils/protocol.ts.
const backendUrl = process.env.VITE_BACKEND_URL ?? '';
const isLocalBackend = /localhost|127\.0\.0\.1/.test(backendUrl);

// Second OAuth client (D-17): type "Chrome Extension", used only by
// chrome.identity.getAuthToken() for Docs API access. Separate from the
// "Web application" client from GOOGLE-SETUP.md Step 6, which powers
// Supabase sign-in via launchWebAuthFlow — the two are unrelated credentials
// serving unrelated code paths.
//
// Committed as a fallback, not left env-only: this ID is not a secret
// (Chrome Extension clients have none, and it ships inside this manifest,
// public either way — GOOGLE-SETUP.md Step 8). An .env-only value would
// build fine but silently produce a manifest with an empty client_id on any
// checkout or CI run lacking that dotfile, which is worse than shipping no
// oauth2 block at all — exactly the trap this comment exists to prevent.
const googleDocsClientId =
  process.env.VITE_GOOGLE_DOCS_CLIENT_ID ||
  '508090872713-v9u4q1seerj9ohlsqppfer80n0aatd0k.apps.googleusercontent.com';
// Must match DOCS_SCOPE in utils/protocol.ts. Exactly `documents` — never
// `drive` or `drive.file` (T-07-03).
const GOOGLE_DOCS_SCOPE = 'https://www.googleapis.com/auth/documents';

export default defineConfig({
  modules: ['@wxt-dev/module-react'],
  vite: () => ({
    plugins: [tailwindcss()],
  }),
  manifest: {
    name: 'AI Skriveassistent',
    description: 'AI-skriveassistent med styrbar indsættelse direkte i det tekstfelt, du allerede skriver i.',
    version: '0.1.0',
    // Pins the extension ID to foidkbeinmfolejjjfjcokmmknimohof. Without this,
    // Chrome derives a different ID on every unpacked install — and both the
    // Google OAuth client and Supabase's redirect allow-list must name one
    // exact address (https://<id>.chromiumapp.org/). An ID that moves makes
    // Google sign-in unconfigurable, which is what stalled SETUP.md Job 4.
    // The matching private key is NOT in this repo and is not needed to build;
    // it only signs a self-hosted .crx. See docs/GOOGLE-SETUP.md.
    key: 'MIIBIjANBgkqhkiG9w0BAQEFAAOCAQ8AMIIBCgKCAQEA1wgQoLfkhlhucd10O3P10aa28um16IBOB9tjzwnUxGNq9G4CIt5qvchs+0zOegtGrJSZ+zuYionyRHSKWxxf+ozPOFNjdc5yydD0KbHs9Z8XcntYFIReWfj3x5b5za6x8p9FXKLlcywHgk/fxPMmi2Gx22x03++pCCqtaxQ6LrITV3X6NZdRqNyezbYclpFWOxG6ZCtyhDxSVnt6I6OXfoEOuUintNXCenjnEiujhFyebJEhfIKhPoDBxOi3NDDPPG+dMfn2lutUIdUtSDEPbrodrCy5TaPg3OAxjT2aDqQNM3DEbpgMzH9Wzs0buciGvzt1/WX2LsHCkh4w4P12OQIDAQAB',
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
        description: 'Åbn/luk AI Skriveassistenten',
      },
    },
    action: { default_title: 'AI Skriveassistent' },
    // Empty client_id is worse than no oauth2 block at all (never lets Chrome
    // silently probe with a blank credential) — same conditional-spread
    // pattern as host_permissions above.
    ...(googleDocsClientId
      ? { oauth2: { client_id: googleDocsClientId, scopes: [GOOGLE_DOCS_SCOPE] } }
      : {}),
  },
});
