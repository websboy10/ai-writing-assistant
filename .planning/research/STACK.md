# Stack Research

**Domain:** Chrome MV3 AI writing-assistant extension (React sidebar + hosted Node/LLM-proxy backend)
**Researched:** 2026-08-05
**Confidence:** MEDIUM-HIGH (core framework and pooling findings verified against multiple current sources; a few items — WXT side panel maturity, OCR approach — carry explicit caveats below)

## Recommended Stack

### Core Technologies

| Technology | Version | Purpose | Why Recommended |
|------------|---------|---------|-----------------|
| **WXT** | `0.20.x` (latest `0.20.27`, actively released) | Extension build framework (wraps Vite) | Purpose-built for MV3, file-based entrypoints (background/content/sidepanel/popup/options), auto-manifest generation, HMR for content scripts and side panels, first-class React module (`@wxt-dev/module-react`). Actively maintained through 2026 with weekly-ish releases. This is the single highest-leverage decision in the stack — see "What NOT to Use" for why the two obvious alternatives are wrong now. |
| **React 19** | `19.x` | Sidebar UI, popup, options page | Already locked by operator. Works cleanly inside a WXT entrypoint or inside a shadow-DOM-mounted content script UI (`createShadowRootUi` helper WXT provides for exactly this). |
| **TypeScript** | `5.6+` | Type safety across extension + backend | Already locked. Share a `packages/shared` types package between extension and backend in the monorepo (matches the spec's `shared/types` folder). |
| **Vite** | `6.x` (bundled/managed by WXT — do not hand-pin a conflicting version) | Bundler underlying WXT | Already locked by operator; WXT is the correct integration layer, not a raw hand-rolled `vite.config.ts` with `@crxjs/vite-plugin` (see alternatives). |
| **Tailwind CSS** | `4.x` | Styling | Already locked. Inside a shadow DOM you must inject Tailwind's generated stylesheet into the shadow root explicitly (WXT's `createShadowRootUi` supports this via `css` option) — Tailwind's utility classes do not leak, but they also don't apply automatically outside the shadow root. |
| **Node.js** | `22 LTS` or `24` (Vercel default) | Backend runtime | Vercel's current default for new projects is Node 24.x; Node 22 LTS is fully supported. Node 20 is deprecated on Vercel from Oct 1, 2026 — do not target it. The OpenRouter AI SDK provider (`@openrouter/ai-sdk-provider@2.x`) requires Node ≥22, which lines up. |
| **Fastify** | `5.x` | Backend HTTP framework, mounted as a single Vercel Function | Smallest framework that gives you real request/response ergonomics, first-class streaming, and a documented, current, zero-config Vercel deployment path (`vercel.com/docs/frameworks/backend/fastify`, updated 2026). NestJS's DI/module ceremony buys nothing for a proxy-plus-upload service and adds cold-start weight; Next.js route handlers would drag in a whole page-rendering framework you don't need since the frontend is the extension, not a website. |
| **Vercel AI SDK (`ai`)** | `^7.x` (peer requirement of `@openrouter/ai-sdk-provider@2.10.0`) | Streaming abstraction over LLM calls | `streamText()` gives you SSE-compatible streaming, cancellation, and a provider-agnostic interface — exactly the "provider abstraction" the project already requires. This is the layer that makes "swap the model in config" true in practice, not just in principle. |
| **`@openrouter/ai-sdk-provider`** | `2.10.0` (latest, ESM-only, requires `ai@^7.0.0` and Node ≥22) | OpenRouter integration for the AI SDK | Official OpenRouter-maintained package (not a community guess), gives access to OpenRouter's full model catalog including `:free`-suffixed models through the same `streamText` call as any other AI SDK provider. |
| **PostgreSQL + Prisma** | Prisma `6.x` | Database + ORM | Already locked. See the dedicated pooling section below — this is the one place a wrong default silently breaks production. |
| **Supabase** | current SaaS (no self-pinned version) | Auth (email/password + Google OAuth), Postgres hosting, file storage | Already locked. |

### Supporting Libraries

