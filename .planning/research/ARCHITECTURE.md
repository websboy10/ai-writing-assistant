# Architecture Research

**Domain:** Chrome MV3 AI writing-assistant extension with universal text insertion, streaming LLM backend, and a document/OCR context pipeline
**Researched:** 2026-08-05
**Confidence:** MEDIUM-HIGH (insertion techniques and MV3 lifecycle are HIGH confidence, verified against MDN/Chrome docs and multiple independent sources; specific per-site editor quirks are MEDIUM/LOW and will need empirical validation during Phase 3)

## Standard Architecture

### System Overview

```
┌──────────────────────────────────────────────────────────────────────┐
│                         HOST PAGE (any website)                       │
│  ┌────────────────────────────────────────────────────────────────┐  │
│  │  Content Script (isolated world)                                │  │
│  │   - mounts React sidebar as a shadow-DOM overlay                │  │
│  │   - hosts the Insertion Engine + adapters                       │  │
│  │   - hosts the Insertion State Machine (pause/resume/stop/undo)  │  │
│  │  ┌──────────────────────────────────────────────────────────┐  │  │
│  │  │  MAIN world bridge script (injected via chrome.scripting) │  │  │
│  │  │   - only for React DevTools / framework fingerprinting    │  │  │
│  │  └──────────────────────────────────────────────────────────┘  │  │
│  └───────────────────────────┬────────────────────────────────────┘  │
└──────────────────────────────┼────────────────────────────────────────┘
                                │ chrome.runtime.connect (long-lived Port)
                                ▼
┌──────────────────────────────────────────────────────────────────────┐
│              BACKGROUND SERVICE WORKER (MV3, non-persistent)          │
│   - single message router: content script ⇄ sidebar ⇄ backend        │
│   - owns the fetch/SSE connection to the backend proxy                │
│   - relays stream chunks over the Port to sidebar AND content script  │
│   - keep-alive: alarms + port pings, no state lives here permanently  │
└───────────────────────────┬────────────────────────────────────────────┘
                             │ Port (persistent while sidebar open)
                             ▼
┌──────────────────────────────────────────────────────────────────────┐
│         REACT SIDEBAR (rendered inside the content-script shadow DOM) │
│   - chat UI, streaming render, transport controls (pause/stop/undo)   │
│   - context manager UI (uploads, OCR results, session history)        │
│   - sends "start insertion" commands back down to the content script  │
└──────────────────────────────┬───────────────────────────────────────┘
                                │ HTTPS (through service worker only)
                                ▼
┌──────────────────────────────────────────────────────────────────────┐
│                    BACKEND (Node/TS on Vercel, hosted)                │
│  ┌─────────────┐ ┌────────────┐ ┌──────────────┐ ┌─────────────────┐ │
│  │ Auth         │ │ AI Gateway │ │ Context/File │ │ Quota/Usage      │ │
│  │ (Supabase)   │ │ (SSE proxy │ │ Pipeline     │ │ Accounting       │ │
│  │              │ │ to OpenRtr)│ │ (parse+OCR)  │ │                  │ │
│  └─────────────┘ └────────────┘ └──────────────┘ └─────────────────┘ │
│                          │                              │              │
│                    PostgreSQL (Supabase)         Object storage        │
│                    conversations, users,         (Supabase Storage)    │
│                    quota counters                 uploaded files       │
└──────────────────────────────────────────────────────────────────────┘
```

### Component Responsibilities

| Component | Responsibility | Typical Implementation |
|-----------|----------------|------------------------|
| Content script | DOM access to the host page; owns insertion adapters and the insertion state machine; mounts sidebar UI | `chrome.scripting` static injection, shadow DOM root for style isolation |
| React sidebar | All chat/context UI; issues insertion commands; never touches host-page DOM directly | Runs *inside* the content script's shadow DOM, not as a separate extension page — it needs DOM proximity to the editor for adapters to work synchronously |
| Background service worker | Stateless message router + single point of contact with the backend; owns the SSE fetch | `chrome.runtime.onConnect`, `fetch()` with `ReadableStream` reader, forwards chunks over Port |
| Backend AI gateway | Holds the OpenRouter API key, proxies/streams completions, enforces quota before forwarding | Node/Fastify or NestJS route, Server-Sent Events or chunked transfer to the extension |
| Backend context/file pipeline | Parses PDF/DOCX/images, runs OCR, chunks and cleans text | Runs server-side to avoid MV3 CSP/WASM restrictions and keep the extension bundle small |
| Storage layer (extension) | Session/local persistence: draft state, insertion progress, user preferences | `chrome.storage.local` / `chrome.storage.session`, never `localStorage` in the service worker (unavailable) |

