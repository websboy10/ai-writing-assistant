# Phase 7: Autonomous mode — answer every question in a document - Context

**Gathered:** 2026-08-06
**Status:** Ready for planning

<domain>
## Phase Boundary

One capability, reachable two ways: the assistant finds every question in a body
of text, answers them all, and writes the answers back into the document — using
the two insertion modes that already exist (Straks and Langsomt).

The two entry points are **scopes of the same machine**, not separate features:

| Entry point | Scope |
|---|---|
| Autonomous-mode button | The whole open document |
| "Besvar markeringen" on a selection | Only what the user marked (1 question or 20) |

**In scope:** question detection, answer generation, per-question placement, the
Google Docs API read/write path, and the fast/slow choice at the point of use.

**Out of scope:** anything that turns this into a conversation (interviewing the
user, approval gates, per-answer confirmation) — explicitly rejected by the
operator. "Brug som kontekst" keeps its current behaviour, untouched.

</domain>

<decisions>
## Implementation Decisions

### Where answers land

- **D-01:** Answers go **in place — directly under the question they answer**.
  This is the default everywhere and, with D-05, on Google Docs too.
- **D-02:** Where in-place placement is genuinely impossible (Docs API
  unavailable AND the fallback path in use), answers land as **one block at the
  cursor with each question repeated above its answer**, and the panel states
  plainly why it differs. This is a degraded mode, not the design.
- **D-03:** Insertion is **sequential and re-located as it goes**. Writing under
  question 1 moves question 2 down the page, so positions must be resolved one
  at a time during the run, never all measured up front.

### The two modes (no third path, no review step)

- **D-04:** The existing two buttons are the entire interface. **Straks** writes
  every answer at once, formatted under its question. **Langsomt** types letter
  by letter **starting at the first question in the document and working
  downward**, each answer appearing beneath its question.
  **There is no review step and no approval gate** — operator decision, stated
  twice. The user picks fast or slow, and the assistant writes.
- **D-04a:** On the "Besvar markeringen" path, clicking it makes the panel ask
  **Straks or Langsomt**; the user picks and the assistant writes directly. The
  old "generate into the panel, then press insert" two-step **goes away** on
  this path.
- **D-04b:** "Brug som kontekst" is **unchanged** — the marking becomes context
  and feeds the next question or request. No work here beyond not breaking it.

### Google Docs — build the real thing

- **D-05:** **Use the Google Docs API** as the primary read and write path:
  `documents.get` for structure and exact indices, `documents.batchUpdate` to
  insert at a position. This replaces guessing, gives true in-place answers,
  preserves the user's formatting, and makes question-detection materially
  better because headings, tables and list items arrive as *structure* rather
  than as a wall of plain text.
- **D-06:** **Keep today's synthetic-paste mechanism as the fallback** for users
  who decline the Google permission or when the API call fails. Falling back is
  visible to the user, never silent, and it degrades to D-02 placement.
- **D-07:** **Google OAuth is now a hard prerequisite for this phase**, not the
  optional "Job 4" it was in SETUP.md. The same Google Cloud project serves both
  Google sign-in and the Docs API.
- **D-08:** Ship to beta under OAuth **"Testing" mode (up to 100 users, no
  Google verification)**. App verification is a launch task, not a Phase 7
  blocker — and it is paperwork Google sign-in would have required anyway.
- **D-09:** The canvas/select-all/hidden-iframe reading route that this phase
  was originally scoped around is **superseded by D-05** for Docs. It survives
  only inside the D-06 fallback.

### Google Docs, revised after research (2026-08-06)

Research (`07-RESEARCH.md`) found two things that contradicted the decisions
above. Both went back to the operator and were re-decided.

- **D-16: Read with the API, position with Find, type with the existing engine.**
  The Docs API caps writes at **60 requests/minute per user**. Letter-by-letter
  at 30 wpm needs ~150/min, so an API-per-letter Langsomt is impossible. The
  operator rejected every compromise ("we need to fix it. letter by letter"),
  and the resolution is to stop using the API for writing at all:
  1. **`documents.get`** — one request per run. Yields every question, its exact
     text and its `startIndex`. This is what the API is genuinely good at.
  2. **Docs' own Find (Ctrl+F)** — real DOM, not canvas. Fed the exact question
     text from step 1, it moves the cursor to that question for us. This is the
     positioning capability the canvas denies us.
  3. **The existing `InsertionSession` + `GDocsAdapter`** — types letter by
     letter into the live cursor via synthetic events. Local, unlimited, already
     built, already tested.

  **Quota cost: one read request per document, zero writes.** True
  letter-by-letter, in place, top to bottom — the full operator requirement with
  no compromise. It is also the *smaller* change: no second Langsomt path is
  built, the existing engine is reused and only positioning is added.

  `GDocsAdapter.prepare()` already collapses a selection to its end before
  typing (gdocs.ts:88-102), which is exactly the state Find leaves behind — the
  two fit together without modification.

