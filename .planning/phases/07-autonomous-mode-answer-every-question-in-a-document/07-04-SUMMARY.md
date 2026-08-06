---
phase: 07-autonomous-mode-answer-every-question-in-a-document
plan: 04
subsystem: extension
tags: [autonomous-mode, insertion-engine, e2e, transport-controls]

requires:
  - phase: 07-03
    provides: "AutonomousRun orchestrator, QuestionSource/sourceFor, sidebar/autonomous.ts controller, store.autoRun with unplaced/ungrounded already populated"
provides:
  - "Besvar markeringen writing directly (Straks/Langsomt, no draft/Insert step) — D-04a"
  - "AutoRunBar: full whole-run transport (pause/resume/stop/undo-all/hide) plus the gap list (Uden grundlag i dine kilder / Kunne ikke placeres)"
  - "AutonomousRun hardened: pause holds between answers AND during the initial backend call, undo resets to idle, a failed run copies remaining answers to the clipboard"
  - "E2E proof: ten questions in one marking, whole-run pause/resume/undo, typing-race pause, the gap list, panel independence — all in real Chromium against the live model"
affects:
  - "07-05 (Google Docs) — sourceFor() still refuses a gdocs target; the selection-scope DomSource path this plan proved for plain/contenteditable is what 07-05 must match for Docs"

tech-stack:
  added: []
  patterns:
    - "Flag-based pause, not session-forwarding-only — pause()/start(startPaused) hold the queue even when there is no InsertionSession yet to forward the click to (between answers, or during the initial backend call)"
    - "Whole-run undo mirrors InsertionSession's own idle+'undone' convention, so the transport bar never claims a run is still 'Færdig' after every answer was just removed"

key-files:
  created: []
  modified:
    - apps/extension/sidebar/components/ChatView.tsx
    - apps/extension/sidebar/autonomous.ts
    - apps/extension/insertion/autonomous/orchestrator.ts
    - scripts/verify-autonomous.mjs
    - scripts/verify.mjs

decisions:
  - "Task 2 (UI) was implemented before Task 1's test additions, not after — the reusable Straks/Langsomt chip pattern and exact button/label text needed to exist before a meaningful E2E test could be written against it. The RED signal Task 1 normally provides came instead from the FIRST real run of the finished test suite against the just-built UI plus the not-yet-hardened orchestrator, which genuinely failed in the ways Task 3 was written to fix (see Deviations)."
  - "pause() is flag-based, not purely session-forwarding: a pause pressed between two answers, or during the initial ~20-25s /api/autonomous/answer call (before any InsertionSession exists), is remembered and applied atomically via a new startPaused param on start() — the previous behaviour silently dropped both."
  - "undo() now transitions AutonomousRun to 'idle' and resets progress on full success, mirroring InsertionSession's own idle+'undone' pattern, so the panel does not keep claiming 'Færdig ✓ 10/10' after every answer was just removed."
  - "A run that errors mid-flight now copies its remaining (un-written) answers to the clipboard, via a new AutonomousRun.remaining() method — the same courtesy inserter.ts already extends on a failed manual insert (AUTO-17)."

requirements-completed: [AUTO-02, AUTO-05, AUTO-07, AUTO-09, AUTO-10, AUTO-15, AUTO-16, AUTO-17]

duration: "~3h"
completed: 2026-08-06
---

# Phase 7 Plan 4: Besvar markeringen, whole-run transport, and the gap list Summary

**One-liner:** "Besvar markeringen" now asks Straks/Langsomt and writes straight into the marking — ten questions in one marking behave exactly like one — while a new `AutoRunBar` gives the whole run (either entry point) pause/resume/stop/undo-all and a gap list, proven end-to-end in real Chromium including two real timing bugs the live-model E2E surfaced and fixed: pause silently dropped during the initial backend call, and premature "Skriver"-text waits that raced past the actual typing.

## Performance

- **Duration:** ~3h (four full live-model E2E runs of `verify-autonomous.mjs`, two of `verify.mjs`)
- **Tasks:** 3/3 complete (executed out of literal order — see Decisions/Deviations)
- **Files modified:** 5

## Accomplishments