## Recommended Project Structure

```
apps/
├── extension/
│   ├── src/
│   │   ├── background/
│   │   │   ├── index.ts              # service worker entry, onConnect router
│   │   │   ├── stream-relay.ts       # fetch(SSE) -> chunk -> port.postMessage
│   │   │   └── keepalive.ts          # chrome.alarms ping, avoids 30s idle death
│   │   ├── content/
│   │   │   ├── index.ts              # injects shadow root, mounts sidebar
│   │   │   ├── bridge.ts             # content script <-> service worker Port
│   │   │   └── mount.tsx             # React root inside shadow DOM
│   │   ├── insertion/
│   │   │   ├── engine.ts             # picks adapter, owns state machine
│   │   │   ├── state-machine.ts      # idle/streaming/paused/stopped/undoing
│   │   │   ├── adapters/
│   │   │   │   ├── plain-field.ts    # <input>/<textarea>, native setter trick
│   │   │   │   ├── contenteditable.ts# execCommand('insertText') + fallback
│   │   │   │   └── google-docs.ts    # synthetic keyboard events at iframe target
│   │   │   └── detect-target.ts      # classify focused element -> adapter
│   │   ├── sidebar/                  # React app (chat, context manager, controls)
│   │   ├── popup/                    # minimal: open sidebar, quick settings
│   │   ├── options/                  # account, quota display, model choice
│   │   ├── storage/                  # chrome.storage wrappers, typed
│   │   └── shared/                   # extension-only shared types/utils
│   └── manifest.json
├── backend/
│   ├── src/
│   │   ├── auth/                     # Supabase session verification middleware
│   │   ├── ai/                       # OpenRouter client, SSE passthrough, provider abstraction
│   │   ├── prompts/                  # structured prompt assembly (system/request/context/history/style/format)
│   │   ├── context/                  # upload -> extract -> OCR -> clean -> chunk pipeline
│   │   ├── quota/                    # per-user usage accounting, budget guard
│   │   ├── conversations/            # persistence, session history
│   │   └── database/                 # Prisma schema + client
│   └── ...
└── shared/
    ├── types/                        # message envelope types, prompt section types
    └── constants/                    # event names, quota limits
```

### Structure Rationale

- **`insertion/adapters/` is exactly three files, matching the three-engine decision already made in PROJECT.md.** Plain fields, contenteditable frameworks, and Google Docs fail in structurally different ways (see Pattern section below) — collapsing them into one "smart" function produces a component that silently does the wrong thing on whichever surface wasn't tested last.
- **The React sidebar lives inside the content script's shadow DOM, not as a `chrome.sidePanel` extension page.** This is a deliberate deviation from the "modern" Chrome recommendation (Side Panel API) — see Anti-Patterns. Side Panel is a separate `chrome-extension://` document with no page DOM access; every insertion action would need an extra round-trip through the service worker to reach the content script, adding latency to a feature whose entire value proposition is responsiveness. Shadow DOM avoids CSS collisions with the host page while keeping the sidebar and the insertion engine in the same execution context.
- **`background/` contains no business logic**, only routing and the SSE relay. MV3 service workers are non-persistent and can be killed and revived at any point; anything stateful placed here (conversation state, insertion progress) will be silently lost mid-session.
- **Backend owns the entire context pipeline** (parse, OCR, chunk). The extension only uploads raw files and receives structured text back. See Integration Points for why this boundary is forced by MV3 CSP, not just convenience.

## Architectural Patterns

### Pattern 1: Three insertion adapters behind one dispatcher, no shared "insert" primitive

**What:** `detect-target.ts` classifies the currently focused/target element into one of three buckets (plain form field, contenteditable rich editor, Google Docs canvas) and hands off to the matching adapter. No adapter calls into another adapter's logic.

**When to use:** Always — this is the correct model, not a fallback.

**Trade-offs:** More code than a single generic function, but each adapter can be tested, versioned, and fixed independently when a site changes its editor internals (which happens without notice).

