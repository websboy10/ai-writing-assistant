# Roadmap: Universal AI Writing Assistant

## Overview

The journey runs from a signed-in user who can hold a streaming AI conversation
inside a sidebar on any page, through the three insertion engines that are this
product's actual differentiator (plain fields, contenteditable, and — proved by
an early spike, built once the state machine is solid — Google Docs), to the
context pipeline that feeds richer prompts, conversation history, and finally
the quota/trust hardening that makes a beta safe to hand to real users writing
real, sometimes sensitive, material. Every phase after Phase 1 ships a complete,
observable capability end to end; nothing is a horizontal layer with no visible
behavior until the end.

## Phases

**Phase Numbering:**

- Integer phases (1, 2, 3): Planned milestone work
- Decimal phases (2.1, 2.2): Urgent insertions (marked with INSERTED)

Decimal phases appear between their surrounding integers in numeric order.

- [ ] **Phase 1: Foundation — Sidebar, Accounts & Guarded Chat** - Signed-in user can chat with the AI in a sidebar on any page, protected by a server-side auth/quota gate and a provider-policy gate that keeps real content off free/training-enabled models
- [ ] **Phase 2: Insertion Foundation — Plain Fields & Rich Text** - User can insert AI output, instantly or progressively with pause/resume/stop/undo, into plain form fields and contenteditable editors (Gmail, LinkedIn, Slack, Notion)
- [ ] **Phase 3: Google Docs Spike & Adapter** - A timeboxed go/no-go spike proves (or disproves) synthetic-keystroke insertion into Google Docs; on go, a self-testing adapter ships with the same transport controls as Phase 2
- [ ] **Phase 4: Context & File Pipeline** - User can attach PDFs, Word docs, text/Markdown, images and screenshots, and have their content pulled into the prompt as context, with specific failure messages when a file can't be processed
- [ ] **Phase 5: Conversation History** - User can see, reopen, and delete past conversations, persisted across devices
- [ ] **Phase 6: Quota Hardening, Usage Transparency & Trust Polish** - Real per-user quota limits with honest usage numbers, an ordered model fallback chain, and the permission/privacy posture needed to keep the extension defensible
- [ ] **Phase 7: Autonomous mode — answer every question in a document** - User opens a document full of questions, presses one button, and the assistant finds every question, answers them all and writes the answers back, in either insertion mode

## Phase Details

### Phase 1: Foundation — Sidebar, Accounts & Guarded Chat

**Goal**: A signed-in user can open the assistant on any webpage and hold a streaming AI conversation, while the server enforces who can call the AI, what it costs them, and which models real content is allowed to touch.
**Mode:** mvp
**Depends on**: Nothing (first phase)
**Requirements**: SIDE-01, SIDE-02, SIDE-03, SIDE-04, SIDE-05, SIDE-06, SIDE-07, AUTH-01, AUTH-02, AUTH-03, AUTH-04, AUTH-05, AUTH-06, CHAT-01, CHAT-02, CHAT-03, CHAT-04, CHAT-05, CHAT-06, CHAT-07, PROM-01, PROM-02, PROM-03, PROM-04, QUOT-01, QUOT-04, QUOT-05, QUOT-07
**Success Criteria** (what must be TRUE):

  1. User can open the sidebar on any webpage via a floating button or a keyboard shortcut, collapse it without losing the conversation, resize it with the width persisting across pages, switch light/dark theme, and it survives in-page navigation on single-page apps without a reload.
  2. User can create an account with email/password or sign in with Google, stay signed in across a browser restart, reset a forgotten password by email, and sign out from the sidebar.
  3. User can send a message and watch the response stream in token by token, stop it mid-generation, start a fresh conversation that clears prior context, edit the generated response in the sidebar, and copy it to the clipboard.
  4. User can apply a built-in operation (summarize, rewrite, expand, simplify, explain, translate, continue) to text selected on the page or typed in, and set a tone/length preference that visibly changes the output.
  5. An unauthenticated or over-stub-limit request to the backend is rejected with a specific, visible message rather than a silent stall, and a bundle/network inspection shows the AI provider key never reaches the browser and real traffic is never routed to a free or training-enabled model.

**Plans**: TBD
**UI hint**: yes

### Phase 2: Insertion Foundation — Plain Fields & Rich Text

