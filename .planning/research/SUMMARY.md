# Project Research Summary

**Project:** Universal AI Writing Assistant (Chrome MV3 extension)
**Domain:** Chrome MV3 AI writing-assistant extension (React sidebar + hosted Node/LLM-proxy backend), wedge use case: HR performance-review writing in Google Docs
**Researched:** 2026-08-05
**Confidence:** MEDIUM-HIGH, with two research conclusions explicitly overruled by evidence gathered after the research ran (see "Where User Evidence Overrules Research" below)

## Executive Summary

This is a Chrome MV3 extension whose entire value proposition is one moment: AI-generated text landing correctly, at a controllable pace, inside an editor the extension doesn't control (a plain field, a framework-driven contenteditable, or Google Docs' canvas). All four research passes converge on the same structural verdict: this is an insertion-engineering problem wrapped in a chat product, not the other way around. The recommended stack — WXT for the MV3 build, a content-script-hosted React sidebar in a shadow DOM (not `chrome.sidePanel`), Fastify on Vercel, Vercel AI SDK + OpenRouter provider, Supabase for auth/DB/storage with pooled Prisma connections — is well-evidenced and should be treated as settled. Three separate insertion adapters (plain field, contenteditable, Google Docs), each with its own state machine and undo semantics, is correct architecture, not over-engineering; a single generic "insert text" function is the single most consistently-flagged anti-pattern across the research.