| Library | Version | Purpose | When to Use |
|---------|---------|---------|-------------|
| `@wxt-dev/module-react` | latest matching WXT | React integration for WXT entrypoints | Every React entrypoint (sidebar UI, popup, options). |
| `pdf.js` (`pdfjs-dist`) | `4.x` | PDF text extraction | **Run this on the backend (Node), not in the extension.** See Document Parsing section — MV3's CSP and worker restrictions make client-side pdf.js viable but needlessly fragile when a backend already exists for every AI call. |
| `mammoth` | `1.x` | DOCX → text/HTML extraction | Also run on the backend for the same reason: it's pure JS (no eval/wasm), works identically in Node, and keeping all parsing server-side means one code path instead of two. |
| `tesseract.js` | `6.x` (Node build, e.g. `tesseract.js-node`, or plain `tesseract.js` running under Node) | OCR for screenshots/images | **Server-side only — do not attempt this in the MV3 extension.** See Document Parsing section for why the client-side path is a known, repeatedly-reported dead end. |
| `zod` | `3.x` / `4.x` | Runtime validation of request bodies, prompt-assembly sections, provider config | Validate everything crossing the extension↔backend boundary; also useful for validating the AI SDK's structured tool/output schemas if you add them later. |
| `@fastify/multipart` | `9.x` | File upload handling in Fastify | Needed the moment file upload (PDF/DOCX/image) hits the backend. |
| `@fastify/cors` | `10.x` | CORS for extension-origin requests | The extension calls the backend from a `chrome-extension://` origin — CORS must explicitly allow it. |
| `@prisma/extension-accelerate` (optional) | latest | Alternative connection pooling via Prisma's own edge-compatible pooler | Consider only if Supabase's own PgBouncer (see below) proves insufficient under real beta load; not needed to start. |
| `@supabase/supabase-js` | `2.x` | Supabase client for auth/storage calls from the backend | Use the service-role key only on the backend, never in the extension bundle. |

### Development Tools

| Tool | Purpose | Notes |
|------|---------|-------|
| WXT CLI (`wxt`, `wxt build`, `wxt zip`) | Dev server with HMR, production build, store-ready zip | Replaces hand-rolled Vite config entirely; `wxt.config.ts` is the single source of truth for the manifest. |
| `pnpm` workspaces | Monorepo tooling for `apps/extension`, `apps/backend`, `packages/shared` | Matches the spec's suggested folder structure; pnpm's strictness catches phantom-dependency bugs that are especially costly in a shared-types monorepo. |
| Prisma CLI (`prisma migrate`, `prisma studio`) | Schema migrations against Supabase Postgres | Must use the **direct** (non-pooled, port 5432) connection string for migrations — see pooling section. |
| Chrome DevTools + `chrome://extensions` (Developer Mode) | Manual testing of MV3 service worker lifecycle, CSP violations | Watch the service worker console specifically — CSP and MV3 lifecycle errors often don't surface in the page console. |

## Installation

```bash
# Extension (apps/extension)
npm create wxt@latest
# select: React, TypeScript
npm install -D tailwindcss @tailwindcss/vite

# Backend (apps/backend)
npm install fastify @fastify/cors @fastify/multipart
npm install ai @openrouter/ai-sdk-provider zod
npm install @prisma/client @supabase/supabase-js
npm install pdfjs-dist mammoth tesseract.js
npm install -D prisma typescript tsx @types/node

npx prisma init
```

## Alternatives Considered

| Recommended | Alternative | When to Use Alternative |
|-------------|-------------|--------------------------|
| WXT | CRXJS (`@crxjs/vite-plugin`) | Only if you need to hand-roll a highly custom Vite pipeline and are willing to accept a project with visibly slowed 2025–2026 development activity. Not recommended for a greenfield build in 2026. |
| WXT | Plasmo | Never, for this project — Plasmo's Parcel-based tooling and community-reported maintenance concerns make it the weakest of the three options right now. |
| Fastify (single Vercel Function) | Next.js API/route handlers | If the team later wants a marketing site, dashboard, or admin UI served from the same deployment — Next.js gives you that for free. Not justified for a pure streaming-proxy-plus-upload backend. |
| Fastify (single Vercel Function) | NestJS (on Fastify adapter) | If the backend is expected to grow into a large multi-team service with many modules, guards, and interceptors. Adds bootstrap/cold-start cost and structural ceremony this project doesn't need yet. |
| Content-script + shadow DOM sidebar | Chrome's native `chrome.sidePanel` API | If you are willing to drop the "floating button on the page triggers open" requirement and accept opening only via the toolbar icon or keyboard command. See Sidebar Injection section — this is a real trade-off, not a style preference. |
| Backend-side PDF/DOCX/OCR parsing | Client-side parsing (pdf.js/mammoth/Tesseract.js in the extension) | Only if you have a hard requirement that files never leave the browser (e.g., strict local-only privacy promise). Given the product already sends the same content to the LLM backend, there's no privacy win to client-side parsing here — only CSP/bundle-size pain. |
| Supabase pooled connection (`pgbouncer=true`, port 6543) for `DATABASE_URL` | Prisma Accelerate | If the free-tier PgBouncer pool proves insufficient once traffic grows beyond ~50 beta users; revisit then, don't pre-optimize. |

