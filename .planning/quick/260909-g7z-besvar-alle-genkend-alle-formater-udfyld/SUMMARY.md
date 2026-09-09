---
status: complete
date: 2026-09-09
---

# Hvert svar har sit eget sted

"Besvar alle spørgsmål" no longer thinks in "one question, one box". The
model plans **fills**: every place in the document that gets text, and what
goes there. A question may have many, and a place may be an empty box, a
new line under existing text, or the rest of a label's own line.

## Observed on the operator's own worksheet ("Fra myter til kønsstereotyper")

Seeded from his docx into a real Google Doc, run with the local backend,
read back through Docs' export. Before this task the same document got three
answers on the line under three questions and nothing in any table.

| Shape in the document | What landed |
|---|---|
| The first task, already answered in the paragraph under it | left alone: no second answer |
| Table 1: answer cells holding "Manden skal herske" / "fortsæt herunder…" | continued on a new line under "fortsæt herunder…" in BOTH cells, the starters untouched (one cell breaks its lines with Shift+Enter, the other with a paragraph) |
| Table 2: verses × "Manden?" / "Kvinden?", five empty cells, one pre-filled | all five filled, each about its own verse and column; the pre-filled one untouched |
| Table 3: five columns, a header, an example row, five empty rows | all 25 cells filled, five coherent rows (quote, man, woman, explanation, positiv/negativt), the header and example untouched |
| Nothing reported as unplaced; 95 seconds in Straks | |

## Observed on the synthetic worksheet (scripts/verify-fills.mjs)

29 of 29 in Straks on the first run: the answered question skipped, both
"fortsæt herunder…" cells continued, a 2×2 grid and a 4×2 table filled
cell by cell with the example row untouched, "Navn:" answered on its own
line, an empty numbered list answered as a list, nothing written between any
question and its table, no asterisk. Langsomt, later the same day on the
build with the Backspace deletion (260909-h4m): 29 of 29 as well, 35
deletions all checked. The older suites on the same build: answer-all 9/9,
answer-selection 14/14, box-below 2/2, table-answers 7/7 — the last after a
guard for a regression this task introduced (a `below` planned at the user's
own filled cell; see 260909-h4m).

## What changed, and what it cost

- **The contract.** `AutonomousAnswer` carries `at` and `mode`
  (`fill` / `below` / `inline`) and an optional `task`; the detection call
  returns `fills` per question; the answer call answers per PLACE, keyed by
  its paragraph number. A separate 1-based id lived for a few hours and the
  model answered with the place numbers instead, so five answers were dropped
  and two crossed — one identity per fill, and it is the place. Old
  extensions get one answer per question (fills joined) unless they send
  `fills: true`.
- **Placement.** Any empty cell is reached from the last ORIGINAL text cell
  before it in the same table by Tab × N (measured: Tab crosses filled cells
  and row ends, F-11). Find is driven by Docs' own match counter: typing lands
  on the first match after the caret, Enter moves one on, and the counter's
  first number is absolute (F-10) — which also explains and fixes F-8's open
  observation. The wanted occurrence counts the query in every paragraph and
  every answer already typed before the anchor.
- **Reading.** A soft line break (`<br>`) is a line; a paragraph's `lastLine`
  is what Find is given to write below it (F-12). `answerCellFor` and the
  `cells` array are gone: the plan is the only authority on cells, and the
  box-below rule is the one fallback for a question the model left as
  "below".
- **The inline space** is pressed as a key: Docs drops a space at the edge of
  a paste, and the first run read "Navn:Christian Jensen".

Unit: 133 extension, 41 backend. Typecheck clean on both.

## Not done, said plainly

- The backend is deployed from this session; the store package is the
  operator's upload (`pnpm zip:store`). Until it is uploaded, store installs
  of 0.2.2 get the old-client shape from the new backend.
- Checkboxes ("Sæt kryds", ☐) are not a fill mode. The model can only write
  text; ticking a box in Docs is a different mechanism.
- A question whose answer place sits ABOVE it (a label under its box) still
  goes under the question.
