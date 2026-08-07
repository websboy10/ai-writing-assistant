# Phase 7 — findings from the operator's real Google Docs session (2026-08-06/07)

Recorded so 07-05 does not re-diagnose these. All three were found on a real
document, which is the first time this code has ever met live Google Docs —
**Phase 3's go/no-go spike was never run** (no SPIKE file exists anywhere in
`.planning/`), so the Docs adapter shipped having never been observed to work.

---

## F-1 — Marking text on Docs never surfaces the selection bar (CONFIRMED, unfixed)

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
