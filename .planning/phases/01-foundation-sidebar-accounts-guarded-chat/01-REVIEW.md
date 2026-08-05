---
phase: 01-foundation-sidebar-accounts-guarded-chat
reviewed: 2026-08-05T00:00:00Z
depth: deep
files_reviewed: 32
files_reviewed_list:
  - apps/backend/src/env.ts
  - apps/backend/src/index.ts
  - apps/backend/src/openrouter.ts
  - apps/backend/src/prompt.ts
  - apps/backend/src/routes/auth.ts
  - apps/backend/src/routes/chat.ts
  - apps/backend/src/routes/conversations.ts
  - apps/backend/src/routes/files.ts
  - apps/backend/src/supabase.ts
  - apps/extension/entrypoints/background.ts
  - apps/extension/entrypoints/content/index.tsx
  - apps/extension/entrypoints/popup/main.ts
  - apps/extension/insertion/adapters/contenteditable.ts
  - apps/extension/insertion/adapters/gdocs.ts
  - apps/extension/insertion/adapters/plain.ts
  - apps/extension/insertion/engine.ts
  - apps/extension/insertion/index.ts
  - apps/extension/insertion/target.ts
  - apps/extension/insertion/types.ts
  - apps/extension/sidebar/api.ts
  - apps/extension/sidebar/chat.ts
  - apps/extension/sidebar/components/App.tsx
  - apps/extension/sidebar/components/AuthView.tsx
  - apps/extension/sidebar/components/ChatView.tsx
  - apps/extension/sidebar/components/ContextPanel.tsx
  - apps/extension/sidebar/components/HistoryView.tsx
  - apps/extension/sidebar/components/SettingsView.tsx
  - apps/extension/sidebar/inserter.ts
  - apps/extension/sidebar/store.ts
  - apps/extension/utils/protocol.ts
  - apps/extension/wxt.config.ts
  - packages/shared/src/index.ts
findings:
  critical: 3
  warning: 17
  info: 17
  total: 37
status: issues_found
---

# Phase 1: Code Review Report

**Reviewed:** 2026-08-05
**Depth:** deep (full read of every file, cross-file tracing of the port relay, insertion state machine, auth/refresh flow, and SSE pipeline)
**Files Reviewed:** 32
**Status:** issues_found

## Summary

The architecture is sound and matches the pitfalls research: key server-side only, quota consumed atomically before the AI call, three isolated insertion adapters, shadow-DOM sidebar, port-based stream relay. The defects below are in execution, not design. Three are Critical: a timeout bug that kills every generation longer than 30 seconds mid-stream, an edit-flow bug that erases the AI response with one click, and a resume/undo path that corrupts the user's document after they type mid-insertion — the exact race the product's own research (Pitfall 3) calls "the primary use case, not an edge case."

## Critical Issues

### CR-01: 30-second timeout aborts the entire stream, not just time-to-first-byte

**File:** `apps/backend/src/openrouter.ts:81-84`
**Issue:** The comment says "30s to first byte", but `AbortSignal.timeout(30_000)` is combined with the caller's signal and passed as the fetch `signal`. In Node/undici that signal governs the whole request *including body consumption*: it fires 30 seconds after `streamOne` starts regardless of whether tokens are flowing. Any generation whose total wall time exceeds 30 s is aborted mid-stream. Because `emitted === true` at that point, `streamChat` throws "Model X failed mid-response: This operation was aborted", the user sees an error, the partial response is not persisted (`persistExchange` is skipped), and the quota point is still spent. The line-116 comment "After the stream is open, only the caller's abort applies" is false — nothing detaches the timeout. This will not show up with short dev prompts and will fail on exactly the long, read-along generations the product is for.
**Fix:** Enforce first-byte timeout on the `fetch()` promise only, then stream under the caller's signal alone:
```ts
const firstByte = new AbortController();
const t = setTimeout(() => firstByte.abort(), 30_000);
const res = await fetch(url, { signal: AbortSignal.any([signal, firstByte.signal]), ... });
clearTimeout(t); // headers received — from here only `signal` applies
```
(and read `res.body` without the timeout signal attached; abort-on-`signal` already works via the existing `signal.aborted` check plus `reader.cancel()`).