Two facts surfaced after the research ran change the plan the research would otherwise recommend, and both push in the same direction: earlier and more careful, not later and looser. First, the actual first users are HR teams writing performance reviews in Google Docs — so the adapter every research file said to build last and defer to v1.x is now the primary target and must ship in v1. What survives from the research is not the sequencing conclusion but the risk assessment underneath it: Docs is canvas-rendered, undocumented, and breaks without warning, so it needs a timeboxed spike to prove the mechanism early, a runtime self-test on every load, and a graceful clipboard-paste fallback — built early, not deferred, but still isolated and defensively engineered. Second, the content flowing through this product is GDPR personal data (a manager's written assessment of a named employee), and OpenRouter's free models are only reachable by an account that has opted into "may train on inputs" and "may publish prompts" — incompatible with real HR content. This turns the provider abstraction from a convenience into a compliance boundary: free/cheap models are fine for development and synthetic test data, but the moment real user content flows through the system, the backend must enforce routing to paid, no-training, no-publish endpoints server-side, not as a client-configurable option.

The biggest risks that are genuinely architectural — meaning they must be right in the foundation phase or every later phase inherits the bug — are: (1) treating the MV3 service worker as a place to hold stream or session state (it is killed after ~30s idle and cannot be trusted with anything), (2) building one generic insertion function instead of three adapters, (3) leaving quota/auth enforcement client-side or partial, and (4) skipping the Docs mechanism spike before committing a phase to building on it. Everything else — OCR limits, conversation history search, model-picker UI, billing — is real but recoverable if gotten wrong initially; these four are not.

## Key Findings

### Recommended Stack

The stack is locked by the operator for the big pieces (React, TypeScript, Vite, Tailwind, Node, PostgreSQL, Prisma, Supabase) and research fills in the framework and version choices around it. See STACK.md for full detail.

**Core technologies:**
- **WXT `0.20.x`** — MV3 build framework wrapping Vite; purpose-built file-based entrypoints, auto-manifest, `createShadowRootUi()` for exactly the shadow-DOM sidebar pattern this project needs. Chosen over CRXJS (slowing development) and Plasmo (maintenance-stagnant, Parcel-based).
- **React 19 + TypeScript 5.6+ + Tailwind 4** — already locked; inside the shadow DOM, Tailwind's generated stylesheet must be explicitly injected into the shadow root, not `<head>`.
- **Node 22 LTS or 24, Fastify 5.x, mounted as a single Vercel Function** — smallest framework giving real streaming ergonomics; NestJS and Next.js route handlers add ceremony/weight this project doesn't need. Node 20 is EOL and being deprecated on Vercel — do not target it.
- **Vercel AI SDK (`ai@^7.x`) + `@openrouter/ai-sdk-provider@2.10.0`** — `streamText()` gives SSE-compatible streaming and the provider-agnostic interface that makes "swap the model in config" real. Requires Node ≥22, ESM-only.
- **PostgreSQL + Prisma 6.x via Supabase, with the two-URL pooling pattern** — pooled PgBouncer endpoint (port 6543, `?pgbouncer=true`) for `DATABASE_URL`, direct port-5432 for `DIRECT_URL`/migrations. This is flagged as the single most common silent production failure for this exact stack combination if skipped.
- **Backend-side document/OCR pipeline** — `pdf.js`, `mammoth`, `tesseract.js` all run server-side (Node), never in the extension. MV3's CSP blocks Tesseract's default CDN-fetch behavior outright; this is a confirmed, repeated real-world failure pattern, not a style preference.
- **Content-script-hosted sidebar in a shadow DOM root**, not `chrome.sidePanel` as the primary UI. `sidePanel.open()` has active, currently-reported Chromium bugs when called from content-script gesture handlers — exactly this project's floating-button trigger. Side Panel is retained only as an optional secondary affordance via the toolbar icon.

### Expected Features

See FEATURES.md for full detail. The competitive landscape (Grammarly, Merlin, Sider, HARPA, MaxAI, Monica) converges on a consistent pattern: no competitor documents a real three-engine insertion architecture, and the single most repeated user complaint across the category is silent product breakage (spinners that never resolve, credits vanishing, features going flaky post-update) — not AI quality.

**Must have (table stakes):**
- Sidebar/panel injected on any page, keyboard shortcut + floating button trigger
- Streaming AI responses with session-scoped memory
- Copy-to-clipboard as an always-available fallback to insertion
- 6-8 prompt templates for core operations (summarize, rewrite, expand, simplify, translate, explain)
- Editable AI response before use
- Visible, specific error states (this is table stakes precisely because competitors fail at it)
- Working insertion on the top real editors — this IS the product category
- Minimal, justifiable permissions with a real privacy policy (Chrome Web Store tightened enforcement August 2026)

**Should have (competitive differentiators):**
- Progressive insertion with live pause/resume/stop/undo, framed as a reading/review mechanism — no competitor reviewed offers this; it is the core, genuinely unclaimed bet
- Insertion that survives contenteditable's internal document model (`beforeinput`/`InputEvent`, not naive DOM writes) — differentiation through correctness
- Working Google Docs insertion via the actual hidden input target — highest risk, highest differentiation, and per the operator's user evidence, no longer deferrable
- Context manager combining multiple source types (PDF, DOCX, OCR, pasted text) into one coherent prompt

**Defer (v2+):**
- Multi-provider model-picker UI — the provider abstraction stays internal/config-only until there's a concrete reason to expose it
- Conversation history search/organization — retention feature, not activation
- Firefox/Safari, code-editor adapters, multi-document reasoning, team/collaboration, billing — all explicitly out of scope per PROJECT.md

**Explicit anti-features to avoid building:** "undetectable"/humanized typing framed as AI-detection evasion (reputational and policy risk — pacing must stay framed as a reading aid, not disguise), broad `<all_urls>` requested up front, web-automation/agentic features beyond writing, "unlimited" quota marketing language, a supported-editor allowlist config UI, remote-loaded prompt templates.

### Architecture Approach

See ARCHITECTURE.md for full detail, including code-level patterns for each insertion adapter. The system is a content-script-hosted React sidebar (shadow DOM) that talks to a stateless MV3 background service worker (pure message router + SSE relay, no business logic) which proxies to a Fastify backend on Vercel holding the OpenRouter key, Supabase auth/DB/storage, and the document/OCR pipeline.

**Major components:**
1. **Content script** — owns DOM access to the host page, the insertion adapters, and the insertion state machine; mounts the sidebar UI into a shadow root. This is the only component with both a stable-enough lifetime and synchronous DOM access to the target editor — insertion state must live here, not in the service worker or the sidebar.
2. **Background service worker** — stateless router between sidebar, content script, and backend; owns the SSE fetch relay. Must hold zero state that needs to survive beyond a single message exchange, because MV3 can kill it at any point.
3. **Backend (Fastify/Vercel)** — four sub-responsibilities: Auth (Supabase), AI Gateway (SSE proxy to OpenRouter, quota-enforced before every call), Context/File Pipeline (parse + OCR, entirely server-side), Quota/Usage Accounting. This is also where the GDPR/compliance boundary now lives (see below) — model routing for real user content must be enforced here, not left to client config.
4. **Insertion engine (`insertion/adapters/`)** — exactly three files (plain-field, contenteditable, google-docs) behind one dispatcher, each independently testable/fixable, sharing a state machine (`idle → streaming → paused → streaming → stopped/completed → undoing → idle`) that is explicitly decoupled from the generation stream's buffer.

### Critical Pitfalls

See PITFALLS.md for full detail including recovery strategies and a "looks done but isn't" checklist. Ranked by how architectural (foundation-phase-blocking) versus deferrable each is:

1. **Service worker dies mid-stream, silently truncating AI responses** — MV3 kills the worker after ~30s idle or 5 min continuous work; a stream held there vanishes with no error. Avoid by keeping a `chrome.runtime.connect()` port open for the duration of generation (message traffic resets the idle timer), persisting partial chunks to `chrome.storage.session` as they arrive, and never using `setTimeout`/`setInterval` in the worker for anything beyond seconds.
2. **Framework-controlled fields silently revert inserted text** — setting `.value` or mutating `innerHTML` updates the DOM but not React/Vue's internal state; the next re-render reverts it with no error. Avoid via the native-setter + synthetic-`InputEvent` technique for plain fields and `beforeinput`/`execCommand` for contenteditable — and always verify by reading the DOM back after write, not just checking immediately after.
3. **Progressive insertion races with live user typing**, corrupting the document or leaving an incoherent undo stack — this is not an edge case, it is the primary use case (the user reads along specifically to interrupt bad output). Avoid by re-verifying focus/selection before every chunk write and treating "Stop" as a clean, single-undo-step teardown.
4. **Google Docs adapter breaks on an unannounced Google-side change** — canvas-rendered, no DOM, no official API, precedent exists (2021 rendering migration broke every extension relying on DOM structure). Avoid with a runtime self-test on load, isolation from the other two adapters at the code-boundary level, and a documented clipboard-paste fallback.
5. **Shared OpenRouter key leaks, or the proxy is called directly bypassing quota** — extension code is fully inspectable; client-side quota display is not enforcement. Avoid with server-only key storage, quota checked-and-incremented atomically server-side before every OpenRouter call, and a hard spend cap set independently in the OpenRouter dashboard as a backstop.

## Where User Evidence Overrules Research

Both research conclusions below were correct given what the researchers knew at the time. Both are now overruled by facts the operator established afterward. Recording the disagreement, not silently dropping it:

**1. Google Docs sequencing.**
- *Research said:* FEATURES.md scoped Google Docs insertion as "Add After Validation (v1.x)" — build plain-field and contenteditable first, validate the transport-control UX, then invest in Docs once the pattern is proven elsewhere. ARCHITECTURE.md's build order places the Docs adapter last among the three (step 5 of 8), explicitly "most fragile, least documented, highest cost-of-change ... must not be the adapter that also shakes out state-machine bugs."
- *We are doing:* Google Docs ships in v1, and its technical spike happens early — not last.
- *Because:* The first real users are HR teams writing performance reviews in Google Docs, established by the operator talking directly to prospective users. Deferring Docs to v1.x would mean shipping a v1 that doesn't work for the only confirmed audience. This is a scoping fact the research had no way to know.
- *What survives from the research unchanged:* the risk profile. Docs is still the most fragile of the three adapters — canvas-rendered, no DOM, undocumented hidden input target, no vendor commitment, known precedent of silent breaking changes. The research's prescription for de-risking it (isolate it completely from the other two adapters, build a runtime self-test before every insertion attempt, fail loud with a clipboard-paste fallback rather than silently corrupting a real document) is adopted in full and now applies to a v1 adapter, not a v1.x one. The correct reading of the research is: build the state machine and the plain-field/contenteditable adapters first as originally planned (they're needed to prove the state-machine architecture on friendlier ground), but run a timeboxed Google Docs mechanism spike in parallel, early, rather than after — so the roadmap isn't discovering Docs is harder than expected only after committing a full phase to it.

