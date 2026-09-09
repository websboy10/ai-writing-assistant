# Phase 7 — findings from the operator's real Google Docs session (2026-08-06/07)

Recorded so 07-05 does not re-diagnose these. All three were found on a real
document, which is the first time this code has ever met live Google Docs —
**Phase 3's go/no-go spike was never run** (no SPIKE file exists anywhere in
`.planning/`), so the Docs adapter shipped having never been observed to work.

---

## F-4 — Spaces are dropped on Docs (ROOT-CAUSED 2026-08-17; fix undetermined)

> **The observation was made on 2026-08-17.** Against a real document:
> A (`A B C` in one paste) kept its spaces; B (space leading each letter, what
> Langsomt does) and C (space as its own chunk) both lost them — the document
> read `A B CABCABC`. That is the table's *"chunk Docs at word level; do not
> touch the engine"* row: **Docs trims each individual paste, and only
> whitespace interior to one paste survives.**
>
> The fix is still undetermined, deliberately. B and C both put the space at the
> **front** of a chunk; nothing has tested the **end**, and that decides whether
> any chunked path can carry a space at all. Variants D/E/F (ordinary space at
> the end, NBSP at the end, NBSP at the front) are built and **not yet run** —
> see `07-HANDOFF-2026-08-17.md` §3, where their reading is again fixed in
> advance.
>
> Two runs before this one were **invalid** and nearly read as evidence: the
> probe drives the document from another tab, and Docs discards a synthetic
> paste when its input frame is unfocused while every success signal still reads
> fine. See the handoff, §4. The original text below predates all of this.



**Symptom:** slow insertion into a real Doc lands as `I'mnotfamiliar`. Letters
arrive, the spaces between them do not. Observed by the operator on 2026-08-07
in the same run that first put text into a document successfully.

**What is known.** `chunkText()` (`insertion/engine.ts`) sends one letter per
paste with its whitespace LEADING it — the chunk is `" B"`, never a bare `" "`.
So a space IS being handed to Docs on every write; something between that call
and the document is removing it. Straks sends the whole string as one paste and
is not known to be affected.

**Why it is not fixed here.** Three fixes for this adapter have already been
written from reasoning rather than observation (the guard, the false failure
signal, the wrong target element), and all three were wrong. The most plausible
explanation — Docs trims each individual paste — is a hypothesis, and the fix it
implies (chunk Docs differently) is different from the fix implied by the next
most plausible one. Guessing costs another debugging round.

**What replaces the guess:** the whitespace probe, added 2026-08-07 to the spike
page (`chrome-extension://<id>/spike.html` → **Kør mellemrums-prøve**). It writes
`A B C` three ways into a real document — one paste; letter-by-letter with the
space leading (what Langsomt does today); letter-by-letter with the space as its
own chunk — then reads the document back **through the Docs API**, not off the
screen, and prints what actually landed with spaces made visible. A non-breaking
space is displayed differently from an ordinary one, because "swapped" and
"dropped" need different fixes and look identical.

The reading is decided in advance, in `runDocsSpaceProbe`'s comment, so the
result cannot be interpreted into whichever fix is convenient:

| Outcome | Fix |
|---|---|
| A keeps spaces, B does not, C does | send whitespace as its own chunk on Docs |
| A keeps spaces, B and C do not | chunk Docs at word level; do not touch the engine |
| A and B both keep spaces | the defect is not in this channel — look further up |
| Nothing keeps spaces | not trimming; stop and re-investigate from the start |

**Blast radius:** every Docs write path inherits it, including autonomous mode.

---

## F-1 — Marking text on Docs never surfaces the selection bar (CONFIRMED, FIXED 2026-08-07)

**Fixed in `dd8a16c`.** `TargetTracker.selectionText()` now reads the hidden
mirror on Docs, via `gdocsSelectionText()` in `target.ts`. That read had three
copies (`GDocsAdapter.hasSelection`, `docs-source.ts`'s `markedMirrorText`, and
now the tracker); all three point at the one function, because duplicated Docs
resolutions in this codebase have already drifted apart once — see the note on
`gdocsEventTarget`. Unverified against a real Doc.

The original diagnosis, kept because it explains the shape of the bug:


**Symptom:** the operator marks text in a Google Doc and neither "Besvar
markeringen" nor "Brug som kontekst" ever appears. They pressed the autonomous
whole-document button instead, which is why the Docs refusal message appeared.

**Root cause:** `TargetTracker.selectionText()` (`insertion/target.ts:126-135`)
ends with `document.getSelection()?.toString() ?? ''`. Docs paints the document
to canvas, so the browser has no selection to report — it returns `''` on every
poll, `liveSelection` in `ChatView.tsx:36` stays empty, and the bar's render
condition (`ChatView.tsx:100`) is never met.

