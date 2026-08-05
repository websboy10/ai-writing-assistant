# Pitfalls Research

**Domain:** Chrome MV3 extension, LLM backend, universal text insertion across hostile third-party editors
**Researched:** 2026-08-05
**Confidence:** MEDIUM-HIGH (MV3 lifecycle and Web Store policy are well-documented HIGH confidence; insertion failure modes are MEDIUM — verified against known React/contenteditable behavior but each target site changes its editor internals without notice)

## Critical Pitfalls

### Pitfall 1: Service worker dies mid-stream and silently drops the AI response

**What goes wrong:**
Chrome terminates an MV3 service worker after ~30 seconds of no incoming events/API calls, and unconditionally after 5 minutes of continuous work or a fetch() response idle for 30+ seconds. If the SSE/stream connection to the backend is held open in the background service worker and the user's active tab isn't generating events, the worker can be killed mid-stream. The sidebar shows a spinner that never resolves, or resolves with a truncated response, and there's no error the user can act on.

**Why it happens:**
Developers building the streaming pipeline against a persistent-background-page mental model (or MV2 muscle memory) assume the connection just stays open. It works fine in dev testing (short prompts, service worker stays "hot" from other activity) and fails under real usage (long generations, user switches tabs, laptop throttles background workers).

**How to avoid:**
- Do not treat the service worker as a long-lived stream holder. Either: (a) stream the fetch response directly from the **content script/sidebar iframe context** (which lives in the tab and isn't subject to the same 30s idle kill), proxying only auth through the worker, or (b) if the worker must hold the stream, register a `chrome.runtime.connect()` port from the sidebar for the duration of generation — an open port resets the idle timer on every message, and message traffic during streaming (chunk arrival) keeps resetting it naturally.
- Persist partial response chunks to `chrome.storage.session` (or IndexedDB) as they arrive, not just in worker memory, so a kill mid-stream is recoverable rather than a silent void.
- Never rely on `setTimeout`/`setInterval` in the worker for anything beyond a few seconds — they do not survive suspension. Use `chrome.alarms` (1-minute minimum granularity) only for periodic housekeeping, not as a streaming keepalive hack.
- Build a resume/reconnect path: if the worker restarts mid-generation, the sidebar UI should detect the gap and either resume the SSE from the backend (if the backend supports resumable streams) or surface "response was interrupted" rather than hanging forever.

**Warning signs:**
Generations that take >20-30 seconds start silently truncating in real-world testing but never fail in short dev prompts; DevTools "Inspect service worker" shows the worker context going gray (inactive) during an active generation.

**Phase to address:**
Phase 1 (Foundation / basic AI chat with streaming) — this is architectural, not a later polish item. Getting the streaming transport wrong here means re-architecting after content scripts and insertion already depend on it.

Sources: [Chrome for Developers — service worker lifecycle](https://developer.chrome.com/docs/extensions/develop/concepts/service-workers/lifecycle), [chromium-extensions group — execution time limits](https://groups.google.com/a/chromium.org/g/chromium-extensions/c/L3EbiNMjIGI)

---

### Pitfall 2: React/framework-controlled fields silently revert inserted text

**What goes wrong:**
Setting `.value` on an `<input>`/`<textarea>` directly, or mutating `innerHTML` on a `contenteditable`, updates the DOM but not the framework's internal state (React's fiber value, Vue's reactive ref, etc.). On the next re-render — which can be triggered by something unrelated, like the user's cursor moving or a debounce timer — the framework overwrites the DOM back to its last known state. The inserted text visibly appears for a moment, then vanishes or reverts, with no error thrown anywhere.

**Why it happens:**
This is the single most common trap in "type text into a modern web app" projects, because it works perfectly in a plain HTML `<textarea>` test page and only breaks on real target sites (LinkedIn, X, Gmail compose, Notion) which are all React/framework-driven. It's invisible in unit tests against synthetic DOM and only shows up against live sites.

**How to avoid:**
- For native inputs/textareas: use the native property setter via `Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set` (bypassing React's overridden setter), then dispatch a real `InputEvent('input', {bubbles: true})` (not a fake `Event`) so React's synthetic event system picks it up.
- For `contenteditable`: do not use `innerHTML` mutation or `execCommand` (deprecated, inconsistent). Use `document.execCommand('insertText', ...)` only as a fallback; the more robust approach is dispatching `beforeinput`/`input` `InputEvent`s with `inputType: 'insertText'` and `data`, which is what real typing produces and what modern editors (Slack, Notion, Gmail) listen for via their own controlled-model reconciliation.
- Build one adapter per editor family (plain field, contenteditable-with-InputEvents, Google Docs canvas) as already decided in PROJECT.md — do not attempt a single generic "set text" function; verified per-family behavior differs enough that a shared abstraction produces exactly this bug.
- Test insertion against the actual target sites in the acceptance criteria, not a synthetic test page. A synthetic textarea passing is not evidence of correctness.

**Warning signs:**
Text appears then disappears after ~1 render cycle; works on a plain HTML test page but fails on the real target; works when insertion is fast (before framework re-render) but fails when progressive/slow (framework catches up and reverts mid-stream).

**Phase to address:**
Phase 3 (Editor Integration) per the original spec's phase numbering — but flag now: this must be validated against 2-3 real target sites (not a mock) before the phase is called done, because "insert into a textarea" passing is not evidence "insert into Gmail" works.

Sources: [dtang.dev — contenteditable in React](https://dtang.dev/using-content-editable-in-react/), general React controlled-component behavior (MEDIUM confidence — verified pattern, but exact editor internals per site are undocumented and must be tested directly)

---

### Pitfall 3: Progressive insertion races with user typing and corrupts the document or undo stack

**What goes wrong:**
While the extension is progressively inserting text character-by-character (or chunk-by-chunk) into a field, the user keeps typing, clicks elsewhere, or the field's selection changes. The insertion logic — which typically tracks a cursor position or appends at "the end" — either inserts into the wrong location, interleaves with the user's own keystrokes, or leaves the document in a state where Ctrl+Z undoes only part of what was inserted (because each simulated keystroke may or may not register as a separate undo step depending on the target editor).

**Why it happens:**
The pacing/typing-animation feature is built and tested with the user passively watching, not actively interacting during insertion — which is exactly the scenario PROJECT.md says progressive insertion exists for (read along, then stop a bad paragraph). The failure only appears when someone actually uses it as designed: reading, deciding it's wrong, and intervening mid-stream.

**How to avoid:**
- Insertion state (position, remaining text, pause/resume/stop) must be its own state machine, independent of generation state (already a stated design decision) — but it must also independently track and react to external mutation of the target field. Before each chunk write, re-verify the target element still has focus and the cursor/selection is where insertion left it; if not, pause and surface a conflict rather than writing blindly.
- Treat "Stop" as tearing down cleanly: stop must leave the document in a coherent, single-undo-step state, not mid-word with a dangling event listener still armed.
- Where the target editor supports it, batch each visible "tick" of the typing animation as one grouped input event rather than one native keystroke per character — reduces undo-stack pollution and reduces the surface area for race conditions, while still producing the visual pacing effect.
- Explicitly test: start insertion, type into the field with the other hand (or scripted), verify no data loss and no double-content.

**Warning signs:**
Duplicated words/sentences after interrupting insertion; Ctrl+Z requiring 40 presses to undo one AI insertion; cursor jumping to the wrong location after the user clicks during insertion.

**Phase to address:**
Phase 3 (Editor Integration), specifically the progressive insertion transport controls milestone — this is the one PROJECT.md calls a "review mechanism, not an animation," so the race condition is not an edge case, it's the primary use case.

---

### Pitfall 4: Google Docs insertion breaks the moment Google ships an unannounced internal change

**What goes wrong:**
Google Docs has no meaningful DOM — it renders to `<canvas>` and accepts input only through a hidden, off-screen contenteditable/input target that dispatches synthetic keyboard events into Docs' own internal editing engine. This mechanism is unofficial and unsupported; Google has changed Docs' rendering pipeline before (the 2021 HTML→canvas migration broke every extension relying on DOM structure) with no advance notice to third parties, and can do so again at any time. There is no vendor commitment that the synthetic-keystroke approach keeps working.

**Why it happens:**
Because it's the only way to programmatically write into Docs at all, teams build against current observed behavior and treat it as a stable integration rather than what it is: reverse-engineered behavior of a closed system that can silently regress.

**How to avoid:**
- Isolate the Google Docs adapter completely from the other two (plain field, contenteditable) so a Docs breakage doesn't cascade — this is already the PROJECT.md decision ("three separate engines"), reinforce it at the code-boundary level too.
- Build a runtime self-test: on load (or first use per session), verify the hidden input target still exists at its expected selector/role and a trivial synthetic keystroke round-trips correctly, before attempting a full insertion. Fail loud and specific ("Google Docs insertion isn't working right now") rather than silently writing garbage into a user's document.
- Budget ongoing maintenance time for this adapter specifically — it is the most likely of the three to require a fix after a Google-side change, and that fix is urgent (a broken insertion into someone's real document is a trust-destroying failure, not a cosmetic bug).
- Consider clipboard-paste as a documented fallback path for Docs if synthetic keystrokes fail a self-test, even though paste loses progressive pacing — degrade gracefully rather than fail silently.

**Warning signs:**
Any Chrome or Docs version bump breaking insertion in dev without a corresponding extension code change; insertion working in some Google Workspace domains/configurations and not others (Docs behavior can vary by account type/flags).

**Phase to address:**
Phase 3 (Editor Integration) for initial build; needs to be flagged in every future roadmap phase as "verify Google Docs adapter still works" — this is a standing regression risk, not a one-time build task.

---

### Pitfall 5: Shared OpenRouter key gets scraped from the extension bundle or abused through an open backend proxy

**What goes wrong:**
Two distinct but related failure modes: (1) the API key ends up reachable from the client — hardcoded in the extension bundle, exposed via an unauthenticated debug endpoint, or logged somewhere a user can read (extension code is fully inspectable via `chrome://extensions` → "Inspect views" and unpacking the .crx) — and gets scraped and used by strangers, spending the operator's prepaid OpenRouter balance in minutes. (2) The key stays server-side correctly, but the backend proxy endpoint has weak or missing auth/quota checks, so any authenticated (or even unauthenticated) caller can hit it directly with curl and bypass the extension UI's quota logic entirely, since client-side quota display is not enforcement.

**Why it happens:**
PROJECT.md already makes the right architectural call (hosted backend, key never ships in the extension) — the risk is in execution: a debug/test endpoint left open, a quota check implemented only in the frontend (trivially bypassed), or a JWT/session validation that's easy to forge or replay. Because OpenRouter is a single key routing to dozens of models/providers, a leaked key's blast radius is larger than a single-provider key — "cheap free-tier model" abuse can pivot to expensive models if the key isn't scoped.

**How to avoid:**
- The API key lives only in backend environment config, never in any response body, log line, or client-reachable code path — verify with a bundle-inspection pass before every release (grep the built extension output for the key pattern).
- Every AI-gateway backend endpoint requires a valid authenticated session (Supabase auth token), validated server-side on every request, not just at login.
- Enforce quota **server-side**, atomically, before the OpenRouter call is made — not after, and not only in the UI. A per-user token/request counter checked-and-incremented in the same transaction as the request, so concurrent requests from one leaked or scripted session can't race past the limit.
- Set a hard per-key spend cap directly in OpenRouter's dashboard (if supported) as a backstop independent of your own code — defense in depth against a bug in your quota logic.
- Rate-limit by IP and by user on the backend gateway endpoint itself, separate from the per-user usage quota, to blunt scripted abuse even from a validly authenticated but compromised account.
- Do not expose model selection or system-prompt override from the client without server-side allow-listing — an open "pass through any prompt/model" gateway is an easy vector for someone to run unrelated workloads on your bill.

**Warning signs:**
OpenRouter dashboard usage spikes with no corresponding extension-side session activity; usage from users/sessions that never opened the sidebar; a single user's usage far exceeding what the UI could have generated in the observed session count.

**Phase to address:**
Phase 1 (Foundation) — auth and the AI gateway proxy are both first-phase work per PROJECT.md ("hosted backend with accounts from Phase 1"); quota enforcement must ship in the same phase as the first real AI call, not bolted on after beta starts.

---

### Pitfall 6: Chrome Web Store rejects or later pulls the extension over `<all_urls>` and content-reading justification, discovered only when the operator finally tries to list it

**What goes wrong:**
Because "universal" insertion means the content script must run on any page, the natural manifest choice is `"host_permissions": ["<all_urls>"]` or `"content_scripts": [{"matches": ["<all_urls>"]}]`. Google's review process specifically flags broad host permissions for manual/in-depth review, and an extension whose stated purpose doesn't obviously require every site (or whose privacy policy doesn't precisely justify it) gets rejected or delayed. Decisions baked into the manifest and data-handling architecture now (what's read from the page, what's sent to the backend, whether raw page content ever leaves the browser) are expensive to unwind later if store listing becomes a goal.

**Why it happens:**
Unlisted-beta shipping (the current ship bar) doesn't go through Chrome Web Store's public review gate the same way — items can be distributed to a handful of testers without the same scrutiny — so it's easy to defer "will this pass review" entirely and back yourself into permissions/data practices that are hard to justify later. The operator explicitly noted this: unlisted now, but decisions now determine whether store listing is possible later.

**How to avoid:**
- Write the permission justification and a real privacy policy now, even for the beta, treating `<all_urls>` as something that must be defensible in one sentence tied directly to the core value prop ("reads the active tab's editable field to insert AI-generated text; does not read or transmit page content the user didn't select"). If that sentence is hard to write honestly, the current data-handling design is the problem, not the justification copy.
- Minimize what content scripts actually read and send to the backend: only what's explicitly part of the user's context (uploaded files, selected text, the target field for insertion) — never passively scrape/transmit full page DOM or unrelated page content. This is both a store-policy requirement and the honest privacy stance.
- Keep the privacy policy specific and hosted in full text reachable from the extension itself (Chrome Web Store requires the policy be specific to the extension, not generic boilerplate, and must disclose any third parties data is shared with — Supabase, OpenRouter, Vercel all need to be named).
- Avoid any remote-code pattern that MV3 forbids: no `eval()` of remotely fetched strings, no `<script src="https://...">` pointing outside the packaged extension — this includes being careful with how the sidebar's bundled JS is built (no dynamic remote imports of executable code, even for "feature flags" or "hot config").
- Even though beta doesn't require store review, build and test the unpacked extension as if it will be reviewed — retrofitting permission minimization after users depend on broad behavior is a breaking change to ship later.

**Warning signs:**
Manifest requests broader host permissions than any single current feature needs; no privacy policy exists yet even in beta; content script code path that reads `document.body.innerText` or similar broad scraping "just in case" rather than targeted at the active input field.

**Phase to address:**
Phase 1 (Foundation), at manifest-authoring time — permission scope and data-flow design are architectural decisions, not launch-week paperwork. Revisit explicitly before any future "prepare for public store listing" milestone.

Sources: [Chrome for Developers — remote hosted code](https://developer.chrome.com/docs/extensions/develop/migrate/remote-hosted-code), [Chrome Web Store host permission in-depth review](https://extensionbooster.net/blog/chrome-extension-host-permission-in-depth-review-warning-fix-guide/), [TermsFeed — Chrome extension privacy policy requirements](https://www.termsfeed.com/blog/browser-extension-privacy-policy/)

---

### Pitfall 7: Untrusted file uploads (PDF/DOCX/image) exhaust server memory or crash the parsing pipeline

**What goes wrong:**
PDF and DOCX are compressed, structured formats with known attack patterns: decompression bombs (a small file that expands to gigabytes via chained FlateDecode streams in a malicious PDF, or a nested-zip DOCX), pathological structures that make parsers hang or allocate unbounded memory, and — for PDF specifically — embedded JavaScript/active content that some parsers execute. A single malicious or even just malformed upload from one beta user can crash or hang the backend's file-processing worker, or run up unexpected compute cost trying to OCR a garbage image.

**Why it happens:**
File parsing is usually built and tested against well-formed sample files, and the "what if this is malicious/corrupt/huge" case is deprioritized because beta users are trusted and few. But a shared backend with a shared budget means one bad upload — even accidental (a user drags in a 500-page scanned PDF) — degrades or costs money for everyone else, and pdf.js itself has documented memory-release issues under repeated use.

**How to avoid:**
- Hard size limits enforced before parsing begins, both on upload (reject at the API boundary, not after reading the whole file into memory) and on decompressed content (cap extracted text length and page/image count).
- Run parsing (PDF/DOCX/OCR) in a process/worker with a memory and time ceiling, killed and returned as a clean user-facing error on breach — never let one upload take down the whole backend process.
- Use pdf.js (or an equivalent) in a mode that disables embedded JavaScript execution; treat PDFs strictly as data, never as active content.
- Validate file type by content sniffing, not just extension/MIME header, before handing to a parser (a `.pdf` extension on a non-PDF payload should fail fast, not be handed to the PDF parser).
- OCR specifically: cap image dimensions/resolution before running Tesseract (or the cloud OCR fallback) — a deliberately huge image is a cheap way to burn CPU/time.

**Warning signs:**
A single upload causing backend memory/CPU spikes visible in Vercel/Supabase metrics; parsing requests that don't return within a normal timeframe; free-tier hosting limits (Vercel function memory/time caps) being hit by file processing specifically.

**Phase to address:**
Phase 2 (Context Processing / file uploads) per original spec phase numbering — limits and sandboxing must be in the initial implementation, since the free-tier hosting budget (Vercel, Supabase) has hard resource ceilings that a single bad file can exhaust for everyone.

Sources: [Zip bomb — Wikipedia](https://en.wikipedia.org/wiki/Zip_bomb), [PDF.js memory leak issue #20198](https://github.com/mozilla/pdf.js/issues/20198), [CVE-2024-4367 — PDF.js arbitrary JS execution](https://codeanlabs.com/2024/05/cve-2024-4367-arbitrary-js-execution-in-pdf-js/) (MEDIUM confidence on the specific PDF compression-bomb mechanism — pattern is well-established in security literature, but no single authoritative current source covers pdf.js's specific bomb resistance; treat as "assume vulnerable, mitigate defensively")

---

### Pitfall 8: Content script CSS/DOM collides with the host page, or gets destroyed on SPA navigation

**What goes wrong:**
Two related failures: (1) the sidebar's injected CSS leaks onto the host page (or vice versa) because it's injected as plain DOM without style isolation, causing visible breakage on some sites and making the extension look broken/untrustworthy; (2) target sites like Gmail, Notion, LinkedIn, X are all single-page apps that swap DOM subtrees on client-side navigation without a full page reload — an extension that injects its UI once on page load and doesn't watch for SPA route changes ends up with a sidebar that's still "attached" to a DOM node the app has since removed, silently going unresponsive until a manual page refresh.

**Why it happens:**
Easy to miss in dev because local testing tends to reload the page for every iteration, which happens to reset the extension's injection too — masking the SPA-navigation-survival bug entirely until real usage (a user navigating within Gmail without reloading) surfaces it.

**How to avoid:**
- Inject the sidebar UI inside a Shadow DOM root (`element.attachShadow({mode: 'open'})`) with its own isolated stylesheet — this is the standard, well-documented defense for both directions of CSS bleed and is worth doing from the first sidebar implementation, not retrofitted later.
- Use a `MutationObserver` on `document.body` (or a `history.pushState`/`popstate` listener, since most SPAs use the History API) to detect navigation and re-verify/re-inject the sidebar's mount point and re-bind to the current target field, rather than assuming a one-time injection survives the session.
- Test explicitly against at least one SPA target (Gmail or Notion) by navigating within the app without reloading, not just by loading the page fresh each time.
- For sites with strict CSP that blocks inline styles or certain script patterns, verify the shadow DOM + externally-loaded stylesheet approach (via `chrome.runtime.getURL` referenced in the extension's own CSP-exempt context) still renders correctly — content scripts execute in an isolated world so the page's CSP restrictions on scripts don't apply to the content script itself, but DOM-injected elements the content script creates on the page are still subject to the page's CSP for things like inline `style` attributes on some configurations, so prefer classes/stylesheets over inline styles.

**Warning signs:**
Sidebar visually broken (wrong fonts, colors, layout) only on certain sites; sidebar becomes unresponsive after navigating within a site without a full reload but works fine after a manual refresh.

**Phase to address:**
Phase 1 (Foundation / sidebar interface) for shadow DOM isolation — this is foundational, not a later fix. SPA-navigation resilience should be validated in Phase 1 for the sidebar's own persistence, and re-validated in Phase 3 when insertion needs to track the correct live target field across navigations.

Sources: [Railwaymen — Chrome extensions and Shadow DOM](https://blog.railwaymen.org/chrome-extensions-shadow-dom), [Chrome for Developers — content scripts](https://developer.chrome.com/docs/extensions/develop/concepts/content-scripts)

---

## Technical Debt Patterns

| Shortcut | Immediate Benefit | Long-term Cost | When Acceptable |
|----------|-------------------|-----------------|------------------|
| Client-side-only quota display (no server enforcement) | Faster to ship the quota UI | A leaked session or scripted call bypasses the budget entirely — direct cost exposure | Never, even in beta — the operator is personally funding usage |
| Single generic insertion function instead of 3 adapters | Less code to write initially | Silent, hard-to-debug failures on real sites (Pitfall 2); rebuild is expensive once other features depend on the interface | Never — PROJECT.md already rejected this correctly |
| Testing insertion only against a synthetic textarea page | Fast local iteration | False confidence; real target sites fail differently and the gap isn't caught until user reports | Fine for initial dev loop, never as the acceptance bar for "insertion works" |
| Injecting content script UI without Shadow DOM | Simpler CSS at first | CSS collisions surface unpredictably per-site later, expensive to retrofit shadow DOM once styling assumes global scope | Never — cost of doing it right from day one is near-zero |
| No self-test/health-check for the Google Docs adapter | Ships faster | Silent breakage after a Google-side change goes undetected until a user reports corrupted insertion into a real document | Only if beta cohort is small enough for fast manual detection, and only short-term |
| Holding SSE stream in the service worker without a port/keepalive strategy | Simpler initial streaming code | Long generations randomly truncate once the worker gets killed under real usage patterns | Never for anything beyond the shortest smoke-test prompts |

## Integration Gotchas

| Integration | Common Mistake | Correct Approach |
|-------------|----------------|-------------------|
| OpenRouter | Passing model/system-prompt straight through from client without server-side allow-listing | Backend validates/allow-lists model choice; system prompt assembly happens server-side, not client-supplied |
| Supabase Auth | Trusting a client-supplied user ID/email on backend requests instead of verifying the session token server-side | Verify the Supabase JWT on every backend request; never trust client-asserted identity |
| Supabase Storage (free tier) | Assuming free-tier storage/bandwidth limits won't be hit during beta | Set explicit per-user storage caps for uploaded files; monitor free-tier quota proactively, not after a cutoff |
| Vercel (free tier) | Long-running file-parsing/OCR jobs exceeding Vercel serverless function time/memory limits | Cap processing time/size per Pitfall 7; consider background/queued processing if OCR proves slow rather than blocking a serverless invocation |
| Chrome `chrome.storage` (sync vs local vs session) | Using `chrome.storage.sync` for conversation history/large data — it has strict per-item and total quota limits (much smaller than local) | Use `chrome.storage.local` or IndexedDB for conversation history/cached content; reserve `sync` for small user preferences only |

## Performance Traps

| Trap | Symptoms | Prevention | When It Breaks |
|------|----------|------------|-----------------|
| Service worker held alive with an always-on port for the whole session, not just during active generation | Unnecessary battery/CPU drain reported by beta users, browser flags the extension as resource-heavy | Open the keepalive port only for the duration of an active stream; let the worker idle out normally between generations | Noticeable once a handful of users leave the sidebar open all day |
| Progressive insertion firing one full synthetic event per character with no batching | Sluggish UI, high CPU on the host page, occasional dropped frames on slower machines during "typing" animation | Batch multiple characters per animation tick even at slow pacing settings; the visual effect doesn't require one DOM event per character | Immediately on longer generations at slow pacing (which is the setting the read-along feature specifically encourages) |
| Full conversation history resent as context on every request with no trimming/summarization | Token cost and latency grow with every message in a long session | Cap context window sent per request; summarize or truncate older turns once a session gets long | Any session that runs past a handful of back-and-forth turns |
| OCR run synchronously in the request/response cycle | Sidebar hangs/spinner during large-image OCR, serverless function timeout risk | Treat OCR as inherently slow; show progress state, consider async/polling pattern rather than blocking one request | As soon as a beta user uploads a full-page scanned document instead of a small screenshot |

## Security Mistakes

| Mistake | Risk | Prevention |
|---------|------|------------|
| API key reachable from any client-inspectable path (bundle, response body, console log) | Full budget drained by a scraped key within minutes | Server-only key storage; grep built bundle for the key pattern before every release; never echo the key in error responses |
| No server-side rate limiting on the AI gateway, only client-side "polite" throttling | Scripted abuse of a valid or leaked session bypasses UI-layer throttling entirely | Enforce rate limits and quota atomically server-side, independent of what the client claims |
| Content script reads/transmits full page content by default "for context" rather than only user-selected material | GDPR exposure (processing personal data on pages users didn't intend to share) and Store-policy violation | Explicit, minimal, user-initiated data collection only — page content is read/sent only when the user actively includes it as context |
| PDF parser executes embedded JavaScript/active content | Remote code execution risk from a malicious uploaded PDF | Use a parser configuration/library mode that disables active content execution; treat all uploads as pure data |
| No file type/content validation before parsing | Malformed or disguised files crash or hang the parsing worker | Content-sniff and validate before handing to a parser; enforce size caps before decompression |

## UX Pitfalls

| Pitfall | User Impact | Better Approach |
|---------|-------------|-------------------|
| Insertion fails silently (text vanishes, no error) when a framework reverts the DOM write | User doesn't know if it worked, may re-trigger insertion and duplicate content, loses trust in the "it lands correctly" core value prop | Verify the DOM actually reflects the inserted text after the write (read back and compare) before declaring success; surface a clear error/retry if verification fails |
| Progressive insertion has no visible pause/stop affordance while it's happening | Defeats the entire stated purpose (read along, stop mid-flow) if controls aren't obviously reachable during insertion | Transport controls must be persistently visible and reachable the whole time insertion is running, not buried in a menu |
| Generic "something went wrong" errors for insertion failures across three totally different failure classes (plain field, contenteditable, Docs) | User can't tell if it's a target-site problem, a network problem, or a bug, and can't self-recover | Error messages differentiate by adapter/failure class ("Couldn't write into this Google Doc — try again or use copy instead") with a fallback action (copy-to-clipboard) always available |
| Quota exhaustion surfaces only as a failed generation with no warning | User burns their session not knowing they were close to the limit, feels the product is broken rather than rate-limited | Show remaining quota proactively in the sidebar before it's exhausted |

## "Looks Done But Isn't" Checklist

- [ ] **Streaming AI chat:** Often missing resilience to service-worker termination mid-stream — verify by generating a long response and leaving the tab idle/backgrounded during it, not just a short happy-path prompt.
- [ ] **Text insertion into contenteditable:** Often missing verification that the framework-controlled field actually retains the text after its next re-render — verify by inserting, waiting a beat, and checking the DOM again, not just checking immediately after the write.
- [ ] **Progressive insertion pause/stop:** Often missing correct behavior when the user types into the target field mid-insertion — verify by interacting with the field during an active progressive insertion, not just letting it run untouched.
- [ ] **Google Docs insertion:** Often missing a self-test/health-check and an honest failure path — verify by simulating the hidden-input-target selector being wrong (e.g., testing on an unusual Docs view/mode) and confirming it fails loud, not silently corrupting the document.
- [ ] **File upload processing:** Often missing size/type limits and sandbox enforcement — verify by uploading an oversized file and a deliberately malformed file, not just a well-formed sample PDF.
- [ ] **Per-user quota:** Often missing server-side, race-safe enforcement — verify by firing concurrent requests from one session near the quota boundary and confirming the limit actually holds.
- [ ] **Sidebar injection:** Often missing Shadow DOM isolation and SPA-navigation resilience — verify by testing on a real SPA target (Gmail/Notion) with in-app navigation, not a static test page.
- [ ] **Privacy policy / permissions:** Often missing entirely during beta because it "isn't required yet" — verify a policy exists and every host permission requested is 1-sentence-justifiable against it, even for unlisted beta.

## Recovery Strategies

| Pitfall | Recovery Cost | Recovery Steps |
|---------|----------------|------------------|
| Service worker kills a long generation mid-stream | LOW | Persist partial chunks to storage as they arrive; on worker restart, detect the incomplete session and offer resume/retry rather than losing it entirely |
| Framework reverts an inserted DOM write | MEDIUM | Implement post-write verification (read back and compare) and auto-retry once via the InputEvent path before surfacing failure to the user |
| Google Docs adapter breaks after a Google-side change | HIGH | Requires investigation of the new hidden-input-target behavior and adapter rework; mitigate impact with the self-test + clipboard-paste fallback so users aren't silently blocked while a fix ships |
| Leaked API key drains the shared budget | HIGH (financial + trust) | Rotate the key immediately, set/lower the OpenRouter dashboard spend cap, audit backend logs for the abuse window, patch the leak path before re-enabling |
| A malicious/malformed upload crashes the file-processing worker | LOW | Process files in an isolated worker with a crash boundary; a crash there should degrade to "this file couldn't be processed," not take down the backend |

## Pitfall-to-Phase Mapping

| Pitfall | Prevention Phase | Verification |
|---------|-------------------|----------------|
| Service worker termination mid-stream | Phase 1 | Generate a long response, background the tab mid-generation, confirm it completes or fails gracefully rather than hanging |
| React/contenteditable reverting inserted text | Phase 3 | Insert into 2-3 real target sites (not synthetic), wait a full render cycle, confirm text persists |
| Progressive insertion race with user typing | Phase 3 | Actively type into the target field during an in-progress progressive insertion; confirm no data loss/duplication and a clean undo state |
| Google Docs adapter fragility | Phase 3 (build) + every future phase (verify) | Self-test on load; manual smoke test against current Docs before each release |
| Shared API key / proxy abuse | Phase 1 | Attempt to call the AI gateway endpoint directly (curl, no extension) with and without a valid session; confirm it's rejected/rate-limited correctly |
| Chrome Web Store permission/privacy exposure | Phase 1 (manifest + policy authored) | Write the one-sentence permission justification before writing the manifest; if it can't be written honestly, narrow the permission first |
| Malicious/oversized file uploads | Phase 2 | Upload an oversized file and a deliberately malformed PDF/DOCX; confirm graceful rejection, not a crash or hang |
| Content script CSS bleed / SPA navigation loss | Phase 1 (sidebar) + Phase 3 (insertion target tracking) | Load sidebar on a real SPA (Gmail/Notion), navigate in-app without reload, confirm sidebar and insertion target tracking survive |

## Sources

- [Chrome for Developers — The extension service worker lifecycle](https://developer.chrome.com/docs/extensions/develop/concepts/service-workers/lifecycle) — HIGH confidence, official docs
- [Chrome for Developers — Deal with remote hosted code violations](https://developer.chrome.com/docs/extensions/develop/migrate/remote-hosted-code) — HIGH confidence, official docs
- [Chrome for Developers — Content scripts](https://developer.chrome.com/docs/extensions/develop/concepts/content-scripts) — HIGH confidence, official docs
- [ExtensionBooster — host permission in-depth review](https://extensionbooster.net/blog/chrome-extension-host-permission-in-depth-review-warning-fix-guide/) — MEDIUM confidence, third-party but consistent with official policy language
- [TermsFeed — Privacy Policy for Browser Extensions](https://www.termsfeed.com/blog/browser-extension-privacy-policy/) — MEDIUM confidence, third-party legal-adjacent guidance, not a law firm source
- [Railwaymen — Chrome Extensions and Shadow DOM](https://blog.railwaymen.org/chrome-extensions-shadow-dom) — MEDIUM confidence, community best-practice writeup
- [dtang.dev — Using contenteditable in React](https://dtang.dev/using-content-editable-in-react/) — MEDIUM confidence, widely-corroborated pattern
- [Google Workspace Updates — Docs canvas-based rendering](https://workspaceupdates.googleblog.com/2021/05/Google-Docs-Canvas-Based-Rendering-Update.html) — HIGH confidence for the historical precedent (Google shipped a breaking rendering change with notice-but-short-runway); used here as evidence of ongoing fragility risk, not current API detail
- [Mozilla pdf.js GitHub issue #20198 — memory leak](https://github.com/mozilla/pdf.js/issues/20198) — HIGH confidence, primary source
- [CVE-2024-4367 — Arbitrary JS execution in PDF.js](https://codeanlabs.com/2024/05/cve-2024-4367-arbitrary-js-execution-in-pdf-js/) — HIGH confidence, documented CVE
- [Wikipedia — Zip bomb](https://en.wikipedia.org/wiki/Zip_bomb) — HIGH confidence, general mechanism reference
- [Obsidian Security — Browser extensions stealing API keys](https://www.obsidiansecurity.com/blog/small-tools-big-risk-when-browser-extensions-start-stealing-api-keys) — MEDIUM confidence, vendor blog but consistent with well-known key-leak patterns

---
*Pitfalls research for: Chrome MV3 AI writing-assistant extension with universal text insertion*
*Researched: 2026-08-05*
