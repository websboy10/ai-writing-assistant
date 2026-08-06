# Phase 7: Autonomous mode — answer every question in a document - Research

**Researched:** 2026-08-06
**Domain:** Google OAuth token acquisition (Supabase + Chrome), Google Docs REST API (read/write, index math, rate limits), structured LLM output for question extraction, Chrome extension identity APIs
**Confidence:** MEDIUM-HIGH — the Docs API mechanics are HIGH confidence (official docs, cross-verified). The OAuth *mechanism choice* is the one place this research diverges from the plan implied by `docs/GOOGLE-SETUP.md`, and that divergence is flagged loudly below — it is not a contradiction of a locked CONTEXT.md decision, but it does contradict an assumption GOOGLE-SETUP.md states as settled.

## Summary

D-05's "build the real thing" is achievable, and the Google Cloud setup the operator already completed (Docs API enabled, `documents` scope on the consent screen, Testing mode, test users) is sufficient infrastructure for it — **no additional Google Cloud console work is strictly required beyond what's already done**, though one small addition is recommended (see below).

The one open engineering decision the operator has not made and CONTEXT.md correctly leaves open is **how the extension obtains a usable Google API access token**. Two mechanisms exist and this research recommends a specific one:

- **Mechanism A (implied by GOOGLE-SETUP.md's "I hold on to the Google token... I handle the refresh"):** extend the existing Supabase-mediated sign-in (`auth.ts:75`) to request the `documents` scope plus `access_type=offline&prompt=consent`, extract `provider_token`/`provider_refresh_token` from the OAuth callback, and have the **backend** store and refresh them. This requires the backend to hold the Google OAuth **client secret** itself (Supabase does not expose or refresh provider tokens on the app's behalf — confirmed below), which is new secret-handling surface GOOGLE-SETUP.md explicitly told the operator they'd never need to provide ("You don't need to send me the client secret. It lives in Supabase.").
- **Mechanism B (recommended):** register a **second, separate OAuth client** in the *same* Google Cloud project — type **"Chrome Extension"**, Item ID = the already-pinned extension ID — scoped only to `.../auth/documents`, and call it via `chrome.identity.getAuthToken()` from the extension's background service worker. Chrome caches, and transparently refreshes, this token; **no client secret is ever created or handled by this app's code**, because "Chrome Extension"-type OAuth clients use the installed-app flow, which has no secret. This is also the natural mechanism for **incremental, at-first-use authorization** (Research Q2) — call it interactively the first time the user runs autonomous mode on a Doc, not at sign-up.

Mechanism B is recommended on simplicity, security, and incremental-auth grounds. It satisfies D-07 ("same Google Cloud project") literally — it is one more OAuth client resource inside the project that already exists, not a new project. It is a small addition to what GOOGLE-SETUP.md describes (one extra Google Cloud Console step, ~5 minutes, no new operator-facing complexity) and should be presented to the operator as an open decision before planning locks it in, per D-05/D-06's spirit of not silently reinterpreting a build approach.