**The fix is known:** Docs mirrors the live selection into the hidden
`iframe.docs-texteventtarget-iframe`, which is exactly what
`GDocsAdapter.hasSelection()` (`adapters/gdocs.ts:78-85`) already reads.
`selectionText()` needs the same branch, returning that body's `textContent`.

**The tell that this is an oversight, not a decision:** `inserter.ts:64-66`
*does* special-case Docs for the has-a-selection question (to decide the leading
newline). One call site knew Docs needs different treatment; the other didn't.

**Note for 07-05:** fixing this alone changes little for the operator —
"Besvar markeringen" still hits `sourceFor()`'s deliberate Docs refusal
(`insertion/autonomous/locator.ts:190-194`), which is 07-05's job to replace.
It does make "Brug som kontekst" work on Docs, which today silently cannot.

---

## F-2 — Langsomt stopped after one letter on Docs (root-caused, FIXED, unverified on a real doc)

Fixed in `2c07100`. The typing-race guard (INST-12) mistook Docs' own late edit
report for the user typing and paused the run after the first chunk. Straks was
unaffected because `insertInstant()` never arms the guard. Adapters now declare
`echoesAsync`, and those adapters drop the `input` listener and rely on
`keydown` — a person typing always produces one, a synthetic paste never does.

Reproduced in a unit test before the fix (`insertion/engine.test.ts`, "only
wrote H") and green after. **Still not verified against a real Google Doc** —
the operator's retest attempts were confounded by F-3 and by testing the
autonomous button rather than the plain insert path.

---

## F-3 — The operator's Docs session was OFFLINE during the retests

Console showed `ERR_INTERNET_DISCONNECTED`, repeated
`ERR_QUIC_PROTOCOL_ERROR.QUIC_PUBLIC_RESET`, and `400` responses on Docs' own
`kix_core` sync channel. A document that cannot reach Google's servers is not a
valid test surface — Docs can drop or refuse edits in that state regardless of
who is making them.

**Before trusting any future Docs result:** confirm Docs saves the operator's
own typing ("Alle ændringer gemt") first. Two debugging rounds were spent
against a broken connection.

---

## F-5 — Docs drops a synthetic Backspace one time in fifty under load (MEASURED, FIXED 2026-09-08)

Seen on a real MUS form typed with "Skriv som et menneske": "derude" arrived as
"drerude" (one of two Backspaces never happened) and "Søren" as "Sren" (a
Backspace applied after the next letter had landed).

Measured with `scripts/probe-docs-backspace-race.mjs`, `probe-docs-delete-channel.mjs`
and `probe-docs-select-read.mjs`, all on live Docs, no model quota:

| what was sent | idle page | main thread ~50% busy |
|---|---|---|
| Backspace keydown, 40–250 ms apart | 143/144 | loses ~1 in 50 at EVERY spacing |
| keydown only / keydown + beforeinput | — | same rate |
| `beforeinput deleteContentBackward` alone | — | ignored outright, 0/10 |
| `execCommand('delete')` | — | ignored, 0/10 |
| paste, Enter | never lost | never lost (600+ each) |
| Shift+ArrowLeft × N, then paste over the selection | — | 10/10 |
| synthetic copy read of that selection | — | exact 101/101 whole selections, different 7/7 short ones |

The busy thread is not hypothetical: the sidebar is a content script in Docs'
own page, so its progress rendering and Docs' key handling share one thread.
Spacing is therefore not a fix; the channel is.

**Fix (adapters/gdocs.ts deleteBack):** a deletion is a verified selection.
Shift+ArrowLeft per character, read what is marked, compare with what the
session typed last; a dropped arrow gets one more arrow and another read,
twice at most; only an exact match is left for the next paste to replace,
anything else is collapsed and deleted the old way. engine.ts sends the whole
deletion as one step so the selection is one gesture. The read is untrimmed
(`gdocsMarkedTextNow`) so a selection that reached into the space before a
word cannot pass as a match.

## F-6 — A blank line between a question and its box is invisible to the structure read (MEASURED, FIXED 2026-09-09)

The operator's own test form (2026-09-08 23:52): a question, a blank line, a
one-cell box. The answer went on the blank line; the box stayed empty.

Measured (`scripts/probe-docs-box-kinds.mjs`, `probe-docs-text-lines.mjs`,
`probe-docs-next-table.mjs`, `probe-docs-extend-into-box.mjs`):

- Docs' copy **html leaves empty paragraphs out entirely** — the box looks
  like the very next block after the question, so "End, ArrowDown" lands on
  the blank line.
- The copy **text flavour** shows the blank lines but draws a one-cell table
  as three empty lines (cell, row end, table end), so blank-before and
  blank-after cannot be told apart by counting.
- Docs' own **"move to next table" chord is ignored** when synthetic.
- An html paste **drops empty paragraphs before a table**, which is why no
  test fixture ever had this shape: it had to be built with a text paste.
- What works: **extend the selection down one line at a time with
  Shift+ArrowDown and read the copy html after each step.** Docs takes a
  table into a selection whole the moment the selection touches it, so the
  step count is the number of ArrowDowns to the box; an EMPTY list item has
  nothing to serialise, so its list shows one step late. 5/5 through one,
  two and three blank lines, into an empty list item, and past a hint line.

**Fix (docs-source.ts walkIntoBox):** used both for the model's plan and for
the old box-below rule. Text met on the way down stops the walk.

## F-7 — The server stripped every paragraph's structure before the model saw it (FOUND 2026-09-09, FIXED)

`validateParagraphs` copied only `index` and `text`. Every "(tabelcelle, TOM
svarboks)" tag in the detection prompt had therefore been an empty string
since the day it was written, and every `answerAt` the model returned was
rejected for pointing at a paragraph of no kind. Found by logging the
validated plan next to the raw reply: the model said `"answerAt": 1`, the
plan said `null`. The validator now copies kind, level, bold and cell, each
checked, and lives in autonomous/parse.ts with tests.

