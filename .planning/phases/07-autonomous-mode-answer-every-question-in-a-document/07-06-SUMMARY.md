---
phase: 07-autonomous-mode-answer-every-question-in-a-document
plan: 06
subsystem: acceptance test, permission disclosure, operator walkthrough
tags: [acceptance, privacy, chrome-web-store, oauth, uat, google-docs]

dependency-graph:
  requires:
    - phase: 07-05
      provides: "resolveDocsSource() and the three Google Docs sources; the spike page's full-run harness"
    - phase: 07-04
      provides: "Besvar markeringen writing directly; the whole-run transport bar"
  provides:
    - "The operator's own scenario as an executable test — attachment included, undo compared character for character"
    - "Truthful disclosure of the auth/documents scope in PRIVACY.md, STORE-LISTING.md and CHROME-WEB-STORE.md"
    - "TESTING.md's six-check autonomous walkthrough, and 07-UAT.md waiting for what is actually seen"
    - "The whitespace probe — the open Docs defect turned into a designed experiment with its reading fixed in advance"
  affects:
    - "Phase closure: the phase does NOT close on this plan. Three of the five ROADMAP criteria can only be observed on a real Google Doc, and the operator deferred that pass."

tech-stack:
  added: []
  patterns:
    - "An acceptance test that proves grounding rather than assuming it: a fact present only in an attached file must come back out inside an answer (D-11)"
    - "A probe whose interpretation table is written before the run, so the result cannot be read to suit a preferred fix"

key-files:
  created:
    - .planning/phases/07-autonomous-mode-answer-every-question-in-a-document/07-UAT.md
  modified:
    - scripts/verify-autonomous.mjs
    - PRIVACY.md
    - docs/STORE-LISTING.md
    - docs/CHROME-WEB-STORE.md
    - TESTING.md
    - apps/extension/entrypoints/content/index.tsx
    - apps/extension/entrypoints/spike/main.ts
    - apps/extension/entrypoints/spike/index.html
    - apps/extension/sidebar/chat.ts
    - apps/extension/sidebar/store.ts
    - apps/extension/insertion/target.ts
    - apps/extension/insertion/adapters/gdocs.ts
    - apps/extension/insertion/autonomous/docs-source.ts
---

# 07-06 — Prove the phase, and tell the truth about the permission

## What was built

**Task 1 — the acceptance scenario.** `scripts/verify-autonomous.mjs` gained a
final "Acceptance scenario" section that walks the operator's framing in one
flow instead of as separate feature probes: fresh load still signed in → attach
the material a worker would answer from → click into the document → one button →
Langsomt → assert mid-run that question one is being answered before question
two is touched → assert at the end that a fact existing **only** in the attached
file came back out inside an answer → one press of Fortryd restores the document
compared in full, character for character.

The attachment is what makes it more than a repeat of the sections above it.
D-11 says answers are built from the worker's own material; that is only proven
if something that appears nowhere on the page comes back out.

**Task 2 — the disclosure.** The extension now asks for access to a person's
Google documents, and nothing said so.

- `PRIVACY.md` names the exact scope (`https://www.googleapis.com/auth/documents`
  and nothing else), that it is requested at first use rather than at sign-up,
  what is read, what is written, that Drive is never touched, where the document
  text goes, and that declining still gets you answers.
- `docs/STORE-LISTING.md` has the justification a reviewer reads, plus the fact
  that `auth/documents` is a sensitive scope and the OAuth app sits in Testing
  mode (100 users, no verification) — public launch needs Google to verify it.
- `docs/CHROME-WEB-STORE.md` has the pre-submission check on the extension ID:
  the Docs OAuth client is bound to one ID, and a mismatch fails with
  `bad client id` for every user while everything else looks normal. The
  manifest `key` pins it, so this is a confirmation rather than a repair.
- `TESTING.md` has the six-check walkthrough: three editors, both entry points,
  both modes, the decline path, and the unchanged "Brug som kontekst".

**Task 3 — the walkthrough.** `07-UAT.md` is written with one section per
ROADMAP success criterion and the observation fields deliberately blank. Where
automation already covers a criterion for the two testable editors it cites the
passing section rather than spending operator time on it.

## Two defects fixed along the way

Neither was in this plan's file list; both were open findings that would have
made the walkthrough report a false result.

1. **F-1** (`dd8a16c`) — marking text on Docs never showed the buttons, because
   `selectionText()` ended at `document.getSelection()`, always empty on a
   canvas. Criterion 5 could not have been observed on Docs at all without this.
2. **`chat.ts` contentClass** (`f26d78c`) — every chat request shipped as
   `synthetic`, routing real user text to free models allowed to train on it
   while the published policy promised the opposite. Disclosing the Docs scope
   honestly in the same pass as leaving that in place would have been absurd.
   It also closes the standing blocker at the end of STORE-LISTING.md.

## What is NOT done, and why

**The phase does not close here.** Task 3's human-check is the whole point of
the plan, and the operator deferred it: *"forget the checks. just finish the
build then we take the browser checks."* Everything buildable is built; nothing
Docs-specific has been observed.

Outstanding, in the order that unblocks the most:

1. **The whitespace probe** (F-4 in `07-FINDINGS-docs.md`). Slow-typed text on
   Docs arrives without its spaces. Not fixed, on purpose — three fixes for this
   adapter have already been written from reasoning instead of observation and
   all three were wrong. The probe is now a button on the spike page that writes
   the same string three ways and reads the document back through the API. Its
   interpretation table is fixed in advance. Every Docs write path is behind it.
2. **Re-run the spike.** P3 (Find) failed before `8e5e86d`, when Ctrl+F was
   being dispatched at the frame's `<body>` and reaching nothing. Whether Find
   now works decides whether letter-by-letter writes in place or falls back to
   API block writes — a product difference, not a detail.
3. **The four browser suites.** `pnpm verify`, `pnpm verify:autonomous`,
   `pnpm verify:autonomous-api` and the new acceptance section have not been run
   since this plan's changes. They need the backend on 127.0.0.1:8787 and an
   extension built with `VITE_BACKEND_URL=http://127.0.0.1:8787` — the build in
   `.output` right now points at production.
4. **`ChatView.tsx` does not render `GDocsApiWriteSource`'s Straks
   `degradedReason`.** Known, recorded in 07-UAT.md so it is not misread as the
   operator missing a message.

## Gates

| Gate | Result |
|---|---|
| `tsc --noEmit` (extension) | 0 errors |
| `tsc --noEmit` (backend) | 0 errors |
| `pnpm test` | 10/10 |
| `insertion/engine.test.ts` | 3/3 |
| `pnpm build` | clean; probe present in both the content and spike bundles |
| `pnpm verify` / `verify:autonomous` / `verify:autonomous-api` | **not run** — browser pass deferred by the operator |
