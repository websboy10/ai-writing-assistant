---
id: 260909-g7z
slug: besvar-alle-genkend-alle-formater-udfyld
date: 2026-09-09
---

# Besvar alle: hvert svar har sit eget sted — gitre, fortsæt-her-celler, udfyldte spørgsmål

The operator's own worksheet ("Fra myter til kønsstereotyper", 2026-09-09)
put answers on the line under the question three times out of three. Not a
bug in any one rule: the run's unit is "one question → one empty box", and
this form has none of that shape. Measured on a real Doc (scratchpad probe,
57 paragraphs):

- **A table whose answer cells already hold a starter and "fortsæt
  herunder…"** — occupied, so refused; the answer went above the table.
- **A grid: verse rows × "Manden?" / "Kvinden?" columns** — five empty cells
  for one question; the plan can name one.
- **A five-column table with a header, an example row and five empty rows**
  — 25 cells, each row one coherent example. Placement could reach only the
  first empty cell after a text anchor.
- **The first question is already answered** in the paragraph under it, and
  nothing tells the model to leave it alone.

## The change: from questions to FILLS

The model plans **fills**: every place in the document that gets text, with
what goes there. A question may have many. Three modes:

- `fill` — an EMPTY box or list item (as `answerAt` was).
- `below` — a new line under an existing paragraph: the question itself when
  nothing is drawn for it, or a cell whose text asks you to continue under it.
- `inline` — on the same line after a label ("Navn:", "Dato:").

Fills are carried out in document order. Any empty cell in a table is reached
by Find on the last ORIGINAL text cell before it in the same table, then Tab
as many times as cells lie between (measured 2026-09-09: Tab crosses filled
cells and row ends, 5 Tabs from A1 landed in B3). A table with no text before
the slot is entered by the walk and tabbed from its first cell.

Docs' Find, measured the same day (scratchpad probe-find-tab.mjs): typing the
query selects the FIRST MATCH AFTER THE CARET (wrapping), every Enter moves
one on, and the bar's counter "n af m" gives the ABSOLUTE index of the current
match. The old code pressed `occurrence` Enters and so landed on the second
copy of any repeated line (07-FINDINGS-docs.md F-8's unexplained
observation). Now: read the counter, press Enter `(wanted - current + m) % m`
times, confirm the counter. The wanted index counts the query in every
paragraph before the target AND in every answer the run has already typed.

Old extensions keep working: a client that does not send `fills: true` gets
one answer per question (its fills joined), with `answerAt` as before.

## Files

1. `packages/shared/src/index.ts` — `AutonomousParagraph.lastLine`,
   `AutonomousRequest.fills`, `AutonomousAnswer.at/mode/task`;
   `MAX_AUTONOMOUS_ANSWERS = 80`, `ANSWER_BATCH_SIZE = 10` (fills, grouped by
   question, a group never split).
2. `apps/backend/src/autonomous/prompt.ts` — shape tags carry table, row and
   column; the detection prompt plans fills and skips answered questions; the
   answer prompt answers per fill by `id`, shaped by the place.
3. `apps/backend/src/autonomous/parse.ts` — `parseDetection` → flat fills,
   validated (empty for `fill`, text for `below`/`inline`, one fill per
   paragraph, no `below` at a question that has boxes); `parseAnswers` by id;
   `collapseForOldClients`.
4. `apps/backend/src/routes/autonomous.ts` — batches by question group; the
   old-client collapse; plan logging per fill.
5. `apps/extension/insertion/autonomous/docs-structure.ts` — cell lines joined
   with a space (was "herskefortsæt"), `lastLine` for multi-line cells; the
   `cells` array goes with `answerCellFor`.
6. `apps/extension/insertion/autonomous/docs-tables.ts` — `slotPlanFor`: Tab
   ×N within a table, walk + Tab ×N into a textless one; `answerCellFor`
   deleted (the plan is the only authority on cells); `boxBelowFor` keeps the
   empty-box and empty-list fallbacks for `below` at a text question.
7. `apps/extension/insertion/autonomous/docs-find.ts` — counter-driven
   occurrence; the caller supplies `occurrenceOf(query)`.
8. `apps/extension/insertion/autonomous/docs-source.ts` — `locate(fill)` per
   mode; typed answers remembered for occurrence counting.
9. `apps/extension/insertion/autonomous/locator.ts`, `orchestrator.ts`,
   `plan.ts`, `sidebar/autonomous.ts` — the fill travels through; the lead
   is `''` in a box, `' '` inline, `'\n'` below; run order by place.
10. Tests: `parse.test.ts`, `docs-tables.test.ts`, `docs-structure.test.ts`.
11. `scripts/verify-fills.mjs` — a worksheet with every shape above, answered
    live, read back through the export.
12. `07-FINDINGS-docs.md` F-10/F-11, `STATE.md` quick-task row.

## Proof

Live, in a real Google Doc, against the local backend: the synthetic
worksheet (verify-fills.mjs) and the operator's actual document seeded from
his docx. Both read back through Docs' export, never from the extension's
own report.
