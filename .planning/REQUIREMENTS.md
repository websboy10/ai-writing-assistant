# Requirements: Universal AI Writing Assistant

**Defined:** 2026-08-05
**Core Value:** Generated text lands correctly in the editor the user is already
in, arriving at a pace they can read along with and stop mid-flow.

## v1 Requirements

Requirements for initial release — a hosted beta for 10–50 real users. Each maps
to exactly one roadmap phase.

### Sidebar & Workspace

- [ ] **SIDE-01**: User can open the assistant sidebar on any webpage via a floating button
- [ ] **SIDE-02**: User can open and close the sidebar with a keyboard shortcut
- [ ] **SIDE-03**: User can collapse the sidebar without losing the current conversation
- [ ] **SIDE-04**: User can resize the sidebar and the width persists across pages
- [ ] **SIDE-05**: Sidebar renders correctly regardless of host page CSS, and does not alter the host page's own layout
- [ ] **SIDE-06**: Sidebar survives in-page navigation on single-page apps without needing a reload
- [ ] **SIDE-07**: User can switch between light and dark theme

### Accounts

- [ ] **AUTH-01**: User can create an account with email and password
- [ ] **AUTH-02**: User can sign in with Google
- [ ] **AUTH-03**: User can reset a forgotten password via an emailed link
- [ ] **AUTH-04**: User stays signed in across browser restarts until they sign out
- [ ] **AUTH-05**: User can sign out from the sidebar
- [ ] **AUTH-06**: Unauthenticated requests to the AI backend are rejected

### AI Chat

- [ ] **CHAT-01**: User can send a message and see the response stream in token by token
- [ ] **CHAT-02**: Assistant remembers earlier messages within the current session
- [ ] **CHAT-03**: User can stop a response mid-generation
- [ ] **CHAT-04**: A response that is interrupted by extension or network failure resumes or reports the failure — it never stalls silently
- [ ] **CHAT-05**: User can start a new conversation, clearing session context
- [ ] **CHAT-06**: User can edit the generated response in the sidebar before using it
- [ ] **CHAT-07**: User can copy the generated response to the clipboard

### Prompt Operations

- [ ] **PROM-01**: User can apply a built-in operation to selected page text or to their own input: summarize, rewrite, expand, simplify, explain, translate, continue
- [ ] **PROM-02**: User can capture the text they have selected on the page as the subject of an operation
- [ ] **PROM-03**: Requests are assembled from discrete sections — system instructions, user request, attached context, conversation history, style and format preferences — rather than one concatenated string
- [ ] **PROM-04**: User can set tone and length preferences that apply to generated output

### Insertion Engine

- [ ] **INST-01**: User can insert the generated response into a plain input or textarea, including framework-controlled fields where the text must survive the next re-render
- [ ] **INST-02**: User can insert the generated response into a rich-text editor built on contenteditable — verified against Gmail, LinkedIn, Slack and Notion
- [ ] **INST-03**: User can insert the generated response into a Google Doc at the cursor position
- [ ] **INST-04**: The extension detects which kind of editor is focused and selects the correct insertion method without the user choosing
- [ ] **INST-05**: User can insert the whole response instantly
- [ ] **INST-06**: User can insert the response progressively at a configurable pace
- [ ] **INST-07**: User can pause an in-progress insertion and resume it from the same point
- [ ] **INST-08**: User can stop an in-progress insertion, leaving the partially inserted text in place
- [ ] **INST-09**: User can undo an insertion — complete or partial — in a single step
- [ ] **INST-10**: Insertion continues correctly when the AI response has already finished, and stopping insertion does not abort generation
- [ ] **INST-11**: Inserted text is verified as present after writing; if the editor rejected or reverted it, the user is told and offered clipboard fallback
- [ ] **INST-12**: If the user types into the target editor during progressive insertion, the document is not corrupted
- [ ] **INST-13**: The Google Docs adapter self-tests on load and falls back to clipboard with a visible message if the mechanism has broken
- [ ] **INST-14**: User can configure insertion pacing — characters or words per second, and pauses at sentence and paragraph boundaries

### Context & Files

- [ ] **CTX-01**: User can attach a PDF and have its text used as context
- [ ] **CTX-02**: User can attach a Word document (.docx) and have its text used as context
- [ ] **CTX-03**: User can attach a plain text or Markdown file and have its content used as context
- [ ] **CTX-04**: User can attach an image and have text extracted from it by OCR
- [ ] **CTX-05**: User can capture a screenshot of the current page and have text extracted from it by OCR
- [ ] **CTX-06**: User can paste text directly into the context panel
- [ ] **CTX-07**: User can drag and drop files onto the sidebar to attach them
- [ ] **CTX-08**: User can see everything currently attached as context and remove individual items
- [ ] **CTX-09**: Multiple attached sources are combined into one coherent prompt
- [ ] **CTX-10**: Files that are too large, malformed, or of an unsupported type are rejected with a specific reason
- [ ] **CTX-11**: Extraction that fails or times out reports the failure rather than silently attaching nothing