**2. Free-tier OpenRouter models as the default.**
- *Research said:* STACK.md and PROJECT.md's original framing treat OpenRouter's free/cheap `:free`-suffixed models as the default starting point, "because it exposes dozens of models behind one API and the default can change in config rather than code." No research file flagged a content-sensitivity constraint on model choice.
- *We are doing:* Free models are for development and synthetic test data only. Before any real user content passes through, the backend must route to paid endpoints with training and prompt-publication disabled, enforced server-side.
- *Because:* Verified against OpenRouter's own docs on 2026-08-05, free-tier access requires the account to opt into "free endpoints that may train on inputs" and "may publish prompts." Real content here is a manager's written assessment of a named employee — GDPR personal data, and the operator is in Denmark. That data cannot legally or ethically flow through an endpoint that may train on it or publish it.
- *What survives from the research unchanged:* the provider-abstraction architecture itself (STACK.md's `streamText()`/AI SDK layer, ARCHITECTURE.md's "provider abstraction wraps the client so swapping providers later is a config change") is exactly the mechanism needed to implement the compliance boundary — the abstraction was recommended for flexibility, and it turns out to be load-bearing for compliance too. What changes is that model routing is no longer a single config value chosen once; it must be a server-enforced policy gate (real user content → paid/no-training endpoints only; synthetic/dev traffic → free tier permitted) sitting inside that same abstraction layer, not a client-visible or client-changeable setting.

