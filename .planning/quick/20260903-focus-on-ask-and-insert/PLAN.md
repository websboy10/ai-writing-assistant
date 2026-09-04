---
quick_id: 20260903-focus-on-ask-and-insert
type: quick
status: complete
created: 2026-09-03
operator_request: >
  Strip "Besvar markeringen" (answers written into the marked text) and
  "Besvar alle spørgsmål" (autonomous whole-document answering). Make the
  product solely: ask a question, get an answer, write it into the document
  slowly or instantly. Speed must be adjustable. Add a toggleable
  "human-like" typing mode that makes small typos and deletes a little and
  rewrites, so it reads like another collaborator typing.
---

# Quick task: focus the product on ask → answer → insert

## Why (plain language)

The in-place answering on Google Docs (find each question, write under it,
keep formatting) never became reliable, and it dragged a Google OAuth
verification (2 to 6 weeks) in with it. The operator wants the one thing that
already works, made better: a chat answer typed into the document at a pace
the user chooses, with an optional human-looking typing style that an HR
colleague asked for.

## Decisions (assumptions the operator can overturn in one word)

- D-1 Removed entirely: autonomous mode (both scopes), the selection bar
  ("Besvar markeringen" and "Brug som kontekst"), the operation picker
  (Omskriv/Opsummér/… on marked text), the Docs API OAuth surface
  (`docs-auth`, `docs-get`, `docs-batch-update`, the oauth2 manifest block),
  the spike page and every probe/verify script that only served those.
- D-2 Kept: chat, tone and length, attachments (+ Fil, + Denne side,
  + Skærmbillede), saved instructions, history, paywall, Indsæt straks /
  Indsæt langsomt with pause, stop and undo.
- D-3 "+ Denne side" on Google Docs now reads the document through Docs' own
  text export (`/export?format=txt`) from the background worker, with the
  browser's cookies. No OAuth, no sensitive scope, no verification. Unverified
  on this machine (no Google login in the harness profile) — the operator
  tests it.
- D-4 Speed: one slider, 10 to 200 words per minute, default 30 (the pace
  already verified), persisted in chrome.storage.local. Straks is unchanged.
- D-5 Human mode ("Skriv som et menneske"): off by default, persisted. When
  on, the slow run occasionally types a wrong letter, notices after a beat,
  backspaces and retypes; and occasionally deletes the last word or two,
  pauses, and types them again. The final text is always byte-identical to
  the answer, and undo removes exactly what was inserted.
- D-6 Backend: the autonomous route and its prompt/parse/vision modules are
  deleted. The chat prompt's operation instructions stay (API surface, not
  dead code paths). Production keeps serving until the next deploy; nothing in
  the new extension calls the removed route.

## Tasks (one commit each)

1. Strip autonomous mode, the selection features and the Docs OAuth surface
   from the extension, backend, shared types, scripts and docs.
2. Speed slider: `PacingConfig.wpm` from the store, persisted; UI row in the
   composer; tooltip reads the live value.
3. Human mode: engine runs a step script (insert / delete / pause) built by
   `insertion/human.ts`; every adapter gains `deleteBack(n)`; Docs undo in
   human mode is Backspace × net characters (deterministic, no dependence on
   how Docs coalesces its history). Unit tests for the builder and engine.
4. "+ Denne side" on Docs via the txt export from the background worker.
5. Docs, planning state, SUMMARY.md.

## Verification

- `pnpm typecheck && pnpm test` green (claims, not proof).
- `node scripts/verify.mjs` against production with the built extension:
  plain textarea slow insert at a chosen speed and in human mode ends
  letter-perfect, undo restores the field; contenteditable the same.
- Google Docs: operator walkthrough (TESTING.md), because the harness profile
  on this machine has no Google session.