### History

- [ ] **HIST-01**: User can see their past conversations and reopen one
- [ ] **HIST-02**: Conversations persist across devices for a signed-in user
- [ ] **HIST-03**: User can delete a conversation, and deletion removes stored content

### Trust, Quotas & Compliance

- [ ] **QUOT-01**: Per-user usage limits are enforced on the server before every AI call, atomically
- [ ] **QUOT-02**: User can see their real usage against their limit, expressed in concrete numbers
- [ ] **QUOT-03**: A user who reaches their limit is told clearly, with a stated reset time — never a silent failure
- [ ] **QUOT-04**: The AI provider key is never present in extension code or network traffic reaching the browser
- [ ] **QUOT-05**: Real user content is routed only to paid endpoints with model training and prompt publication disabled; the policy is enforced server-side and cannot be overridden by the client
- [ ] **QUOT-06**: When the chosen model is unavailable or rate-limited, the request falls back through an ordered chain of alternatives rather than failing
- [ ] **QUOT-07**: Every user-visible failure states what went wrong and what to do next — no indefinite spinners, no silent stalls
- [ ] **QUOT-08**: The extension requests the narrowest host permissions that support its function, and ships with a privacy policy describing exactly what data is collected and why

## v2 Requirements

Deferred. Tracked but not in the current roadmap.

### Billing

- **BILL-01**: User can subscribe to a paid plan
- **BILL-02**: User can manage payment method and cancel
- **BILL-03**: Quota tiers are driven by subscription status

### Advanced AI

- **ADV-01**: User can reason across multiple attached documents at once
- **ADV-02**: User can save reusable knowledge collections
- **ADV-03**: Generated claims can cite the source document and location
- **ADV-04**: User can choose between AI providers in the interface

### Productivity

- **PROD-01**: User can save and reuse their own prompt templates
- **PROD-02**: User can search conversation history
- **PROD-03**: User can export a conversation
- **PROD-04**: User can save named workspaces

### Reach

- **REACH-01**: Extension runs in Firefox
- **REACH-02**: Extension runs in Safari
- **REACH-03**: Insertion works in code editors (Monaco, CodeMirror)

## Out of Scope

Explicitly excluded. Documented to prevent scope creep.

| Feature | Reason |
|---------|--------|
| Payment processing in v1 | Beta runs on the operator's own key; quotas provide the economic protection billing would. Building it now delays reaching real users |
| Firefox and Safari | Separate manifests, API shims and an Xcode wrapper plus App Store review. Prove the product in one browser first |
| Code editor adapters | Monaco and CodeMirror each need bespoke work and are not where prose gets written |
| Handwriting OCR | Accuracy is poor enough that wrong extracted text would damage trust in the whole context pipeline |
| Team and collaboration features | Single-user product first |
| Model picker in the UI | Competitor reviews tie multi-model UI to "cluttered and confusing". The provider abstraction stays internal until there is a concrete reason to expose it |
| Marketing insertion pacing as undetectable or humanized | Pacing exists so the user can read along and intervene. Framing it as AI-detection evasion invites Chrome Web Store and reputational risk, and misdescribes the feature |
| The word "unlimited" anywhere near quotas | The single most trust-destroying pattern found across competitor reviews. Show real numbers instead |
| Agentic or web-automation features | Outside writing assistance; correlates with the complaint patterns found in competitors |
| Remote-loaded prompt templates | Chrome Web Store treats remotely loaded code as grounds for rejection |
| `<all_urls>` host permission requested up front | Triggers in-depth Web Store review and is hard to walk back. Request the narrowest scope that works |

## Traceability