A related, smaller correction from the same verification pass: free models were also found to be individually unreliable in live testing (one 429'd on a single first request). This doesn't overrule any research conclusion, but it adds a requirement research didn't surface: an ordered fallback chain across models/providers, not a single configured default, because a beta user hitting silence from one busy free upstream will read it as the product being broken — directly reinforcing PITFALLS.md's "silent failure is the existential risk" finding from a different angle.

## Implications for Roadmap

Based on combined research and the two overruling facts above, suggested phase structure:

### Phase 1: Foundation — extension scaffold, backend skeleton, auth, streaming chat
**Rationale:** Every later component needs a message-passing channel (Port between sidebar and service worker) and a logged-in user to attribute quota to. The riskiest MV3 plumbing — service worker survival through a multi-minute stream — must be proven in isolation before insertion (which depends on generation already working) is layered on top.
**Delivers:** MV3 project (background/content/sidebar) with shadow-DOM sidebar injection; Supabase auth wired end to end; deployed Fastify backend with one authenticated, quota-gated route; streaming chat with session memory working against OpenRouter free-tier for dev traffic.
**Addresses:** Sidebar workspace, streaming AI chat, session memory, accounts (all table stakes per FEATURES.md).
**Avoids:** Pitfall 1 (service worker mid-stream death), Pitfall 5 (leaked key / unenforced quota), Pitfall 6 (permission/privacy posture baked in at manifest-authoring time), Pitfall 8 (shadow-DOM CSS isolation and SPA-navigation resilience for the sidebar itself).
**Compliance boundary, built now not later:** the provider-abstraction layer must be able to distinguish dev/synthetic traffic (free tier OK) from any traffic carrying real user content (paid, no-training-required endpoints only) from day one, even though real content isn't flowing yet — retrofitting this policy gate after the abstraction exists as "just pick a model" is expensive to unwind.

### Phase 2: Insertion foundation — plain-field and contenteditable adapters, state machine, transport controls
**Rationale:** This is the core value proposition. Build the state machine (idle/streaming/paused/stopped/undoing) and validate it on the two friendlier adapter types before Docs' fragility can obscure state-machine bugs.
**Delivers:** Working instant + progressive insertion (pause/resume/stop/undo) for plain fields and contenteditable, validated against real target sites (Gmail, LinkedIn, Slack, Notion), with copy-to-clipboard fallback and visible per-adapter error states.
**Addresses:** Text insertion, progressive insertion with transport controls, editable-before-insert, visible error states — all P1 in FEATURES.md's prioritization matrix.
**Avoids:** Pitfall 2 (framework-controlled fields silently reverting text — mandatory post-write verification), Pitfall 3 (progressive insertion racing live user typing).

### Phase 3: Google Docs spike and adapter
**Rationale — revised by user evidence, not research:** research placed this last; the operator's user evidence (HR teams write in Docs) makes it primary. The correct compromise is not "build it first" (the state machine needs to be proven on friendlier ground first, per research) nor "defer to v1.x" (research's sequencing is overruled) — it's a timeboxed spike run early/in parallel with Phase 2, followed by a dedicated adapter-build phase once the mechanism is proven and the state machine exists.
**Delivers:** A validated technical spike proving the hidden-iframe/synthetic-keystroke mechanism works against current Docs internals, followed by a full Docs adapter with a runtime self-test on load and a clipboard-paste fallback if the self-test fails.
**Addresses:** Google Docs insertion — now a v1 requirement, not v1.x.
**Avoids:** Pitfall 4 (Docs breaking silently on an unannounced Google change) — the self-test and fallback are the direct mitigation, and must ship with the adapter, not after.
**Research flag:** this phase needs a dedicated timeboxed spike before roadmap commitment — treat the spike as its own deliverable with a go/no-go gate, not folded into general "Phase 3 build" estimation.

