# Phase 7 — operator walkthrough (UAT)

One section per ROADMAP success criterion. **Observations are recorded here as
they are reported, not as they are supposed to happen.** A criterion that half
works is written down as half working.

- **Script:** `TESTING.md` → "Autonomous mode — the 20-minute walkthrough"
- **Status:** ⏳ not yet walked. Written 2026-08-07; the operator deferred the
  browser pass to a later session ("forget the checks. just finish the build
  then we take the browser checks").
- **Prerequisite the operator must confirm first:** the Doc saves their own
  typing ("Alle ændringer gemt"). Two debugging rounds on 2026-08-06 were spent
  against a Docs session that was offline — see F-3 in `07-FINDINGS-docs.md`.

## Which Docs path was in use

`resolveDocsSource` probes Find live, once per run, and picks the source from
the result (07-05-SUMMARY.md). **Every Docs observation below must name which
one was actually in play** — the panel says so:

| Source | What it means |
|---|---|
| `GDocsFindSource` | Ctrl/Cmd+F positioning, zero API writes — the primary path |
| `GDocsApiWriteSource` | `documents.batchUpdate`, bottom-up — the fallback when Find fails |
| paste fallback | the permission was declined; one block at the cursor |

The last spike run reported P3 (Find) FAILING, but that run predates the
`target.ts` fix in `8e5e86d` — the Ctrl+F was being dispatched at the frame's
`<body>` and reaching nothing. Re-running the spike is what settles which path
is primary; until then, treat a `GDocsApiWriteSource` observation as expected
rather than as a regression.

---

## Criterion 1 — every question answered directly beneath it

> …in a plain textarea, a contenteditable editor, **and a real Google Doc**.

**Plain textarea** — covered by automation, no operator time needed:
`scripts/verify-autonomous.mjs` → "Autonomous run: whole document, Straks, plain
textarea", plus the new "Acceptance scenario" section.
Observed: _(pending — automation not yet re-run since 07-06)_

**Contenteditable** — covered by automation:
`scripts/verify-autonomous.mjs` → "Autonomous run: whole document, Langsomt,
contenteditable".
Observed: _(pending — automation not yet re-run since 07-06)_

**Real Google Doc** — no automation here can reach it. TESTING.md check 3.
- Source in use: _(Find / batchUpdate / paste fallback)_
- Observed: _(pending)_
- Screenshot: _(pending)_

---

## Criterion 2 — a marking holding ten questions

> …asked Straks or Langsomt, and every marked question answered in place.

Automation covers the ten-question marking in a plain field
(`verify-autonomous.mjs` → the `#ten` sections). TESTING.md check 4 covers the
same thing in a real Doc, which is where it has never been seen.

- Observed (Docs): _(pending)_
- Any question skipped: _(pending)_

---

## Criterion 3 — Langsomt types top-down; pause/resume/stop/undo act on the whole run

Automation covers pause, resume, the typing-race auto-pause, undo-in-one-press
and panel independence in the two testable editors. The new acceptance section
additionally asserts top-down ordering while the run is live.

- Observed (Docs, TESTING.md check 3): _(pending)_
- Did **Fortryd alle svar** remove everything in one press: _(pending)_

---

## Criterion 4 — exact placement on Docs, and an honest degraded path when declined

Two halves, and the second is the one that is easy to skip:

**Permission granted** — answers at the right positions, formatting intact.
- Source in use: _(pending)_
- Formatting intact: _(pending)_
- **Whitespace:** known open defect — slow-typed text on Docs may arrive with
  spaces missing ("detterikke"). Record whether it appeared; do not treat it as
  a new finding.

**Permission declined** — TESTING.md check 5.
- Did answers still arrive: _(pending)_
- Was the placement difference stated plainly in the panel: _(pending)_
- **Failure condition:** nothing happening, silently. Record that verbatim if
  it happens.

> Known gap, separate from the walkthrough: `GDocsApiWriteSource`'s Straks path
> sets a `degradedReason` that `ChatView.tsx` does not render. If the panel says
> nothing about degraded placement while writing through the API, that is this
> defect and not the operator missing it.

---

## Criterion 5 — "Brug som kontekst" is unchanged

Automation covers it in a plain field (`verify-autonomous.mjs` → "Regression:
Brug som kontekst is unchanged"). On Docs it could not work at all until
2026-08-07 (F-1: the selection bar never appeared, because Docs paints to
canvas). TESTING.md check 6 is the first time it can be seen there.

- Chip appears on Docs: _(pending)_
- Nothing written into the document: _(pending)_

---

## Outcome

_(To be filled in after the walkthrough. If anything fails, this phase does not
close — the gap-closure path exists for exactly that: `/gsd:plan-phase 7 --gaps`.)_
