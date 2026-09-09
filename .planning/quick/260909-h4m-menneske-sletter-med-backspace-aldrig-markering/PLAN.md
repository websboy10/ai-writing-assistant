---
id: 260909-h4m
slug: menneske-sletter-med-backspace-aldrig-markering
date: 2026-09-09
---

# Skriv som et menneske: slet med Backspace, aldrig ved at markere

The operator, 2026-09-09: "one huge mistake in the humanizer. when going
back, deleting it marks over the text which makes it visible that its
automatic. instead it should just click delete or backspace instead of
marking the text."

Root cause, not a guess: `adapters/gdocs.ts deleteBack` was rewritten on
2026-09-08 to mark the slip with Shift+ArrowLeft and let the NEXT paste
replace it, because a synthetic Backspace keydown is dropped about one time
in fifty under load (probe-docs-backspace-race.mjs), which had left
"drerude" in a real form. The marking stands until the next write comes —
40 ms to 600 ms, given the pauses human.ts puts before a correction — and is
painted on screen every time. With a slip or rewrite on every third word,
that is the run's signature.

## The change

Backspaces, and a check nobody can see. One Backspace per character, then,
in the same synchronous task, a read of what now stands before the caret
(Shift+ArrowLeft over the last few characters, the synthetic copy target.ts
reads with, ArrowRight to collapse), compared with what the session typed
before the deleted characters. Docs updates its model on the keydown itself
and paints on a later frame, so a selection made and collapsed inside one
task never reaches the screen. Slip characters still standing — what a
dropped Backspace leaves — get one more Backspace each and another read.

Measured before writing it (scripts/probe-docs-backspace-verify.mjs, main
thread half busy, the canvas read back every frame for 350 ms after each
deletion; a control with a selection left standing shows +170 px of blue
wash for the whole window): see SUMMARY.md for the numbers.

## Also in this task

Two regressions the overnight regression chain surfaced in the fills work
(260909-g7z):

- `verify-table-answers.mjs`: the model planned a `below` at a cell holding
  the user's own answer ("MIT EGET SVAR") and the answer was written under
  it. `parse.ts validFill`: a `below`/`inline` at a cell other than the
  question's own, whose text does not ask to be continued, means the question
  is ANSWERED — it is left out, with no fallback under the question.
- `verify-answer-all.mjs`: 2 of 3 answers landed; the third was "placed" and
  never typed. The suite now keeps the extension log; rerun to read it.

## Files

1. `apps/extension/insertion/adapters/gdocs.ts` — `deleteBack` rewritten;
   `marked` gone from `prepare`, `wrote`, `undoAll`.
2. `apps/extension/insertion/engine.ts` — comment; `engine.done` log.
3. `apps/backend/src/autonomous/parse.ts`, `prompt.ts`, `parse.test.ts` —
   the answered-cell guard.
4. `scripts/probe-docs-backspace-verify.mjs` — new.
5. `scripts/verify-formatted-answers.mjs` — reads the screen every frame of
   the Langsomt run and fails on any marking inside a typing window; the
   deletion check reads the new `verdict` field.
6. `scripts/verify-answer-all.mjs` — keeps the extension log.

## Proof

Live, in a real Google Doc: the probe above, then `verify-formatted-answers.mjs`
(Langsomt, human typing on, every answer letter for letter, no marking while
typing), `verify-table-answers.mjs`, `verify-answer-all.mjs`,
`verify-fills.mjs --slow`.