| Requirement | Phase | Status |
|-------------|-------|--------|
| SIDE-01 | Phase 1 — Foundation: Sidebar, Accounts & Guarded Chat | Pending |
| SIDE-02 | Phase 1 — Foundation: Sidebar, Accounts & Guarded Chat | Pending |
| SIDE-03 | Phase 1 — Foundation: Sidebar, Accounts & Guarded Chat | Pending |
| SIDE-04 | Phase 1 — Foundation: Sidebar, Accounts & Guarded Chat | Pending |
| SIDE-05 | Phase 1 — Foundation: Sidebar, Accounts & Guarded Chat | Pending |
| SIDE-06 | Phase 1 — Foundation: Sidebar, Accounts & Guarded Chat | Pending |
| SIDE-07 | Phase 1 — Foundation: Sidebar, Accounts & Guarded Chat | Pending |
| AUTH-01 | Phase 1 — Foundation: Sidebar, Accounts & Guarded Chat | Pending |
| AUTH-02 | Phase 1 — Foundation: Sidebar, Accounts & Guarded Chat | Pending |
| AUTH-03 | Phase 1 — Foundation: Sidebar, Accounts & Guarded Chat | Pending |
| AUTH-04 | Phase 1 — Foundation: Sidebar, Accounts & Guarded Chat | Pending |
| AUTH-05 | Phase 1 — Foundation: Sidebar, Accounts & Guarded Chat | Pending |
| AUTH-06 | Phase 1 — Foundation: Sidebar, Accounts & Guarded Chat | Pending |
| CHAT-01 | Phase 1 — Foundation: Sidebar, Accounts & Guarded Chat | Pending |
| CHAT-02 | Phase 1 — Foundation: Sidebar, Accounts & Guarded Chat | Pending |
| CHAT-03 | Phase 1 — Foundation: Sidebar, Accounts & Guarded Chat | Pending |
| CHAT-04 | Phase 1 — Foundation: Sidebar, Accounts & Guarded Chat | Pending |
| CHAT-05 | Phase 1 — Foundation: Sidebar, Accounts & Guarded Chat | Pending |
| CHAT-06 | Phase 1 — Foundation: Sidebar, Accounts & Guarded Chat | Pending |
| CHAT-07 | Phase 1 — Foundation: Sidebar, Accounts & Guarded Chat | Pending |
| PROM-01 | Phase 1 — Foundation: Sidebar, Accounts & Guarded Chat | Pending |
| PROM-02 | Phase 1 — Foundation: Sidebar, Accounts & Guarded Chat | Pending |
| PROM-03 | Phase 1 — Foundation: Sidebar, Accounts & Guarded Chat | Pending |
| PROM-04 | Phase 1 — Foundation: Sidebar, Accounts & Guarded Chat | Pending |
| INST-01 | Phase 2 — Insertion Foundation: Plain Fields & Rich Text | Pending |
| INST-02 | Phase 2 — Insertion Foundation: Plain Fields & Rich Text | Pending |
| INST-03 | Phase 3 — Google Docs Spike & Adapter | Pending |
| INST-04 | Phase 2 — Insertion Foundation: Plain Fields & Rich Text | Pending |
| INST-05 | Phase 2 — Insertion Foundation: Plain Fields & Rich Text | Pending |
| INST-06 | Phase 2 — Insertion Foundation: Plain Fields & Rich Text | Pending |
| INST-07 | Phase 2 — Insertion Foundation: Plain Fields & Rich Text | Pending |
| INST-08 | Phase 2 — Insertion Foundation: Plain Fields & Rich Text | Pending |
| INST-09 | Phase 2 — Insertion Foundation: Plain Fields & Rich Text | Pending |
| INST-10 | Phase 2 — Insertion Foundation: Plain Fields & Rich Text | Pending |
| INST-11 | Phase 2 — Insertion Foundation: Plain Fields & Rich Text | Pending |
| INST-12 | Phase 2 — Insertion Foundation: Plain Fields & Rich Text | Pending |
| INST-13 | Phase 3 — Google Docs Spike & Adapter | Pending |
| INST-14 | Phase 2 — Insertion Foundation: Plain Fields & Rich Text | Pending |
| CTX-01 | Phase 4 — Context & File Pipeline | Pending |
| CTX-02 | Phase 4 — Context & File Pipeline | Pending |
| CTX-03 | Phase 4 — Context & File Pipeline | Pending |
| CTX-04 | Phase 4 — Context & File Pipeline | Pending |
| CTX-05 | Phase 4 — Context & File Pipeline | Pending |
| CTX-06 | Phase 4 — Context & File Pipeline | Pending |
| CTX-07 | Phase 4 — Context & File Pipeline | Pending |
| CTX-08 | Phase 4 — Context & File Pipeline | Pending |
| CTX-09 | Phase 4 — Context & File Pipeline | Pending |
| CTX-10 | Phase 4 — Context & File Pipeline | Pending |
| CTX-11 | Phase 4 — Context & File Pipeline | Pending |
| HIST-01 | Phase 5 — Conversation History | Pending |
| HIST-02 | Phase 5 — Conversation History | Pending |
| HIST-03 | Phase 5 — Conversation History | Pending |
| QUOT-01 | Phase 1 — Foundation: Sidebar, Accounts & Guarded Chat | Pending |
| QUOT-02 | Phase 6 — Quota Hardening, Usage Transparency & Trust Polish | Pending |
| QUOT-03 | Phase 6 — Quota Hardening, Usage Transparency & Trust Polish | Pending |
| QUOT-04 | Phase 1 — Foundation: Sidebar, Accounts & Guarded Chat | Pending |
| QUOT-05 | Phase 1 — Foundation: Sidebar, Accounts & Guarded Chat | Pending |
| QUOT-06 | Phase 6 — Quota Hardening, Usage Transparency & Trust Polish | Pending |
| QUOT-07 | Phase 1 — Foundation: Sidebar, Accounts & Guarded Chat | Pending |
| QUOT-08 | Phase 6 — Quota Hardening, Usage Transparency & Trust Polish | Pending |

**Coverage:**
- v1 requirements: 60 total
- Mapped to phases: 60
- Unmapped: 0 ✓

---
*Requirements defined: 2026-08-05*
*Last updated: 2026-08-05 after roadmap creation (60/60 v1 requirements mapped across 6 phases)*