## What NOT to Use

| Avoid | Why | Use Instead |
|-------|-----|--------------|
| **Plasmo** | Widespread, current community reports of maintenance stagnation; built on Parcel, which has fallen behind Vite-based tooling; picking it now is picking a framework you may need to migrate off mid-project. | WXT |
| **CRXJS (`@crxjs/vite-plugin`) as the primary framework** | Development has visibly slowed through 2025–2026; it's "just a Vite plugin," not a framework, so you'd be re-solving entrypoint conventions, manifest generation, and HMR-for-content-scripts yourself. | WXT |
| **Hand-rolled Vite config with manual `manifest.json`** | Reinvents everything WXT already solved (MV3 manifest quirks, service-worker HMR limitations, CRX packaging); high maintenance burden with no upside for this project's timeline. | WXT |
| **`chrome.sidePanel.open()` called from a content-script-injected floating button as the *sole* trigger mechanism** | Actively, currently broken/unpredictable: Chromium bug reports through 2026 show `sidePanel.open()` throwing "may only be called in response to a user gesture" when invoked from content-script listeners (including legitimate click handlers), especially after Chrome 127. This directly conflicts with the project's "floating-button triggered" requirement. | Content-script-injected UI in a shadow DOM root (see below); reserve `chrome.sidePanel` only as a secondary trigger via the toolbar icon if you want it, not as the primary UX. |
| **Client-side Tesseract.js inside the MV3 extension** | Confirmed, repeated real-world failure pattern: Tesseract.js's default behavior tries to fetch its core/worker/wasm/lang-data files from a CDN, which MV3's CSP blocks outright (no remote code execution); working around it requires manually vendoring every worker/wasm/traineddata file into the extension bundle and still needs `wasm-unsafe-eval` in the manifest CSP — high complexity for a feature that already has a working backend to run it on. | Run Tesseract.js (or a cloud OCR API) server-side, where none of this applies. |
| **`unsafe-eval` anywhere in `content_security_policy.extension_pages`** | Flatly disallowed by MV3; several older tutorials and libraries assume it's available (a legacy MV2 pattern) and will silently fail or throw CSP violations. | `wasm-unsafe-eval` only if you genuinely run WASM in an extension page (you likely won't, if parsing is server-side); otherwise omit entirely. |
| **Prisma's default (unpooled) `DATABASE_URL` pointed at Postgres port 5432 from Vercel serverless functions** | The single most common production failure mode for this exact stack combination: every cold serverless invocation opens a new Postgres connection; under real traffic this exhausts Postgres's connection limit and the app falls over with "too many connections" — a failure that will not show up in local dev or light testing. | Two-URL Prisma setup: `DATABASE_URL` = Supabase's pooled PgBouncer endpoint (port 6543, `?pgbouncer=true`) for the running app; `DIRECT_URL` = the direct port-5432 connection, used only by `prisma migrate`. Also cache the `PrismaClient` instance on `globalThis` to reuse it across warm invocations. |
| **Node 20 as the target runtime** | Reached end-of-life April 30, 2026; Vercel is deprecating it for new deployments from Oct 1, 2026; the OpenRouter AI SDK provider also requires Node ≥22. | Node 22 LTS (safe, stable) or Node 24 (Vercel's current default). |

## Stack Patterns by Variant

**If the sidebar must be triggerable by a floating button injected into arbitrary pages (this project's requirement):**
- Use a content-script-mounted UI rendered into a **shadow DOM root**, not Chrome's native Side Panel API.
- WXT provides `createShadowRootUi()` specifically for this: it mounts your React app into an isolated shadow root attached to the host page's DOM, so page CSS cannot leak in and your Tailwind styles cannot leak out.
- Because: the native `sidePanel.open()` API has current, repeatedly-reported gesture-detection bugs when called from content-script click handlers — exactly the trigger this project needs. A shadow-DOM-mounted UI has no such restriction; it's just DOM the content script controls directly, so it can be shown/hidden instantly, resized with plain CSS/JS, and toggled by keyboard shortcut via the background service worker without any gesture-forwarding gymnastics.
- Caveat: shadow DOM is strong isolation but not absolute — a hostile page using `all: initial` on very broad selectors or manipulating `:host` can still bleed through in edge cases. Explicitly set base properties (font, line-height, color) on the shadow host rather than relying on inheritance.

**If Chrome's native side panel is wanted as a *secondary* affordance (e.g., toolbar-icon click):**
- Add a WXT `sidepanel` entrypoint alongside the shadow-DOM content-script UI. WXT auto-adds the `sidePanel` permission and wires `chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: true })`.
- Because: toolbar-icon clicks are always a trusted top-level user gesture, so `sidePanel.open()` is reliable in that specific path — it's only the content-script-forwarded gesture that's broken.

**If file processing volume or latency becomes a bottleneck:**
- Move PDF/DOCX/OCR parsing to a Vercel background function or queue (e.g., Vercel Cron + a lightweight job table in Postgres) rather than blocking the request/response cycle of the main Fastify function.
- Because: Vercel serverless functions have execution time limits, and OCR in particular can be slow; decoupling upload-accepted from parsing-complete keeps the chat/streaming path fast and unaffected by heavy jobs.

## Version Compatibility

| Package A | Compatible With | Notes |
|-----------|------------------|-------|
| `@openrouter/ai-sdk-provider@2.10.0` | `ai@^7.0.0`, Node ≥22, ESM-only | Do not pin `ai@6.x` — the provider will fail its peer-dependency check. Ensure `"type": "module"` or equivalent ESM config in the backend `package.json`. |
| WXT `0.20.x` | Vite 6.x (managed internally), `@wxt-dev/module-react` matching major | Let WXT manage its own Vite version; don't hand-pin a conflicting Vite version in the extension's `package.json`. |
| Prisma `6.x` | Supabase Postgres (any current version), PgBouncer transaction mode | Requires `?pgbouncer=true` on the pooled URL and a separate `directUrl` in `schema.prisma`'s `datasource` block — both flags are required together, not either/or. |
| Fastify `5.x` | Node ≥20 (project targets ≥22 anyway), Vercel's Fluid Compute | Vercel's Fastify guide (updated mid-2026) documents zero-config deployment; no custom serverless-adapter shim needed as of this stack's Fastify major version. |
| Tailwind CSS 4.x | Shadow DOM | Must explicitly inject the generated stylesheet text into the shadow root (not `<head>`) — Tailwind 4's CSS-first config doesn't change this requirement. |

## Sources

- WXT official repo and npm — https://github.com/wxt-dev/wxt, https://www.npmjs.com/package/wxt — version and maintenance activity (MEDIUM-HIGH, cross-referenced across 3 independent 2026 comparison articles plus npm registry data)
- Framework comparison articles (dev.to, optymized.net, trybuildpilot.com, redreamality.com) — WXT vs CRXJS vs Plasmo maintenance status — MEDIUM (WebSearch-sourced, consistent across multiple independent sources, not Context7-verified)
- Chrome for Developers, `chrome.sidePanel` API docs — https://developer.chrome.com/docs/extensions/reference/api/sidePanel — HIGH (official)
- Chromium issue tracker — issues 355266358, 415694848 and related chromium-extensions group threads — `sidePanel.open()` user-gesture bugs from content scripts — MEDIUM-HIGH (primary-source bug reports, actively open in 2026)
- Chrome for Developers extension CSP docs (MDN cross-reference) — `wasm-unsafe-eval` requirement — HIGH (official + community confirmation)
- `naptha/tesseract.js` GitHub issue #961 — MV3 CDN-loading CSP failure — HIGH (primary-source, maintainer repo)
- OpenRouterTeam/ai-sdk-provider GitHub + npm — https://github.com/OpenRouterTeam/ai-sdk-provider, https://www.npmjs.com/package/@openrouter/ai-sdk-provider — version 2.10.0, Node ≥22, `ai@^7` peer requirement — HIGH (official package registry data)
- OpenRouter official docs — streaming API, free-model rate limits — https://openrouter.ai/docs — HIGH (official)
- Vercel official docs — Fastify deployment guide, Node.js runtime versions — https://vercel.com/docs/frameworks/backend/fastify, https://vercel.com/docs/functions/runtimes/node-js/node-js-versions — HIGH (official, dated 2026)
- Vercel changelog — Node 20 deprecation, Node 22 LTS availability — https://vercel.com/changelog — HIGH (official)
- Prisma official docs — PgBouncer configuration — https://www.prisma.io/docs/orm/prisma-client/setup-and-configuration/databases-connections/pgbouncer — HIGH (official)
- Supabase docs — Prisma troubleshooting/connection pooling — https://supabase.com/docs/guides/database/prisma/prisma-troubleshooting — HIGH (official)
- Community pooling write-ups (dev.to, humansfix.ai) — connection-exhaustion failure pattern description — MEDIUM (WebSearch-sourced, consistent with official docs above, used for narrative framing only)
- dev.to shadow-DOM-vs-iframe extension UI posts — isolation trade-offs — MEDIUM (WebSearch-sourced, single-author series, technically consistent with known Shadow DOM behavior)

---
*Stack research for: Chrome MV3 AI writing-assistant extension*
*Researched: 2026-08-05*
