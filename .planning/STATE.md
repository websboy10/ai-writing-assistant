---
gsd_state_version: 1.0
milestone: v1.0
milestone_name: milestone
status: verifying
stopped_at: Google Docs WORKS end-to-end on the real product path — verified against a real document and read back from it. See 07-DOCS-VERIFIED-2026-08-18.md.
last_updated: "2026-08-18T12:00:00.000Z"
last_activity: 2026-08-18 — Docs fixed and verified: whitespace, F-1 marking, autonomous placement + undo, Find selector; backend redeployed (autonomous route was 404 in prod)
progress:
  total_phases: 7
  completed_phases: 0
  total_plans: 6
  completed_plans: 6
  percent: 0
---

# Project State

## Project Reference

See: .planning/PROJECT.md (updated 2026-08-05)

**Core value:** Generated text lands correctly in the editor the user is already
in, arriving at a pace they can read along with and stop mid-flow.
**Current focus:** Operator walkthrough (UAT) of the full v1 build

## Current Position

Phase: 7 (autonomous mode) — all 6 plans executed, Docs verified on a real document
Status: **Observed working.** The whole Google Docs surface was driven on the
real product path in a real Chrome on 2026-08-18 and read back from the
document itself: chat Straks/Langsomt/Fortryd, marking, Besvar markeringen,
and Besvar alle spørgsmål (3/3 on three consecutive runs) with a byte-exact
undo. Evidence and the remaining gaps:
`.planning/phases/07-*/07-DOCS-VERIFIED-2026-08-18.md`.
Last activity: 2026-08-07 — plan 07-06 (acceptance scenario, Docs permission
disclosure, TESTING.md walkthrough, 07-UAT.md), plus two open defects closed:
F-1 (the selection bar never appeared on Docs) and the contentClass routing
defect that sent all real user text to training-enabled free models.

Progress: [████████░░] ~85% (Phases 1–7 built; operator UAT and real-site
verification outstanding for both v1 and autonomous mode)

## Next session — start here

**Read `.planning/phases/07-*/07-DOCS-VERIFIED-2026-08-18.md` first.** It holds
the evidence for every Docs claim, and the honest list of what is still thin.

1. **Langsomt in autonomous mode on Docs** — the least-tested path. It is the
   only one still using Find positioning (the API cannot type letter by
   letter). Run it several times and count; Find measured ~50% on a
   document's last question before the confirmation was tightened.
2. **Decide the OAuth path.** `getAuthToken` worked in the test profile, but it
   can only ever use the account Chrome itself is signed into — a real risk for
   the Workspace/HR market, where an admin can disable it silently.
   `launchWebAuthFlow` is the alternative and remains undecided.
3. **Ungrounded answers.** With only questions marked and no source material,
   the backend sometimes answers from general knowledge and sometimes returns
   empty answer text, which writes blank lines into the document. Product
   decision needed.
4. **The four browser suites** have not been re-run against these changes.
   They need the backend on 127.0.0.1:8787 and a build with
   `VITE_BACKEND_URL=http://127.0.0.1:8787`; `.output` points at production.
5. **`07-UAT.md`** still needs the operator's own walkthrough recorded; the
   automated evidence is in the file named above.

**Driving Docs from a script:** the one thing that made this session possible is
reading the document back via `…/export?format=txt` with ordinary cookies — no
OAuth needed. It must be called from OUTSIDE the Docs page (its CSP blocks the
fetch). Without a read-back channel, a Docs "fix" cannot be verified at all,
which is how four wrong ones were written.

**Sign-in** depends on the Supabase project being awake; `dig +short
gkqpyqmuopqxumugszoa.supabase.co` diagnoses a pause in one command. Nothing
keeps it awake — the operator accepted that risk on 2026-08-18.

**Reload ritual after every rebuild:** reload at `chrome://extensions` AND
Cmd+R the Docs tab. Note that `chrome.runtime.reload()` via CDP does not
reliably pick up a new build; restarting Chrome does.