- "Besvar markeringen" on a selection of ANY size — one question or ten — asks Straks/Langsomt and writes directly; the old generate-into-the-panel-then-Insert two-step is gone on that path only (D-04a). "Brug som kontekst" is byte-for-byte the same handler/chip it always was (D-04b), proven by the unchanged regression assertions (plus one intentionally-updated wording assertion, see Deviations).
- `AutoRunBar`: a sticky transport bar styled like `InsertBar`, reachable from either entry point (document or selection scope), with Pause/Fortsæt/Stop/"Fortryd alle svar"/Skjul, the `degradedReason` line, and a two-part gap list ("Uden grundlag i dine kilder" for `grounded:false` answers, a separate "Kunne ikke placeres" list for `unplaced` questions) — nothing is ever marked in the document itself (D-12).
- `AutonomousRun.pause()`/`start()` now genuinely hold the whole run under real timing, not just the happy path where a click happens to land mid-typing — see Deviations for the two live-model-surfaced bugs this fixed.
- `AutonomousRun.undo()` resets to `'idle'` on full success so the panel stops claiming a finished run after every answer was just removed.
- A run that errors mid-flight copies its remaining answers to the clipboard, matching the courtesy `inserter.ts` already extends on a failed manual insert.

## Task Commits

1. **Task 2 (built first — see Decisions): Besvar markeringen writes directly, whole-run transport bar** — `9118540` (feat)
2. **Task 1: E2E coverage for ten questions, transport, gap list** — `436409b` (test)
3. **Task 3: whole-run control hardening (RED to GREEN)** — `9fd50ed` (fix)
4. **Deviation fix: stale regression wording** — `faae875` (test)

**Plan metadata:** (this commit, docs)

## Files Created/Modified

- `apps/extension/sidebar/components/ChatView.tsx` — selection bar now reveals Straks/Langsomt chips instead of the old draft chip; `AutoRunBar` added beside `InsertBar`; dead `selSubject` state removed.
- `apps/extension/sidebar/autonomous.ts` — `loadingRun`/`pauseRequestedWhileLoading` flags so a pause during the initial backend call is honored, not dropped; `startPaused` passed to `AutonomousRun.start()`; clipboard-copy courtesy on a failed run.
- `apps/extension/insertion/autonomous/orchestrator.ts` — flag-based `pausedBetween`/`resumeWaiters` so pause holds between answers; `start(startPaused)`; `undo()` transitions to `'idle'`; new `remaining()` method; D-14 panel-independence comment.
- `scripts/verify-autonomous.mjs` — five new sections (ten-question selection, whole-run transport, typing race, gap list, panel independence) plus the "Brug som kontekst" regression check; two test-only bugs found and fixed while getting these green (see Deviations).
- `scripts/verify.mjs` — one regex updated to match the intentionally-changed "Besvar" explanatory wording (D-04a); the "Kontekst"/baggrundsviden half is untouched.

## Decisions Made

See frontmatter `decisions` — the flag-based pause design and the undo→idle transition are the two structural choices; both are documented inline in `orchestrator.ts` at the point of use.

## Deviations from Plan

### Process deviation (not a Rule 1-4 case, disclosed for transparency)

