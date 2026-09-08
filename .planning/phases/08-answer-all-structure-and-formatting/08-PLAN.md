---
phase: 8
slug: answer-all-structure-and-formatting
date: 2026-09-08
status: executing
---

# Phase 8 — Besvar alle spørgsmål: see the structure, keep the formatting

## The operator's requirement, verbatim

"The llm needs to be able to recognize every type of formatting the questions
and descriptions are put in, and also be able to recognize where to answer and
how to format the answer. It needs to be able to type slowly with said
formatting and recognition. It needs to recognize all tasks and questions, find
the answer to all of them, find out how and where it should be inserted, and do
it slowly." — with the hard constraint: **no Google Docs API, no permissions.**

## What was measured before a line was written (all kept as scripts/)

| Question | Answer | Evidence |
|---|---|---|
| Can we see the document's structure without the API? | Yes. Docs writes `text/html` into the synthetic copy we already fire. Tables, cells, headings, bold, lists all present; an empty answer box is `<td><br/></td>`. | `probe-docs-html.mjs` |
| Can slow typing carry formatting? | Yes. Synthetic Cmd+B/I, Cmd+Alt+1/2/0, Cmd+Shift+8/7, Enter between paced pastes give real Docs formatting. 8/8. | `probe-docs-typing-format.mjs` |
| A space at a toggle boundary? | `beforeinput insertText` delivers a real U+0020. | `probe-docs-space.mjs` |
| Can the caret reach the box from the question? | beside → Tab; stacked → Tab; plain text with a box below → End, ArrowDown. 4/4. | `probe-docs-placement.mjs` |

## Design — the smallest version that fully solves it

1. **Read structure, not text.** `target.ts` reads both flavours of the copy.
   `docs-structure.ts` turns the HTML into `AutonomousParagraph[]` carrying
   `kind` (heading / text / bullet / numbered / cell), `level`, and for cells
   `{table,row,col}` — empty cells KEPT, because they are the answer boxes.
   Table cells for placement come from the same HTML. The `docs-export-html`
   background handler and `readDocTableCells` are DELETED: they were the one
   Google-shaped, account-dependent capability left, and they are now redundant.

2. **Placement stays deterministic, in the extension.** No model decides where
   text lands in the user's document. Three verdicts, all measured:
   - question in a cell, next cell empty → Find, Tab
   - question is plain text, next paragraph is an empty first cell of a table
     → Find, End, ArrowDown
   - otherwise → Find, new line below (as shipped)
   An occupied box is still refused and reported, never overwritten.

3. **The model sees the structure and writes markdown.** Detection lines are
   annotated (`(overskrift 2)`, `(tabelcelle, TOM)`, `(punkt)`). The answer
   prompt permits the markdown subset the engine can type — paragraphs, bold,
   italic, bullets, numbers — and is told to match the shape the document asks
   for. `PROSE_RULES` is split into FORMAT and VOICE so the chat product's
   plain-text ban is untouched.

4. **Formatting as keystrokes in the paced plan.** `Step` gains `key`;
   `InsertionAdapter` gains optional `pressKey`; only `GDocsAdapter` implements
   it. `richsteps.ts` compiles markdown → blocks → steps, running `humanScript`
   inside each text run so a slip never crosses a toggle. `SessionOptions`
   gains `markdown`; every existing path is byte-identical when it is absent.
   Undo after a formatted run is Backspace over the typed characters, never
   Cmd+Z counting, so it can never reach the user's own history.

5. **The run honours the user's tempo and human switch.** The orchestrator was
   hard-wired to `DEFAULT_PACING`; it now takes the panel's pacing.

6. **Web search in a run.** One decision per run on the questions found
   (websearch.ts), passed as the hint the chat route already uses.

## Out of scope, stated

- Non-Docs editors keep plain-text answers (they do today).
- The store build keeps the feature flagged out until the operator says.

## Proof required

Browser, real documents, read back through Docs' own copy: the three existing
verify scripts still green; `verify-box-below.mjs` green on BOTH layouts; a
new `verify-formatted-answers.mjs` where a "tre mål" prompt arrives as a real
list and bold survives — typed slowly.