**Goal**: The generated response can be written into the two friendlier classes of editor — plain form fields and contenteditable rich-text editors — with full transport control, proving the insertion state machine before the fragile Google Docs adapter is built on top of it.
**Mode:** mvp
**Depends on**: Phase 1
**Requirements**: INST-01, INST-02, INST-04, INST-05, INST-06, INST-07, INST-08, INST-09, INST-10, INST-11, INST-12, INST-14
**Success Criteria** (what must be TRUE):

  1. User can insert the response instantly into a plain `<input>`/`<textarea>`, including a React-controlled field, and the text survives the next re-render rather than reverting.
  2. User can insert the response into a rich-text editor — verified on Gmail, LinkedIn, Slack and Notion — with the extension detecting the right editor type automatically, without the user choosing an insertion method.
  3. User can turn on progressive insertion at a configurable pace (characters/words per second, with pauses at sentence/paragraph boundaries), and pause, resume, and stop it mid-flight without losing already-inserted text; stopping insertion never aborts the AI response if it's still generating.
  4. User can undo a complete or partial insertion in a single action, and typing into the target field during progressive insertion does not corrupt or duplicate the document.
  5. If the editor silently reverts or rejects the written text, the user is told specifically and offered copy-to-clipboard as a fallback.

**Plans**: TBD
**UI hint**: yes

### Phase 3: Google Docs Spike & Adapter

**Goal**: Prove — via a timeboxed, go/no-go spike run early and, where possible, in parallel with Phase 2 — that synthetic-keystroke insertion into Google Docs' hidden input target actually works against current Docs internals; on a go decision, ship a full adapter with the same transport controls as the other two editors plus a self-test and clipboard fallback for when the mechanism breaks.
**Mode:** mvp
**Depends on**: Phase 1 (spike can start in parallel with Phase 2); the full adapter build depends on Phase 2's insertion state machine being proven
**Requirements**: INST-03, INST-13
**Success Criteria** (what must be TRUE):

  1. A documented go/no-go decision exists from the timeboxed spike, based on an actual test of synthetic keystrokes landing text in a real Google Doc — not a code review or a plan.
  2. On a go decision, user can place their cursor in a Google Doc, trigger insertion from the sidebar, and see the generated text appear at that cursor position, including progressive insertion with pause/resume/stop.
  3. On every load, the Docs adapter runs a self-test; if the self-test fails, the user sees a specific "Google Docs insertion isn't working right now" message and is offered copy-to-clipboard instead of a silent or corrupting failure.

**Plans**: TBD
**UI hint**: yes

### Phase 4: Context & File Pipeline

**Goal**: A user can pull outside material — documents, images, screenshots, pasted text — into the conversation as context, entirely processed server-side, with defensive limits so one bad upload can't take down the shared backend.
**Mode:** mvp
**Depends on**: Phase 1 (needs the authenticated backend and structured-prompt-assembly convention); independent of Phases 2-3 and can run in parallel with them
**Requirements**: CTX-01, CTX-02, CTX-03, CTX-04, CTX-05, CTX-06, CTX-07, CTX-08, CTX-09, CTX-10, CTX-11
**Success Criteria** (what must be TRUE):

  1. User can attach a PDF, a Word document, or a plain text/Markdown file and see its extracted text appear as context.
  2. User can upload an image or capture a screenshot of the current page and see OCR-extracted text appear as context, and can also paste text directly or drag-and-drop files onto the sidebar.
  3. User can see everything currently attached as context in one list, remove individual items, and confirm multiple sources get combined into one coherent prompt.
  4. A file that's too large, malformed, or an unsupported type is rejected immediately with a specific reason instead of hanging or crashing the upload.
  5. If extraction or OCR fails or times out, the user sees a specific failure message rather than the item silently attaching nothing.

**Plans**: TBD
**UI hint**: yes

### Phase 5: Conversation History

**Goal**: A signed-in user's conversations persist and are reachable across sessions and devices, with real deletion when they choose to remove one.
**Mode:** mvp
**Depends on**: Phase 1 (auth and conversation storage); independent of Phases 2-4 and can run in parallel with them
**Requirements**: HIST-01, HIST-02, HIST-03
**Success Criteria** (what must be TRUE):

  1. User can see a list of past conversations and reopen one to continue it.
  2. Signing in on a second browser/device shows the same conversation history.
  3. User can delete a conversation, it disappears from the list immediately, and its stored content is actually removed, not just hidden.

**Plans**: TBD
**UI hint**: yes

### Phase 6: Quota Hardening, Usage Transparency & Trust Polish