**The second load-bearing finding** is about Langsomt on the Docs API path. Google's write quota is **60 requests/minute per user** (600/minute per project) — confirmed against official docs. A literal per-letter `batchUpdate` call, at the product's existing ~30 wpm (2.5 chars/sec ≈ 150 requests/minute), **exceeds the quota by 2.5x** and will 429. Per-letter API calls are infeasible as designed. The recommended fix does not touch `InsertionSession` or its existing chunking/pacing (`chunkText`, `delayAfter` in `engine.ts`) — instead, the new Docs adapter's `insert(chunk)` **buffers** each per-letter chunk it's handed and flushes the buffer as **one `batchUpdate` call every ~800ms–1s** (a handful of words per flush). The on-screen *progress bar* still advances per letter (because `engine.ts`'s tick loop and jitter are untouched), but **the document itself will visibly update in small word/clause bursts, not true continuous letter-by-letter**, on the Docs API path specifically. This is a real, honest gap against the operator's stated framing ("Langsomt should look like a person typing... the visible behaviour matters") and should be surfaced to the operator, not silently implemented — flagged in Assumptions Log and Open Questions.

**Primary recommendation:** Build a new `GDocsApiAdapter` (kind `'gdocs-api'`, isolated per the existing one-adapter-per-family rule) that authorizes via `chrome.identity.getAuthToken()` against a new "Chrome Extension"-type OAuth client, reads structure via `documents.get`, resolves and inserts answers **bottom-to-top** (highest original index first) via `documents.batchUpdate` `insertText`, buffers Langsomt's per-letter ticks into ~1-request-per-second flushes, and reuses the existing `iframe.docs-texteventtarget-iframe` purely as a keystroke-detection surface for the typing-race guard (D-13) even though it does not perform insertion. An orchestrator above `InsertionSession` drives one session per question, in the same bottom-to-top order, and composes a single combined pause/stop/undo across the whole run (D-15) by calling each sub-session's `undo()` in the same bottom-to-top order insertion happened.

## Architectural Responsibility Map

| Capability | Primary Tier | Secondary Tier | Rationale |
|------------|-------------|----------------|-----------|
| Google API token acquisition (Mechanism B) | Browser / Client (`background.ts`, `chrome.identity`) | — | Chrome owns the installed-app OAuth flow and token cache; no secret exists to hold server-side |
| Google Docs read (`documents.get`) | Browser / Client (background service worker) | — | Has the token; a backend round-trip would only add latency and a new proxy surface for no security benefit (token stays in the extension either way under Mechanism B) |
| Google Docs write (`batchUpdate`) | Browser / Client (background service worker) | — | Same reasoning; keeps all Docs-specific logic (index math, bottom-to-top ordering, buffering) in one place next to the token |
| Question extraction (AI call, D-10) | API / Backend | — | Must go through the existing quota-gated, policy-enforced `/api/chat`-style path (QUOT-01/05) — never call OpenRouter from the extension |
| Answer generation (AI call) | API / Backend | — | Same as above; reuses `streamChat`/`assembleMessages` |
| Source material assembly (doc text + attached files, D-11) | API / Backend | Browser / Client (extracts doc text, sends to backend) | Backend already owns the file/OCR/context pipeline (Phase 4); extension's job is only to hand over the document's plain text alongside existing attachments |
| Insertion pacing / transport state machine | Browser / Client (`InsertionSession`, content script) | — | Existing engine; autonomous mode drives it repeatedly, does not replace it |
| Fallback synthetic-paste mechanism (D-06) | Browser / Client (content script, existing `GDocsAdapter`) | — | Unchanged; triggered when Mechanism B's token is denied or a Docs API call fails |
| Gap list ("nothing to draw on", D-12) | API / Backend (computed alongside answers) | Browser / Client (displayed in panel) | The model itself is best positioned to say when it had no grounding; backend passes the flag through, panel renders it |
| Whole-run undo/stop composition (D-15) | Browser / Client (new orchestrator layer above `InsertionSession`) | — | No existing code owns "N sequential sessions act as one step" — this is new, and belongs next to the existing per-session state machine it wraps |

## User Constraints (from CONTEXT.md)

<user_constraints>

### Locked Decisions

- **D-01:** Answers go **in place — directly under the question they answer**. Default everywhere, including Google Docs (via D-05).
- **D-02:** Where in-place placement is genuinely impossible (Docs API unavailable AND the fallback path in use), answers land as **one block at the cursor with each question repeated above its answer**, and the panel states plainly why it differs. Degraded mode, not the design.
- **D-03:** Insertion is **sequential and re-located as it goes**. Writing under question 1 moves question 2 down the page — positions resolve one at a time during the run, never all measured up front.
- **D-04:** The existing two buttons are the entire interface. **Straks** writes every answer at once, formatted under its question. **Langsomt** types letter by letter **starting at the first question and working downward**, each answer beneath its question. **No review step, no approval gate** — stated twice.
- **D-04a:** On "Besvar markeringen", clicking it makes the panel ask **Straks or Langsomt**; user picks, assistant writes directly. The old "generate into panel, then insert" two-step goes away on this path.
- **D-04b:** "Brug som kontekst" is **unchanged**.
- **D-05:** **Use the Google Docs API** as the primary read/write path: `documents.get` for structure and exact indices, `documents.batchUpdate` to insert at a position. Replaces guessing, gives true in-place answers, preserves formatting, improves question-detection because structure (headings, tables, list items) arrives as structure, not a wall of text.
- **D-06:** **Keep today's synthetic-paste mechanism as the fallback** for users who decline the Google permission or when the API call fails. Falling back is visible, never silent, and degrades to D-02 placement.
- **D-07:** **Google OAuth is now a hard prerequisite for this phase**, not optional "Job 4". The same Google Cloud project serves both Google sign-in and the Docs API.
- **D-08:** Ship to beta under OAuth **"Testing" mode (up to 100 users, no Google verification)**. App verification is a launch task, not a Phase 7 blocker.
- **D-09:** The canvas/select-all/hidden-iframe reading route this phase was originally scoped around is **superseded by D-05** for Docs. Survives only inside the D-06 fallback.
- **D-10:** **The AI decides** what counts as a question. No hand-written rules about `?` or numbering.

### Claude's Discretion

- **D-11:** **Source material = the document itself plus any files already attached in the panel.** Reuses the existing file/OCR pipeline; costs the user no extra steps.
- **D-12:** **The panel lists which questions had nothing to draw on**, shown alongside the run. Visible, never a gate.
- **D-13:** A **trusted keystroke from the user during a run auto-pauses it**, reusing the existing typing-race guard (INST-12) unchanged.
- **D-14:** A long Langsomt run **continues in a background tab**. The insertion engine lives in the content script and its timers survive; not tied to the panel being visible.
- **D-15:** **Stop and undo work across the whole run**, not per answer — one user-visible undo step, consistent with INST-08. On the Docs API path undo is exact; on the D-06 fallback it stays best-effort and is reported honestly.

### Deferred Ideas (OUT OF SCOPE)

- **Google OAuth app verification** for public launch (>100 users). Required eventually by D-08; not a Phase 7 blocker.
- **Microsoft Word Online / Office 365** as a second structured-document target. Never discussed.
- **The `contentClass` model-routing fix** (`chat.ts:48`) — a live defect, deliberately deferred by the operator. Phase 7 raises the stakes (routes more user content through the model) but stays its own decision.

</user_constraints>

## Project Constraints (from CLAUDE.md)

- Platform: Chrome, Manifest V3 — service worker background, no persistent background page, strict CSP. Any new Docs API code in the extension must live in a context that survives MV3 lifecycle (background service worker via message passing, or the content script for DOM-facing work) — not assume a long-lived page.
- Tech stack is locked: React + TypeScript + Vite (via WXT) + Tailwind for the extension; Node + TypeScript (Fastify) backend. No new heavyweight SDK should be introduced where a `fetch()` call matches the existing house style (see `openrouter.ts`, `supabase.ts` — both hand-rolled fetch wrappers, no client libraries).
- AI provider: OpenRouter behind the existing provider abstraction; model stays a config value. Question-extraction and answer-generation calls must go through the same policy gate (`streamChat`/`contentClass`) as chat — QUOT-05 is non-negotiable and applies to autonomous mode's AI calls exactly as it does to chat.
- Operator is non-technical — any operator-facing instructions (e.g. "create a second OAuth client") must be written the way `docs/GOOGLE-SETUP.md` is: click-by-click, plain language, business consequence first.
- Managed services: Supabase (auth/DB) and Vercel (backend hosting), both free-tier — no infra change implied by this phase.

## Standard Stack

### Core

| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| `chrome.identity` (built-in extension API) | Chrome 84+ (`getAuthToken`), already available | Acquire and auto-refresh a Google API access token without ever handling a client secret | Purpose-built by Chrome for exactly this — Google API access from an extension. No package to install. `[CITED: developer.chrome.com/docs/extensions/reference/api/identity]` |
| Google Docs API v1 (REST, via `fetch`) | `v1` (stable, no versioning churn in this API) | Read document structure (`documents.get`), write answers (`documents.batchUpdate`) | Official, documented, the entire reason D-05 exists. No SDK needed — plain `fetch()` with a Bearer token matches this repo's existing pattern (`openrouter.ts`) and avoids adding the heavy `googleapis` Node client, which isn't even usable from an MV3 service worker anyway. `[CITED: developers.google.com/workspace/docs/api]` |

**No new npm packages are required for this phase.** Both the token acquisition (`chrome.identity`, built into Chrome) and the Docs API calls (`fetch`, already used throughout this codebase) need zero new dependencies.

### Supporting

| Library | Version | Purpose | When to Use |
|---------|---------|---------|-------------|
| (none new) | — | — | — |

### Alternatives Considered

| Instead of | Could Use | Tradeoff |
|------------|-----------|----------|
| `chrome.identity.getAuthToken` (Mechanism B) | Extend Supabase's `provider_token`/`provider_refresh_token` (Mechanism A) | Mechanism A requires the backend to hold the Google OAuth client secret and implement its own refresh-token exchange against `https://oauth2.googleapis.com/token` — Supabase does **not** refresh or store provider tokens on the app's behalf (confirmed below). Also ties Docs access to whichever Google account the user signed *into the app* with, which may not match the Google account the browser/Chrome profile is signed into — a real UX edge case Mechanism B avoids by using the Chrome-profile account directly. |
| Plain `fetch()` to `docs.googleapis.com` | `googleapis` npm client | The official Node client is a large dependency, is designed for Node/server contexts (not MV3 service workers, which do support `fetch` but not all of `googleapis`'s internals cleanly), and this repo already has zero SDK dependencies for HTTP APIs — `fetch()` matches house style exactly. |
| OpenRouter `response_format: json_schema` for question extraction | Regex/prompt-only extraction, hoping for parseable JSON | `response_format` support varies by underlying provider even within OpenRouter (`[CITED: openrouter.ai/docs/guides/features/structured-outputs]`) — since this phase's free/paid model chains route through multiple providers, **never trust the model's JSON blindly**. Request `json_schema` where offered, but always defensively parse + validate server-side with an explicit shape check before using any index/anchor from the response. |

**Installation:** none — no `npm install` needed for this phase's core mechanics.

**Version verification:** N/A — no versioned packages introduced. `chrome.identity` version is tied to the Chrome release the user runs (`getAuthToken` has existed since Chrome 84, no compatibility risk for a 2026 beta). Google Docs API is `v1` and has been stable since GA.

## Package Legitimacy Audit

**No external packages are installed by this phase.** Both mechanisms researched (`chrome.identity` and `fetch`-based Docs API calls) use only built-in browser/Node capabilities already present in this codebase. The Package Legitimacy Gate protocol is not applicable — this table is intentionally empty.

| Package | Registry | Age | Downloads | Source Repo | slopcheck | Disposition |
|---------|----------|-----|-----------|--------------|-----------|-------------|
| — | — | — | — | — | — | N/A — no new packages |

**Packages removed due to slopcheck [SLOP] verdict:** none
**Packages flagged as suspicious [SUS]:** none

## Architecture Patterns

### System Architecture Diagram

```
User clicks "Autonomous" (whole doc) or "Besvar markeringen" (selection)
        │
        ▼
[Content script: sidebar] ── picks Straks/Langsomt (D-04/D-04a)
        │
        ▼
[Content script: autonomous orchestrator]  (NEW — wraps InsertionSession)
        │
        ├─(1)─▶ [Background SW] chrome.identity.getAuthToken({interactive:true})
        │              │  first use only; cached+refreshed silently after (Mechanism B)
        │              ▼
        │         token, or "declined" ──▶ fall back to D-06 synthetic-paste path
        │
        ├─(2)─▶ [Background SW] GET docs.googleapis.com/v1/documents/{id}   (documents.get)
        │              │
        │              ▼
        │         paragraphs[] {text, startIndex, endIndex}  ──▶ relayed to content script
        │
        ├─(3)─▶ [Backend /api/*] question extraction (AI call, JSON schema)
        │              │  scoped to whole doc OR the marked selection's paragraphs
        │              │  + attached context files (D-11)
        │              ▼
        │         questions[] {paragraphIndex, quotedText, hasGrounding}
        │
        ├─(4)─▶ [Backend /api/*] answer generation per question (D-11 context, D-12 gap flag)
        │              ▼
        │         answers[] aligned to questions[]
        │
        └─(5)─▶ for each question, BOTTOM-TO-TOP by original startIndex:
                   [Background SW] POST documents.batchUpdate  insertText at question.endIndex
                       │
                       ▼
                   one InsertionSession per answer (Straks: insertInstant;
                   Langsomt: start() — ticks per letter, GDocsApiAdapter buffers
                   and flushes ~1 batchUpdate/sec)
                       │
                       ▼
                   [Sidebar] progress bar + gap list (D-12) + combined
                   pause/stop/undo across the whole run (D-15)

Fallback path (D-06, D-09): if token declined or any Docs API call fails →
same orchestrator drives the EXISTING GDocsAdapter (paste-event into the
hidden iframe) with D-02 degraded placement, visibly reported.
```

### Recommended Project Structure

```
apps/extension/
├── insertion/
│   ├── adapters/
│   │   ├── gdocs.ts           # UNCHANGED — becomes the D-06 fallback
│   │   └── gdocs-api.ts       # NEW — Docs API adapter (kind: 'gdocs-api')
│   ├── autonomous/            # NEW — orchestration layer, one level above InsertionSession
│   │   ├── orchestrator.ts    # drives N InsertionSessions bottom-to-top, composes undo/pause/stop
│   │   └── docs-client.ts     # documents.get / batchUpdate fetch wrappers + index math
│   └── types.ts               # extend EditorKind union with 'gdocs-api'
├── entrypoints/
│   └── background.ts          # + case 'docs-auth' (chrome.identity.getAuthToken)
│                               # + case 'docs-api' (proxies documents.get/batchUpdate fetches)
apps/backend/src/routes/
└── autonomous.ts              # NEW — question extraction + per-question answer generation,
                                #        reusing assembleMessages/streamChat under the hood
```

### Pattern 1: Mechanism B — Chrome-managed Google API token

**What:** A second OAuth client, type "Chrome Extension", registered in the *same* Google Cloud project GOOGLE-SETUP.md already set up, scoped only to `.../auth/documents`. The extension's `manifest.json` gets an `oauth2` key; `chrome.identity.getAuthToken()` from the background service worker returns a token Chrome caches and refreshes.

**When to use:** Any time the extension itself (not the backend) needs to call a Google API on behalf of the signed-in Chrome profile.

**Example:**
```jsonc
// wxt.config.ts manifest addition
oauth2: {
  client_id: '<new-chrome-extension-client-id>.apps.googleusercontent.com',
  scopes: ['https://www.googleapis.com/auth/documents'],
},
```
```ts
// background.ts — new case, mirrors the existing 'google-auth' case's shape
case 'docs-auth': {
  const result = await chrome.identity.getAuthToken({
    interactive: true,
    enableGranularPermissions: true, // Google's consent screen is granular by default now —
  });                                 // requesting a scope does not guarantee it was granted (see Pitfall 1)
  if (!result?.token || !result.grantedScopes?.includes('https://www.googleapis.com/auth/documents')) {
    return { ok: false, status: 403, error: 'Docs permission not granted' }; // → D-06 fallback
  }
  return { ok: true, status: 200, data: { token: result.token } };
}
```
`[CITED: developer.chrome.com/docs/extensions/reference/api/identity, developers.google.com/identity/protocols/oauth2/resources/granular-permissions]`

### Pattern 2: Bottom-to-top insertion and undo ordering (D-03 + Google's own guidance)

**What:** Process questions in **descending original `startIndex` order** (bottom of the document first). Inserting an answer at a higher index never shifts the indices of paragraphs above it, so every not-yet-processed question's captured index stays valid without recomputation.

**When to use:** Any multi-insertion pass against the same document in one run — this is exactly Google's own documented technique for `batchUpdate`, generalized across a whole autonomous run rather than one batch call.

**Example:**
```ts
// docs-client.ts
const questionsByIndexDesc = questions.sort((a, b) => b.startIndex - a.startIndex);
for (const q of questionsByIndexDesc) {
  await batchUpdate(docId, [{
    insertText: { location: { index: q.endIndex }, text: `\n${answerFor(q)}` },
  }]);
  // q.endIndex is STILL VALID for every remaining (lower-index) question —
  // nothing above this insertion point moved.
}
```
Undo reverses cleanly with the **same ordering**: delete the highest-index inserted range first, then the next, etc. — deleting a higher range never invalidates a not-yet-undone lower range's stored offsets.
`[CITED: developers.google.com/workspace/docs/api/how-tos/move-text — "write backwards" guidance]`

### Pattern 3: Buffered Langsomt for the Docs API adapter

**What:** `GDocsApiAdapter.insert(chunk)` is called once per letter by the unchanged `InsertionSession.tick()` loop (same cadence/jitter as every other adapter). Instead of one `batchUpdate` per call, the adapter appends to an internal string buffer and returns `{ ok: true, verified: false }` immediately. A separate internal timer flushes the buffer as one `batchUpdate insertText` roughly every 800ms–1s (comfortably under the 60 writes/min/user cap, leaving headroom for the `documents.get` self-test and any retry).

**When to use:** Specifically for the `gdocs-api` adapter kind, and only in progressive (Langsomt) mode — `insertInstant()` (Straks) is a single write regardless and needs no buffering.

**Example:**
```ts
class GDocsApiAdapter implements InsertionAdapter {
  private buffer = '';
  private flushTimer: number | null = null;
  private trackedIndex: number; // advances as each flush lands

  insert(chunk: string): InsertResult {
    this.buffer += chunk;
    this.flushTimer ??= window.setTimeout(this.flush, 900);
    return { ok: true, verified: false }; // optimistic — verified on next documents.get if needed
  }

  private flush = async () => {
    this.flushTimer = null;
    if (!this.buffer) return;
    const text = this.buffer; this.buffer = '';
    await batchUpdate(this.docId, [{ insertText: { location: { index: this.trackedIndex }, text } }]);
    this.trackedIndex += text.length;
  };
}
```
**Honest tradeoff (see Assumptions Log A1):** the document will visibly fill in small bursts every ~1s, not continuously letter-by-letter — a real deviation from the DOM adapters' feel and from the operator's stated framing of Langsomt.

### Pattern 4: Reusing the hidden iframe purely as a keystroke sensor

**What:** `GDocsApiAdapter.eventTarget()` returns the *same* `iframe.docs-texteventtarget-iframe` contentDocument the fallback `GDocsAdapter` uses for insertion — but the API adapter never writes through it. It exists purely so `InsertionSession`'s existing typing-race guard (D-13/INST-12, unmodified) has something to attach `input`/`keydown` listeners to, since the API path itself has no DOM event stream to observe for the canvas.

**When to use:** Wherever the Docs API adapter needs D-13's auto-pause-on-user-typing behavior without inventing a new detection mechanism.

```ts
eventTarget(): EventTarget | null {
  // Not used for insertion — purely so the engine's typing-race guard has a
  // real keystroke stream to listen on for this canvas-rendered page.
  return gdocsEventTarget(); // reuse target.ts, already exported
}
```

### Anti-Patterns to Avoid

- **Trusting the model's returned character offsets for insertion points.** LLMs are unreliable at exact character counting. Have the model return which *paragraph* (by array index, from a list you already built from `documents.get`) contains each question, or a short verbatim quote to fuzzy-match against your own paragraph list — never let raw model-reported `startIndex`/`endIndex` values drive a `batchUpdate` call directly.
- **Assuming a granted scope request means the scope was actually granted.** Google's consent screen is granular by default (2024+) — a user can approve sign-in while unchecking `documents`. Always check `grantedScopes` (or, for the Supabase path, decode the token's actual scope) before treating Docs access as available.
- **Calling OpenRouter directly from the extension for question extraction or answer generation.** Must go through the backend's existing quota/policy gate (QUOT-01/05) exactly like chat does — this is non-negotiable regardless of which OAuth mechanism is chosen for Docs access.
- **One `InsertionSession` per whole run.** D-15's "one undo step" is a *composition* requirement on the orchestrator, not a reason to jam every answer through a single session — the existing per-session model (CONTEXT.md's "drive it repeatedly, once per answer") stays correct; only the undo/pause/stop *presentation* needs to be unified above it.

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|--------------|-----|
| Google API token refresh | A custom refresh-token exchange against `oauth2.googleapis.com/token`, with your own secret storage | `chrome.identity.getAuthToken()` (Mechanism B) | Chrome already does exactly this, with automatic caching and silent refresh, and never requires your code to hold a client secret at all |
| Detecting which Docs paragraph a question is in | Fuzzy string search across the raw rendered text | Walk `documents.get`'s `body.content` yourself and hand the model an indexed paragraph list; have it reference paragraph index/quote, not raw offsets | The API already gives exact structural boundaries — reinventing text search to find them back is strictly worse than never losing them |
| JSON extraction from the model's answer | Regex-scraping a JSON blob out of free-form text | `response_format: { type: 'json_schema', json_schema: {...} }` where the provider supports it, with a defensive parse+validate fallback for providers that don't | OpenRouter passes this through natively for supporting providers; still validate — never trust it blindly across a multi-provider fallback chain |