### CR-02: "Edit" on a streamed message opens an empty draft — "Save" erases the AI response

**File:** `apps/extension/sidebar/components/ChatView.tsx:200-214, 227`
**Issue:** `MessageBubble` initializes `const [draft, setDraft] = useState(m.content)` on first render. For every streamed assistant message, first render happens when `content === ''` (the streaming placeholder). `useState`'s initializer runs once; `draft` never re-syncs as tokens arrive (`key={m.id}` is stable, so no remount). After the stream completes, clicking **Edit** shows an empty textarea, and clicking **Save** runs `saveEdit()`, replacing the full response with the empty draft. The response vanishes from the UI (it survives only in the DB). This affects the primary path — every live-generated message; only history-loaded messages (mounted with full content) escape.
**Fix:** Seed the draft when editing starts, not at mount:
```tsx
<button onClick={() => { setDraft(m.content); setEditing(true); }}>Edit</button>
```

### CR-03: Resume/undo after the user types corrupts the document (plain and contenteditable adapters)

**File:** `apps/extension/insertion/adapters/plain.ts:47-68` (insert at stale offset, snapshot undo), `apps/extension/insertion/adapters/contenteditable.ts:95-129` (undo range from stale offsets), `apps/extension/insertion/engine.ts:60-70` (resume with no re-verification)
**Issue:** The typing guard correctly auto-pauses on trusted input (`engine.ts:153-164`) and the UI invites "Resume when ready." But nothing recomputes positions on resume:
- **Plain:** `insert()` writes at `insertPos + inserted` — character offsets captured at `prepare()`. If the user typed *before* that offset while paused (or clicked elsewhere and typed), resume splices AI text into the middle of the wrong location. Worse, `undoAll()` restores `snapshot.value` — the field's content from before insertion began — silently deleting everything the user typed since `prepare()`.
- **Contenteditable:** `undoAll()` selects `[startOffset, startOffset + inserted]` computed against the text length at prepare time. User edits before/inside that span shift the offsets, so undo deletes a range that includes the user's own text and/or leaves AI text behind.
This is Pitfall 3 from the project's own research, which explicitly requires "before each chunk write, re-verify … if not, pause and surface a conflict rather than writing blindly." The E2E pass ran without mid-insertion interaction, which is exactly the blind spot the research predicted.
**Fix (minimal):**
1. In `engine.ts`, record a content fingerprint (plain: `el.value`; CE: `textContent` length + slice around the insertion span) after each successful `insert()`. On `resume()` and in `undo()`, ask the adapter to verify the fingerprint; on mismatch, refuse with a specific message ("The text changed while paused — undo is no longer safe; remove the text manually") instead of writing/deleting blindly.
2. Plain `undoAll()`: instead of restoring the snapshot, delete only the inserted span `[insertPos, insertPos + inserted]` from the *current* value — and only if `value.slice(insertPos, insertPos + inserted)` still equals the inserted text.

## Warnings

### WR-01: Google Docs adapter computes its own failure signal, then discards it

**File:** `apps/extension/insertion/adapters/gdocs.ts:83-90`
**Issue:** `dispatchEvent` returns `true` when *no listener called preventDefault* — i.e., Docs did **not** consume the paste. The code puts an explanatory string in `reason` but returns `ok: true` either way, and `reason` on a successful result is never read by the engine. If Google changes the texteventtarget listener (the exact breakage mode Pitfall 4 documents — the iframe can still exist while the handler is gone, so `selfTest()` passes), every chunk "succeeds," `chunksInserted` increments, and the UI reports "Sent (unverified)" while nothing entered the document. The one affirmative signal available is thrown away.
**Fix:** `if (delivered) return { ok: false, verified: true, reason: 'Google Docs did not accept the inserted text — Google may have changed how Docs receives input. Use Copy instead.' };` and only increment `chunksInserted` when `delivered === false`.

### WR-02: SSE route writes to `reply.raw` without `reply.hijack()`