### Phase 4: Context pipeline — file upload, extraction, OCR
**Rationale:** Backend-only work, largely independent of insertion once the upload endpoint contract is fixed; can run in parallel with Phases 2-3 if capacity allows. Needs the authenticated backend and structured-prompt-assembly convention from Phase 1.
**Delivers:** PDF/DOCX/TXT/MD extraction and image/screenshot OCR, both server-side, with hard size/type limits and sandboxed parsing (memory/time ceilings, content-sniffing, no embedded-JS execution).
**Addresses:** File upload + extraction, context manager combining multiple sources — P1/P2 per FEATURES.md.
**Avoids:** Pitfall 7 (malicious/oversized uploads exhausting shared server resources).

### Phase 5: Quota hardening, usage transparency, polish across all adapters
**Rationale:** Quota limits are best calibrated against real observed usage from Phases 1-4 rather than guessed numbers up front; a basic server-side check should already exist as a stub from Phase 1, this phase fills it in for real. Undo correctness across all three adapters can only be fully exercised once all three exist.
**Delivers:** Real per-user quota enforcement with visible usage display ("X of Y requests used"), cross-adapter undo correctness, pacing-performance tuning (batched chunk insertion, not per-character events).
**Addresses:** Per-user quotas with honest usage display (anti-"unlimited" trust failure from FEATURES.md's competitive analysis).

### Phase Ordering Rationale

- **Generation before insertion, insertion before Docs, Docs spike early but adapter build after the state machine is proven** — each step is a precondition for testing the next; insertion cannot be validated without generation working, and the state-machine architecture should not be shaken out on the single most fragile adapter.
- **Compliance/provider-policy gate is foundation-phase work, not a later retrofit** — because real user content (HR performance reviews) is GDPR personal data from the first real beta user, not an edge case reached at scale.
- **Context pipeline is architecturally independent and can parallelize** with the insertion-adapter work — they only share the authenticated-backend foundation from Phase 1.
- **Quota hardening deliberately staged last (though a stub ships in Phase 1)** so real limits are set from observed usage, not guesses — but the stub itself (auth-gated, rejects unauthenticated calls) is non-negotiable from Phase 1 per Pitfall 5.

### Research Flags

Needs deeper research/spike during planning:
- **Phase 3 (Google Docs):** LOW-MEDIUM confidence mechanism, no official documentation, behavior can shift without notice — requires an empirical, timeboxed spike with a go/no-go gate before the phase is planned as a normal implementation phase.
- **Phase 2 (contenteditable adapter):** MEDIUM-HIGH confidence on the general mechanism (`execCommand`/paste-simulation), but exact per-site behavior (Slack's markdown auto-formatting interception, Gmail's inconsistent `execCommand` support across internal editor surfaces) is not independently re-verified per live site and should be spot-checked early, tracked as a punch list rather than assumed solved.

Standard patterns (skip deep research-phase):
- **Phase 1 (Foundation):** MV3 service worker lifecycle, shadow-DOM sidebar injection, Supabase auth, and Fastify-on-Vercel deployment are all HIGH confidence, officially documented, current patterns.
- **Phase 4 (Context pipeline):** Server-side PDF/DOCX/OCR parsing is a well-understood pattern; the main work is defensive limits, not novel mechanism.

## Confidence Assessment

| Area | Confidence | Notes |
|------|------------|-------|
| Stack | MEDIUM-HIGH | Core framework/pooling choices verified against multiple current official sources (Vercel, Prisma, Supabase, OpenRouter docs); WXT side-panel maturity and OCR approach carry explicit caveats. |
| Features | MEDIUM | Competitive landscape and complaint patterns well-evidenced across G2/Trustpilot/Product Hunt/Chrome Web Store reviews; insertion-engine internals are LOW-MEDIUM since no competitor documents their actual DOM/canvas technique — inferred from adjacent tooling. |
| Architecture | MEDIUM-HIGH | Insertion techniques and MV3 lifecycle are HIGH confidence (MDN/Chrome official docs); per-site editor quirks are MEDIUM/LOW and explicitly flagged as needing empirical validation in Phase 2/3. |
| Pitfalls | MEDIUM-HIGH | MV3 lifecycle and Web Store policy are HIGH confidence, official; insertion failure modes are MEDIUM — each target site's editor internals change without notice and were not independently re-verified live against every site. |

**Overall confidence:** MEDIUM-HIGH for architecture and stack decisions; MEDIUM for exact per-site insertion behavior and the Google Docs mechanism specifically, which is now higher-stakes than the original research assumed given the sequencing change.

### Gaps to Address

- **Google Docs mechanism validity is unverified against current (2026-08-05) Docs internals** — the research describing the hidden-iframe/synthetic-keystroke approach is community-sourced, not official, and Google has shipped breaking changes before with no notice. This must be resolved by an empirical spike, not more desk research, before Phase 3 is planned in detail.
- **Per-site contenteditable quirks (Slack, Gmail, Notion, LinkedIn) are not independently re-verified live** — treat the Phase 2 punch list as provisional until spot-checked against the actual current sites.
- **OpenRouter's specific list of paid, no-training, no-prompt-publication models/endpoints has not been enumerated** — the research establishes the policy requirement (paid + no-training + no-publish for real content) but not which exact OpenRouter models/flags satisfy it at data-processing-agreement level; this needs a compliance-focused check (OpenRouter's DPA terms, not just its model-catalog docs) before Phase 1's provider-policy gate is finalized.
- **Free-model reliability (429s observed on a single live test) is anecdotal at n=1-2** — the ordered-fallback-chain requirement is directionally correct per PITFALLS.md's silent-failure findings, but the exact chain and retry/backoff parameters need to be tuned against real dev-traffic observation in Phase 1, not assumed from one test.