**Key insight:** Every "don't hand-roll" here already has an existing, sanctioned mechanism in this stack (Chrome's identity API, the Docs API's own structure, OpenRouter's structured-output passthrough) — the risk in this phase is reaching for a hand-built workaround because the sanctioned path looks unfamiliar, not because it doesn't exist.

## Common Pitfalls

### Pitfall 1: Granular consent silently withholds the `documents` scope

**What goes wrong:** The app requests `email profile documents` (or, under Mechanism B, just `documents`) in one authorization call. The user approves sign-in but unchecks the Docs checkbox on Google's consent screen. The authorization call still "succeeds" — you get a token — but it doesn't cover Docs.
**Why it happens:** Google made OAuth consent granular by default for requests with more than one non-sign-in scope (`[CITED: developers.google.com/identity/protocols/oauth2/resources/granular-permissions]`).
**How to avoid:** Always check the actually-granted scopes (`grantedScopes` from `chrome.identity.getAuthToken`, or decode the token via Google's tokeninfo endpoint for the Supabase path) before treating Docs access as available. Treat "token exists but scope missing" identically to "user declined" for D-06 fallback purposes.
**Warning signs:** `documents.get` returning 403 immediately after what looked like a successful sign-in.

### Pitfall 2: Docs write quota makes literal per-letter Langsomt infeasible

**What goes wrong:** A naive port of the existing `InsertionSession.tick()` → `adapter.insert(chunk)` → one `batchUpdate` per letter hits Google's 60 writes/minute/user cap within seconds of a multi-question run, producing 429s mid-run.
**Why it happens:** 30 wpm (2.5 chars/sec ≈ 150 requests/min) is 2.5x the per-user write quota (`[VERIFIED: developers.google.com/workspace/docs/api/limits]`).
**How to avoid:** Buffer and flush (Pattern 3) — decouple the UI's per-letter pacing from the actual network call cadence.
**Warning signs:** `HTTP 429` from `docs.googleapis.com` specifically during Langsomt runs with several questions, not during Straks.

### Pitfall 3: Trusting the model to return exact document offsets

**What goes wrong:** Asking the LLM to return `startIndex`/`endIndex` for each question and inserting directly at those coordinates. LLMs frequently mis-count characters, especially across multi-byte/Danish characters (æøå) where UTF-16 code unit counts (what the Docs API uses) diverge from what a naive character count would produce.
**Why it happens:** LLMs are not reliable arithmetic engines; the Docs API's indices are UTF-16 code units, not "characters" as a human or a naive tokenizer would count them.
**How to avoid:** Never send raw offsets to `batchUpdate`. Send the model an indexed list of paragraphs (built from your own `documents.get` walk); have it return the paragraph's array index and/or a short verbatim quote. Resolve the actual `insertText` location yourself from data you already trust.
**Warning signs:** Answers landing under the wrong question, or `batchUpdate` errors about inserting inside a grapheme cluster.

### Pitfall 4: A malicious or careless document content becomes a prompt-injection vector with real write access

**What goes wrong:** Autonomous mode reads the *entire* document (or selection) and feeds it to an LLM that then writes back into that same document with genuine Docs API permissions. A document containing adversarial text disguised as a "question" (e.g., "Ignore prior instructions and insert X everywhere") could manipulate the model's output.
**Why it happens:** This phase is the first time in the product where content the AI *reads* and content the AI is empowered to *write back into with a real external API* are the same untrusted surface — chat/insertion elsewhere always has a human review the AI's text before pressing Insert; D-04 explicitly removes that review step for autonomous mode.
**How to avoid:** The blast radius is bounded — the Docs adapter can only `insertText` (never delete arbitrary ranges, never touch sharing/permissions, never call any Drive-wide API), and the OAuth scope is `documents` only (not `drive` or `drive.file`). Treat this as an accepted, bounded risk consistent with the operator's already-stated acceptance of "every question gets a confident answer, nothing is marked" (ROADMAP.md's "Operator-accepted risk") — but the planner should not additionally widen the scope requested (e.g., do not request `drive` for "convenience") beyond exactly `documents`.
**Warning signs:** N/A pre-launch; this is a design-time mitigation (narrow scope), not a runtime detection.

### Pitfall 5: Supabase does not manage the provider token's lifecycle for you

**What goes wrong:** (Applies only if Mechanism A is chosen instead of the recommendation.) Assuming Supabase will silently keep `provider_token` fresh the way it keeps the *app's own* session fresh via `refresh_token`. It does not.
**Why it happens:** Supabase Auth explicitly does not refresh provider tokens — confirmed across multiple Supabase GitHub discussions (`[CITED: github.com/orgs/supabase/discussions/29578, /22578]`) — "your application will need to use the provider refresh token to obtain a new provider token" yourself, which requires your own copy of the Google client secret.
**How to avoid:** If Mechanism A is ever chosen over the recommendation, budget for: storing `provider_refresh_token` encrypted at rest, adding `GOOGLE_OAUTH_CLIENT_ID`/`GOOGLE_OAUTH_CLIENT_SECRET` to backend env, and implementing the refresh POST to `oauth2.googleapis.com/token` yourself. None of this is needed under Mechanism B.
**Warning signs:** Docs calls working for ~1 hour after sign-in, then failing with 401 for every user simultaneously (the access token expired and nothing refreshed it).

## Code Examples

### Extracting the doc ID from the active tab's URL

```ts
// docs.google.com/document/d/<ID>/edit#...
function extractDocId(url: string): string | null {
  const m = url.match(/\/document\/d\/([a-zA-Z0-9_-]+)/);
  return m?.[1] ?? null;
}
```

### `documents.get` walk to build an indexed paragraph list

```ts
// Source: developers.google.com/workspace/docs/api/concepts/structure
interface ParaRef { index: number; text: string; startIndex: number; endIndex: number; heading?: string }

function extractParagraphs(doc: { body: { content: any[] } }): ParaRef[] {
  const out: ParaRef[] = [];
  doc.body.content.forEach((el, index) => {
    const p = el.paragraph;
    if (!p) return; // tables/TOC handled separately if needed
    const text = (p.elements ?? [])
      .map((e: any) => e.textRun?.content ?? '')
      .join('');
    if (!text.trim()) return;
    out.push({
      index,
      text,
      startIndex: el.startIndex,
      endIndex: el.endIndex,
      heading: p.paragraphStyle?.namedStyleType,
    });
  });
  return out;
}
```

### `batchUpdate` insertText for one answer

```ts
// Source: developers.google.com/workspace/docs/api/reference/rest/v1/documents/batchUpdate
async function insertAnswer(docId: string, token: string, atIndex: number, text: string) {
  const res = await fetch(`https://docs.googleapis.com/v1/documents/${docId}:batchUpdate`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      requests: [{ insertText: { location: { index: atIndex }, text: `\n${text}` } }],
    }),
  });
  if (!res.ok) throw new Error(`Docs API ${res.status}: ${(await res.text()).slice(0, 300)}`);
}
```

### Requesting the extra scope on the existing Supabase authorize URL (Mechanism A reference, if chosen)

```ts
// auth.ts:75, if Mechanism A is chosen instead of the recommendation — the
// raw GoTrue REST /authorize endpoint accepts `scopes` and forwards any
// UNRECOGNIZED query params straight through to the provider's own auth URL.
// [VERIFIED: github.com/supabase/auth internal/api/external.go — GetExternalProviderRedirectURL]
url: `${env.supabaseUrl}/auth/v1/authorize` +
  `?provider=google&redirect_to=${encodeURIComponent(redirect)}` +
  `&scopes=${encodeURIComponent('email profile https://www.googleapis.com/auth/documents')}` +
  `&access_type=offline&prompt=consent`, // forwarded through to Google as-is
