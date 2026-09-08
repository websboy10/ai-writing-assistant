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

## Observed (scripts/verify-formatted-answers.mjs, 14/14, Langsomt + human)

One worksheet carrying every shape at once (the last two rows and the
letter-for-letter check were added 2026-09-08 evening, after the first run on
a real MUS form found three defects — see below):

| Shape | Result |
|---|---|
| a heading | left alone — not answered |
| the form's own instruction line, in bold ("Udfyld skemaet nedenfor…") | left alone — not answered |
| "Nævn tre byer" with an empty "1." under it | answer typed INTO that item, three real numbered items, no "1. " characters |
| a plain-text question with a box drawn below | answer in the box |
| a question with two bullet hints and the box under THOSE | answer in the box; nothing between question and hints |
| a two-column table, question beside an empty cell | answer in the cell; question cell untouched |
| "skriv Vigtigt med fed" | **Vigtigt** in real bold, a real space after it, typed slowly with slips |
| whole document | not one asterisk; nothing reported unplaced |
| every deletion of the human-typing mode (36 in the run) | verified by reading the selection back before anything was replaced; 36/36 first try |
| the answers, read back from the document | letter for letter what the model wrote — no slip left behind, no letter eaten |

Regressions, same session: `verify-answer-all` 9/9, `verify-table-answers`
7/7, `verify-box-below` 2/2 — the last on BOTH layouts, including the one
predicted unsolvable before this phase.

Unit: 121 extension tests (19 new for the compiler, 11 for placement, 1 for
one-step deletions), 19 backend. Typecheck clean.

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

### Found on the first REAL form (a MUS worksheet, 2026-09-08 evening), all fixed

- **The form's instruction line was answered.** "Udfyld skemaet nedenfor. Svar
  så konkret som muligt." got a paragraph about the writer's year. The
  detection prompt now names form instructions — and a bold line at the top of
  a section — as not questions.
- **An answer landed between the question and its hints**, with the box below
  the hints left empty. Placement now skips the guidance bullets and takes
  the caret to the box FROM THE LAST HINT (`via` in docs-tables.ts), found
  with Docs' own Find so a wrapped hint cannot miscount lines.
- **"derude" arrived as "drerude", "Søren" as "Sren".** Docs drops a synthetic
  Backspace about one time in fifty while the page's main thread is busy,
  and the sidebar's own progress rendering is that load. Measured on live
  Docs across three probes (07-FINDINGS-docs.md F-5): no spacing helps, no
  other keystroke channel helps, but a paste never drops and a paste replaces
  a selection. A deletion is now a verified selection — Shift+ArrowLeft per
  character, the selection read back and compared with what was typed, a
  dropped arrow retried, and only an exact match left for the next paste to
  replace. The engine sends each deletion as one step so that is one gesture.
- **The test account had spent its 200 daily requests** on the day's
  verification runs, and the verify script waited 15 minutes for a run that
  had never started. It now fails within seconds on the panel's own message;
  the test account's limit is 1000 (profiles.daily_limit, set by SQL).

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