## What exists and how it was verified

**Working, verified by automated real-Chromium walkthrough (scripts/verify.mjs, 13/13):**
sidebar injection + floating button, sign-in, streaming chat against live AI,
edit-response-before-insert, progressive insertion with pause/resume into plain
textarea, single-step undo, insertion surviving a framework-controlled input's
revert behavior, contenteditable insertion, typing-race auto-pause, real usage
numbers in header.

**Working, verified via live API calls:**
401 for unauthenticated chat (AUTH-06); atomic quota consumption + clear 429
with reset time (QUOT-01/03); server-side model policy — real content routed to
paid/no-training endpoints, free chain only for synthetic (QUOT-05); ordered
model fallback observed live (QUOT-06); PDF/DOCX/TXT parsing + PNG OCR with
specific rejection messages for oversized/malformed/unsupported files
(CTX-01/02/03/04/10/11); conversation list/reopen/delete with real deletion
(HIST-01/03).

**Built but needs operator eyes (documented in TESTING.md):**

- Google Docs adapter (paste-event via docs-texteventtarget-iframe, self-test +
  clipboard fallback) — automation has no Google login; THE priority manual test

- Rich-editor insertion on real Gmail/LinkedIn/Slack/Notion (passes on
  equivalent harness editor)

- Google OAuth button (needs operator's Google Cloud credential — SETUP.md Job 4)
- Screenshot capture, drag-drop, theme toggle, resize persistence, SPA-nav
  remount, keyboard shortcut (all built; not in the automated suite)

## Infrastructure

- Supabase project `ai-writing-assistant` (gkqpyqmuopqxumugszoa, eu-north-1):
  schema + RLS + quota RPCs applied; test user tester@example.com (confirmed)

- **`mariams-guide` Supabase project was PAUSED (not deleted)** to free the
  2-project free-tier slot — zero users/sign-ins, data intact, restorable from
  the dashboard in ~1 min

- Backend: Fastify on 127.0.0.1:8787 (local dev; Vercel-ready), serves /harness
- OpenRouter key in backend .env only; never in extension code

## Deviations from plan (all deliberate, operator informed via TESTING.md)

- Prisma dropped in favor of Supabase RPC/PostgREST with RLS — MCP-created
  projects don't expose a DB password for a Prisma DATABASE_URL; RLS +
  security-definer RPCs cover v1's needs with less machinery

- Phases built together rather than sequentially — operator's /goal directive
  ("build the entire app, don't ask questions") supersedes phase-by-phase flow

- 2026-08-06 simplification pass (operator directive "idiot friendly"):
  settings page removed (only Log ud remains), tone/operation/templates/
  real-data controls removed from UI, insertion reduced to two modes —
  Straks (instant) and Langsomt (letter-by-letter at ~30 wpm, hardcoded).
  Templates backend routes kept but unused by the UI.

- **Compliance note**: the "contains real data" checkbox is gone from the UI;
  all requests now go out as contentClass 'synthetic' (free models). BEFORE
  real users: flip the backend to treat everything as 'real' (paid,
  no-training chain) via env/config — server-side enforcement unchanged.

- Marked text now has two explicit functions (answer-below vs. context);
  insertion NEVER replaces a selection — adapters collapse to selection end
  and the answer is prefixed with a newline

- Scanned PDFs OCR'd server-side (pdfjs render → tesseract dan+eng, max 6
  pages); all OCR now Danish+English. New backend deps: pdfjs-dist,
  @napi-rs/canvas (needs a Vercel-compat check at deploy time; tessdata
  cache lives in os.tmpdir())

- Logo/icon generated via kie.ai (nano-banana), monochrome knot mark;
  manifest icons in apps/extension/public/icon, inline data-URI in the UI

### Billing (added 2026-08-06)