**File:** `apps/backend/src/routes/chat.ts:48-53, 117`
**Issue:** Fastify 5 still owns the reply lifecycle here. The handler returns `undefined` after `reply.raw.end()`, so Fastify attempts its own send and logs `FST_ERR_REP_ALREADY_SENT`-class errors on every chat request; onSend hooks and error handling around this route behave unpredictably.
**Fix:** Call `reply.hijack()` immediately before `reply.raw.writeHead(...)`.

### WR-03: `persistExchange` never checks response status — silent conversation-history loss

**File:** `apps/backend/src/routes/chat.ts:146-150`
**Issue:** Both the `/messages` insert and the `/conversations` PATCH ignore `res.ok`. Any RLS rejection, constraint failure, or transient PostgREST error silently drops the exchange from history while the UI shows it succeeded. Combined with WR-05 (client-supplied `conversationId` reaches this insert unvalidated), a bogus id means every message in the session is silently discarded.
**Fix:** Check `res.ok` on the messages insert; on failure, `req.log.error` and append a non-fatal note to the `done` event (or at minimum log). Validate `body.conversationId` is a UUID before use.

### WR-04: A failed `get_usage` after a successful generation reports the whole response as failed

**File:** `apps/backend/src/routes/chat.ts:89-90`
**Issue:** After the stream completes and the exchange is persisted, `rpc('get_usage')` runs inside the same try. If it throws (Supabase blip, PGRST303 retry exhausted), the catch sends `{type:'error', message:'The AI response failed: rpc get_usage failed…'}` — the client marks the stream errored and shows a failure banner for a generation that fully succeeded and was charged.
**Fix:** Wrap the usage lookup in its own try/catch and send `done` with a null/last-known usage on failure.

### WR-05: PostgREST filter injection via interpolated identifiers

**File:** `apps/backend/src/routes/chat.ts:147`, `apps/backend/src/routes/conversations.ts:28, 39`
**Issue:** `conversationId` (client JSON) and `:id` (URL param, %-decoded by Fastify, so `%26` becomes `&`) are interpolated raw into PostgREST query strings: `/conversations?id=eq.${id}`. A crafted id injects additional query parameters (extra filters, `or=(...)`, `select=`, `limit=`), changing which rows the query touches. RLS confines the blast radius to the caller's own rows, so this is not cross-user, but DELETE/PATCH scope can be widened beyond a single row (e.g., delete all own conversations via an injected `or` filter) and it is one RLS mistake away from IDOR.
**Fix:** Validate ids against a UUID regex before interpolation (`if (!/^[0-9a-f-]{36}$/i.test(id)) return 400`), or use `encodeURIComponent(id)` inside the filter value *and* validate format.

### WR-06: Quota is consumed for generations that deliver nothing — and the UI claims otherwise

**File:** `apps/backend/src/routes/chat.ts:27-45` (no refund path), `apps/extension/sidebar/chat.ts:65` (copy)
**Issue:** `consume_quota` runs before the AI call (correct per QUOT-01), but there is no compensation when the outcome is `all_models_failed`, `policy_no_paid_models`, or a pre-token upstream failure: the user is charged one request for zero output. With free models 429ing routinely (verified in PROJECT.md day one), a beta user can burn a day's quota on nothing. Separately, the interruption message in the sidebar says "nothing was charged twice" — charging happened once for nothing, so the copy is misleading.
**Fix:** In the error paths where no token was ever emitted (PolicyError, NoModelsError), call a `refund_quota` RPC (or `consume_quota` with `p_cost: -1`). If deliberately not refunding, change the client copy and document the decision.

### WR-07: Concurrent token refresh race in the background worker