**Detection logic (concrete):**
```typescript
function classifyTarget(el: Element): 'plain-field' | 'contenteditable' | 'google-docs' {
  if (location.hostname === 'docs.google.com') return 'google-docs';
  if (el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement) return 'plain-field';
  if (el.closest('[contenteditable="true"]')) return 'contenteditable';
  throw new Error('No focused editable target');
}
```
Google Docs is detected by hostname up front (it never exposes a normal focused element to check), not by DOM shape.

### Pattern 2: Plain field insertion — native setter + synthetic `input` event

**What:** React (and Vue, and most modern SPA form libraries) overrides the native `value` setter on `<input>`/`<textarea>` so that assigning `.value` directly is invisible to the framework's change detection — the framework's own re-render silently reverts it. The fix is to call the **native** prototype setter directly, then dispatch a **trusted-shaped but synthetic** `input` (and often `change`) event so the framework's event listener — not its property watcher — picks up the change.

```typescript
function setNativeValue(el: HTMLInputElement | HTMLTextAreaElement, value: string) {
  const proto = el instanceof HTMLTextAreaElement
    ? window.HTMLTextAreaElement.prototype
    : window.HTMLInputElement.prototype;
  const setter = Object.getOwnPropertyDescriptor(proto, 'value')!.set!;
  setter.call(el, value);
  el.dispatchEvent(new Event('input', { bubbles: true }));
  el.dispatchEvent(new Event('change', { bubbles: true }));
}
```

**When to use:** Any plain `<input type="text">` / `<textarea>`, including framework-controlled ones. For progressive (character-by-character) insertion, call this repeatedly with the accumulating substring, or dispatch `beforeinput`/`input` with `inputType: 'insertText'` and `data` per chunk for finer-grained fidelity with frameworks that inspect `inputType`.

**Trade-offs:** Reliable and has been the standard technique for years (Medium/Kent C. Dodds-style writeups confirm this is still current practice). Cursor position must be managed manually (`selectionStart`/`selectionEnd`) if inserting mid-content rather than appending.
**Confidence:** HIGH — consistent across multiple independent sources, mechanism (property descriptor override) is a well-documented, unchanged part of how React's `SyntheticEvent` system works.

### Pattern 3: Contenteditable insertion — `execCommand('insertText')` as the practical unifier, clipboard-paste simulation as the fallback

