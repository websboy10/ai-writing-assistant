---
gsd_state_version: 1.0
milestone: v1.0
milestone_name: milestone
status: verifying
stopped_at: 2026-09-04 — The product is cut down to one thing and proven in a real browser. Autonomous mode and answering markings are deleted; insertion gained a speed slider and a human typing style. 44/44 in scripts/verify.mjs against the deployed backend. Not yet deployed or pushed; Google Docs needs the operator's own eyes.
last_updated: "2026-09-04T00:00:00.000Z"
last_activity: 2026-09-04 — stripped autonomous mode + the Docs OAuth scope, added the tempo slider and "Skriv som et menneske", reworked the docs, verified 44/44 in a real Chrome
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

## Where this stands (2026-09-09, evening)

**"Skriv som et menneske" deletes with Backspace again, and nothing is ever
shown as marked.** The 2026-09-08 fix for Docs dropping a Backspace (one in
fifty under load) marked the slip and typed over it, and the marking was on
screen on every third word — the operator's "one huge mistake". Now:
Backspaces, then a same-task read of what is left that the screen never sees
(07-FINDINGS-docs.md F-13, quick task 260909-h4m). Two regressions from the
fills work closed in the same task: a filled answer cell is the user's answer
and its question is left alone (backend guard), and verify-answer-all keeps
the extension log.

**A run now fills EVERY place in a worksheet, not one box per question.**
The operator's own form (a table whose answer cells say "fortsæt
herunder…", a grid of verses × Manden?/Kvinden?, a five-column table with
five empty rows, and a question already answered) put three answers on the
line under three questions before; now it fills all 32 places and skips the
answered one, observed on a real Doc through the export (quick task
260909-g7z, SUMMARY.md). The model plans fills (`at` + `mode`); the
extension Tabs through tables from original text, drives Find by Docs' own
match counter (07-FINDINGS-docs.md F-10/F-11/F-12), and old extensions get
one joined answer per question until they are rebuilt.


**Phase 8 complete: "Besvar alle spørgsmål" reads a Google Doc's structure and
answers into it — the right box, real formatting, typed slowly — with no API
and no permission.** 14/14 on a worksheet carrying every shape at once, and
the answers read back letter for letter. The first run on a REAL form (a MUS
worksheet, 2026-09-08 evening) found three defects — an instruction line
answered, an answer placed above its hints, and letters lost to Docs dropping
synthetic Backspaces under load — all three measured, fixed and re-verified
the same evening (08-SUMMARY.md, 07-FINDINGS-docs.md F-5).

**2026-09-09, after the operator's own test:** the answers had gone on the
line under each question instead of into the boxes. Two causes, both fixed
and verified live (08-SUMMARY.md, 07-FINDINGS-docs.md F-6/F-7): Docs' copy
html hides blank lines, so placement now measures its way into a box; and
the server had been stripping every paragraph's structure since the day the
structure tags were written, so the model had never seen a box. The run now
PLANS: the model names the empty place for each answer with the whole form
in view, and the extension carries it out. 22/23 live plus the corrected
checker; regressions re-run with the plan active.

**"Besvar markeringen" and "Brug som kontekst" are back (2026-09-09),** on
the new machinery: the model plans the places, answers are typed formatted —
only for what is marked. The operator's first test showed the box under a
marked question was never in view (only the marked lines were sent), so a
marked run now reads the WHOLE document like "Besvar alle" and sends the
marking as a range (07-FINDINGS-docs.md F-8). Verified live with the
question alone marked, 14/14 (scripts/verify-answer-selection.mjs).