**Goal**: The Phase 1 quota stub becomes real, calibrated enforcement with honest usage numbers, model unavailability degrades gracefully instead of failing, and the extension's permission/privacy posture is defensible for a wider release.
**Mode:** mvp
**Depends on**: Phases 1-5 (hardens quota using real observed usage across chat, insertion, and context features)
**Requirements**: QUOT-02, QUOT-03, QUOT-06, QUOT-08
**Success Criteria** (what must be TRUE):

  1. User can see their real usage against their limit expressed in concrete numbers (e.g., "12 of 50 requests used"), never the word "unlimited," anywhere quota is relevant.
  2. A user who reaches their limit is told clearly, with a stated reset time, instead of hitting a silent failure.
  3. When the default AI model is unavailable or rate-limited, the request automatically falls back through an ordered chain of alternative models and the user still gets a response, or a clear final failure if every option is exhausted.
  4. The extension requests only the narrowest host permissions its functions need, and a real, specific privacy policy describing what's collected and why is reachable from the extension.

**Plans**: TBD
**UI hint**: yes

### Phase 7: Autonomous mode — answer every question in a document
**Goal**: [To be set by /gsd:discuss-phase 7 — see the open questions below]
**Mode:** TBD
**Depends on**: Phases 1-6 (all shipped)
**Requirements**: TBD (new requirement family AUTO-xx to be written during discuss)
**Success Criteria** (what must be TRUE): TBD

**Origin**: Operator request 2026-08-06. The use case is a project leader who
sends a worker a document full of questions. The worker opens it, presses one
button, and the assistant reads the whole document, finds every question,
answers them all, and writes the answers back — in either of the two insertion
modes that already exist (Straks and Langsomt).

**The load-bearing assumption**: Google Docs paints its document to `<canvas>`,
so there is no readable DOM (`insertion/adapters/gdocs.ts:6-9`). The candidate
read path is select-all followed by reading the hidden
`iframe.docs-texteventtarget-iframe` mirror that `GDocsAdapter.hasSelection()`
(gdocs.ts:67) already uses to detect a selection. **Unproven against live Docs.**
If it fails, the whole feature's shape changes on Docs. It should be spiked
before anything else is planned — the same go/no-go discipline Phase 3 used.

**The consequence if it holds**: the mirror yields plain text with no positions.
We would know every question but not where on the canvas each one sits, so
answering *in place, under each question* is the hard part on Docs specifically.
Plain fields and contenteditable editors have real positions and do not have
this problem.

**Open questions for discuss** (none of these are decided):
1. What counts as a question? Lines ending in `?`, numbered items, a heading
   with blank space under it, form-like prompts — the document is not
   necessarily punctuated helpfully.
2. Where does each answer go — in place under its question, or as one collected
   answer block at the cursor/end? On Docs this may be forced.
3. Langsomt at ~30 wpm across a whole questionnaire could run for many minutes.
   Does the user watch it, can they leave, what happens on tab switch?
4. Review before writing: does the user see the answers first, or does the
   assistant write straight into the document?
5. Stop and undo across *many* insertions rather than one.
6. What the assistant answers *from* — the document alone, attached files, or
   does it need to ask the user for facts it cannot know?

**Plans**: TBD
**UI hint**: yes

## Progress

**Execution Order:**
Phases execute in numeric order: 1 → 2 → 3 → 4 → 5 → 6. Phase 3's spike may start in parallel with Phase 2. Phases 4 and 5 are architecturally independent of Phases 2-3 and each other, and may run in parallel with them once Phase 1 is complete, if parallel capacity is available.

**Parallelization notes** (parallelization enabled per config.json):

- Phase 3's Google Docs spike (the go/no-go experiment itself, not the full adapter) can start as soon as Phase 1 ships — it only needs a way to test synthetic keystrokes against docs.google.com, not the insertion state machine. The full Docs *adapter* build still waits on Phase 2's state machine being proven, per the hard constraint that state-machine bugs must be shaken out on friendlier adapters first.
- Phase 4 (Context & File Pipeline) is backend-only and shares no code with the insertion adapters — it can run fully in parallel with Phases 2 and 3 once Phase 1's authenticated backend exists.
- Phase 5 (Conversation History) is a thin persistence/UI slice on top of Phase 1's chat and auth — it can also run in parallel with Phases 2-4.

| Phase | Plans Complete | Status | Completed |
|-------|----------------|--------|-----------|
| 1. Foundation — Sidebar, Accounts & Guarded Chat | 0/TBD | Not started | - |
| 2. Insertion Foundation — Plain Fields & Rich Text | 0/TBD | Not started | - |
| 3. Google Docs Spike & Adapter | 0/TBD | Not started | - |
| 4. Context & File Pipeline | 0/TBD | Not started | - |
| 5. Conversation History | 0/TBD | Not started | - |
| 6. Quota Hardening, Usage Transparency & Trust Polish | 0/TBD | Not started | - |
| 7. Autonomous mode — answer every question in a document | 0/TBD | Not planned | - |