- **D-16a: Find-positioning is UNPROVEN and must be spiked first.** Same risk
  class as the existing paste mechanism. The plan must prove it against a real
  Google Doc before anything is built on top of it. **Fallback if it proves
  unreliable:** `documents.batchUpdate` writes, applied bottom-up (highest index
  first, per Google's documented ordering rule), which yields correct in-place
  placement for Straks and degrades Langsomt to the D-02 block on Docs only.

- **D-17: A second OAuth client, not the Supabase provider token.** Supabase
  does **not** refresh `provider_token`, and Google's tokens expire hourly.
  Making the Supabase path work would put the Google **client secret** on our
  backend — contradicting what `docs/GOOGLE-SETUP.md` promised the operator.
  Instead: a second OAuth client of type **Chrome Extension** in the same Google
  Cloud project (D-07 still holds), used via `chrome.identity.getAuthToken()`.
  Chrome caches and refreshes the token itself; no secret ever enters this
  codebase. **This also enables incremental authorization** — document access is
  requested the first time someone runs autonomous mode on a Doc, not at signup,
  which is materially better for conversion.
  - **Operator action required:** ~2 minutes creating that client. The extension
    ID is already pinned (`foidkbeinmfolejjjfjcokmmknimohof`).
  - **Unverified:** whether `getAuthToken` works before the extension is
    published to the Web Store. Must be tested early — it is cheap to test and
    expensive to discover late.
  - **Granular consent trap:** Google now lets a user grant sign-in while
    unticking `documents`. Always check `grantedScopes` before assuming access;
    never let a partial grant look like success.
  - The Supabase Google sign-in configured on 2026-08-06 stays exactly as it is
    and keeps powering login.

### What counts as a question

- **D-10:** **The AI decides.** The document (or the marked text) goes to the
  model, which returns the list of things needing an answer. No hand-written
  rules about `?` characters or numbering — real questionnaires use "Beskriv
  dine tre vigtigste resultater", numbered fields, and headings with blank space
  beneath them, and a rule-based detector would miss most of a real form.

### Claude's Discretion

The operator explicitly delegated **"where the answers come from"** and did not
take up the smaller interaction questions. Decided as follows:

- **D-11:** **Source material = the document itself plus any files already
  attached in the panel.** A worker can drop in their notes, last review, or a
  project summary and get answers built from their actual work. This reuses the
  existing file/OCR pipeline, costs the user no extra steps, and is the single
  biggest thing separating this feature from fabrication.
- **D-12:** **The panel lists which questions had nothing to draw on**, shown
  alongside the run. Visible, never a gate — this respects D-04 (no review step)
  while keeping the invented answers findable.
  **Context:** the operator chose "just answer everything, mark nothing in the
  document" with the fabrication risk stated. D-11 and D-12 are the mitigation
  that fits inside that decision rather than reopening it.
- **D-13:** A **trusted keystroke from the user during a run auto-pauses it**,
  reusing the existing typing-race guard (INST-12) unchanged.
- **D-14:** A long Langsomt run **continues in a background tab**. The insertion
  engine lives in the content script and its timers survive; it is not tied to
  the panel being visible.
- **D-15:** **Stop and undo work across the whole run**, not per answer — one
  user-visible undo step, consistent with INST-08. On the Docs API path undo is
  exact; on the D-06 fallback it stays best-effort and is reported honestly.

</decisions>

<canonical_refs>
## Canonical References

**Downstream agents MUST read these before planning or implementing.**

### The insertion machine this phase drives
- `apps/extension/insertion/types.ts` — `InsertionAdapter`, `EditorKind`,
  `PacingConfig`. Note `verifyIntact?` is deliberately absent on adapters that
  cannot observe the editor.
- `apps/extension/insertion/engine.ts` — the `InsertionSession` state machine
  (idle → running ⇄ paused → done/stopped/error), the typing-race guard behind
  D-13, and `insertInstant()` vs the paced path behind D-04.
- `apps/extension/insertion/target.ts` — `SavedTarget`, `isGoogleDocs()`,
  `gdocsEventTarget()`; how a target and cursor are captured.
- `apps/extension/insertion/adapters/gdocs.ts` — the current Docs mechanism that
  becomes the D-06 fallback. Lines 6-9 state the canvas constraint; line 67
  (`hasSelection`) is the hidden-mirror read channel.

### Where the two entry points live
- `apps/extension/sidebar/inserter.ts` — insertion driven from the panel.
- `apps/extension/sidebar/chat.ts` — request assembly. **Line 48 is the
  `contentClass` defect recorded in STATE.md** — it reads a checkbox that no
  longer exists in the UI.
- `apps/extension/sidebar/components/ChatView.tsx` — the panel surface where the
  Straks/Langsomt prompt (D-04a) and the gap list (D-12) belong.
- `apps/extension/sidebar/store.ts` — panel state.
- `scripts/verify.mjs` §"Marked text" — the *current* behaviour of "Besvar
  markeringen" / "Brug som kontekst", and the E2E suite any change must keep
  green.

### Project-level constraints
- `.planning/PROJECT.md` — core value statement; note the first demand signal is
  **HR teams writing performance reviews in Google Docs**, which is exactly this
  phase's use case.
- `.planning/STATE.md` — locked operator decisions, including the deferred
  model-routing fix and the paused Web Store submission.
- `.planning/ROADMAP.md` §"Phase 7" — origin, the six original open questions,
  and the superseded canvas assumption (see D-09).
- `docs/SETUP.md` Job 4 — the Google OAuth credential, promoted to a
  prerequisite by D-07.

</canonical_refs>

<code_context>
## Existing Code Insights

### Reusable Assets
- **`InsertionSession`** already does pacing, pause/resume/stop, undo and the
  typing-race guard. Autonomous mode should **drive it repeatedly**, once per
  answer, rather than growing a second insertion path.
- **The file/OCR context pipeline** (PDF/DOCX/TXT/MD + vision OCR) is built and
  live — D-11 needs no new ingestion work, only that attached files reach the
  autonomous prompt.
- **The adapter interface** already models "this editor cannot be observed"
  (`verified: false`, optional `verifyIntact`). A Docs *API* adapter is the
  first adapter that CAN observe Docs — the interface accommodates it as-is.
- **`Redigér`** (edit-before-insert) and the chip UI exist and are untouched.

### Established Patterns
- **One adapter per editor family**, deliberately isolated (`types.ts:10-13`).
  The Docs API path should be a **new adapter**, not a branch inside the
  existing `GDocsAdapter`.
- **`selfTest()` before promising anything** (INST-13): prove the mechanism
  exists, and on failure show a specific message plus a fallback — never a
  silent no-op. The Docs API path must follow this: probe authorization first,
  fall back visibly per D-06.
- **Failure is always specific and visible.** No silent stalls anywhere.
- **Two modes only, hardcoded, no settings UI** — the operator's "idiot
  friendly" bar from the 2026-08-06 simplification pass. Do not add a pacing
  control, a mode preference, or a settings surface.

### Integration Points
- New: Google Docs API client + OAuth token handling (extension `identity`
  permission already granted and used by `background.ts:196`).
- New: a question-extraction call, distinct from the chat call.
- Changed: `chat.ts` request path, to carry a whole-document or marked-text
  scope.
- Changed: the selection bar's "Besvar markeringen" branch (D-04a).
- The backend must decide whether the Docs API is called from the extension or
  proxied — a planning question, not a discussion one.

</code_context>

<specifics>
## Specific Ideas

- The operator's framing, verbatim in intent: *a project leader sends a worker a
  document full of questions; the worker opens it, picks fast or slow, and the
  answers get written in.* This is the acceptance scenario to build against.
- **Ten questions marked at once must work** — the operator raised this
  explicitly. Multi-question selections are the normal case, not an edge case.
- Langsomt should look like a person typing the document out, top to bottom —
  the visible behaviour matters to the operator, not just the end state.
- "Let's be creative and fix Google Docs" — the operator rejected accepting the
  canvas limitation. D-05 exists because a workaround was judged not good
  enough.

</specifics>

<deferred>
## Deferred Ideas

- **Google OAuth app verification** for public launch (>100 users). Required
  eventually by D-08; not a Phase 7 blocker. Belongs with the Web Store
  submission work.
- **Microsoft Word Online / Office 365** as a second structured-document target.
  Never discussed; noted because D-05 establishes the "use the real API"
  pattern that would apply there.
- **The `contentClass` model-routing fix** (`chat.ts:48`) — a live defect
  recorded in STATE.md, deliberately deferred by the operator. Phase 7 will
  route far more user content through the model than before, which raises the
  stakes, but it remains its own decision.

</deferred>

---

*Phase: 7-autonomous-mode-answer-every-question-in-a-document*
*Context gathered: 2026-08-06*