- Freemium: 7-day server-side trial (billing_init RPC) → hard paywall (402
  payment_required on /api/chat) → Stripe Checkout subscription 50 DKK/md
  (price_1U1Lf2GrmuDlJMN2u6PrgTcB, product prod_V1ORKbu7oE0CNj, TEST MODE)

- Anti-abuse: one trial per extension install (x-awa-install header →
  trial_devices table); a device that used its week gives new accounts
  status 'expired' immediately

- Sync channels: /billing/success page (server-side session retrieve),
  on-demand Stripe sync in getEntitlement, webhook /api/stripe/webhook
  (needs STRIPE_WEBHOOK_SECRET — set at Vercel deploy, not needed locally)

- Full flow proven E2E incl. real test-mode checkout: scripts/verify-paywall.mjs
- BEFORE LAUNCH: live-mode Stripe keys, webhook endpoint in dashboard,
  rename Stripe business name (shows "Chat sandbox" on checkout today),
  operator's $10 OpenRouter top-up

### Deployment (2026-08-06)

- Backend LIVE on Vercel: https://ai-skriveassistent-api.vercel.app
  (project ai-skriveassistent-api, rootDirectory apps/backend, Fastify via
  api/index.ts adapter, maxDuration 300, all env vars set incl.
  STRIPE_WEBHOOK_SECRET; live Stripe webhook we_1U1OHYGrmuDlJMN2shs10ioT)

- Landing LIVE: https://ai-skriveassistent.vercel.app (+privatliv,
  +handelsbetingelser)