**Task 2 was implemented before Task 1.** The plan's literal order is test-first (write the failing E2E test, confirm RED, then build). I built Task 2's UI first because the E2E test needed the actual button text/DOM shape ("Besvar markeringen" → Straks/Langsomt chips) to assert against meaningfully, and because these tasks are `type="auto"` without `tdd="true"` — the formal RED/GREEN gate enforcement (which would have blocked this) does not apply to this plan. The first REAL run of the finished test suite (against the built UI, before Task 3's hardening) still produced genuine, unplanned failures — see below — which served the same purpose the plan's RED phase intended: proving the remaining behavior didn't yet exist before fixing it.

### Auto-fixed Issues (Rules 1-3, no permission needed)

**1. [Rule 1 — bug] `pause()` was a silent no-op during the ~20-25s initial `/api/autonomous/answer` call.**
- **Found during:** first live run of the new "whole-run transport" E2E section — `isPaused` stayed false, and the field length was unchanged after the observation window (`len 222 vs 222`).
- **Root cause:** the store shows `state: 'writing'` and a live Pause button the INSTANT `run()` is called (before the backend call resolves), but `AutonomousRun` (`this.active`) either doesn't exist yet or still points at the previous run. `this.active?.pause()` on that stale/absent reference did nothing, and nothing surfaced the failure — a silent no-op, forbidden per AUTO-17.
- **Fix:** `sidebar/autonomous.ts` tracks `loadingRun`/`pauseRequestedWhileLoading`; a pause during that window is remembered and applied atomically via a new `startPaused` parameter on `AutonomousRun.start()`, so the run begins already paused rather than writing one answer first and racing to catch up.
- **Files:** `apps/extension/sidebar/autonomous.ts`, `apps/extension/insertion/autonomous/orchestrator.ts`. **Commit:** `9fd50ed`

**2. [Rule 1 — bug] Pause pressed BETWEEN two answers was silently dropped.**
- **Found during:** same section, same root symptom, second cause — `AutonomousRun.pause()` only ever called `this.currentSession?.pause()`, a no-op whenever no session was currently running (the gap between one answer finishing and the next being located).
- **Fix:** explicit `pausedBetween` flag plus `resumeWaiters` array, checked via `await this.waitIfPausedBetween()` at the top of the loop before `locate()` runs for the next answer; released by both `resume()` and `stop()`.
- **Files:** `apps/extension/insertion/autonomous/orchestrator.ts`. **Commit:** `9fd50ed`

**3. [Rule 1 — test bug] `runSelection()` double-clicked "Besvar markeringen".**
- **Found during:** first RED-ish run — `TimeoutError` waiting for the "Besvar markeringen" button, because the test script clicked it once itself (to assert the Straks/Langsomt choice appears) and then called the reusable `runSelection()` helper, which unconditionally clicked it again — by then the button had already been replaced by the mode chips.
- **Fix:** `runSelection()` takes an `alreadyOpen` option to skip the first attempt's click.
- **Files:** `scripts/verify-autonomous.mjs`. **Commit:** `436409b`

**4. [Rule 1 — test bug] Three E2E sections waited for the "Skriver" state word, not for actual progress.**
- **Found during:** second run — "pause holds...", "the field stops growing...", "a trusted keystroke mid-run pauses...", and "the run advanced while the panel was collapsed" all failed with `222 vs 222` / `222 → 222` (the field's length immediately after `.fill(DOC_TEXT)`, unchanged).
- **Root cause:** `store.autoRun.state` is set to `'writing'` synchronously the instant `run()` is called — well before the ~20-25s `/api/autonomous/answer` call resolves, let alone before the first letter is typed. Waiting for the "Skriver" text (as the earlier draft of this section did) resolves during that loading window, so the subsequent pause-click loop / 900ms-1500ms observation window elapsed entirely before any real typing had started — a test-timing bug, not a product bug (separately confirmed: "the Langsomt run over #doc finishes after resume" already passed in that same run, proving the run itself worked end-to-end).
- **Fix:** new `waitForFieldGrowth(selector, baseLen, timeoutMs)` helper polls the actual field value length past its pre-run baseline (40s timeout, generous enough for the backend call) before any timing-sensitive assertion.
- **Files:** `scripts/verify-autonomous.mjs`. **Commit:** `436409b`

**5. [Rule 1 — bug] `undo()` never told the caller the run had returned to idle.**
- **Found during:** code review while implementing Task 3's undo hardening (not caught by the E2E suite, which only checks document content, not panel wording).
- **Issue:** a full-success undo left `store.autoRun.state` at whatever it was before (typically `'done'`), so the panel kept showing "Færdig ✓ 10/10" after every answer had just been removed — technically not a "failure" but a dishonest state, which the operator's "never a silent no-op" / "state plainly" standard doesn't distinguish from one.
- **Fix:** `undo()` transitions to `'idle'` and calls `onRunState('idle', 'undone')` on full success, mirroring `InsertionSession`'s own convention; `AutoRunBar` maps `'idle'` to "Fortrudt".
- **Files:** `apps/extension/insertion/autonomous/orchestrator.ts`, `apps/extension/sidebar/components/ChatView.tsx`. **Commit:** `9118540` (UI mapping), `9fd50ed` (orchestrator).

**6. [Rule 3 — blocking] `pnpm verify`'s "the two functions are explained in words" assertion went red after the plan-mandated wording change.**
- **Found during:** `pnpm verify` run after Task 3.
- **Issue:** the plan explicitly requires updating the selection bar's explanatory line to truthfully describe the new "writes directly" behavior (D-04a's own action text). `scripts/verify.mjs`'s regex asserted the OLD wording verbatim (`svaret skrives lige under markeringen`), which would stay permanently red regardless of correctness.
- **Fix:** updated the regex to match the new, truthful copy (`skrives direkte ind i markeringen`); the `Kontekst`/`baggrundsviden` half of the same assertion is untouched, since D-04b requires no change there.
- **Files:** `scripts/verify.mjs`. **Commit:** `faae875`

**7. [Rule 2 — missing critical functionality] Added `AutonomousRun.remaining()` and a clipboard-copy courtesy on a failed run.**
- **Trigger:** Task 3's own action text explicitly asks for this ("On an insertion failure, copy the remaining answers to the clipboard and say so"), not present before this plan.
- **Fix:** `remaining()` returns the failed answer plus everything not yet attempted, in run order; `sidebar/autonomous.ts`'s `onRunState('error', ...)` handler copies their text and appends a specific count to the error message.
- **Files:** `apps/extension/insertion/autonomous/orchestrator.ts`, `apps/extension/sidebar/autonomous.ts`. **Commit:** `9fd50ed`

No Rule 4 (architectural) deviations — nothing here required a new table, a new service layer, or any change outside this plan's `files_modified` list beyond the one `scripts/verify.mjs` line (Rule 3, justified above).

## Real gate output

```
$ pnpm --filter extension typecheck
$ tsc --noEmit
(exit 0, no output)

$ pnpm --filter extension build
✔ Built extension in ~0.3-0.5s, 327.46 kB total (no errors)

$ VITE_BACKEND_URL=http://127.0.0.1:8787 pnpm --filter extension build && node scripts/verify-autonomous.mjs
— Sidebar + auth —
  ✓ signed in
— Autonomous run: whole document, Straks, plain textarea — (5 checks, all ✓, unchanged from 07-03)
— Autonomous run: whole document, Langsomt, contenteditable — (4 checks, all ✓, unchanged from 07-03)
— Besvar markeringen: ten questions in ONE marking (D-04a) —
  ✓ the panel offers Straks and Langsomt directly on the selection
  ✓ no draft awaiting an Insert press appeared — the old two-step is gone on this path
  ✓ no old "Besvarer markeringen" chip appeared
  ✓ the ten-question run reports finished
  ✓ all ten questions are still present, unchanged
  ✓ all ten questions have a non-empty answer on the line beneath them
  ✓ all ten questions remain in original document order
  ✓ the answer for question 3 sits between questions 3 and 4
— Whole-run transport: pause holds the WHOLE run, resume continues, Fortryd undoes it all in one press (D-15) —
  ✓ pause holds the whole run — even one pressed between two answers, not just mid-typing
  ✓ the field stops growing across a 900ms wait while paused
  ✓ the Langsomt run over #doc finishes after resume
  ✓ Fortryd removes EVERY answer in one press — the whole run, not per-answer (D-15)
  ✓ the original questions are untouched after undo
— Typing race: a trusted keystroke mid-run pauses the WHOLE run (D-13) —
  ✓ a trusted keystroke mid-run pauses the run, reporting why
  ✓ the typed character survives resume
— The gap list: ungrounded questions are named in the PANEL, never marked in the document (D-12) —
  ✓ the panel names the question nothing could ground, under "Uden grundlag i dine kilder"
  ✓ the ungrounded question still gets a full answer beneath it
  ✓ the document itself carries no marker, flag or bracket next to that answer — the gap lives only in the panel
— Panel independence: closing the sidebar does not stop a running Langsomt run (D-14) —
  ✓ the run advanced while the panel was collapsed
  ✓ reopening the panel shows the run still finishes on its own
— Regression: Brug som kontekst is unchanged — still a chip, never a run (D-04b) —
  ✓ Brug som kontekst still produces a context chip
  ✓ Brug som kontekst never starts an autonomous run — no transport bar appears
========================================
  34 passed, 0 failed

$ pnpm verify
  33 passed, 0 failed

$ pnpm test
  ℹ tests 10, pass 10, fail 0
```

Acceptance-criteria greps, all confirmed:
```
grep -c "run('selection'" ChatView.tsx                              → 2
grep -c "setSelSubject(liveSelection)" ChatView.tsx                 → 0
grep -c "useSelectionAsContext" ChatView.tsx                        → 2
grep -c "Uden grundlag i dine kilder" ChatView.tsx                  → 1
grep -c "Fortryd alle svar" ChatView.tsx                            → 1
grep -v '^\s*//' ChatView.tsx | grep -c "degradedReason"             → 1
grep -E "Gennemgå|Godkend|Bekræft svar" ChatView.tsx                 → (empty)
grep -v '^\s*\*\|^\s*//' orchestrator.ts | grep -c "user-typing"     → 1
grep -n "addEventListener('input'|'keydown'" orchestrator.ts         → (empty)
grep -c "new InsertionSession" orchestrator.ts                       → 1
```

## Threat Flags

None beyond `07-CONTEXT.md`'s threat model, which already covers this plan's surface (T-07-15 DoS-via-unstoppable-run, T-07-16 fabrication-visibility, T-07-17 undo-tampering, T-07-18 selection-content-routing). No new network endpoints, auth paths, or schema changes. The two pause-timing bugs fixed here (Deviations 1-2) are hardening of T-07-15's existing mitigation, not a new threat surface.

## Known Stubs

None. `store.autoRun.unplaced`/`.ungrounded` (populated by 07-03) are now fully rendered by `AutoRunBar`.

## What 07-05 needs to know

- **The selection-scope path (`DomSource` with `scope: 'selection'`) is now proven end-to-end**, including the operator's explicit "ten questions, not one" requirement, for both a plain textarea (this plan's E2E) — `contenteditable` selection-scope remains proven only by unit-level reasoning per 07-03's own note; still worth an explicit contenteditable-selection E2E assertion if 07-05 or a later plan touches that path.
- **`sourceFor()` still throws for a `gdocs` target** — untouched by this plan. 07-05's job is to either extend `sourceFor()`/`DomSource` with a Docs-aware `QuestionSource`, or add a new one, following the exact same `AutonomousRun` contract this plan hardened (pause/resume/stop/undo/remaining all now correct under real timing — 07-05 gets these for free as long as it drives the same `InsertionSession`-per-answer pattern).
- **`AutonomousRun.start()` now takes an optional `startPaused` boolean.** If 07-05 constructs `AutonomousRun` directly (rather than through `sidebar/autonomous.ts`), it should either pass this through from the same "pause requested while loading" pattern, or explicitly pass `false`/omit it — the parameter is additive and backward compatible either way.
- **`AutonomousRun.undo()` now reports state via `onRunState('idle', 'undone')` on full success.** Any new caller of `undo()` should NOT assume the run silently stays in its prior terminal state afterward.
- **The Straks/Langsomt chip pattern in `ChatView.tsx`** (reveal-on-click, collapse-and-run-on-select) is now used identically in two places (`AutonomousBar` for the document, the selection bar for `scope: 'selection'`) — 07-05 should reuse this exact pattern rather than inventing a third if a Docs-specific entry point is ever needed (it should not be, per D-05: Docs is a `scope`/`QuestionSource` change, not a new UI).
- **Live-model E2E timing gotcha, worth carrying forward:** `store.autoRun.state` (and hence the "Skriver" text) is set to `'writing'` SYNCHRONOUSLY the instant `run()`/`autonomous.run()` is called — well before the backend call resolves. Any new E2E test that needs to observe "the run is actually typing" must wait for real field growth (`waitForFieldGrowth` in `verify-autonomous.mjs`), not for the state word alone.

## Self-Check: PASSED

All 5 modified files confirmed present on disk with the expected changes. All 4 commit hashes (`9118540`, `436409b`, `9fd50ed`, `faae875`) confirmed in `git log`. All required gates (`pnpm --filter extension typecheck`, `pnpm --filter extension build`, `pnpm verify:autonomous` 34/34, `pnpm verify` 33/33, `pnpm test` 10/10) run for real against the local backend and pasted above, not claimed without running.
