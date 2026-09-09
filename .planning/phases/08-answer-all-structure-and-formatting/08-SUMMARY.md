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

## How a run decides where to write (since 2026-09-09)

The model reads the whole document with its structure — headings, bold
lines, list items, every cell and whether it is empty — and returns a PLAN:
each question with the empty place its answer belongs in (`answerAt`), or
none when the answer simply goes under the question. The server checks each
place against the paragraphs it was sent (empty, after the question, claimed
once). The extension turns the place into keystrokes from the last line with
text before it: Tab into the next cell, ArrowDown into the next list item, or
a measured walk into a table or list below, past any blank lines
(docs-tables.ts slotPlanFor, docs-source.ts walkIntoBox). The old rules
remain as the fallback when the model gives no place or names one that
cannot be reached safely.

## "Besvar markeringen" and "Brug som kontekst", back (2026-09-09)

Removed with the old autonomous mode on 2026-09-03; reinstated on the new
machinery. A bar appears in the panel the moment text is marked on the page:

- **Besvar markeringen** — "Besvar alle spørgsmål" scoped to the marking:
  the same structure read (Docs' copy of the marked text carries its
  tables and lists), the same model plan for where each answer goes, the
  same formatted slow typing. Mark two questions and their boxes out of a
  long form and only those are answered. Behind the same flag as Besvar
  alle.
- **Brug som kontekst** — attaches the marked text as a context chip,
  never starts a run. Not behind the flag.

The bar polls a free read once a second (on Docs the input frame's
placeholder — never a copy dispatch, which corrupted a document when polled
during a run in August) and is hidden while anything is being written. One
trap found on the way: on a Docs page the target tracker had captured Docs'
own Find bar as a plain input, so the gate read that field's selection
instead of the document's; Docs now wins, as it does for the write target.

Observed (scripts/verify-answer-selection.mjs, 2026-09-09): two questions
with a box each; the first marked with its box; "Besvar markeringen" →
Straks answered it INTO its box by the model's plan (a walk), the second
question and its box untouched, the run's source logged as scope
"selection"; then the second question marked and "Brug som kontekst"
attached a "Markeret tekst (…)" chip with no run. 11 checks, the last a
checker nit fixed after the run.

## Observed (scripts/verify-formatted-answers.mjs, Langsomt + human)

Latest run 2026-09-09: 22 of 23 checks live, the 23rd a checker that
compared a bulleted answer with its list markers still on — corrected and
confirmed against that run's own output. Six of seven questions got a place
from the model and all six were carried out by the plan (three walks, one
Tab, one list); the seventh, the bold-word question, has no box and went
under its question as intended.

One worksheet carrying every shape at once (rows added as real forms found
them wanting — see below):

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
| a question, a BLANK LINE, then the box (the operator's own form) | answer in the box; nothing on the blank line |
| a question, a plain note ("Skriv kun årstallet."), then the box | answer in the box, the note untouched — the model's plan, walked from the note |
| every deletion of the human-typing mode (20–36 per run) | verified by reading the selection back before anything was replaced; every one first try |
| the answers, read back from the document | letter for letter what the model wrote — no slip left behind, no letter eaten |

Open observation: one run (2026-09-09, 01:30) read back the bold word as
"V<zw><zw>gtigt" — the second letter replaced by two zero-width spaces. Not
reproduced in 20 tries under load (scripts/probe-docs-bold-start.mjs) and
clean in the runs before and after; the verify now keeps the whole adapter
log (test-results/formatted-awa.log) so the next occurrence can be traced.

Regressions, same session: `verify-answer-all` 9/9, `verify-table-answers`
7/7, `verify-box-below` 2/2 — the last on BOTH layouts, including the one
predicted unsolvable before this phase.

Unit: 130 extension tests (19 for the compiler, 20 for placement and the
plan, 1 for one-step deletions), 27 backend (plan validation, the paragraph
validator). Typecheck clean.

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
- **The operator's own form (2026-09-08 23:52): every box left empty, the
  answers on the line under each question.** A blank line between question
  and box, which Docs' copy html does not show at all. Placement now
  measures the way down by extending a selection until it touches the box
  (07-FINDINGS-docs.md F-6), and the model PLANS: it reads the whole form
  and names the empty place each answer belongs in (`answerAt`), which the
  extension carries out by Tab, ArrowDown or that walk, from the last line
  with text before the place — so a note or hint between question and box
  no longer matters.
- **The server had been stripping the structure all along** (F-7): the
  shape tags never reached the model and the first plans were all rejected.
  Fixed in the validator, with tests.
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
