---
status: complete
date: 2026-09-08
---

# "Tænker" og "Søger på internettet"

## Why it was needed now

The silence before the first word used to be one short pause. Today's changes
made it two waits the user has no way to see: deciding whether to look
something up (~0.8s) and then searching (2-4s). Five seconds of an empty panel
reads as broken software.

## What it says

`Tænker` from the moment the request leaves, and `Søger på internettet` the
instant the decision comes back yes — before the search starts, because that is
the long one. Both vanish the moment there are words to show; the label and the
first word can never both be on screen, because the status is cleared in the
same store write that applies the first token rather than on a timer.

Sans-serif, not the draft serif, and grey: this is the panel talking about
itself, never text that could be mistaken for something about to be inserted.
A breathing dot plus an ellipsis that fills in; reduced-motion gets the words
and no movement, because the information is the word.

`Søger på internettet` also quietly answers a question the user would otherwise
have: why this answer has sources under it when the last one did not.

## Observed

- **Backend, 21/21** (`pnpm verify:web`): every one of seven cases said
  "Tænker" before any word, said "Søger" only when it actually searched, and
  emitted no status after the first token.
- **A real browser, 8/8** (`scripts/verify-status.mjs`): the maths question
  showed "Tænker" and never claimed to search; the elpriser question showed
  both, in order, then the Kilder line. Screenshots in `test-results/`.

## Ships how

This is the first change this week that is NOT backend-only. The event is
server-side but the rendering is in the bundle, so **users see nothing until a
new extension build reaches the store**. Deploying the backend alone is safe:
older builds have no `default:` case in the event switch, so an unknown
`status` event is ignored.