```

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|---------------|--------|
| Google consent screen granted all requested scopes as one bundle | Granular per-scope consent by default | 2024–2025 rollout | Requesting a scope no longer guarantees it was granted — must check `grantedScopes` (Pitfall 1) |
| `execCommand`/document.execCommand generally | Still the only working entry point for contenteditable insertion (unrelated to this phase, noted for context) | N/A | Not affected by this phase — contenteditable adapter unchanged |
| Legacy "OAuth consent screen" tabbed UI | "Google Auth Platform" (Overview/Branding/Audience/Clients/Data Access) | 2025–2026 | GOOGLE-SETUP.md already accounts for both layouts; no action needed here |

**Deprecated/outdated:** none directly relevant — the Docs API v1 surface used here has been stable since GA and has no announced deprecation.

## Assumptions Log

| # | Claim | Section | Risk if Wrong |
|---|-------|---------|----------------|
| A1 | Buffering Langsomt into ~1 flush/second is an acceptable visual compromise against the operator's "looks like a person typing" framing | Pattern 3, Summary | If the operator rejects this compromise, Langsomt on Google Docs specifically may need a fundamentally different design (e.g., always fall back to the D-06 paste mechanism for Langsomt specifically, even when the API path is available for Straks) — a scope-affecting decision that should be surfaced before planning locks in the Docs-API Langsomt behavior |
| A2 | `chrome.identity.getAuthToken()` works for an unpublished/sideloaded extension as long as the manifest's pinned `key` matches the Google Cloud "Chrome Extension" OAuth client's Item ID, without requiring Chrome Web Store presence | Pattern 1, Mechanism B | MEDIUM confidence only — official docs don't explicitly confirm unpublished behavior; community reports are mixed and partly dated. If wrong, Mechanism B may only work once the (currently paused) Web Store listing goes live, which would force Mechanism A or delay Phase 7's Docs path until publication |
| A3 | The `documents` scope, already added to the Google Cloud consent screen's Data Access list in Step 4 of GOOGLE-SETUP.md, is shared across ALL OAuth clients in that project (so adding a second "Chrome Extension" client needs no separate scope re-registration) | Mechanism B, "no additional Google Cloud work required" | LOW-MEDIUM — if scopes are actually scoped per-client rather than per-project/consent-screen, the operator would need to re-add the scope when creating the second client (a trivial extra step, but the Summary currently states none is needed) |
| A4 | OpenRouter's `response_format: json_schema` passthrough is reliably available on at least one model in both the free and paid chains currently configured (`env.ts`) | Standard Stack, Alternatives Considered | If none of the configured models support it, question extraction must fall back to prompt-only JSON with defensive parsing for every model in the chain — more validation code, same overall approach, not a blocker but adds implementation surface |
| A5 | Google Docs API rate limits (600/min project, 60/min/user) apply uniformly regardless of whether calls originate from the extension (Mechanism B) or a backend proxy (Mechanism A) — i.e., choosing Mechanism B doesn't change the quota math in Pitfall 2 | Pitfall 2 | LOW risk — this is standard OAuth-token-scoped quota behavior per Google's docs, but worth a sentence of confirmation during planning since it affects whether buffering is needed regardless of mechanism chosen (it is) |

## Open Questions

1. **Which OAuth mechanism — A or B?**
   - What we know: Mechanism B (`chrome.identity.getAuthToken`, separate "Chrome Extension" OAuth client) needs no backend secret, supports clean incremental auth, and satisfies D-07's "same Google Cloud project" literally. Mechanism A (extend the Supabase sign-in flow) matches the mechanism GOOGLE-SETUP.md's Step 7 already told the operator would happen, but requires the backend to hold the Google client secret and implement its own refresh logic — new secret-handling surface GOOGLE-SETUP.md explicitly said wouldn't be needed.
   - What's unclear: Whether the operator has any preference once this tradeoff is explained, and whether the extra ~5-minute Google Cloud Console step for Mechanism B is acceptable given the operator already did the setup once.
   - Recommendation: Present this explicitly during planning/discuss-phase as a named decision (not silently pick one) — Mechanism B is this research's recommendation, but it changes the shape of Step 7 in GOOGLE-SETUP.md, which the operator has already read and may have expectations from.

2. **Does the operator accept buffered (word/clause-burst) Langsomt on Google Docs specifically, or should Langsomt fall back to the existing paste mechanism (D-06) even when the API read/write path is otherwise available for Straks?**
   - What we know: True per-letter API calls are quota-infeasible (Pitfall 2). Buffering preserves the pacing UI but changes the Doc's visible update pattern.
   - What's unclear: Whether "looks like a person typing" (a specifics item in CONTEXT.md) is a hard requirement specifically for Google Docs, or a general product feel that can flex per-adapter given a technical constraint.
   - Recommendation: Surface both options (buffered API typing vs. Langsomt-always-uses-paste-fallback-on-Docs) to the operator before this becomes an implicit implementation choice.

3. **Should the whole-document autonomous button be disabled/hidden on non-Docs, non-plain-field, non-contenteditable pages** (e.g., a page with no editable target at all)? Not addressed by CONTEXT.md; the existing `targetStatus()` pattern in `inserter.ts` already produces a reasonable "no target" message this phase can reuse — likely not worth a new open question but flagged so the planner explicitly reuses rather than re-designs it.

## Environment Availability

| Dependency | Required By | Available | Version | Fallback |
|------------|--------------|-----------|---------|----------|
| Google Cloud project + Docs API enabled | D-05/D-07 | Yes | — | — (operator already completed) |
| Google OAuth consent screen, Testing mode, `documents` scope added | D-05/D-07/D-08 | Yes | — | — |
| Supabase Google provider configured (Web app client) | Existing Google sign-in (AUTH-02) | Yes | — | — |
| Second "Chrome Extension"-type OAuth client for Mechanism B | Pattern 1 (recommended) | **No — not yet created** | — | Falls back to Mechanism A if the operator declines this extra step |
| `chrome.identity` permission in manifest | Both mechanisms | Yes (`wxt.config.ts:32`) | — | — |
| `<all_urls>` host permission (covers `docs.googleapis.com`/`docs.google.com`) | Docs API fetch calls from extension | Yes (already broadest possible) | — | — |
| Playwright / real-Chromium E2E harness (`scripts/verify.mjs`) | Automated verification of Straks/Langsomt/undo on plain+contenteditable | Yes | `playwright ^1.49.0` | — |
| Automated Google login for Playwright | Automated verification of the actual Google Docs path | **No** — confirmed in STATE.md ("automation has no Google login") | — | Manual operator walkthrough remains the only verification path for the live Docs API mechanism, exactly as it already is for the D-06 fallback today |

**Missing dependencies with no fallback:**
- None — the one missing piece (the second OAuth client) has a documented fallback (Mechanism A) if the operator prefers not to create it.

**Missing dependencies with fallback:**
- Second OAuth client for Mechanism B (fallback: Mechanism A, at the cost described in Open Question 1).
- Automated Google-login testing (fallback: manual operator walkthrough, already the established pattern for this exact adapter family per STATE.md).

## Validation Architecture

### Test Framework

| Property | Value |
|----------|-------|
| Framework | Playwright `^1.49.0`, driven by a custom script (`scripts/verify.mjs`) — not a config-file-based runner (no `playwright.config.ts`, no `jest`/`vitest`) |
| Config file | none — `scripts/verify.mjs` is itself the harness: launches real Chromium, loads the built extension, serves local test pages (`test-pages/`) |
| Quick run command | none separate — the script is one linear walkthrough; there is no subset-selection flag today |
| Full suite command | `pnpm verify` (→ `node scripts/verify.mjs`) — requires the backend running locally and the extension built |

### Phase Requirements → Test Map

CONTEXT.md's D-01..D-15 are the requirement source for this phase (formal `AUTO-XX` IDs are written during planning, per ROADMAP.md). Mapping by decision:

| Decision | Behavior | Test Type | Automated Command | File Exists? |
|----------|----------|-----------|---------------------|--------------|
| D-01/D-03 (in-place, sequential) | Whole-document autonomous run answers every question in the harness's plain textarea, in place | E2E (Playwright) | extend `scripts/verify.mjs` | ❌ Wave 0 — needs a multi-question harness fixture |
| D-04/D-04a (Straks/Langsomt choice, no review) | Straks writes instantly; Langsomt paces visibly; both on the "Besvar markeringen" path too | E2E (Playwright) | extend `scripts/verify.mjs` | ❌ Wave 0 |
| D-13 (typing-race auto-pause) during an autonomous run | Trusted keystroke mid-run pauses the whole orchestrator, not just the current answer | E2E (Playwright) | extend `scripts/verify.mjs`, reusing the existing typing-race test pattern (`onUserInput`) | ❌ Wave 0 — existing test covers single-session INST-12, not the orchestrator's multi-session composition |
| D-15 (whole-run undo/stop as one step) | Undo after 3+ answers removes all of them in one user action | E2E (Playwright) | extend `scripts/verify.mjs` | ❌ Wave 0 |
| D-05/D-06/D-09 (Docs API primary, paste fallback) | Real Google Doc: read structure, write answers at exact positions; decline permission → visible fallback | **Manual only** | N/A — Playwright has no Google login (STATE.md, confirmed unchanged) | N/A — this is, and will remain, the operator's manual walkthrough, same as the existing GDocsAdapter today |
| D-10 (AI decides what's a question) | A document mixing `?`-questions, numbered fields, and heading-with-blank-space is fully covered | Integration (backend) | new script or extend `scripts/verify.mjs` with a fixture page containing all three question shapes | ❌ Wave 0 |
| D-11/D-12 (source material + gap list) | An unanswerable question (no grounding) is flagged in the panel, not silently fabricated-and-hidden | E2E (Playwright) | extend `scripts/verify.mjs` | ❌ Wave 0 |

### Sampling Rate
- **Per task commit:** targeted manual run of the relevant `scripts/verify.mjs` section during development (the harness is linear; there's no fast subset today — the planner may want a Wave 0 task to add one, e.g. a `--only` flag, given this phase adds substantially more scenarios to an already-long script).
- **Per wave merge:** full `pnpm verify` against plain textarea + contenteditable harness pages.
- **Phase gate:** full `pnpm verify` green (automatable parts) + one documented, screenshotted operator walkthrough of the real Google Docs path (mirrors how the existing GDocsAdapter was verified — see STATE.md "Built but needs operator eyes").

### Wave 0 Gaps

- [ ] `test-pages/` needs a fixture with multiple questions in a plain textarea/contenteditable (mixed `?`, numbered, heading-style) to drive D-10/D-11/D-12 tests.
- [ ] `scripts/verify.mjs` needs new sections for: whole-document autonomous run, multi-question "Besvar markeringen" (ten questions at once, per CONTEXT.md's explicit note), whole-run undo, whole-run typing-race pause.
- [ ] No automated coverage is possible for the actual Google Docs API mechanism (documents.get/batchUpdate against a real Doc) — this gap is permanent, not a Wave 0 backlog item, and mirrors the existing accepted gap for the D-06 fallback.
- [ ] Backend needs a way to unit/integration-test question extraction + gap flagging independent of the E2E harness (currently no backend test framework exists at all — `apps/backend/package.json` has no test script). The planner should decide whether to add one now or continue relying solely on the E2E harness + manual review, consistent with how the rest of this backend has shipped so far.

## Security Domain

### Applicable ASVS Categories

| ASVS Category | Applies | Standard Control |
|----------------|---------|--------------------|
| V2 Authentication | Yes (indirect) | Existing Supabase JWT verification (`verifyUser`) gates the new question-extraction/answer-generation backend routes exactly like `/api/chat` — no new auth mechanism |
| V3 Session Management | No new surface | Google API tokens (both mechanisms) are a *separate* credential from the app session and must never be conflated with or substituted for the Supabase JWT |
| V4 Access Control | Yes | The Docs OAuth scope must remain exactly `.../auth/documents` — never widened to `drive`/`drive.file`/admin scopes "for convenience"; the Google API itself is the access-control boundary for which documents can be read/written (whatever the signed-in Google account can already access) |
| V5 Input Validation | Yes | Model-returned question/answer JSON must be shape-validated before use (Pitfall 3); paragraph indices from the model must be checked against the actual bounds of the paragraph list built from `documents.get`, never trusted as raw offsets into the live document |
| V6 Cryptography | Yes, conditionally | Only relevant if Mechanism A is chosen: `provider_refresh_token` would need encryption at rest in Supabase Postgres and a client secret in backend env, secrets-managed like `STRIPE_SECRET_KEY`/`OPENROUTER_API_KEY` already are. Not applicable under the recommended Mechanism B — no long-lived Google secret is created or stored by this app at all |

### Known Threat Patterns for this stack

| Pattern | STRIDE | Standard Mitigation |
|---------|--------|------------------------|
| Prompt injection via document content leading to unwanted writes (Pitfall 4) | Tampering / Elevation of Privilege | Narrowest possible OAuth scope (`documents` only, never `drive`), no delete/share capability exposed by the adapter, D-12's gap-list transparency as a partial detection aid (not a full mitigation) |
| OAuth token leakage via logging or error messages | Information Disclosure | Never log the raw access token; error messages surfaced to the UI must be the existing pattern (`GDocsApiAdapter` returning a `reason` string, never the token itself) — mirrors the existing rule that the OpenRouter key never reaches the browser (QUOT-04) applied to the *user's own* Google token instead |
| Cross-account confusion (Chrome profile's Google account ≠ app's signed-in account) | Spoofing (of intent, not identity) | Surface the Docs adapter's target label with the *email* of the Google account the token belongs to (obtainable via `userinfo.email` alongside `documents` scope, or a lightweight `people.get` call) so the user can see which account will be used before a run starts |

## Sources

### Primary (HIGH confidence)
- `developers.google.com/workspace/docs/api/limits` — exact write/read quota numbers (600/min project, 60/min/user)
- `developers.google.com/workspace/docs/api/how-tos/move-text` — "write backwards" descending-index ordering guidance, quoted directly
- `developers.google.com/workspace/docs/api/concepts/rules-behavior` — structural index rules, insertion boundary constraints
- `developers.google.com/workspace/docs/api/concepts/structure` — `body.content`/`StructuralElement`/`textRun` shape
- `developers.google.com/workspace/docs/api/auth` — Docs API scopes and their "sensitive" classification
- `developer.chrome.com/docs/extensions/reference/api/identity` — `getAuthToken` behavior, caching
- Direct repo reads: `apps/extension/insertion/{types,engine,target}.ts`, `apps/extension/insertion/adapters/{gdocs,contenteditable}.ts`, `apps/extension/sidebar/{inserter,chat,store}.ts`, `apps/extension/sidebar/components/ChatView.tsx`, `apps/backend/src/{env,openrouter,supabase,prompt}.ts`, `apps/backend/src/routes/{auth,chat}.ts`, `apps/extension/wxt.config.ts`, `apps/extension/entrypoints/background.ts`, `docs/GOOGLE-SETUP.md`, `scripts/verify.mjs`

### Secondary (MEDIUM confidence)
- `supabase.com/docs/guides/auth/social-login/auth-google` and `supabase.com/docs/reference/javascript/auth-signinwithoauth` — `scopes`/`queryParams`/`access_type`/`prompt` mechanics
- GoTrue/`supabase/auth` `internal/api/external.go` (`GetExternalProviderRedirectURL`) — confirms the raw `/authorize` REST endpoint forwards unrecognized query params straight through to the provider, cross-verified via WebFetch summary of the source
- `developers.google.com/identity/protocols/oauth2/resources/granular-permissions` — granular consent, `grantedScopes` behavior
- `developers.google.com/identity/sign-in/web/incremental-auth` — incremental authorization mechanics
- Multiple `github.com/orgs/supabase/discussions` threads (29578, 22578, 19384, 22653) — cross-verified, consistent across threads: Supabase does not refresh provider tokens; app must store and refresh them itself
- `openrouter.ai/docs/guides/features/structured-outputs` — `response_format`/`json_schema`/`strict`, per-provider support variance

### Tertiary (LOW confidence)
- Community reports (Stack Overflow-adjacent, Chromium extensions Google Group, GitHub issue threads) on whether `chrome.identity.getAuthToken` fully works for unpublished/sideloaded extensions using a pinned key — mixed, partly dated, flagged as Assumption A2, needs a real test against this specific extension before being treated as settled

## Metadata

**Confidence breakdown:**
- Standard stack (no new packages, `chrome.identity` + `fetch`): HIGH — official docs, no ambiguity
- Docs API mechanics (structure, batchUpdate, indices, quotas): HIGH — official docs, cross-verified across two separate pages
- OAuth mechanism recommendation (Mechanism B over A): MEDIUM-HIGH — strongly reasoned and well-cited, but genuinely an open decision the operator/planner must confirm, not a settled fact
- Langsomt buffering strategy: MEDIUM — technically sound and quota-safe, but the *visual compromise* it implies against the operator's stated framing is an open question, not a research conclusion
- Unpublished-extension `getAuthToken` behavior (A2): LOW-MEDIUM — could not be verified against official docs with certainty

**Research date:** 2026-08-06
**Valid until:** ~30 days for the Docs API/quota facts (stable API); ~14 days for the Google consent-screen/granular-permissions behavior (actively evolving area per Google's 2025-2026 rollout cadence) — re-verify before execution if planning is delayed
