---
status: complete
date: 2026-09-09
---

# Skriv som et menneske sletter med Backspace, og skærmen ser aldrig en markering

The humanizer marked every slip before deleting it — Shift+ArrowLeft over
the letters, then the next paste replaced them — and the marking stood on
screen for up to half a second, on every third word. The operator called it
the one huge mistake, and it was: a person backspaces.

Now it backspaces. And because Google Docs drops one synthetic Backspace in
fifty under load (the reason for the marking in the first place, 2026-09-08),
each deletion is checked right after, in the same synchronous task: mark the
last few characters, read them through the copy Docs writes for us, collapse.
Docs paints on a later frame, so that check never reaches the screen. A
character of the slip still standing gets one more Backspace.

## Observed

**The probe** (scripts/probe-docs-backspace-verify.mjs, main thread half
busy, the canvas read back every animation frame for 350 ms after each
deletion): a control that leaves three letters marked shows the selection
wash for the whole window (354 ms, +154 px). The new deletion: 0 ms in 48 of
48 reps, 1, 3 and 7 characters, with and without text after the caret, and
every line read back exactly. Over four runs, 190 deletions: two dropped
Backspaces, both caught by the read and repaired; one dropped arrow,
retried.

**The real thing** (scripts/verify-formatted-answers.mjs, Langsomt, "Skriv
som et menneske" on, a worksheet with a list, boxes, a cell and a bold
question, the screen read on every frame of the run and laid against the
typing windows): 26 of 26. Two runs, 13 and 22 deletions, every one of them
checked out, every answer letter for letter as the model wrote it, and
nothing shown as marked while an answer was being typed. The five markings
the watch did see were Docs' own Find holding its match while the next
answer was placed — placement, not typing, and unchanged.

**The rest of the regression chain, on the new build:** verify-fills Straks
29/29 and Langsomt 29/29 (35 deletions, all ok), verify-table-answers 7/7,
verify-answer-all 9/9, verify-answer-selection 14/14, verify-box-below 2/2.

## Two regressions from the fills work, closed here

- **A filled answer cell is the user's answer.** verify-table-answers wrote
  under "MIT EGET SVAR": the model planned a `below` at the filled cell.
  `parse.ts validFill` now reads a `below`/`inline` at a cell other than the
  question's own, whose text does not ask for more ("fortsæt", "uddyb", a
  colon, an ellipsis), as "answered", and the question is left out with no
  fallback under it. Prompt says so too. Deployed to production.
- **verify-answer-all lost one answer of three** with the panel reporting
  3/3 placed and nothing typed after the third question. It did not
  reproduce (9/9 on the rerun); the suite now keeps the extension's log so
  the next time is readable.

## Also learned

- A selection that reaches the start of a list item or a cell comes back
  from Docs' copy wrapped in the structure's own newlines ("\n\nOde\n"). The
  check compares with newlines stripped; a slip never holds one.
- Docs hides the caret while text is marked, and its grammar squiggles are a
  saturated blue: a screen reader that measures a selection has to remember
  the line first and count only the light wash (07-FINDINGS-docs.md F-13).

## Not done

- The store package is built as 0.2.3
  (`apps/extension/.output/extension-0.2.3-chrome.zip`; 0.2.2 went to the
  store this morning and the store wants a higher number); uploading it is
  the operator's step. Until then, store installs still mark.