## F-8 — "Besvar markeringen" never saw the box under a marked question (FOUND 2026-09-09, FIXED)

The marked run read the marking alone, and a person marks the question, not
the empty box under it — so the model was handed one line and no place to
put the answer, and typed it under the question. Now a marked run reads the
marking first, then the WHOLE document exactly as "Besvar alle" does, finds
the marking in it by its lines (docs-structure.ts `markedRange`, unit-tested
for whole, partial and repeated lines) and sends everything with the range;
the server answers only questions inside the range (parse.ts) and the
prompt says the answer's place may sit just outside it. Verified live with
the question alone marked: answered in its box by the model's plan, the
other question and box untouched (scripts/verify-answer-selection.mjs,
14/14). When the marking cannot be found in the whole read, the marked lines
alone are sent, as before.

Observation on the way, not fixed: Docs' Find is caret-relative. The run's
`occurrence` is document-absolute (earlier identical lines + 1), and the two
agree only because a run moves down the page and the probe leaves the caret
on the first line. In a document holding the same question twice, a marked
run of the first copy would land on the second (seen once, on a worksheet
the harness had pasted twice). Unique question text is unaffected.

## F-9 — "Alle modeller i kæden er utilgængelige" on a real Besvar run (FOUND 2026-09-09, FIXED)

Two runs at 08:33 and 08:34 (production log): the question found, the box
planned, then a 503 within two seconds. The reasons were not logged — only
the status — so the cause had to be reproduced: OpenRouter's web-search
plugin (engine parallel, mode turbo) answers HTTP 500 for EVERY model, in
half a second each, once the user message passes roughly 4,500 characters
(4,079 fine, 5,079 dead; scratchpad probes against the live API). A Besvar
answer call put the whole form in the user message, and the decider had
said "search" because the question named a novella. Not transient: it
would have failed every time for every form of that size with any named
work in it. Three layers now, so no one of them has to hold:

1. **Web search never takes the chain down** (openrouter.ts streamChat): a
   model that fails with the plugin attached is retried at once without it,
   before the next model. Proven on the exact request shape: plugin 500,
   same model bare, answer in 2.3s, the failure recorded.
2. **A Besvar run looks things up in its own short call** (websearch.ts
   webResearch): the questions alone go to the plugin, and what it found
   rides into every batch as attached context; the answer call never
   carries the plugin. One search per run instead of one per batch. Moving
   the form into the system message was tried first and reverted within
   the hour: the model then answered every question in the form instead of
   the ones listed, two runs of two.
3. **One more pass through the chain** when every failure looked transient
   (5xx, 429, a dropped connection), a second later.

Plus the reasons are logged on every "all models failed" (both routes), so
the next one is diagnosable from the log alone. Unit: openrouter.test.ts
drives the chain against a fake OpenRouter (4 tests). Live: a marked
question about a named novella went through web research (1,162 characters
found) and into its box (scripts/verify-answer-selection.mjs with AWA_Q_A).

## F-10 — Docs' Find lands on typing; Enter moves one on; the counter is absolute (MEASURED 2026-09-09, FIXED)

