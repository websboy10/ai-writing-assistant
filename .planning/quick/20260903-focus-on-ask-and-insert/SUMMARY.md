---
quick_id: 20260903-focus-on-ask-and-insert
type: quick
status: complete
completed: 2026-09-04
---

# Focus the product on ask → answer → insert

## What the operator asked for

Strip the two features that answer questions inside the document — "Besvar alle
spørgsmål" and "Besvar markeringen" — because neither worked dependably in
Google Docs, which is where the intended users write. Keep the one thing that
did work, and make it adjustable: ask a question, get a draft, put it in the
document instantly or slowly, with real control over the speed. Add a
toggleable typing style that makes small mistakes and corrects them, so the
document looks like a colleague is working in it. That last one came from an HR
colleague of the operator's.

## What was done

**1. The strip.** Deleted the autonomous run engine, the Docs source resolver,
the Find-based cursor positioning, the whole-document backend route with its
prompt/parse/vision modules, the spike page, the selection bar, the operation
picker, and every probe and verification script that existed only for those.
With them went the entire Google Docs API surface: the `docs-auth`, `docs-get`
and `docs-batch-update` message kinds, the image-fetch-and-shrink pipeline, the
second OAuth client and the `oauth2` block in the manifest.
**6,602 lines deleted, 128 added.**

**2. Tempo.** Progressive insertion was a fixed 30 words a minute. It is now a
slider from 10 to 200, kept in `chrome.storage.local` so it holds across tabs
and restarts, with the insert button's tooltip naming the current setting.

**3. Skriv som et menneske.** A switch beside the slider, off by default. When
on, `insertion/human.ts` turns the finished answer into a script of pieces —
text to type, characters to take back, pauses — and the engine now runs a list
of steps rather than a queue of chunks. Slips are neighbouring-key errors,
transpositions, doubled and skipped letters, noticed a character or two later
and backspaced; now and then the last word or two are deleted and typed again.

**4. "+ Denne side" on Google Docs, without a Google account.** It used to read
the document through the Docs API and the sensitive `auth/documents` scope.
The first pass replaced that with the document's own `/export?format=txt`
fetched with the browser's cookies, which asked for no permission but still
required a signed-in account with access. The operator rejected that dependency
outright, so it now does what a person does: select all, copy, read the result,
all inside the page. No network call, no cookies, no account, and the system
clipboard is never touched. The `docs-export` handler and its message kind are
deleted.

**5. Documentation.** TESTING.md, PRIVACY.md, the store listing, the store
guide, the Google setup guide, REQUIREMENTS.md, ROADMAP.md and STATE.md all
rewritten to describe the product that now exists.

## The unplanned win

`auth/documents` is a Google *sensitive scope*. Asking for it put a **public**
Chrome Web Store listing behind an OAuth verification measured in weeks, on top
of the store's own review. The manifest now has no `oauth2` key at all, so that
blocker is gone outright. It was the slowest item on the release path and it was
removed as a side effect of removing the feature.

## Verified — observed, not claimed

`node scripts/verify.mjs`, the extension built exactly as a user installs it,
driven in a real Chrome against the **deployed** backend: **44/44**.

The human-mode check is the one worth describing, because a finished text proves
nothing about how it got there. It samples the target field *while the run is
typing*. A sample that is not a prefix of the draft is a character the user
would have seen that is not in the answer.

| Run | Samples | Not a prefix of the draft |
|---|---|---|
| 2026-09-04 first | 294 | 16 |
| 2026-09-04 second | 277 | 10 |

Both finished byte-identical to the draft, and undo emptied the field. The same
mode runs on through the rich-text section of the suite, which is where taking
characters back is hardest, and left no debris there either.

Also observed: the tempo slider at 200 wpm inserted a whole paragraph
letter-perfect and far faster than the old fixed pace; both settings survived a
reload; 45 unit tests pass, including that human typing ends up as exactly the
draft across 60 seeded runs, that a slip is never made inside a number or a
date, and that the text is never cut where Google Docs would eat the space.

## Assumed

- Answering questions in place is not coming back in another form. Nothing was
  left behind as a stub or a flag.
- Human mode is off for new users. Someone who has not asked for typos should
  not see one.
- The eight prompt operations stay in the backend contract. They are the API's
  shape, not a dead code path, and the chat still sends `operation: 'chat'`.

## Blocked, and it is the operator's

**Google Docs is unproven.** This machine has no Google session, so neither
insertion into a real document nor the new "+ Denne side" has been run end to
end. The thing to look at is the character count on the attached chip: a short
count on a long document means the synthetic select-all did not take. A read
that comes back empty is reported as a failure, never as an empty document. The
walkthrough is in TESTING.md.

**Not deployed, not pushed.** Commits are local. The deleted
`/api/autonomous/answer` route stays live on Vercel until the backend is
deployed; nothing calls it.