**NO BOLD, EVER (operator's rule, 2026-09-09).** Nothing the product writes
is bold: both prompts forbid it, the server strips `**`/`__` from every
answer (parse.ts stripBold), the typing compiler never presses Cmd+B (the key
is gone from FormatKey), and the paste path no longer emits <strong>. Proven
live on the worksheet whose question ASKS for bold: the word arrived plain,
nothing the run wrote was bold, no asterisk (verify-formatted-answers.mjs,
23/24 — the 24th is the open invisible-character observation, F-8's tail).

**"Alle modeller utilgængelige" on the operator's run (2026-09-09 08:33)
was the web-search plugin, not the models** — it 500s on every model once
the user message passes ~4,500 characters, and the answer call carried the
whole form (07-FINDINGS-docs.md F-9). Fixed in three layers: a model that
fails with the plugin is retried bare at once; a Besvar run does its web
lookup in a separate short call and never attaches the plugin to the answer
call; one more pass through the chain on transient failures. Reasons now
logged on every such failure. Deployed 09:15.

**0.2.2 to the store, 2026-09-09, WITH "Besvar alle spørgsmål" and "Besvar
markeringen" on** — the operator's call after a day of testing on real forms
(wxt.config.ts answerAllEnabled is now simply true; the constant stays so a
feature can be held back again with one word). The package on the operator's
Desktop is `pnpm zip:store`'s output: production backend only, no localhost
permission, no manifest key. Same permissions as the approved 0.2.0, so
nothing new to justify in review. Backend for it deployed 09:15.

### Where this stood (2026-09-04)

**The product is now one sentence: ask a question, get a draft, put it into the
document — instantly or typed out, at a speed you choose.** Everything that
answered questions in place is gone.

**What was removed, and why.** "Besvar alle spørgsmål" and "Besvar markeringen"
were built, shipped and demonstrably worked in ordinary editors. They never
became dependable in Google Docs, which is where the intended users write:
answers landed in the wrong place or lost formatting, and Docs paints to canvas
so the extension cannot read back what it wrote. The operator called it. Deleted
with them: the Docs API path, the `auth/documents` OAuth scope and its client,
the spike page, the whole-document backend route and every script that only
served those. 6,602 lines out, 128 in.

**The unplanned win.** `auth/documents` is a Google *sensitive scope*, which put
a public Chrome Web Store listing behind an OAuth verification measured in weeks.
That blocker is simply gone — the manifest has no `oauth2` key at all now. Only
the store review itself remains.

**What was added.** A tempo slider on progressive insertion (10 to 200 words a
minute, was a fixed 30) and **Skriv som et menneske**: the run makes the small
mistakes a person makes and corrects them — a wrong letter noticed a beat later
and backspaced, the occasional word deleted and retyped. Off by default. Both
settings persist. Asked for by an HR colleague of the operator's.

**Observed, not claimed** (`node scripts/verify.mjs`, the built extension in a
real Chrome against the deployed backend, 2026-09-04): **44/44**. The human-mode
check samples the field *while it types* — 10 to 16 of roughly 290 samples were
not a prefix of the draft, i.e. characters the user would have seen that are not
in the answer — and the finished text was exactly the draft every time. It runs
on through the rich-text section too, which is the hardest place to take
characters back. Unit tests: 45, including that human typing ends byte-identical
to the draft across 60 seeded runs.

**Nothing Google-account-shaped is left, by operator instruction (2026-09-04).**
"+ Denne side" briefly read a Doc through its own `/export?format=txt` with the
browser's cookies. That asked for no permission, but it still only worked for a
browser signed into an account with access — a dependency on Google the operator
would not carry. It now does what a person does: select all, copy, read the
result, entirely inside the page. No network call, no cookies, no account, and
nothing touches the system clipboard. The `docs-export` handler is deleted.

**Unproven, and it needs the operator.** Google Docs. There is no Google session
on this machine, so neither insertion into a real Doc nor the new "+ Denne side"
has been run end to end. The one thing to check is the character count on the
attached chip: a short count on a long document means the synthetic select-all
did not take. A read that comes back empty is reported as a failure, never as an
empty document. TESTING.md has the walkthrough.

**Deployed and pushed, 2026-09-04.** Production is
`dpl_73J1wHnfn31DDKBQUAJ3zKf7zKRN`, deployed with the Vercel CLI from the repo
root. Checked against the live domain afterwards, not assumed: `/api/health`
200, `/api/autonomous/answer` **404** (the deleted route is genuinely gone),
unauthenticated chat 401, billing status answers. `scripts/verify.mjs` re-run
against the deployed backend: 44/44.

**How this project deploys, because it is not obvious.** The Vercel project
`ai-skriveassistent-api` has **no GitHub link** (`link: null`), so pushing to
`origin/master` deploys nothing. Every deployment in its history came from the
CLI. There is no `.vercel` directory in the repo either (it is gitignored and
was lost with the machine), so the link has to be supplied by hand from the repo
root, where the project's own `rootDirectory: apps/backend` then applies:

```
VERCEL_ORG_ID=team_p1rF17AClZ3lYE1MDZiSvzgf \
VERCEL_PROJECT_ID=prj_2LcxQhYnQPKyAcdixxrPJmc43w4d \
vercel --prod --yes
```

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

- **Phase 7 withdrawn 2026-09-04, after being built.** Operator decision: it
  worked in ordinary editors but never became dependable in Google Docs, which
  is where its users are. The Docs API path and the `auth/documents` scope went
  with it, which also removed Google's OAuth verification as a blocker on a
  public store listing. The canvas/hidden-iframe paste mechanism — the thing the
  phase demoted to a fallback — is once again the only way the product touches
  Docs, and it is the one that was never the problem.

### Locked operator decisions

- **2026-08-06 — Chrome Web Store submission on hold.** Developer account is
  paid for, listing text and package are ready (`docs/STORE-LISTING.md`), but
  the operator wants to iterate on the product first. Screenshots deliberately
  NOT taken — they would go stale with each UI change.

- ~~**2026-08-06 — the model-routing fix is deferred, knowingly.**~~ **FIXED
  2026-08-25.** All content went out as `contentClass: 'synthetic'` (free,
  training-enabled models) because the "contains real data" checkbox had been
  removed from the UI while the code that read it stayed. `chat.ts` now always
  sends `'real'`, with no client-side switch to change it, and the policy gate
  lives on the server. Left here because the entry was written as a live GDPR
  exposure and must not be read as one.

## Session Continuity

Last session: 2026-09-04
Stopped at: The focus change is done and verified. Autonomous mode, the
selection actions and the whole Google Docs API surface are deleted; progressive
insertion gained a speed slider (10–200 wpm, persisted) and **Skriv som et
menneske** (slips that get corrected, words retyped; off by default, persisted).
Docs, planning state and the store listing are rewritten to match.

Observed rather than claimed: `node scripts/verify.mjs` is **44/44** with the
built extension in a real Chrome against the deployed backend, including a
human-mode check that samples the field mid-run and requires some samples not to
be a prefix of the draft. 45 unit tests. Both typechecks clean.

**Next step, and it is the operator's:** the Google Docs walkthrough in
TESTING.md. Nothing on this machine has a Google session, so insertion into a
real Doc and the rewritten "+ Denne side" are the only unproven surfaces.

After that: deploy the backend (the deleted `/api/autonomous/answer` route is
still live until someone does; nothing calls it), push, and rebuild the store
zip — the manifest changed, and the listing's screenshot set is now four, not
five.

## Quick Tasks Completed

| Date | Task | Outcome |
|---|---|---|
| 2026-09-04 | `20260903-focus-on-ask-and-insert` — strip autonomous mode and the selection actions; add a tempo slider and a human typing style | Done. 6,602 lines deleted, 128 added. 44/44 in a real browser; Google Docs left to the operator |
| 2026-09-08 | `20260908-kort-svar-kortere` — "Kort" cut from 40–70 words / four sentences to one or two sentences | Done. Observed against the local backend: 5 of 5 Danish prompts came back at exactly 2 sentences, 23–36 words, voice slips intact |
| 2026-09-09 | `260909-g7z-besvar-alle-genkend-alle-formater-udfyld` — every place in a worksheet gets its own answer: grids, tables with empty rows, "fortsæt herunder…" cells, labels, answered questions skipped | Done. The operator's own worksheet: 32 places filled, nothing unplaced, read back through Docs' export; synthetic sheet 29/29 |
| 2026-09-09 | `260909-h4m-menneske-sletter-med-backspace-aldrig-markering` — the humanizer deletes with Backspace, checked in a way the screen never shows; a filled answer cell means the question is answered | Done. Probe 48/48 with 0 ms marked; Langsomt worksheet 26/26 twice, screen read every frame; whole chain green; backend deployed; store zip built, upload pending |
| 2026-09-25 | `260925-j9r-landing-favicon` — chatbotskriv.dk gets a favicon Google can use (favicon.ico + 48/96px, same logo) | Done. Live: all three files 200, all 6 sitemap pages link them (commit e4fece0) |
| 2026-10-06 | `261006-gf9-referral-system` — invitations: friend gets a 14-day trial, inviter gets 30 days (or a Stripe credit) when the friend first pays, cap 12 a year, all set from the dashboard | Done. Backend + landing live, migration 0017 applied. Proven with three Stripe test-mode payments on a preview and with the built extension in Chrome against production. Extension 0.2.4 zip built, store upload pending |

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