**File:** `apps/extension/entrypoints/background.ts:45-63`
**Issue:** `freshToken()` has no single-flight guard. Two simultaneous callers (e.g., `loadUsage` from two tabs' sidebars, or an upload racing a chat start) both see the expired token and both POST the same `refresh_token`. Supabase rotates refresh tokens; the default ~10 s reuse window usually absorbs this, but if reuse detection is strict or the calls straddle the window, the second refresh fails → `setSession(null)` → the user is silently logged out mid-session. The two `setSession` writes also race, potentially storing the older token pair last.
**Fix:** Memoize the in-flight refresh: `let refreshing: Promise<string|null> | null` — all concurrent callers await the same promise; clear it when settled.

### WR-08: Session death never returns the UI to the auth view

**File:** `apps/extension/sidebar/store.ts` (no 401 handling), `apps/extension/entrypoints/background.ts:55-57`
**Issue:** When refresh fails, the background clears the stored session, but no signal reaches the sidebar. The store keeps `view: 'chat'` and `email` set; every subsequent action surfaces "Sign in required" errors with no path back to the sign-in form except reloading the page. For beta users this reads as "the product broke."
**Fix:** In `call()`/store, on `status === 401` set `{ email: null, view: 'auth', error: 'Your session expired — sign in again.' }` (one check in the shared `call` wrapper covers every path).

### WR-09: Auth proxy crashes with 500 on non-JSON upstream responses

**File:** `apps/backend/src/routes/auth.ts:17, 28, 39`
**Issue:** signup/login/refresh do `await res.json()` unguarded. When GoTrue (or an intermediary) returns HTML/empty on 502/504/429, `.json()` throws, the route 500s, and the extension shows a generic failure instead of the specific error this file's own header comment promises.
**Fix:** `const body = await res.json().catch(() => ({ error: `Auth service returned ${res.status}` }));` — same pattern already used in `/reset`.

### WR-10: Email redirect URLs are hardcoded to localhost and likely ignored by GoTrue anyway

**File:** `apps/backend/src/routes/auth.ts:15, 54`
**Issue:** Two problems. (1) `http://localhost:${env.port}/confirmed` and `/reset` are baked in — the moment this deploys, confirmation/recovery emails point at the user's own machine. (2) The raw GoTrue REST API takes redirects as a `redirect_to` *query parameter*; `options: { email_redirect_to }` / `options: { redirect_to }` in the JSON body is a supabase-js client convention. Sent this way, GoTrue most likely ignores it and falls back to the project's Site URL — meaning it only appears to work because the Supabase Site URL happens to be set to localhost. Fragile twice over.
**Fix:** Add `PUBLIC_URL` to env and pass the redirect as a query param: `gotrue('/signup?redirect_to=' + encodeURIComponent(`${publicUrl}/confirmed`), …)`, same for `/recover`.

### WR-11: No rate limiting anywhere — auth brute force and free OCR abuse

**File:** `apps/backend/src/index.ts` (no limiter registered), `apps/backend/src/routes/auth.ts:21-30`, `apps/backend/src/routes/files.ts:13`
**Issue:** Pitfall 5 explicitly requires IP/user rate limits *separate from* the chat quota. `/api/auth/login` is unauthenticated and unthrottled (credential stuffing at full speed; GoTrue's own limits are the only backstop). `/api/files` runs Tesseract OCR — the most expensive compute on the box — with no quota and no rate limit: one authenticated user can pin the backend CPU indefinitely for free.
**Fix:** Register `@fastify/rate-limit` globally (e.g., 60/min/IP), tighter on `/api/auth/*` (e.g., 10/min/IP), and count `/api/files` against the same daily quota or a parallel one.

### WR-12: Parse timeout abandons the work instead of stopping it; Tesseract worker can leak

**File:** `apps/backend/src/routes/files.ts:34, 88-95, 115-120`
**Issue:** `withTimeout` races a rejection but the underlying parse keeps running — a pathological PDF continues pinning the event loop after the user has already received "was stopped," which is precisely what the file's own doc comment claims to prevent. For images, `worker.terminate()` sits in a `finally` that only runs when `recognize()` settles; if it never settles, the worker (with its threads/WASM memory) leaks permanently. Repeated bad uploads accumulate leaked workers until the process dies.
**Fix:** For OCR, terminate on timeout explicitly: create the worker outside `parse`, and in the timeout path call `worker.terminate()` (terminate rejects the pending recognize). For pdf-parse/mammoth, true cancellation needs a worker thread — at minimum cap input size harder and log when a timed-out parse eventually settles.

### WR-13: SPA remount path leaks TargetTracker listeners

**File:** `apps/extension/entrypoints/content/index.tsx:15-41`, `apps/extension/sidebar/inserter.ts:20-22`
**Issue:** When the MutationObserver detects the host was torn out and calls `ui.mount()` again, `onMount` runs `inserter.init(...)`, which constructs a new `TargetTracker` — but never calls `destroy()` on the previous one. Each remount adds another permanent `focusin` + `selectionchange` capture listener pair on `document` (the old tracker also keeps stale saved-target references alive). On aggressive SPAs this compounds. Additionally, if `ui.mount()` throws mid-recovery, the observer has already disconnected and never re-arms — sidebar recovery is dead for the rest of the page's life.
**Fix:** In `Inserter.init`: `this.tracker?.destroy();` before creating the new one. Wrap the remount in try/finally so `observe()` re-arms even on failure.

### WR-14: Token streaming re-renders the entire ChatView per token

**File:** `apps/extension/sidebar/components/ChatView.tsx:10, 47-49, 16-18`
**Issue:** `const s = useStore()` subscribes to the whole store, and every token event does `set({ messages: [...] })`. So each token re-renders ChatView plus **all** `MessageBubble`s (none memoized) plus the composer, and the scroll effect runs `scrollTo` (forced layout) per token. Quantified: at ~40 tokens/s with a 20-message conversation, that is ~800 component renders + 40 forced layouts per second inside a shadow root on someone else's page — visible jank on mid-range hardware, and the host page pays for it too. This is the product's most-watched moment.
**Fix (minimal):** memoize the bubble (`const MessageBubble = memo(...)` — non-streaming messages then skip re-render since their object identity is preserved by the spread), select narrow slices (`useStore(s => s.messages)` etc.) instead of the whole store, and batch tokens in `sidebar/chat.ts` with a ~50 ms flush buffer so state updates are capped at ~20/s regardless of token rate.

### WR-15: Server heartbeats are dropped at the relay — SW keepalive is not guaranteed through token gaps

**File:** `apps/extension/entrypoints/background.ts:263-275` (parser skips non-`data:` frames), `apps/backend/src/routes/chat.ts:58`
**Issue:** The stated keepalive strategy is "port traffic resets the SW idle timer." But port traffic only happens when a `data:` frame arrives; the backend's 15 s `: ping` comments are filtered out in the relay and never become port messages. During a model "thinking" gap longer than ~30 s with no tokens, staying alive depends entirely on whether Chrome counts incoming fetch bytes as SW activity — behavior that has shifted across Chrome versions and is exactly what Pitfall 1 warns not to rely on. The 30 s first-byte timeout (CR-01) currently masks this by killing such streams anyway; once CR-01 is fixed, this becomes the live risk.
**Fix:** Forward heartbeats: when a frame is a comment/ping, `send({ type: 'ping' })` on the port (add to `ChatPortServerMsg`; client ignores it). One line each side, makes the keepalive deterministic.

### WR-16: Switching or clearing the conversation mid-stream leaks the generation and can mis-attach the conversation id

**File:** `apps/extension/sidebar/chat.ts:74-76`, `apps/extension/sidebar/store.ts:122-123`, `apps/extension/sidebar/components/HistoryView.tsx:24`
**Issue:** Neither `newConversation()` nor `HistoryView.open()` calls `stopGeneration()`. The port stays open, the backend keeps generating (quota spent), and arriving tokens are silently dropped because the new message list has no streaming placeholder. Also `case 'meta': if (!state.conversationId)` runs against *current* state: press "New conversation" between send and the meta event and the old request's `conversationId` is attached to the fresh empty chat — the next send appends to the wrong server-side conversation.
**Fix:** Call `stopGeneration()` at the top of `newConversation()` and `open()`; in the meta handler, ignore the event if the port that produced it is no longer `activePort` (or capture a request-scoped flag in the listener closure).

### WR-17: `tabs` permission is requested but not needed

**File:** `apps/extension/wxt.config.ts:13`
**Issue:** `chrome.tabs.query({active:true,currentWindow:true})`, `tabs.sendMessage`, and `captureVisibleTab` (covered by `activeTab`/host permissions) do not require the `tabs` permission. Requesting it grants URL/title access to all tabs and adds a warning surface at install and store review — a direct violation of the Pitfall-6 permission-minimization requirement, for zero functionality.
**Fix:** Remove `'tabs'` from `permissions`; verify the three call sites still work (they do — tab `id` is available without it).

## Info

### IN-01: Backend URL hardcoded to localhost
**File:** `apps/extension/utils/protocol.ts:3` — `BACKEND_URL = 'http://127.0.0.1:8787'` is a compile-time constant; deploying requires a code change and a plain-HTTP token flow until then. Move to WXT env (`import.meta.env`) per build target.

### IN-02: Dev harness route + unhandled listen rejection
**File:** `apps/backend/src/index.ts:24-29, 43` — `/harness` does an unauthenticated synchronous `readFileSync` per request and 500s (stack in log) if the file is missing; must not ship past dev. `app.listen(...).then()` has no `.catch` — a busy port dies as an unhandled rejection instead of a clear message.

### IN-03: CORS reflects every origin
**File:** `apps/backend/src/index.ts:13-18` — `origin: true` with bearer auth and `credentials: false` is not exploitable for session theft, but it lets any website drive the unauthenticated auth endpoints from visitors' browsers. Acceptable for dev given chrome-extension origin ids vary; pin the extension origin pattern (`chrome-extension://<id>`) for release.

### IN-04: `/reset` inline script interpolation is not `</script>`-safe
**File:** `apps/backend/src/routes/auth.ts:97-99` — `JSON.stringify(env.supabaseUrl)` does not escape `</script>`; an env value containing it would break out of the script block. Values are operator-controlled so not exploitable today; use `JSON.stringify(v).replace(/</g,'\\u003c')` as cheap hygiene.

### IN-05: `chunkText` drops leading whitespace
**File:** `apps/extension/insertion/engine.ts:181-187` — `/\S+\s*/g` skips whitespace before the first word, so a response beginning with a newline/indent inserts flush against existing text, and `insertedChars` can never reach `totalChars` (masked because the UI forces progress to 1 on done). Prepend `text.match(/^\s+/)` as a first chunk.

### IN-06: Final unterminated SSE line discarded
**File:** `apps/backend/src/openrouter.ts:116-146` — if the upstream closes without a trailing newline, the last buffered `data:` line is dropped. Rare with OpenRouter's `[DONE]` convention; process the remaining buffer after `done`.

### IN-07: `/api/chat` body shape unvalidated beyond `messages`
**File:** `apps/backend/src/routes/chat.ts:21-24`, `apps/backend/src/prompt.ts:39-44` — `context`, `prefs`, `subject`, `operation` are trusted as typed; non-string `c.text` becomes `"undefined"` in the prompt; total context size is bounded only by Fastify's 1 MB default body limit rather than `MAX_CONTEXT_*`. Add a zod schema (already in the recommended stack) and enforce the shared limits server-side.

### IN-08: `rows[0].id` unchecked
**File:** `apps/backend/src/routes/chat.ts:132` — a `return=representation` response with zero rows (RLS filtered the returning set) throws `TypeError: Cannot read properties of undefined` into the generic error path. Guard and produce a specific message.

### IN-09: All `toBuffer` failures mapped to 413; no magic-byte sniffing
**File:** `apps/backend/src/routes/files.ts:20-28, 64-98` — stream errors unrelated to size are reported as "over the limit"; file type is determined by MIME/extension only (research recommended content sniffing). Parser failure paths do fail gracefully, so residual risk is a wrong error message and wasted parse attempts.

### IN-10: `navigator.platform` is deprecated
**File:** `apps/extension/insertion/adapters/gdocs.ts:96` — still functional in Chrome, but the modern check is `navigator.userAgentData?.platform ?? navigator.platform`. One-line swap when touched next.

### IN-11: TargetHint blank for the first 1.5 s; selection capture is fragile
**File:** `apps/extension/sidebar/components/ChatView.tsx:184-196, 27-36` — the interval-only poll means "No insertion target yet" always shows for 1.5 s even when a target exists (call `targetStatus()` once on mount). `captureSelection` reads `document.getSelection()` after the user clicks a sidebar button — a mousedown in the same document can collapse a contenteditable selection before the read; add `onMouseDown={e => e.preventDefault()}` to the button to keep the page selection alive.

### IN-12: Resize effect re-registers window listeners on every width change
**File:** `apps/extension/sidebar/components/App.tsx:29-47` — `[width]` dep means remove/add of both pointer listeners per pointermove during a drag, and the listeners stay attached for the page's lifetime even when only the FAB is showing. Store width in a ref for the `up` handler and register once (`[]`).

### IN-13: Unknown one-shot kinds return `undefined`; token coercion can store `"undefined"`
**File:** `apps/extension/entrypoints/background.ts:83-203, 35-43` — the switch has no default, so an unhandled `kind` resolves `undefined` and callers dereference `.ok` on it; `String(data.access_token)` on a malformed token response stores the literal string `"undefined"` as a session. Add a default branch and reject when `access_token`/`refresh_token` are not strings.

### IN-14: Popup error hint is never visible
**File:** `apps/extension/entrypoints/popup/main.ts:4-10` — when `sendMessage` rejects (chrome:// pages), the catch writes the hint and then `window.close()` runs unconditionally, closing the popup before the user can read it. Also `document.querySelector('.hint')!` throws if the element is missing. Only close on success.

### IN-15: Chat port accepts a second `start` on the same port
**File:** `apps/extension/entrypoints/background.ts:227-291` — two `start` messages share one AbortController and interleave their events on one port. The shipped client never does this, but it is a one-line guard (`let started = false`) against a future client bug producing spliced responses.

### IN-16: Message read/insert isolation rests entirely on RLS policies not in this repo
**File:** `apps/backend/src/routes/conversations.ts:28`, `apps/backend/src/routes/chat.ts:146` — reading `/messages?conversation_id=eq.X` and inserting messages with a client-supplied conversation id are only safe if the `messages` RLS policy checks conversation ownership via join (not merely "authenticated"). Verify the policy exists and has a test; the backend has no second line of defense by design.

### IN-17: Auto-scroll yanks the user to the bottom on every token
**File:** `apps/extension/sidebar/components/ChatView.tsx:16-18` — scrolling up to re-read during a stream is impossible; the effect forces bottom on each token. Only auto-scroll when the user is already within ~40 px of the bottom.

## Summary Table

| Severity | Count |
|----------|-------|
| Critical | 3 |
| Warning | 17 |
| Info | 17 |
| **Total** | **37** |

## Prioritized Fix Order

1. **CR-01** — stream timeout: every >30 s generation currently fails; masks WR-15. Smallest fix, biggest payoff.
2. **CR-02** — Edit erases streamed responses: one-line fix, user-facing data loss.
3. **CR-03** — resume/undo corruption: core-value trust destroyer; needs the fingerprint guard before beta users type mid-insertion.
4. **WR-01** — Docs silent no-op: one conditional; converts the predicted Google-side breakage from silent corruption into a loud failure.
5. **WR-06 + WR-11** — quota refund and rate limiting: direct money exposure on the operator's key (Pitfall 5).
6. **WR-07 + WR-08** — refresh single-flight and 401 → auth view: spurious logouts are the most likely "it broke" beta report.
7. **WR-05 + WR-03 + IN-16** — id validation, persist error checks, RLS verification: closes the data-integrity cluster in one pass.
8. **WR-02, WR-04, WR-09, WR-10** — backend robustness batch (hijack, usage-after-success, JSON guards, redirect URLs).
9. **WR-14 + WR-15 + WR-16** — streaming smoothness and lifecycle batch in the sidebar/relay.
10. **WR-12, WR-13, WR-17** and Info items as touched.

---

_Reviewed: 2026-08-05_
_Reviewer: Claude (gsd-code-reviewer)_
_Depth: deep_
