---
phase: 8
slug: answer-all-structure-and-formatting
date: 2026-09-08
status: complete
---

# Phase 8 — done. Observed, not claimed.

## What a run now does, on a real Google Doc, with no API and no permission

Reads the document's STRUCTURE off the same synthetic copy it always fired
(the `text/html` flavour), so it sees headings, bold, lists, table cells and —
the thing that matters most — which boxes are empty. Places each answer by
structure: beside the question (Tab), beneath it in a one-column table (Tab),
under a plain-text question with a box drawn below (End, ArrowDown), or into
an empty list item the worksheet drew ("1." with nothing after it). Types the
answer slowly, with "Skriv som et menneske" slips and rewrites, AND with real
formatting — bold, italic, bullets, numbers — by pressing the same shortcuts a
person presses between keystrokes.

## Observed (scripts/verify-formatted-answers.mjs, 11/11, Langsomt + human)

One worksheet carrying every shape at once:

| Shape | Result |
|---|---|
| a heading | left alone — not answered |
| "Nævn tre byer" with an empty "1." under it | answer typed INTO that item, three real numbered items, no "1. " characters |
| a plain-text question with a box drawn below | answer in the box |
| a two-column table, question beside an empty cell | answer in the cell; question cell untouched |
| "skriv Vigtigt med fed" | **Vigtigt** in real bold, typed slowly with slips |
| whole document | not one asterisk; nothing reported unplaced |

Regressions, same session: `verify-answer-all` 9/9, `verify-table-answers`
7/7, `verify-box-below` 2/2 — the last on BOTH layouts, including the one
predicted unsolvable before this phase.

Unit: 117 extension tests (19 new for the compiler, 8 for placement), 19
backend. Typecheck clean.

## Defects found by measurement on the way, all fixed

- **Find cut the question at 60 characters** and the answer was typed into
  "kort sæ|tning", splitting the user's own sentence. Pre-existing; never
  showed because every earlier test question was short. The whole line is
  tried first now, and End follows every collapse.
- **An empty list item was invisible.** The parser dropped it, so the model
  answered a numbered slot with bullets. Empty items are kept, tagged
  "(nummereret punkt, TOM)".
- **The compiler left the worksheet's list after one item** when the model
  wrote plain lines or its own markers. Inside a drawn list, lines are items.
- **Shortcuts need the editor focused**; a paste does not. `pressKey` refocuses
  the frame before every chord.
- **The verify script itself read bold wrong**: Docs' export expresses bold as
  CSS classes, not inline styles, so a working run scored 0 bold. The check
  now resolves the export's own stylesheet.

## Deleted

The `docs-export-html` background handler and `readDocTableCells` — the one
Google-shaped, signed-in-account-dependent capability the package still had.
The copy html carries the same cells and depends on nothing.

## Not done, said plainly

- Non-Docs editors (textarea, contenteditable) still get plain-text answers.
- The store build still has the feature flagged out; that switch is the
  operator's.
- The test fixture's empty cells are 13pt wide (Docs' default for an
  unsized `<td>`), so answers there wrap one letter per line in the
  screenshot. Real worksheets size their cells; the product did not do this.