## Sources

### Primary (HIGH confidence)
- Chrome for Developers — service worker lifecycle, message passing, sidePanel API, content-security-policy, content scripts — https://developer.chrome.com/docs/extensions/
- MDN — `beforeinput`, `InputEvent.inputType`, `Document.execCommand()` — https://developer.mozilla.org/
- Vercel official docs — Fastify deployment guide, Node.js runtime versions, changelog (Node 20 deprecation) — https://vercel.com/docs/
- Prisma official docs — PgBouncer configuration — https://www.prisma.io/docs/
- Supabase docs — Prisma troubleshooting/connection pooling — https://supabase.com/docs/
- OpenRouterTeam/ai-sdk-provider GitHub + npm — version 2.10.0, Node ≥22, `ai@^7` peer requirement
- OpenRouter official docs — streaming API, free-model terms (verified live 2026-08-05 for the GDPR/training-consent finding) — https://openrouter.ai/docs
- Chromium issue tracker — `sidePanel.open()` user-gesture bugs (issues 355266358, 415694848), service-worker sleep-wake termination (#40273015)
- `naptha/tesseract.js` GitHub issue #961 — MV3 CSP conflict, primary source
- Mozilla pdf.js GitHub issue #20198 (memory leak), CVE-2024-4367 (arbitrary JS execution) — both primary/documented
- Chrome for Developers Blog — Chrome Web Store policy updates 2026, privacy standards effective August 1, 2026

### Secondary (MEDIUM confidence)
- Framework comparison articles (dev.to, optymized.net, trybuildpilot.com) — WXT vs CRXJS vs Plasmo maintenance status, cross-referenced across independent sources
- G2, Trustpilot, Product Hunt, Chrome Web Store reviews for Grammarly, Merlin, Sider, HARPA, MaxAI, Monica — competitive complaint patterns
- Lexical GitHub Discussion #8249, "How I Defeated ProseMirror" (dev.to), "How I Fooled React" (Medium) — contenteditable/native-setter insertion mechanism, corroborated across independent hands-on sources
- Filippo Orru blog — `docs-texteventtarget-iframe` community technical writeup, the core basis for the Google Docs adapter mechanism
- Railwaymen — Shadow DOM isolation for Chrome extensions

### Tertiary (LOW confidence, needs validation)
- Google Docs insertion mechanism as a whole — community-sourced, no official API, explicitly flagged for a spike rather than trusted as-researched
- Exact per-site behavior of `execCommand`/paste-simulation on Slack, Gmail, Notion as of the current live sites — not independently re-tested in this research pass

---
*Research completed: 2026-08-05*
*Ready for roadmap: yes, with Phase 3 (Google Docs) flagged for a mandatory pre-planning spike*
