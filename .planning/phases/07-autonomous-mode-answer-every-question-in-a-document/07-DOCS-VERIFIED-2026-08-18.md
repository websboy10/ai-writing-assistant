# Google Docs — the session that actually ran it, 2026-08-18

Every Docs claim below was produced by driving the **real product path** in a
real Chrome against a **real Google Doc**, and read back from the document
itself. Nothing here is reasoning presented as fact.

**The read-back channel that made this possible:** Docs' own text export,

```
GET https://docs.google.com/document/d/<id>/export?format=txt
```

fetched with the browser's ordinary cookies. It needs **no OAuth token**, and
it is what previous sessions lacked — they could see that a paste was
*dispatched* but never whether text had *landed*, which is exactly how four
wrong fixes got written. Note it must be called from outside the Docs page
(the page's own CSP blocks the fetch); the driver used Playwright's request
context, which shares the browser's cookie jar.

---

## The question that had never been asked

**Does Docs insertion work on the normal product path?** — cursor in the
document, sidebar open, ask, press Straks.

**Yes.** It has worked all along. The text landed exactly:
`"Dette er en test af indsættelse."` — spaces intact. Every failure in the
previous session came through the spike page, which drives the document from
*another tab*.

That single fact reframed everything: Straks is ONE paste, and Docs only
damages text at paste boundaries.

---

## What was broken, and what each fix rests on

### 1. Whitespace — `Hejmeddigverden.` (chat, Langsomt)

The engine's default split sends one letter at a time with the space **in
front**, and Docs discards a space at the edge of an individual paste.

| Wrote | Landed | |
|---|---|---|
| `['A ', 'B ', 'C']` | `ABC` | space at the end: trimmed |
| `['D', ' E', ' F']` | `DEF` | space at the front: trimmed |
| `['He', 'j med di', 'g.']` | `Hej med dig.` | **interior space: kept** |
| `['Baz', '\nQux']` | `Baz\nQux` | **newline at the front: kept** |

So the rule is narrower than "Docs trims whitespace": it trims *spaces* at a
paste edge and leaves newlines alone. The fix needs no non-breaking spaces and
no engine change — only a split that never breaks next to a space
(`GDocsAdapter.chunkText`). All four insertion paths share the one split site
in `engine.ts`, so one fix covered them.

**Verified:** Langsomt writes `Hej med dig verden, dette er en rigtig test.`

### 2. F-1, marking — the belief was exactly backwards

The hidden input frame does **not** mirror the selection. That comment sat in
three files and the 2026-08-07 fix was built on it, which is why F-1 survived.

| State | Frame holds | Old read returned |
|---|---|---|
| nothing marked | `U+200B U+200B` (two zero-width spaces) | truthy → "2 tegn markeret" (phantom) |
| text marked | `U+00A0` (one non-breaking space) | `""` → no buttons |

`trim()` strips a non-breaking space but not a zero-width one. Docs *will*
hand over the selection though: a synthetic `copy` at the same element that
receives our synthetic paste makes Docs serialize the marked text into the
DataTransfer we supply. It works with or without frame focus and does not move
focus. Unlike paste, Docs **cancels** copy — so here `dispatchEvent`'s return
value is a real signal.

**Verified:** nothing marked → no bar; 19 chars marked → "· 18 TEGN" + the
buttons; deselected → gone.

### 3. Autonomous mode had never placed a single answer

Three faults in a row:

- `POST /api/autonomous/answer` was **404 in production** — the backend had
  not been deployed since 2026-08-06, before Phase 7 existed. Deployed.
- Then HTTP 400 at 0 of 3. A paragraph's `endIndex` counts its own newline, so
  it is really the *first character of the next paragraph*; for the last
  paragraph it is the end of the body segment, which the API rejects outright
  (measured: index 99, document end 99). Bottom-up ordering writes the last
  question first, so this failed **every** run before anything landed.
  `endIndex - 1` is correct for every paragraph including the last.
- Undo corrupted the document: writes run bottom-up, so each later write
  inserts at a lower index and shifts the already-recorded ranges forward.
  Deleting at the recorded offsets ate `ar` out of "Hvor mange dage har en
  uge?" and `blaa` out of the third question. The shift is now computed.

### 4. Find positioning — one stale selector

Docs' find bar is now a Material "wiz" component; all four guessed selectors
matched **nothing**:

```
div.appsDocsUiWizFindbarFindBarContainer
  div.appsDocsUiWizFindbarFindInputContainer
    input[aria-label="Find i dokumentet"]      <- follows the account language
```

The synthetic Ctrl/Cmd+F **did** open the bar and focus the input, measured
identical to a real keystroke. The code simply could not see the field
afterwards, timed out, and fell back every time.

Two further traps found while making it reliable:

- Sending Ctrl/Cmd+F while the bar is already open **toggles it closed**, and
  a closed bar keeps the previous query's match counter — a second question
  reported a confident match while the cursor never moved, and its answer
  landed under the first question.
- The match counter proves the text *exists*, not that the cursor *went there*.
  Confirmation now needs both, and the selection is read only **after** the bar
  closes (while it is open, focus and the mirror belong to the find field).

### 5. The selection poll was corrupting documents mid-run

Reading the selection asks Docs through the same hidden frame our writes go
through. Once a second, *during* a run, that lost an answer and put the
frame's own `U+200B` padding into the user's text. The poll now pauses while
writing — nothing is lost, since the selection bar is hidden during a run.

---

## Where it landed

| Path | Result |
|---|---|
| Chat → Straks | text lands exactly, spaces intact |
| Chat → Langsomt | fixed; spaces intact |
| Chat → Fortryd | document returns to empty |
| Marking text | bar + character count correct, appears and disappears |
| Besvar markeringen | 2/2 placed under their own questions |
| Besvar alle spørgsmål (Straks) | **3/3, three consecutive runs**, each answer under its own question |
| Fortryd alle svar | document restored byte-for-byte, both paths |

**Straks now writes through the Docs API by choice, not as a fallback.** Both
paths were run: the API placed 3/3 twice with an exact undo; Find placed 3/3
once and 2/3 the next, losing the document's *last* question. Find drives Docs'
own search UI, so its timing is Docs' to decide. Langsomt still uses Find,
because the API cannot type letter by letter and pacing is that mode's purpose.

---

## Still open, honestly

- **Langsomt in autonomous mode on Docs is the least-tested path.** It uses
  Find, which measured ~50% on the last question of a document before the
  confirmation was tightened; it has not been re-run enough times since to
  claim a rate.
- **The OAuth token worked in this Chrome profile** (signed in as
  `sehitdd@gmail.com`), which contradicts the previous session's "Service has
  been disabled for this account". The strategic issue is untouched:
  `getAuthToken` can only use the account Chrome itself is signed into, which
  is a real risk for the Workspace/HR market. `launchWebAuthFlow` remains
  undecided.
- **Ungrounded answers vary run to run.** With only questions marked and no
  source material, the backend sometimes answers from general knowledge and
  sometimes returns empty answers — the panel reports this honestly under
  "UDEN GRUNDLAG I DINE KILDER", but two runs produced empty answer text and
  therefore blank lines in the document. Worth a product decision.
- **Nothing keeps the Supabase project awake.** The operator accepted this risk
  on 2026-08-18; it will pause again during a quiet week and take sign-in down.
- The four browser suites have not been re-run against these changes.
