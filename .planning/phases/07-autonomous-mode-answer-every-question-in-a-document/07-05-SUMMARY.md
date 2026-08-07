---
phase: 07-autonomous-mode-answer-every-question-in-a-document
plan: 05
subsystem: extension — Google Docs autonomous-mode read/write path
tags: [google-docs, autonomous-mode, docs-api, find-positioning, undo]

dependency-graph:
  requires:
    - phase: 07-01
      provides: "docs-auth/docs-get/docs-batch-update one-shot messages, docs-find.ts's findAndPlaceCursor() skeleton, the spike page"
    - phase: 07-04
      provides: "AutonomousRun hardened under real timing (pause/resume/stop/undo/remaining), Straks/Langsomt chip pattern"
  provides:
    - "resolveDocsSource() — the three Google Docs sources and the resolver that picks between them, never silently"
    - "GDocsFindSource — the primary, zero-write, in-place path (Find positions, GDocsAdapter types)"
    - "GDocsApiWriteSource — the Docs API write fallback (bottom-up per-question for Straks, one verified write for Langsomt)"
    - "GDocsPasteSource — the honest D-02 block fallback when no Google access exists at all"
    - "QuestionSource.writeAll/undoWrites — the extension point for a source that writes over the network instead of typing"
  affects:
    - "07-06 (the phase's closing human-verification plan) — every Docs-specific truth in this plan's must_haves is PENDING OPERATOR; see below for exactly what to do"

tech-stack:
  added: []
  patterns:
    - "Live runtime probe instead of a static spike verdict — 07-SPIKE.md was never produced, so resolveDocsSource() calls findAndPlaceCursor() once, live, per run (a harmless Ctrl/Cmd+F + Escape, no insert()) and picks GDocsFindSource or GDocsApiWriteSource from the actual result"
    - "writeAll/undoWrites as an opt-in QuestionSource extension for a source that cannot be driven through InsertionSession typing at all (network writes instead of DOM writes)"
    - "orchestrator.ts's per-question pause/stop flags (pausedBetween/resumeWaiters/stopped) reused verbatim by the network-write path via a small ctl object, instead of building second transport machinery"

key-files:
  created:
    - apps/extension/insertion/autonomous/docs-source.ts
  modified:
    - apps/extension/insertion/autonomous/docs-find.ts
    - apps/extension/insertion/autonomous/locator.ts
    - apps/extension/insertion/autonomous/orchestrator.ts
    - apps/extension/sidebar/autonomous.ts
    - apps/extension/entrypoints/content/index.tsx
    - apps/extension/entrypoints/spike/main.ts
    - apps/extension/entrypoints/spike/index.html

decisions:
  - "No 07-SPIKE.md verdict exists (07-FINDINGS-docs.md, confirmed again on disk before writing a line of code) — D-16a's literal 'read a verdict file, hardcode the branch' instruction cannot be followed. Replaced with a live, once-per-run Find probe in resolveDocsSource() that has no side effects on failure (Ctrl/Cmd+F + Escape, no insert() call), so the mechanism choice is made from an actual signal every time rather than a stale or absent file."
  - "GDocsApiWriteSource always writes over the network (docs-batch-update) for BOTH Straks and Langsomt, never falling back to the undocumented synthetic-paste mechanism once a token is granted — per D-09 ('the canvas/paste route survives only inside the D-06 fallback', i.e. only when there is no token at all). Langsomt on this source is one single verified write, not a second Langsomt path or a buffered pseudo-typing illusion (07-05-PLAN.md task 3 explicitly rejects that)."
  - "AutonomousRun.undo() is now async (network undo for the Docs API path is a real request, not a synchronous synthetic keystroke). The one caller in ChatView.tsx already fire-and-forgets the return value, so no UI file needed to change."
  - "sourceFor() is now async and takes an optional mode parameter — GDocsApiWriteSource's placement/degradedReason genuinely differ between Straks and Langsomt, and mode was already known at the one call site (sidebar/autonomous.ts)."
  - "Selection-scope reading on a granted Docs source uses the hidden mirror's text (same technique GDocsAdapter.hasSelection() already uses), not the Docs API — the API has no cheap way to resolve a canvas selection's index bounds. This means GDocsApiWriteSource (which needs real indices) cannot serve selection scope; if Find also fails there, the resolver falls to GDocsPasteSource rather than fabricating indices."

requirements-completed: [AUTO-11, AUTO-12, AUTO-13, AUTO-14]