F-8's open observation ("a marked run of the first copy would land on the
second") had the wrong explanation. Measured with markers pasted after each
landing (scratchpad `probe-find-tab.mjs`, a document with "fortsæt
herunder…" twice):

- **Typing the query already selects a match: the first one after the
  caret**, wrapping to the top when none follows. With the caret between the
  two copies, the bar read "2 af 2" and the marker went into the second.
- **Every Enter moves one match on.** The old code pressed Enter once per
  wanted occurrence, so it always landed one match PAST the one it meant —
  invisible on unique text (one match wraps to itself), wrong on any
  repeated line.
- **The counter's first number is the match's position in the document**,
  wherever the caret was.

**Fix (docs-find.ts):** read "current af total" after typing, press Enter
`(wanted - current + total) % total` times, confirm the counter shows
`wanted` before the bar closes. The caller (docs-source.ts `occurrenceOf`)
supplies `wanted` as the count of the query in every paragraph AND every
answer the run has already typed before the anchor — by the tenth cell of a
grid, nine answers stand between the top of the document and its anchor.
Proven on the operator's own worksheet: both "fortsæt herunder…" cells
continued under their own line, 25 grid cells anchored on one repeated word
("negativt") every time.

## F-11 — Tab crosses filled cells and row ends (MEASURED 2026-09-09)

Five Tabs from A1 of a 3×3 table landed in B3, across four filled cells and
a row end; one more landed in C1; five from B1 crossed cells this run had
just filled. So any empty cell in a table is reachable from the last line of
ORIGINAL text before it in the same table, by Tab as many times as cells lie
between — whatever was typed into the cells on the way. That is how a
five-column table with five empty rows is filled (docs-tables.ts
`slotPlanFor`, kind `tab` with `times`), with every Find anchored on
original text and never on the run's own words.

## F-12 — A soft line break is glued into the line before it (FOUND 2026-09-09, FIXED)

The operator's worksheet breaks "Manden skal herske / fortsæt herunder…"
with Shift+Enter, which Docs' copy html writes as `<span><br /></span>`
inside one `<p>`. Read as textContent that is "Manden skal herskefortsæt
herunder…" — one line that exists nowhere in the document, so Find found
nothing and the fill was reported unplaced. Every `<br>` is now a newline
before the structure is read (docs-structure.ts), a paragraph's `text` is its
lines joined by a space, and `lastLine` carries the line Find is given when
an answer goes below the paragraph.

## F-13 — A selection made and collapsed in one task never reaches the screen (MEASURED 2026-09-09, deleteBack rewritten)

The operator saw the humanizer MARK a slip before deleting it: F-5's fix
(2026-09-08) selected the slip with Shift+ArrowLeft and let the next paste
replace it, and the marking stood on screen for as long as the pause before
the next write — up to half a second, on every third word.

Measured with scripts/probe-docs-backspace-verify.mjs, main thread half busy,
the canvas tile read back on every animation frame for 350 ms after each
deletion, on the caret's line (remembered from before the deletion — Docs
hides the caret while text is marked), counting the selection's light-blue
wash (166,199,251) and nothing else (a grammar squiggle is a saturated blue
and fooled the first version):

- A control that leaves three letters marked: wash on screen for the whole
  window, +154 to +170 px.
- The new deletion — Backspace × n, then Shift+ArrowLeft over the last few
  characters, copy, ArrowRight, all in one synchronous task: 0 ms of wash in
  48 of 48 reps (n = 1, 3, 7; with and without text after the caret), and
  every line read back exactly. Over four runs, 190 deletions: two dropped
  Backspaces, both caught by the read and repaired with one more press; one
  dropped arrow, retried.

So Docs applies a keydown to its model synchronously and paints on a later
frame, which is what makes the check invisible. `gdocs.deleteBack` is now
Backspaces plus that check; the `marked` state and the "left standing for
the next paste" design are gone.

## Open — an invisible character inside a word, twice now (2026-09-09)

Second data point for 08-SUMMARY.md's open observation. Formatted run
2026-09-09 08:15: "meget" read back as "me<zw>get". The adapter log shows
the one unverified deletion of that run at exactly that point: a slip "het"
was to be deleted, the selection read "eet" three times (so Docs' text was
not what was typed — most likely a dropped "h" paste), and the fallback of
ArrowRight + Backspace×3 ran. The first occurrence ("V<zw><zw>gtigt", 01:30)
was in the same answer of the same worksheet, also typed under a question
rather than in a box. Every verified deletion has been clean; the glitch
rides on the fallback path. Next step when it matters: log the marked text
around a failed read in `gdocs.deleteBack`, and probe whether a Backspace
on Docs' own zero-width padding leaves it behind.

## Diagnostics available

`insertion/debug.ts` — off unless the page's localStorage has `awa-debug=1`.
When on, the Docs adapter logs, per write: the element it aimed at, whether
Docs swapped that element or the whole iframe since the last letter, and
whether the paste was consumed. The engine logs whether a run stopped on a
pause or a rejection, and which guard fired.

Turn on from the DevTools console of the page being written into:

```
localStorage.setItem('awa-debug','1')
```

Docs floods its own console; filter on `AWA`.