**What:** `document.execCommand('insertText', false, text)` remains, despite being formally deprecated, the one technique that reliably reaches the internal transaction pipelines of ProseMirror, TipTap, Slate, Lexical, and Draft.js-based editors (this covers Notion, Slack's newer composer, LinkedIn, and most CMS rich-text fields). It works because these editors listen for the browser's native `beforeinput`/`input` pipeline that `execCommand` triggers — the same pipeline a real keystroke uses — rather than watching raw DOM mutations. Directly mutating `innerHTML` or calling `element.dispatchEvent(new InputEvent(...))` is ignored by these editors: they maintain their own document model and only trust input that arrives through the browser's real editing commands, and some (ProseMirror) explicitly check `event.isTrusted`-adjacent signals and discard synthetic `InputEvent`s that didn't originate from an actual native command.

```typescript
function insertIntoContentEditable(el: HTMLElement, text: string) {
  el.focus();
  const sel = window.getSelection();
  if (sel && el.contains(sel.anchorNode)) {
    // keep existing selection/cursor if inside this editor, else place at end
  } else {
    placeCaretAtEnd(el);
  }
  const ok = document.execCommand('insertText', false, text);
  if (!ok) simulatePasteInsertion(el, text); // fallback path
}
```

**Fallback — clipboard-paste simulation** (for editors that block `execCommand`, e.g. some Gmail compose surfaces, or browsers where a future release removes it):
```typescript
function simulatePasteInsertion(el: HTMLElement, text: string) {
  const dt = new DataTransfer();
  dt.setData('text/plain', text);
  const evt = new ClipboardEvent('paste', { clipboardData: dt, bubbles: true, cancelable: true });
  el.dispatchEvent(evt);
}
```
Some editors (Lexical explicitly, per its own docs/discussions) support exactly this pattern — construct a `DataTransfer`, populate it, and dispatch a `paste` event that the editor's own paste handler consumes into its model.

**When to use:** Any `[contenteditable="true"]` surface that is not `docs.google.com`. Try `execCommand` first (feature-detect with `document.queryCommandSupported('insertText')`); fall back to paste simulation if it returns false or the DOM doesn't change after the call.

**Trade-offs:**
- `execCommand` is deprecated with no removal timeline announced by any browser vendor as of this research — MDN explicitly notes there is no viable full replacement yet for cases like this, which is why it survives in production use by extensions and testing tools alike. Treat it as "stable but flagged," not "safe forever" — the adapter needs a runtime feature check and the paste-simulation fallback wired in from day one, not bolted on later.
- Progressive (character-by-character) insertion via repeated `execCommand` calls works but is measurably slower than plain-field insertion on heavier editors (Notion, Slack) because each call triggers the editor's full transaction/reconciliation cycle. Batch in small chunks (e.g. word-at-a-time) rather than single characters for acceptable performance.
- Site-specific quirks are real and cannot be fully eliminated: Slack's composer intercepts certain paste content for markdown auto-formatting; Gmail's compose box has historically had inconsistent `execCommand` support depending on which internal editor surface is focused. These need empirical per-site testing during Phase 3, tracked as a punch list, not solved abstractly.
**Confidence:** MEDIUM-HIGH — the core mechanism is corroborated by independent sources including editor maintainers' own community discussions (Lexical GitHub discussion on this exact use case) and hands-on writeups; exact behavior per specific site (Slack vs. Gmail vs. Notion today) is not independently re-verified against each live site in this research pass and should be spot-checked early in Phase 3.

### Pattern 4: Google Docs insertion — synthetic keyboard events at the hidden text-event-target iframe

**What:** Google Docs renders its document to `<canvas>`; there is no DOM representation of the document content to write into. All real keyboard input is captured by a dedicated, deliberately-hidden `iframe.docs-texteventtarget-iframe` that Google's own editor uses as its native input capture surface (this is how Docs supports IME/CJK input, spellcheck, and native OS-level text services). Community tooling (userscripts, accessibility tools) targets this iframe: locate it via `document.querySelector('iframe.docs-texteventtarget-iframe')`, get `iframe.contentDocument`, find its focused editable node inside, and dispatch synthetic `keydown`/`keypress`/`keyup` (and/or `beforeinput`) sequences at it character by character, or use `execCommand('insertText')` against that iframe's own editable context if it exposes one.

**When to use:** Only for `docs.google.com`. Do not attempt the contenteditable adapter here — there is no meaningful contenteditable surface; the visible page is a canvas render.

**Trade-offs — this is explicitly the most fragile of the three adapters:**
- Google actively works against low-level synthetic input for accessibility/security reasons; some sources note Docs "watches keyboard events at a low level, before they can be trapped and consumed by a browser extension," meaning naive event dispatch can be seen and processed by Docs' own key handling in ways that don't match a real keystroke's side effects (autocorrect, smart-quote conversion, list auto-continuation can all fire unexpectedly).
- The `docs-texteventtarget-iframe` is an internal implementation detail with no public API guarantee — a routine Google Docs internal refactor can silently break this adapter with no deprecation notice, unlike `execCommand` which at least has web-standard visibility.
- Progressive/paced insertion here is materially harder to get right (cursor drift, undo-buffer entanglement with Docs' own revision history) — plan for this adapter to need the most iteration and the most defensive error handling (detect "insertion had no visible effect" and surface a clear failure to the user rather than silently doing nothing).
**Confidence:** LOW-MEDIUM — mechanism is documented by community tooling and consistent with how Docs is known to work, but no official Google documentation exists (by design — this is not a supported integration surface), and behavior should be treated as "known to work as of recent versions, expected to occasionally break."

### Pattern 5: Insertion as a state machine, decoupled from generation, owned by the content script

**What:** Insertion is not "stream tokens as they arrive and write them." It is an explicit state machine — `idle → streaming → paused → streaming → stopped/completed → (optional) undoing → idle` — that owns its own buffer of pending text independent from the LLM stream's buffer.

**Where it lives:** In the **content script**, not the background service worker and not the sidebar.
- The service worker cannot own it: it can be terminated mid-stream (30s idle, 5-min hard cap, or Chrome killing it for other reasons) and has no synchronous access to the host page DOM anyway.
- The sidebar (React UI) cannot own it directly either, for two reasons: it renders inside the content script's shadow DOM but insertion needs to manipulate a *different* element on the page (the user's actual editor, which may not even be inside the sidebar's DOM subtree), and if the sidebar is ever moved to `chrome.sidePanel` in the future it would lose synchronous DOM access entirely. Keep the sidebar as *only* the control surface (buttons, progress UI) that sends commands (`start/pause/resume/stop/undo`) to the content script's insertion engine and receives state updates back.
- The content script is the only component with both a stable lifetime for the duration of the insertion (it dies only on navigation/tab close, which is an acceptable place for insertion to also end) and direct synchronous DOM access to the target editor.

**Decoupling from generation, concretely:** The full LLM response streams into a text buffer owned by the sidebar (or a small shared store) as it arrives from the service worker relay — generation can complete in 3 seconds. The insertion engine independently pulls from *however much of that buffer currently exists*, paced by the user's speed setting, and simply keeps pulling until it catches up to (or the buffer is marked complete). Stopping insertion sets its own state to `stopped` and does nothing to the generation stream or its buffer; stopping generation (rare, but symmetrical) marks the buffer complete without touching insertion's playhead.

**Undo, concretely:** Because every insertion adapter has fundamentally different undo semantics (plain fields: track exact substring + selection range inserted, splice it back out on undo; contenteditable: `execCommand('undo')` piggybacks on the browser's native undo stack *only if* insertion happened through `execCommand`/paste simulation — verify this holds, since native-setter-driven plain-field insertion does NOT feed the native undo stack and needs manual reversal; Google Docs: undo is close to unreconstructable synthetically and the safer strategy is "insert a matching number of Backspace keystrokes" rather than relying on Ctrl+Z), undo must be adapter-specific too, not a single generic reverse operation. Track the exact range/characters each adapter inserted so each can compute its own precise reversal.

**Trade-offs:** More coordination code than "just append tokens to the DOM as they stream," but it is the only design that satisfies the stated requirement that generation and insertion are independently stoppable.

## Data Flow

### Streaming request flow (chat generation)

```
Sidebar (user sends message)
    ↓ port.postMessage({ type: 'GENERATE', prompt, sessionId })
Background service worker
    ↓ fetch(POST /api/ai/stream, { signal, headers: auth })  — SSE / chunked
Backend AI gateway
    ↓ quota check → OpenRouter streaming completion
    ↓ chunk relayed as it arrives
Background service worker
    ↓ port.postMessage({ type: 'CHUNK', text }) for each chunk
Sidebar (appends to response buffer, renders live)
    ↓ (user clicks "insert" or has auto-insert configured)
Sidebar → Content script: port.postMessage({ type: 'INSERT_START', targetElRef, speed })
Content script insertion engine
    ↓ pulls from response buffer at paced interval, writes via matching adapter
Host page editor (text appears progressively)
```

### Context/file pipeline flow

```
Sidebar (user drops a PDF / pastes a screenshot)
    ↓ file kept in memory / IndexedDB briefly, size-checked client-side
    ↓ POST /api/context/upload (multipart, through background service worker as relay
      OR direct fetch from sidebar if sidebar has network access — see Integration Points)
Backend context pipeline
    Extract text (pdf.js server-side / Mammoth for docx)
    → OCR (server-side, Tesseract or cloud OCR) for images/scanned PDFs
    → Clean formatting
    → Chunk content
    → return structured { extractedText, sourceType, warnings } to extension
Sidebar
    → stores extracted text as a "context item" in the current session
    → Prompt Builder assembles context items + system + history + request into
      the structured prompt sent on next GENERATE
```

### Key data flows

1. **Generation buffer vs. insertion playhead** are two separate cursors over the same underlying text, updated by two independent loops (SSE relay vs. paced insertion timer) — this is the mechanism that makes decoupling real rather than aspirational.
2. **Context items never touch the insertion engine.** They flow sidebar → backend → sidebar → prompt assembly only. The insertion engine only ever sees final generated text, keeping the adapters simple and the context pipeline entirely backend-side.

## Scaling Considerations

| Scale | Architecture Adjustments |
|-------|--------------------------|
| Beta (10–50 users, this project's actual target) | Single Node process on Vercel, Supabase free tier Postgres, in-memory or Postgres-row quota counters. No queue needed — OCR/parsing requests are synchronous per-request. |
| 1k–10k users | Move OCR/file-parsing off the request path into a queue (even a simple Postgres-backed job table) so a large PDF doesn't hold a serverless function open; consider a dedicated OCR worker if Vercel function time limits are hit. |
| 100k+ users | Out of scope for this project's stated ship bar — not worth designing for now per the "smallest change that fully solves the problem" principle. |

### Scaling Priorities

1. **First likely bottleneck at any real usage:** Vercel serverless function execution time limits colliding with large PDF OCR jobs (OCR of multi-page scanned documents is slow). Mitigate by capping file size/page count in v1 rather than building async job infrastructure prematurely — this matches the project's "handful of beta users" ship bar.
2. **Second:** Shared OpenRouter API key budget exhaustion — already identified in PROJECT.md as the reason per-user quotas are a correctness requirement, not a feature. Quota checks must happen server-side, before the OpenRouter call, never trusted from the extension.

## Anti-Patterns

### Anti-Pattern 1: Building the sidebar as a `chrome.sidePanel` extension page

**What people do:** Reach for the newer, officially-promoted Side Panel API because it's cleaner, avoids CSS collision with host pages, and is the Chrome team's recommended direction for extension UI as of recent Chrome versions.
**Why it's wrong here:** Side Panel is a fully separate extension document with zero direct access to host-page DOM. Every single insertion action would require: sidepanel → service worker → content script → DOM, versus content-script-hosted sidebar → DOM directly. For a product whose entire differentiator is the feel of text landing responsively in the editor, this is the wrong trade to make for architectural cleanliness. It also requires actively coordinating content-script injection with the panel's open/close lifecycle, which is itself non-trivial (documented as "the somewhat tricky part" even in Side Panel advocacy writeups).
**Do this instead:** Content-script-hosted sidebar in a shadow DOM root. Accept the CSS-isolation burden (shadow DOM solves most of it) in exchange for direct, synchronous DOM proximity to the insertion target.

### Anti-Pattern 2: Treating the service worker as a place to hold state

**What people do:** Keep the current conversation, the insertion buffer, or quota counters in module-level variables in the background service worker, because that's the natural place for "backend-ish" extension logic to live.
**Why it's wrong:** MV3 service workers are terminated after 30 seconds of inactivity (any event or API call resets the timer) and can also be killed for other Chrome-internal reasons (system sleep/wake is specifically documented as a trigger). Any state held only in memory there disappears without warning, mid-session, silently. This is the single most common MV3 extension bug class.
**Do this instead:** Service worker is a pure router/relay. All state that needs to survive a possible restart lives in `chrome.storage.session` (survives service worker restarts, cleared on browser close — right for in-progress session data) or the content script/sidebar's own React state (survives as long as the tab is open, which matches insertion's natural lifetime).

### Anti-Pattern 3: Running OCR or heavy file parsing inside the extension (WASM in the content script/service worker)

**What people do:** Bundle Tesseract.js or a WASM-based PDF/image parser directly into the extension for "zero backend round-trip" OCR, since Tesseract.js is a common, well-known choice.
**Why it's wrong:** MV3's mandatory CSP restricts `script-src` to `'self'` and `'wasm-unsafe-eval'` only — no remote code, and libraries that fetch worker scripts or WASM binaries from a CDN at runtime (Tesseract.js's default distribution does this) break outright under MV3 unless every asset is vendored into the extension package and referenced with `chrome-extension://` URLs, which is a maintenance burden and bloats the extension bundle. There are open, unresolved compatibility issues on Tesseract.js's own tracker specifically about this.
**Do this instead:** Run OCR and all file parsing (PDF, DOCX) server-side, per the architecture above. This was already the direction implied by PROJECT.md's hosted-backend decision; this research confirms it is also the only clean path under MV3's CSP, not just a convenience choice.

## Integration Points

### External Services

| Service | Integration Pattern | Notes |
|---------|---------------------|-------|
| OpenRouter | Backend-only HTTPS, streamed (SSE or chunked) completion, provider abstraction wraps the client so swapping providers later is a config change | API key never ships in the extension — this is already a locked decision in PROJECT.md and is non-negotiable under MV3 (extension code is inspectable) |
| Supabase (Auth/DB/Storage) | Backend uses Supabase server SDK with service role for privileged operations (quota writes); extension only ever talks to *your* backend, never directly to Supabase, to keep quota enforcement server-side and unbypassable | Auth session token passed from extension to backend on each request; backend verifies against Supabase |
| Vercel | Standard serverless Node/TS deployment for the backend API and SSE proxy | Watch Vercel's function execution time limits against large file/OCR jobs (see Scaling) |

### Internal Boundaries

| Boundary | Communication | Notes |
|----------|---------------|-------|
| Sidebar ↔ Background service worker | `chrome.runtime.connect()` long-lived Port, one connection per sidebar instance, opened when sidebar mounts and closed on unmount | Long-lived Port messaging is the correct choice over repeated one-shot `sendMessage` calls for a streaming use case — one-shot messaging works but creates N separate round-trips for a token stream when one persistent channel is cleaner and, per Chrome 114+ behavior, also helps keep the worker alive while genuinely in use |
| Content script ↔ Background service worker | Separate `chrome.runtime.connect()` Port, since content script and sidebar are technically two different execution contexts even though the sidebar is rendered inside the content script's DOM | Keep them as two named ports (`'sidebar'`, `'content'`) rather than conflating — the service worker's router needs to know which one to relay generation chunks to (both, generally: sidebar for display, content script only if auto-insert is active) |
| Content script (insertion engine) ↔ Sidebar (control UI) | Direct in-process calls if truly co-located in the same document (shadow DOM), OR a simple pub/sub event bus within that shared execution context | These two do NOT need `chrome.runtime` messaging between them if the sidebar is mounted inside the content script's own shadow root — they share a JS execution context. This is a second reason to keep them co-located: it eliminates an entire message-passing hop for the highest-frequency interaction (pause/resume clicks during active insertion) |
| MV3 service worker keep-alive | `chrome.alarms` (fires even when worker is dormant, reviving it) as the durable backstop; Port-open-while-sidebar-active as the primary mechanism during normal use | Do not rely on `setInterval`-based self-pinging inside the service worker alone — it stops the moment the worker is actually terminated. `chrome.alarms` is the only mechanism guaranteed to fire and revive a dead worker. Also: an SSE `fetch()` response that itself has no chunk activity for 30s can be killed even with events resetting the *idle* timer elsewhere in the extension — keep the backend sending periodic non-empty chunks (or SSE comment/keepalive lines) during any pause in model output so the connection itself doesn't stall past 30s. |

## Build Order

Dependency-driven, not feature-driven. Each step is a precondition for testing the next, matching the project's stated core value: insertion cannot be validated without generation, and generation cannot be validated without a way to see the output.

1. **Extension scaffold + backend skeleton + auth.** Manifest V3 project (background/content/sidebar), a deployed backend with one authenticated route, Supabase auth wired end to end. Nothing works yet, but the message-passing skeleton (Port between sidebar and service worker) must exist before anything else can be tested. *Reasoning: every later component needs a channel to communicate on and a logged-in user to attribute quota to.*

2. **Streaming chat, no insertion, no context.** Sidebar sends a prompt, backend proxies to OpenRouter and streams back, sidebar renders tokens live. Establishes the service-worker relay pattern and the keep-alive strategy under real multi-minute-capable load. *Reasoning: this is the riskiest MV3 plumbing (service worker survival through a stream) and should be proven in isolation before insertion — which depends on generation already working — is layered on top.*

3. **Insertion engine — plain fields first, in isolation, against a static test page.** Build and validate the native-setter + synthetic-event adapter against a deliberately-built test harness (plain `<input>`, React-controlled input, Vue-controlled input) before touching any real target site. *Reasoning: this is the simplest adapter and validates the state-machine (pause/resume/stop/undo) design cheaply, without the added noise of contenteditable's framework quirks or Google Docs' fragility.*

4. **Insertion engine — contenteditable adapter, against real target sites (Slack, LinkedIn, Notion, Gmail).** Extend the same state machine with the `execCommand`/paste-simulation adapter. Budget real time here for per-site quirks (this is explicitly flagged as needing empirical validation). *Reasoning: depends on the state machine architecture proven in step 3; must not be built first because contenteditable's failure modes are noisy enough to obscure state-machine bugs.*

5. **Insertion engine — Google Docs adapter.** Build last among the three, expect it to need the most iteration, and build defensive detection for "insertion silently failed" from day one. *Reasoning: most fragile, least documented, highest cost-of-change if the state machine underneath it isn't already stable — must not be the adapter that also shakes out state-machine bugs.*

6. **Context pipeline (upload → extract → OCR → chunk → assemble).** Backend-only work, largely independent of the extension once the upload endpoint contract is fixed. Can be developed in parallel with steps 3–5 by a second thread of work, but functionally it slots in after generation works (step 2) since it feeds the same prompt-assembly path. *Reasoning: no insertion or generation dependency, but needs the authenticated backend from step 1 and the structured-prompt-assembly convention established in step 2.*

7. **Progressive insertion pacing + transport controls polish, undo correctness across all three adapters.** Only fully buildable once all three adapters exist, since undo semantics differ per adapter (see Pattern 5). *Reasoning: cross-cutting concern that depends on every adapter being present to be tested exhaustively.*

8. **Quota enforcement hardening + usage accounting UI.** Can start as a stub in step 1 (server-side check that always passes) and be filled in for real once real usage patterns from steps 2–6 exist to calibrate limits against. *Reasoning: correctness-critical but not blocking — deliberately staged last so limits are set from real observed token/request volume rather than guessed numbers.*

**Explicit non-dependency:** File upload/OCR (step 6) and the three insertion adapters (steps 3–5) have no dependency on each other and can genuinely run in parallel if more than one person/session is working the roadmap — they only share the "authenticated backend + structured prompt" foundation from steps 1–2.

## Sources

- [Element: beforeinput event — MDN](https://developer.mozilla.org/en-US/docs/Web/API/Element/beforeinput_event) — HIGH confidence, official docs
- [InputEvent: inputType — MDN](https://developer.mozilla.org/en-US/docs/Web/API/InputEvent/inputType) — HIGH confidence
- [Document.execCommand() — MDN](https://developer.mozilla.org/en-US/docs/Web/API/Document/execCommand) — HIGH confidence, official deprecation status, no removal timeline stated
- [How I Defeated ProseMirror: The Only Way to Programmatically Insert Text Into Rich Text Editors — DEV Community](https://dev.to/vesper_finch/how-i-defeated-prosemirror-the-only-way-to-programmatically-insert-text-into-rich-text-editors-1208) — MEDIUM confidence, single hands-on source, mechanism plausible and consistent with editor architecture
- [Get + Replace lexical html content with browser extension — facebook/lexical Discussion #8249](https://github.com/facebook/lexical/discussions/8249) — MEDIUM-HIGH confidence, from editor's own maintainers/community
- [How I Fooled React Into Thinking I Was a User — Medium](https://medium.com/@arifdewi/how-i-fooled-react-into-thinking-i-was-a-user-and-you-can-too-79caca33fe33) — MEDIUM confidence, corroborated by long-standing widespread use of this technique
- [The extension service worker lifecycle — Chrome for Developers](https://developer.chrome.com/docs/extensions/develop/concepts/service-workers/lifecycle) — HIGH confidence, official docs, fetched directly
- [Message passing — Chrome for Developers](https://developer.chrome.com/docs/extensions/develop/concepts/messaging) — HIGH confidence, official docs
- [chrome.sidePanel — Chrome for Developers](https://developer.chrome.com/docs/extensions/reference/api/sidePanel) — HIGH confidence, official docs
- [Manifest - Content Security Policy — Chrome for Developers](https://developer.chrome.com/docs/extensions/reference/manifest/content-security-policy) — HIGH confidence, official docs
- [Browser extension Manifest version 3 is experiencing issues with Tesseract.js — GitHub Issue #961](https://github.com/naptha/tesseract.js/issues/961) — MEDIUM confidence, live open issue confirming the CSP conflict
- [Block Shortcuts in Google Docs — Filippo Orru](https://filippo-orru.com/blog/google-docs-block-shortcuts/) — MEDIUM confidence, community technical writeup on `docs-texteventtarget-iframe`
- [Manifest v3 service worker stops when computer awakens from 30+ second sleep — Chromium Issue Tracker #40273015](https://issues.chromium.org/issues/40273015) — MEDIUM confidence, official issue tracker, confirms an additional termination trigger beyond idle timeout

---
*Architecture research for: Chrome MV3 AI writing-assistant extension*
*Researched: 2026-08-05*