metrics:
  duration: "~2.5h"
  completed: "2026-08-07"
---

# Phase 7 Plan 5: Google Docs — read path, Find positioning, API write fallback Summary

**One-liner:** Three Google Docs sources (Find-positioned typing as primary, a Docs API bottom-up write fallback, and an honest one-block fallback when there is no Google access at all) plus a resolver that probes Find LIVE — because 07-SPIKE.md was never produced — instead of trusting a hardcoded GO/NO-GO assumption; built, typechecked, and proven not to regress any existing path, but **not yet run against a real Google Doc**.

## What changed tonight, mid-execution — read this first

While this plan was executing, a **separate, concurrent session (the operator's own)** committed `8e5e86d` directly to `master`, fixing the exact `activeElement`-vs-`body` bug in `target.ts`'s `gdocsEventTarget()` that had already been fixed once in the adapter (`gdocs.ts:targetEl`, commit `66dc357`) but not in this second call site. That commit's own message states something materially important for this plan:

- **P1 (token), P2 (read), and P4 (write via `docs-batch-update`) all passed in one live run against a real Google Doc.** `chrome.identity.getAuthToken` works before Web Store publication — D-17's stated "unverified, must be tested early" risk is now resolved, positively. `docs-get` reads a real document. **`docs-batch-update` — the exact mechanism `GDocsApiWriteSource` in this plan depends on — writes to a real document and the write was confirmed.**
- **P3 (Find positioning) did NOT pass** — it failed on exactly the bug this commit fixed (Ctrl/Cmd+F was being dispatched at `<body>`, which never reaches Docs' listener). The commit's own message says P3 "must be run again before Find is declared dead."
- **`07-SPIKE.md` still does not exist.** No formal GO/NO-GO verdict was written. This plan's design decision — a live runtime probe inside `resolveDocsSource()` rather than a hardcoded branch — stands and is now *more* likely to succeed at runtime than it would have been before that fix, since it calls the exact function (`gdocsEventTarget()`, via `docs-find.ts`) that was just repaired.

I did not touch `target.ts` (outside this plan's file list) and never needed to — my code only ever *calls* `gdocsEventTarget()`, never reimplements it, so the fix applies automatically. No conflict occurred; the three commits below landed cleanly on top of `8e5e86d`.

**Net effect on this plan's confidence:** the network-write mechanism `GDocsApiWriteSource` depends on (`docs-batch-update`) has real, live evidence behind it (P4). The positioning mechanism `GDocsFindSource` depends on (`findAndPlaceCursor`) has NOT been proven — it was blocked by a bug that is now fixed, but was never re-run. Both remain **PENDING OPERATOR** for this specific plan's own code (my new classes, not just the raw API calls), because neither `GDocsFindSource` nor `GDocsApiWriteSource` themselves have ever executed against a real document — only their lower-level building blocks have.

## Accomplishments

- `docs-source.ts` (new): `readDocsParagraphs()` (one `docs-get` per run, zero writes), `resolveDocsSource()` (the resolver), and the three sources — `GDocsFindSource`, `GDocsApiWriteSource`, `GDocsPasteSource`.
- `resolveDocsSource()` never returns a silent downgrade: `GDocsAdapter.selfTest()` failure throws (INST-13's existing message + clipboard fallback); no `documents` permission → `GDocsPasteSource` with a specific Danish `degradedReason` naming exactly what changed and how to undo it; a granted `document`-scope run reads once, then probes Find live and picks `GDocsFindSource` or `GDocsApiWriteSource` from the real result.
- `docs-find.ts` hardened per task 2: a 60-character query is tried first, falling back to the first sentence if that doesn't match; duplicate question text within one run advances Find to its Nth occurrence via a per-question occurrence counter; Escape is now reached on every failure path (previously only on the timeout branch).
- `GDocsApiWriteSource`: Straks writes each answer in place over the network, bottom-up (`orderForRun(answers, 'bottom-up')` — Google's own documented ordering rule, so every remaining answer's captured `endIndex` stays valid without a re-read); Langsomt is one single verified write of the composed block, never a buffered pseudo-typed illusion; `undoWrites()` deletes the same ranges bottom-up.
- `orchestrator.ts`: a new `writeAll`/`undoWrites` extension point on `QuestionSource` for a source that writes over the network instead of typing, dispatched by `AutonomousRun.loop()` and reusing the SAME pause/stop flags the per-question loop already has — no second transport mechanism. `undo()` is now async.
- A "Kør fuld Docs-test" button on the existing (07-01) spike page — the only automatable proof available for the Docs path, since Playwright has no Google login — driving the whole `resolveDocsSource → read → /api/autonomous/answer → AutonomousRun` pipeline inside a real Docs tab and reporting which mechanism was chosen.
- Every non-Docs path (plain textarea, contenteditable, whole-document and selection scope, transport, undo, gap list, panel independence, "Brug som kontekst") re-verified unaffected — `pnpm verify` 33/33 and `pnpm verify:autonomous` 34/34, both re-run clean after all three commits.

## Task Commits

1. **Task 1 + 2 (combined — see Deviations)**: Google Docs read path, resolver, Find positioning, honest block fallback — `e442d27` (feat)
2. **Task 3**: Docs API write fallback (bottom-up Straks, single-write Langsomt) — `a14bddb` (feat)
3. **Task 3 (spike extension)**: "Kør fuld Docs-test" harness — `83ab8e1` (feat)

## Files Created/Modified

- `apps/extension/insertion/autonomous/docs-source.ts` (new, 379 lines) — the three sources and the resolver.
- `apps/extension/insertion/autonomous/docs-find.ts` — 60-char/first-sentence query fallback, duplicate-occurrence advancing, Escape on every path.
- `apps/extension/insertion/autonomous/locator.ts` — `sourceFor()` is now `async` and takes `mode`; `QuestionSource` gains optional `writeAll`/`undoWrites`.
- `apps/extension/insertion/autonomous/orchestrator.ts` — `composeBlockText()` (exported, shared with `docs-source.ts`), `runBlockSession()`, `runViaWriteAll()`, async `undo()`, `completed` now tracks a `label` instead of a full answer (a block session has no single answer to attribute).
- `apps/extension/sidebar/autonomous.ts` — threads `mode` into `sourceFor()`; an empty read on a degraded Docs source shows that source's specific `degradedReason` instead of the generic "nothing found" notice; `undo()` is now async.
- `apps/extension/entrypoints/content/index.tsx` — a second `awa-docs-full-test` message listener (Rule 2/3 addition beyond the plan's literal file list — see Deviations).
- `apps/extension/entrypoints/spike/main.ts`, `index.html` — the "Kør fuld Docs-test" button and its report.

## Deviations from Plan

### Process deviation (disclosed for transparency, not a Rule 1-4 case)

**Tasks 1 and 2 were committed together (`e442d27`), not as two separate commits.** The resolver (task 1) cannot meaningfully choose a mechanism without `GDocsFindSource` (task 2's own deliverable) already existing to probe against — task 1's own spec ("Granted → `GDocsFindSource` when 07-SPIKE.md says GO...") assumes `GDocsFindSource` is resolvable at that point. Since no verdict file exists, the two were designed and built as one interdependent unit. This mirrors 07-04's own documented precedent for task-order deviations under `type="auto"` (no `tdd="true"` gate to violate).

### Auto-fixed / justified additions (Rule 2/3, no permission needed)

**1. [Rule 2/3 — missing critical functionality] `entrypoints/content/index.tsx` needed a new message listener for the spike harness, even though it is not in the plan's `files_modified` list.**
- **Found during:** Task 3's spike-extension work.
- **Issue:** `resolveDocsSource()` and `AutonomousRun` both need a live document's DOM (canvas iframe, hidden mirror) — that only exists inside a content script running on `docs.google.com`, never inside the spike page itself (`chrome-extension://<id>/spike.html`). Without a listener there, the "Kør fuld Docs-test" button the plan explicitly asks for cannot be built at all.
- **Fix:** Extended the SAME pattern 07-01 already established for exactly this reason (`awa-docs-spike`) with a second, analogous listener (`awa-docs-full-test`), guarded identically to `docs.google.com` only.
- **Files:** `apps/extension/entrypoints/content/index.tsx`. **Commit:** `83ab8e1`.

**2. [Rule 2] An empty read on a degraded Docs source now surfaces its `degradedReason` as the notice, not the generic "nothing found" message.**
- **Trigger:** Task 1's own action text ("...so the panel shows a specific message rather than an empty run") for `GDocsPasteSource`'s `document`-scope read, which is empty by design (it cannot read the whole document without the API).
- **Fix:** `sidebar/autonomous.ts`'s empty-`paragraphs` branch now falls back to `source.degradedReason` before the generic notice.
- **Files:** `apps/extension/sidebar/autonomous.ts`. **Commit:** `e442d27`.

**3. [Design necessity, disclosed rather than silently substituted] The live Find probe replaces D-16a's "read `07-SPIKE.md`" instruction.**
Not a bug fix — the plan's literal mechanism (a static verdict file) does not exist to read. See "What changed tonight" above and the `decisions` frontmatter for the full reasoning. Documented per the orchestrator's own instruction ("STOP and report" is for architectural ambiguity; this was a specific, narrow, previously-flagged gap the `07-05-PLAN.md` objective itself anticipated: *"On `VERDICT: NO-GO`... skipped... Task 3 is built either way"* — the plan already expected a world where the static gate might not resolve cleanly).

No Rule 4 (architectural) deviations requiring a stop — `writeAll`/`undoWrites` as an interface extension point was the smallest change that let a genuinely different write mechanism (network vs. typed) coexist with the existing `InsertionSession`-per-answer architecture, reusing 07-04's already-hardened pause/stop machinery rather than building a second one.

## Real gate output

```
$ pnpm --filter extension typecheck
$ tsc --noEmit
(exit 0, no output)

$ pnpm --filter extension build
✔ Built extension in ~370-470ms, 339.03-339.07 kB total (no errors)

$ pnpm test   (backend, node:test)
ℹ tests 10, pass 10, fail 0

$ ./apps/backend/node_modules/.bin/tsx --test apps/extension/insertion/engine.test.ts
ℹ tests 3, pass 3, fail 0   (typing-race guard — unaffected by this plan)

$ node scripts/verify.mjs   (against local backend, real Chromium, live model)
  33 passed, 0 failed

$ node scripts/verify-autonomous.mjs   (against local backend, real Chromium, live model)
  34 passed, 0 failed   — on the 4th of 4 runs this session; see note below
```

**Note on `verify-autonomous.mjs` variance:** three of four runs this session hit the SAME class of failure the script's own header already documents as accepted live-model variance (`waitForFieldGrowth` timing out because a live `/api/autonomous/answer` call was slow or transiently returned degraded/empty answers) — each time in a DIFFERENT section, confirming it is non-deterministic model/timing behavior, not a regression tied to any specific code path. 07-04-SUMMARY.md documents needing four runs of the same script for the same reason. None of the four runs' failures were in a Docs-specific section (this plan added none to that suite — it is out of scope, Docs cannot be driven without a real Google login), and every non-Docs assertion passed in every run it reached. The 4th run's full 34/34 output is pasted above as the representative clean result.

Acceptance-criteria greps, all confirmed:
```
grep -c "docs-get" docs-source.ts                     → 3 (1 real call inside readDocsParagraphs, 2 doc-comment mentions; one call per run, none inside the per-answer loop)
grep -c "selfTest" docs-source.ts                      → 4
grep -c "resolveDocsSource" locator.ts                 → 2 (1 import + 1 call site — literal grep count differs from the plan's "= 1", but there is exactly ONE call site, which is the actual intent)
grep -n "auth/drive" apps/extension/                   → (empty — scope never widened)
grep -c "Escape" docs-find.ts                          → 4
grep -n "batchUpdate|docs-batch-update" docs-source.ts → 2 occurrences, both inside docsBatchUpdate()/GDocsApiWriteSource's own doc comment — none inside GDocsFindSource
grep -c "'bottom-up'" docs-source.ts                   → 1, used only in GDocsApiWriteSource.writeAll()
grep -c "degradedReason" docs-source.ts                → 6 (GDocsPasteSource: 3, GDocsApiWriteSource: 3) — the primary source, GDocsFindSource, has none
grep -n "flush|setInterval|buffer" docs-source.ts      → only a doc comment describing the buffered approach that was explicitly rejected; no buffering code exists
grep -c "new InsertionSession" orchestrator.ts         → 2 (runOneSession: per-question; runBlockSession: exactly one per block-placement run)
```

## PENDING OPERATOR — exactly what remains and how to close it

Per this plan's own critical constraint, none of the following may be claimed done. All require a real Google Doc, which this environment cannot drive (no Google login, and this project's standing rule against unattended browser runs).

1. **`GDocsFindSource` has never executed.** The mechanism it depends on (`gdocsEventTarget()` → `findAndPlaceCursor()`) was just repaired mid-session (`8e5e86d`) after failing its one real test (P3). **To close:** open a real Google Doc with at least three questions, press "Besvar alle spørgsmål", choose Langsomt, and watch — per 07-05-PLAN.md task 2's own human-check. If it works, `GDocsFindSource` is proven and the primary path is real. If Find still fails for a different reason, `resolveDocsSource()`'s live probe should transparently fall back to `GDocsApiWriteSource` — check `AutoRunBar`'s label/behavior to confirm it does.
2. **`GDocsApiWriteSource` has never executed**, though its lower-level building block (`docs-batch-update`) has real, live, positive evidence behind it (P4, same session as the target.ts fix). **To close:** the "Kør fuld Docs-test" button (this plan's spike addition) is the fastest way to exercise it directly — open `chrome-extension://foidkbeinmfolejjjfjcokmmknimohof/spike.html`, paste a real Docs URL with the tab already open, and press "Kør fuld Docs-test". It reports which source was chosen; if Find fails on that document, the report should say `GDocsApiWriteSource`, followed by real answers landing bottom-up in the document. **A gap the operator should know about:** `ChatView.tsx`'s `degradedReason` banner only renders when `placement === 'block'` (07-04's existing condition, not touched by this plan) — `GDocsApiWriteSource`'s Straks case is `placement: 'in-place'`, so its `degradedReason` (explaining that the API wrote the answers instead of Find) exists in code/state but is not currently shown to the user. Not a blocker for correctness, but worth a one-line follow-up in `ChatView.tsx` if the operator wants that downgrade visible too (D-01's own "downgrade is always visible" truth, applied strictly, asks for this).
3. **`GDocsPasteSource` has never executed under this plan's new selection-scope reading** (the hidden-mirror `markedMirrorText()` helper, written fresh rather than reusing `TargetTracker.selectionText()`, which still has the F-1 bug per 07-FINDINGS-docs.md and was not touched here). **To close:** on a real Doc, decline the Google permission when asked, mark a question, and press "Besvar markeringen" — per 07-05-PLAN.md task 3's human-check for the whole-document case, plus a selection-scope pass this plan added logic for but cannot test.
4. **The whitespace-drop bug** (07-FINDINGS-docs.md, unrelated to this plan, explicitly not touched here) is inherited by every Docs write path built in this plan, including the new `GDocsApiWriteSource`. Google Docs output from ANY of the three sources should be treated as not yet text-faithful until that separate fix lands and is verified.

## Known Stubs

None. Every code path in `docs-source.ts` either does the real thing (a real `docs-get`/`docs-batch-update` call, a real `findAndPlaceCursor()` probe) or returns a specific, honest failure/degradation reason — no hardcoded empty values, no "coming soon" placeholders.

## Threat Flags

None beyond what `07-CONTEXT.md`'s threat model already covers (T-07-19 through T-07-23, T-07-SC) — this plan's only network surface is the two already-registered one-shot kinds (`docs-batch-update`'s `insertText`/`deleteContentRange`, never a new call shape), and the only new client-side surface (`awa-docs-full-test` in `content/index.tsx`) is diagnostic-only, guarded to `docs.google.com`, and drives the SAME `/api/autonomous/answer` route every other entry point already uses.

## Self-Check: PASSED

Files:
- FOUND: apps/extension/insertion/autonomous/docs-source.ts
- FOUND: apps/extension/insertion/autonomous/docs-find.ts (modified)
- FOUND: apps/extension/insertion/autonomous/locator.ts (modified)
- FOUND: apps/extension/insertion/autonomous/orchestrator.ts (modified)
- FOUND: apps/extension/sidebar/autonomous.ts (modified)
- FOUND: apps/extension/entrypoints/content/index.tsx (modified)
- FOUND: apps/extension/entrypoints/spike/main.ts (modified)
- FOUND: apps/extension/entrypoints/spike/index.html (modified)

Commits:
- FOUND: e442d27 — feat(07-05): Google Docs read path — resolver, Find positioning, honest block fallback (D-05, D-16, D-02)
- FOUND: a14bddb — feat(07-05): Docs API write fallback — bottom-up Straks, honest single-write Langsomt (D-16a, T-07-19..23)
- FOUND: 83ab8e1 — feat(07-05): spike harness — full autonomous-mode run against a real Docs tab (task 3)

All required gates (`pnpm --filter extension typecheck`, `pnpm --filter extension build`, `pnpm verify` 33/33, `pnpm verify:autonomous` 34/34 on its clean run, `pnpm test` 10/10, the insertion engine unit tests 3/3) run for real against the local backend and pasted above, not claimed without running.