- Extension now DEFAULTS to the deployed backend
  (VITE_BACKEND_URL=http://127.0.0.1:8787 for local dev builds)

- DEVIATION: OCR switched from tesseract.js to vision-model OCR
  (google/gemini-3.5-flash, provider data_collection deny, max_tokens 4000)
  — tesseract's WASM cannot ship reliably in serverless bundles, and vision
  reads Danish better. tesseract.js removed from deps.

- Backend imports from @awa/shared are TYPE-ONLY by contract (package ships
  TS source which Node can't load when deployed); the two runtime constants
  are duplicated locally in files.ts with a sync note

- pdfjs on serverless needs: explicit @napi-rs/canvas import + DOM globals +
  _resolveFilename redirect + explicit pdf.worker.mjs import (all in files.ts)

- 33/33 E2E green with the extension running against the DEPLOYED backend
- Operator guides: docs/STRIPE-LIVE.md, docs/CHROME-WEB-STORE.md

### Stripe LIVE (2026-08-06)

- Live product prod_V1SRACC78tS4Gm, price price_1U1PWyGYgFaIZrpIrPedJujG
  (50 DKK/md, tax_behavior inclusive, tax_code SaaS personal), webhook
  we_1U1PWyGYgFaIZrpIsGIM1atH — all on Vercel production env

- STRIPE_AUTOMATIC_TAX=1 in production (operator confirmed tax setup +
  MobilePay enabled); local dev stays on TEST keys deliberately

- Verified live: cs_live checkout mints, webhook rejects bad signatures
- REMAINING for operator: Stripe public business name still shows "Chat"
  (Settings → Business → Public details → "AI Skriveassistent")

### Pending Todos

- Operator walkthrough per TESTING.md — especially Google Docs insertion
- Google OAuth credential (SETUP.md Job 4) when operator wants Google sign-in
- ~$5 OpenRouter credit before any real-content beta usage
- Vercel deployment when moving beyond local testing
- Real-site contenteditable spot-checks (Gmail/LinkedIn/Slack/Notion)

### Blockers/Concerns

- Google Docs mechanism remains unverified against live Docs until the operator
  (or a signed-in session) tests it — self-test + clipboard fallback ship either way

- Free OpenRouter models 429 unpredictably; fallback chain mitigates, observed live

## Accumulated Context

### Roadmap Evolution

- **Phase 7 added 2026-08-06**: Autonomous mode — answer every question in a
  document. Operator request. **Discussed the same day; decisions locked in
  `.planning/phases/07-*/07-CONTEXT.md` (D-01..D-15).** Not planned yet.

- **Phase 7 absorbed the marked-text flow** rather than spawning a phase for it:
  "Besvar markeringen" is the same engine at a smaller scope, and must handle a
  marking containing many questions.

- **Phase 7 chose to fix Google Docs properly, not work around it.** The
  original canvas/hidden-iframe reading assumption is superseded — the phase now
  builds on the Google Docs API, with the existing synthetic-paste mechanism
  demoted to a fallback. **This promotes Google OAuth from optional (SETUP.md
  Job 4) to a hard prerequisite.**

### Locked operator decisions

- **2026-08-06 — Chrome Web Store submission on hold.** Developer account is
  paid for, listing text and package are ready (`docs/STORE-LISTING.md`), but
  the operator wants to iterate on the product first. Screenshots deliberately
  NOT taken — they would go stale with each UI change.

- **2026-08-06 — the model-routing fix is deferred, knowingly.** All content
  still goes out as `contentClass: 'synthetic'` (free, training-enabled models)
  because the "contains real data" checkbox was removed from the UI but
  `chat.ts:48` still reads it. The operator was shown that this makes the
  published privacy policy untrue and chose to defer. **It must be fixed before
  any user other than the operator uses the product** — it is a GDPR exposure
  and would make the Web Store data-use certification false.

## Session Continuity

Last session: 2026-08-07
Stopped at: Phase 7 Plan 5 executed — Google Docs read path, resolver, Find
positioning, and a Docs API write fallback are BUILT (`docs-source.ts`:
`GDocsFindSource`/`GDocsApiWriteSource`/`GDocsPasteSource` + `resolveDocsSource()`),
typechecked, and proven not to regress `pnpm verify` (33/33) or
`pnpm verify:autonomous` (34/34) — but **none of the three new sources have
ever executed against a real Google Doc**. Mid-session, a separate
concurrent session (the operator's own) fixed a real bug in
`gdocsEventTarget()` (`target.ts`, commit `8e5e86d`) and reported P1
(token)/P2 (read)/P4 (write via `docs-batch-update`) all passing live —
`GDocsApiWriteSource`'s core write mechanism has real positive evidence
behind it. P3 (Find) still needs re-running after that fix; no
`07-SPIKE.md` verdict exists. See
`.planning/phases/07-autonomous-mode-answer-every-question-in-a-document/07-05-SUMMARY.md`
for the full "PENDING OPERATOR" list — exactly what to test on a real Doc
and how.
Resume file: `.planning/phases/07-autonomous-mode-answer-every-question-in-a-document/07-05-SUMMARY.md`

**Next step:** Plan 07-06 (the phase's closing human-verification plan) —
every Docs-specific truth in 07-05's `must_haves` is unverified until the
operator runs the "Kør fuld Docs-test" spike button (or the plain UI)
against a real Google Doc. Also worth a one-line follow-up outside this
plan's scope: `ChatView.tsx`'s `degradedReason` banner only renders when
`placement === 'block'`, so `GDocsApiWriteSource`'s Straks-mode reason
(API wrote instead of Find) is not currently shown, only stored.

**New extension surface this session:**

- `apps/extension/sidebar/components/ChatView.tsx` — the selection bar's
  "Besvar markeringen" now reveals the same Straks/Langsomt chip pattern
  `AutonomousBar` uses for the whole document; a new `AutoRunBar` (sticky,
  styled like `InsertBar`) gives the whole run full transport controls and
  the gap list.

- `apps/extension/insertion/autonomous/orchestrator.ts` — `pause()`/
  `start(startPaused)` now hold the queue between answers and during the
  initial backend call (previously a silent no-op in both windows);
  `undo()` reports `'idle'` on full success; new `remaining()` method for
  the clipboard-copy courtesy on a failed run.

- `apps/extension/sidebar/autonomous.ts` — `loadingRun`/
  `pauseRequestedWhileLoading` flags backing the pause-during-load fix.

- `scripts/verify-autonomous.mjs` — five new sections (ten-question
  selection, whole-run transport, typing race, gap list, panel
  independence) plus a `waitForFieldGrowth` helper — any new E2E assertion
  that needs to observe "the run is actually typing" must wait for real
  field growth, not the "Skriver" state word (which appears synchronously,
  well before the backend call resolves).

**Known pre-existing bug surfaced (not fixed, out of scope for 07-02 or 07-03):**
`apps/backend/src/supabase.ts`'s `rpc()` throws parsing `refund_quota`'s empty
response body as JSON. Caught by the existing `.catch()` in both `chat.ts` and
`autonomous.ts` (backend route), so it never reaches the user — but it means
quota is NOT actually credited back on a zero-answer/zero-token run today, in
either route. Worth a small fix in `supabase.ts` (skip `.json()` when body is
empty) in a future plan.

**Also noted, not fixed (07-03):** `scripts/verify.mjs` has the same
2-arg `waitForFunction(fn, options)` timeout bug fixed in
`verify-autonomous.mjs` (Playwright's real signature is
`(fn, arg, options)`; the 2-arg form silently applies the default 30s
timeout). Harmless there today because its waits happen to finish under
30s, but worth a cleanup pass.

**Blocked on the operator first:** the Google Cloud OAuth credential
(`docs/SETUP.md` Job 4) is now a prerequisite, not an optional extra — Phase 7's
primary Google Docs path is the Docs API, which needs that same Google Cloud
project with the Docs API enabled. Roughly 10 minutes of clicking. Planning can
proceed without it; execution of the Docs path (07-05) cannot.

## Decisions

- [Phase 7]: 07-02: contentClass hardcoded to 'real' in autonomous.ts as a local const, never read from the request body (T-07-06 GDPR boundary for whole-document sends)
- [Phase 07]: 07-03: orchestrator.ts imports adapterFor from insertion/index.ts, a circular import verified safe under Vite/Rollup since neither side evaluates the other's binding at module-init time
- [Phase 07]: 07-03: QuestionSource gained an optional lastLocateReason() beyond the plan's literal locate() signature, so unplaced questions get a specific not-found vs ambiguous reason instead of one generic message
- [Phase 07]: 07-04: AutonomousRun.pause()/start() made flag-based (pausedBetween + resumeWaiters + startPaused) rather than purely session-forwarding, after live-model E2E timing proved a pause pressed between answers or during the initial backend call was a silent no-op
- [Phase 07]: 07-04: AutonomousRun.undo() now transitions to 'idle' and resets progress on full success, mirroring InsertionSession's own idle+'undone' convention, so the panel stops claiming a run is still done after every answer was removed
- [Phase 07]: 07-05: no 07-SPIKE.md verdict exists (never run) — resolveDocsSource() probes Find LIVE, once per run, instead of reading a hardcoded GO/NO-GO branch; picks GDocsFindSource or GDocsApiWriteSource from the actual result
- [Phase 07]: 07-05: GDocsApiWriteSource always writes over the network for both Straks and Langsomt once a token is granted, never falling back to the undocumented synthetic-paste mechanism (per D-09, that route survives only inside the no-token fallback) — Langsomt on this source is one single verified write, not a second typed path or buffered pseudo-typing
- [Phase 07]: 07-05: AutonomousRun.undo() and sourceFor() are now async (Docs API undo is a real network call; the Docs resolver needs to ask for a permission and read a document before a source can even be constructed)

## Performance Metrics

| Phase | Plan | Duration | Notes |
|-------|------|----------|-------|
| Phase 07 P03 | 150m | 3 tasks | 10 files |
| Phase 07 P04 | 180m | 3 tasks | 5 files |
| Phase 07 P05 | 150m | 3 tasks | 8 files |
