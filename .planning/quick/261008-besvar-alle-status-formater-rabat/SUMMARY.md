---
quick_id: 261008
slug: besvar-alle-status-formater-rabat
status: built, not deployed
date: 2026-10-08
---

# Besvar alle: live status + forms answered inside the line. Invitations: 50 % for both.

Nothing here is deployed. Backend, migration 0018, extension 0.2.5 and the
landing page all wait for the operator's go.

## What changed

1. **Besvar alle streams.** `/api/autonomous/answer` answers as SSE when the
   request says `stream: true` (stages `found`, `searching`, `answering`, then
   `result`). The extension sends it over a port (`AUTO_PORT`), like chat. The
   panel lists each step as it happens; Stop works during the wait. Root cause
   it removes: the run was a one-shot message whose fetch waited 10-60 s for a
   response, and Chrome ends the service worker at 30 s.
2. **Two new places to write.** `replace` (in place of a blank, a tick box, a
   "Sandt / Falsk") and, between the two model calls only, `choose` (options on
   their own lines; becomes a tick per option picked). Offered only to a client
   that sends `replace: true`: textarea and contenteditable today. Google Docs
   does not send it yet and behaves as before.
3. **Invitations pay in discounts** (migration 0018): friend gets N % on the
   first payment, inviter N % on a month once the friend has paid (Stripe
   balance credit for a subscriber, `billing.discount_credits` for everyone
   else). A full refund within 30 days takes the reward back. N is one field on
   the dashboard, default 50.
4. **Landing page** no longer promises "7 dage gratis".

## Observed

- `scripts/eval-forms.mjs`: 9 of 14 layouts before, 14 of 14 after, 42 of 42
  over three rounds.
- `scripts/verify-answer-all-status.mjs`: 10 of 10, every stage seen on screen.
- `scripts/verify-answer-all-forms.mjs`: 25 of 25, three runs in a row, in a
  textarea and a contenteditable, undo restoring the original text.
- `scripts/verify.mjs`: 47 of 47 after correcting one stale expectation.
- Unit tests 179 of 179, typecheck clean.

## Unproven

- Everything about invitations: migration 0018 is not applied, no checkout has
  been run. Needs a Vercel preview with Stripe test keys (see TESTING.md).
- Google Docs, all of it: `.chrome-profile-cft` is signed out of Google, so no
  Docs suite could run. The streaming change reaches Docs users too.
- "Langsomt" with the new in-line places (only "Straks" was run).
- The JSON fallback in background.ts for a backend that does not stream yet.
- `charge.refunded` must be added to the Stripe webhook endpoint's events.

## Next

- Sign `.chrome-profile-cft` into Google (`bash scripts/launch-chrome.sh`),
  then run the Docs suites and build `replace` for the Docs source.
- Order to ship: migration 0018, backend, then extension 0.2.5 to the store.

## Google Docs, real documents (2026-10-08, account sehitdd@gmail.com)

Observed, on real Docs with the extension built against the local backend:

- **Typo self-check ate the question above (fixed).** When "Skriv som et menneske" deleted a slip that began right after the answer's own Enter, `deleteBack()` had one character of context, matched it against a letter of the slip, and "repaired" by deleting 9 characters of the question (" vejret."). It now skips the check under two characters of context (`gdocs.ts`). `verify-formatted-answers.mjs` now asserts every question is still whole. Not seen again in 12 runs.
- **A click in the document mid-run sent the rest of the answer to the clicked spot (fixed).** The engine now pauses a Docs run on a real mousedown outside the panel (`followsCaret`, `engine.ts`), says so in the panel, and on Fortsæt checks the caret still stands after the answer (`GDocsAdapter.verifyIntact`), refusing if not. `scripts/verify-docs-click-pause.mjs`: 8/8, twice.
  - Known gap: a click in the half second an answer is being PLACED (between Docs' Find and the Enter) is not caught; the guard is only up while typing.
- **Test artefacts, not product faults:** one letter per line (the test's boxes were one letter wide; now 450pt), "marking while typing" (Docs' blue grammar squiggle, on the line and on the line above; the screen check now reads only the upper half of the caret's line), stray letters and a jumped caret (the operator's own keyboard and mouse in the test window).
- **Open: about one letter per long human-typed run is lost.** The letter is gone and two zero-width spaces stand in its place ("Pla​​ten", "statistkker"). Nothing in our log marks the paste that fails: same element, same iframe, focus held, 35 letters after the last selection read. `scripts/probe-docs-letter-loss.mjs` types 4000 letters three ways (plain / with the check's select-copy / with slips and Backspaces) to find which one causes it.

Suites on the final build: verify-docs-click-pause 8/8 ×2, verify-answer-all 9/9, verify-fills 29/29, verify-formatted-answers 33/33 in 4 of 5 hands-off runs (the fifth lost one letter).

## Later the same day

- **Blanks, tick boxes and "Sandt / Falsk" in Google Docs (built, observed).** `GDocsFindSource.canReplace`; `placeInLine` finds the line, walks back over what follows the piece, marks it, and hands it over only when Docs' own copy says the marked text IS the piece; the answer is typed over it (`SavedTarget.removedText`). Deleting first lost the space beside the word ("erKøbenhavn"). `scripts/verify-docs-forms.mjs` 12/12 twice, undo included. Straks only; Langsomt and "Skriv som et menneske" over a marked blank are unproven.
- **Undo left the first answer behind when a run held an inline answer (fixed).** The space the placement presses after "Navn:" is a history step nobody counted (`SavedTarget.placementEdits`).
- **A question whose table row already holds the user's answer was answered in its own cell, 1 run in 5 (fixed, server).** `rowIsAnswered` in `parse.ts`, unit-tested; verify-table-answers 7/7 ×6 since, eval-forms 14/14.
- **Lost letter: it is Docs.** `probe-docs-letter-loss.mjs`, plain arm, 0 real clicks or keys: 4000 single-letter pastes, 3999 arrived, two zero-width spaces where the missing one should be. The `read` and `slip` arms were not run. Not fixed: a repair needs selection reads while writing, which corrupted documents when done once a second (target.ts, 2026-08-18).
- **The "cursor jump" was a hand in the window**: the same probe with no clicks put every line where it belonged.

Regression on the final build: verify-docs-forms 12/12, verify-fills 29/29, verify-answer-all 9/9, verify-box-below 2/2, verify-formatted-answers 33/33, verify-docs-click-pause 8/8 (run before the Docs replace work, not after).
