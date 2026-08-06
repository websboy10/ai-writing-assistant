---
phase: 07-autonomous-mode-answer-every-question-in-a-document
plan: 01
subsystem: extension — Google Docs API auth + Find-positioning spike
tags: [google-docs, oauth, chrome-identity, spike, autonomous-mode]
dependency-graph:
  requires: []
  provides:
    - "docs-auth/docs-get/docs-batch-update one-shot message kinds (background.ts)"
    - "insertion/autonomous/docs-find.ts — findAndPlaceCursor()"
    - "chrome-extension://<id>/spike.html — four-probe runner"
  affects:
    - "plan 07-05 (the Google Docs path) — BLOCKED until 07-SPIKE.md carries a verdict (Task 3, not run)"
tech-stack:
  added: []
  patterns:
    - "conditional-manifest spread for oauth2, mirroring the existing isLocalBackend/host_permissions pattern"
    - "committed OAuth-client-ID fallback constant instead of env-only, because the value is not a secret"
key-files:
  created:
    - apps/extension/insertion/autonomous/docs-find.ts
    - apps/extension/entrypoints/spike/index.html
    - apps/extension/entrypoints/spike/main.ts
  modified:
    - apps/extension/utils/protocol.ts
    - apps/extension/wxt.config.ts
    - apps/extension/entrypoints/background.ts
    - apps/extension/entrypoints/content/index.tsx
    - docs/GOOGLE-SETUP.md
decisions:
  - "Committed the operator-supplied Chrome Extension client ID as a fallback constant in wxt.config.ts (not left env-only) — apps/extension/.env is gitignored, and an ID that only lives in an untracked dotfile would silently ship an empty client_id in any other checkout or CI run. Not a secret: Chrome Extension OAuth clients have none, and the ID is public inside the built manifest regardless."
  - "Renumbered GOOGLE-SETUP.md's existing 'Step 6.5' (already covering the second-client creation, added earlier the same day) to 'Step 8' per the plan's acceptance grep, and rewrote Step 7 to remove the superseded 'hold on to the Google token on the backend' promise."
  - "P3's ASCII vs æøå split in the spike page is derived automatically from whatever the real document contains (longest-ASCII-prefix paragraph vs first paragraph containing æ/ø/å), not from two hardcoded manual fields, so the probe works against any test document the operator creates, not just the one literally described in the checkpoint."
metrics:
  duration: "~50 min"
  completed: "2026-08-06"
---

# Phase 7 Plan 01: Docs API token plumbing + Find-positioning spike (Tasks 1-2) Summary

Wired a second, secret-less Chrome Extension OAuth client into the extension for Google
Docs API access, with granular-consent-safe token handling that never lets a partial grant
look like success — plus a standalone spike page that runs the four probes needed to prove
or disprove Find-based cursor positioning against a real Google Doc. Task 3 (the operator
actually running the spike and recording a GO/NO-GO verdict) was intentionally NOT executed
— it requires a real Google account signed into a real Google Doc, and this project has a
standing rule that a browser is never driven without the operator's explicit permission.

## Tasks Completed

### Task 1: Token plumbing — a second OAuth client, granular-consent-safe — DONE

- `apps/extension/utils/protocol.ts`: added `DocsParagraph`, `DOCS_SCOPE`, and three
  `OneShotRequest` kinds — `docs-auth`, `docs-get`, `docs-batch-update`.
- `apps/extension/wxt.config.ts`: added a committed fallback constant for the OAuth client
  ID (see Deviations) and an `oauth2` manifest key, included only when the ID is non-empty
  — the same conditional-spread pattern already used for `host_permissions`/`isLocalBackend`,
  so an empty `client_id` can never ship.
- `apps/extension/entrypoints/background.ts`: added a `docsAuth()` helper wrapping
  `chrome.identity.getAuthToken({ interactive, enableGranularPermissions: true })`, handling
  both the modern `{ token, grantedScopes }` shape and the bare-string shape older Chrome
  resolves. A `grantedScopes` list present but missing `DOCS_SCOPE` calls
  `removeCachedAuthToken` and returns 403 — never treated as success. `docs-get` walks
  `body.content` into one `DocsParagraph` per non-empty paragraph, retries once on a stale
  401, and maps 403/404 to a message naming the signed-in Chrome profile. `docs-batch-update`
  posts to `:batchUpdate` and maps 429 to a specific rate-limit message. The token is never
  logged, returned to a caller, or written to `chrome.storage` (T-07-01).
- `docs/GOOGLE-SETUP.md`: rewrote Step 7 to remove the superseded "hold on to the Google
  token and refresh it on the backend" promise (D-17 replaced it — Supabase never refreshes
  provider tokens, and making that work would have put Google's client secret on the
  backend). Renumbered the existing second-client-creation instructions (added earlier the
  same day as "Step 6.5") to Step 8, matching the plan's click-by-click spec.

Verified: `pnpm --filter extension typecheck` exits 0; `pnpm --filter extension build` exits
0; the built `manifest.json` contains `oauth2.client_id` = the operator-supplied ID and
`oauth2.scopes` = `["https://www.googleapis.com/auth/documents"]`. All grep acceptance
criteria pass (see Self-Check).

### Task 2: The spike page and the Find-positioning probe — DONE

- `apps/extension/insertion/autonomous/docs-find.ts`: `findAndPlaceCursor(questionText)`
  dispatches a platform-detected Ctrl/Cmd+F at the Docs event target, polls up to 2000ms for
  `FIND_INPUT_SELECTOR`, sets the find-bar value via the native-setter + `InputEvent` trick
  (`PlainAdapter.setValue`'s technique, needed because Docs' find box is
  framework-controlled), presses Enter, confirms the cursor moved through
  `GDocsAdapter.hasSelection()` (the existing hidden-mirror read channel — reused, not
  rewritten), then closes the find bar with Escape. Every failure path returns a specific
  `reason`; no branch returns `ok: true` on a timeout.
- `apps/extension/entrypoints/spike/` (index.html + main.ts): a WXT page reachable only at
  `chrome-extension://foidkbeinmfolejjjfjcokmmknimohof/spike.html`, not linked from the
  sidebar. One URL field, one "Kør spike" button, runs P1 (`docs-auth`, interactive) → P2
  (`docs-get`, prints paragraph count + first 3 with indices) → P3 twice (Find + type
  `⟪AWA-SPIKE⟫` via the docs.google.com tab, then re-reads and reports the character
  distance between the question's `endIndex` and the marker's position) → P4
  (`docs-batch-update` insert + a bottom-up two-marker cleanup delete, proving the fallback
  write path independently). Prints a plain-text report with a "Kopiér rapport" button.
- `apps/extension/entrypoints/content/index.tsx`: added an `awa-docs-spike` message
  listener, guarded to `location.host === 'docs.google.com'`, that calls
  `findAndPlaceCursor`, then `GDocsAdapter.prepare()` and one `insert()` of the marker
  string, reporting which stage failed if any did.

Verified: `pnpm --filter extension typecheck` exits 0; `pnpm --filter extension build`
produces `.output/chrome-mv3/spike.html`; all grep acceptance criteria pass.

### Task 3: Operator runs the spike — GO/NO-GO verdict — NOT DONE, AWAITING OPERATOR

This is `type="checkpoint:human-action"` with `gate="blocking-human"`. It requires:
- A real Google account signed into a real Chrome profile.
- A real Google Doc with real content.
- Driving a real, unpacked Chrome extension load and clicking through Google's consent
  screen — including running the flow once with the `documents` permission unticked, to
  prove a partial grant is reported as a refusal.

None of this is possible for an automated agent to do faithfully, and this project has a
standing rule (echoed explicitly in this plan's own checkpoint) that a browser is never
driven without the operator's explicit permission. `07-SPIKE.md` was **not** created — its
acceptance criteria require a `VERDICT: GO|NO-GO` line backed by an actual run, which does
not exist yet. **Plan 07-05 remains blocked** until the operator runs the spike and a
verdict is recorded (D-16a is a hard gate, stated twice in the plan).

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 3 - Blocking issue] `chrome.identity.getAuthToken`'s TypeScript types don't
model `enableGranularPermissions` or the dual return shape**
- **Found during:** Task 1, `pnpm --filter extension typecheck`
- **Issue:** `@types/chrome@0.0.287`'s `TokenDetails` interface has no
  `enableGranularPermissions` field (excess-property error on the literal), and its Promise
  overload of `getAuthToken` only declares the modern `{ token, grantedScopes }` return
  shape — not the bare-string shape the plan explicitly requires handling for older Chrome.
- **Fix:** Built the details object as a separately-typed `const` (not an inline literal) so
  no excess-property check fires, then cast the awaited result through `unknown` before
  narrowing it by hand at runtime against both shapes. Documented both gaps with a comment
  at the call site so a future `@types/chrome` upgrade doesn't leave dead defensive code
  unexplained.
- **Files modified:** `apps/extension/entrypoints/background.ts`
- **Commit:** 899d5c0

**2. [Rule 2 - Missing critical functionality] GOOGLE-SETUP.md's Step 7 promised a path
D-17 explicitly rejected**
- **Found during:** Task 1, `<read_first>` for GOOGLE-SETUP.md
- **Issue:** Step 7 said "I ... hold on to the Google token" from Supabase sign-in and
  refresh it on the backend — the exact approach D-17 replaced, because Supabase does not
  refresh provider tokens and making it work would put the Google client secret on the
  backend server, contradicting Step 6's promise to the operator.
- **Fix:** Rewrote Step 7 to describe the actual D-16/D-17 flow (extension-side token via a
  second OAuth client, one API read, local Find-driven typing), stated in one plain sentence
  why the old plan changed, per the plan's explicit instruction.
- **Files modified:** `docs/GOOGLE-SETUP.md`
- **Commit:** 899d5c0

### Operator-directed deviation (not a bug, a routing decision made per the operator's
explicit supplied instruction)

**Committed the OAuth client ID instead of routing it through `apps/extension/.env`.**
`.env` is gitignored (root `.gitignore` line 3). The operator explicitly instructed: since
the Chrome Extension client ID is not a secret (no client secret exists for this client
type, and the ID ships inside the public manifest regardless of how it reaches the build),
prefer a committed value over an untracked `.env` — an env-only value would silently produce
a manifest with an empty `client_id` on any checkout or CI run lacking that dotfile, which
the plan itself calls worse than shipping no `oauth2` block at all. Implemented as:
`process.env.VITE_GOOGLE_DOCS_CLIENT_ID || '<committed fallback>'` in `wxt.config.ts`, so a
future rotation via env var still overrides the committed default without a code change.

## Verification Evidence

```
$ pnpm --filter extension typecheck
$ tsc --noEmit
(exit 0, no output)

$ pnpm --filter extension build
WXT 0.20.27
✔ Built extension in 297-327ms
  ├─ .output/chrome-mv3/manifest.json   1.42 kB
  ├─ .output/chrome-mv3/spike.html      2.09 kB
  ├─ .output/chrome-mv3/background.js   9.25 kB
  ├─ .output/chrome-mv3/chunks/spike-*.js  5.32 kB
  ...
✔ Finished

$ python3 -c "import json; d=json.load(open('.output/chrome-mv3/manifest.json')); print(d['oauth2'])"
{'client_id': '508090872713-v9u4q1seerj9ohlsqppfer80n0aatd0k.apps.googleusercontent.com',
 'scopes': ['https://www.googleapis.com/auth/documents']}
```

Grep acceptance criteria (all pass):
- `getAuthToken` in background.ts: 2 occurrences
- `grantedScopes` in background.ts: 7 occurrences
- `auth/drive` anywhere in apps/extension: 0 occurrences (scope never widened)
- `docs-auth|docs-get|docs-batch-update` in protocol.ts: 4 occurrences
- `data: { token` in background.ts: 0 occurrences (token never returned to a caller)
- `Chrome Extension` in GOOGLE-SETUP.md: 3 occurrences; `Step 8|Trin 8`: 2 occurrences
- `hold on to the Google token` in GOOGLE-SETUP.md: 0 occurrences (superseded promise gone)
- `docs-find.ts` exports `findAndPlaceCursor` and `FIND_INPUT_SELECTOR`
- `hasSelection` in docs-find.ts: 3 occurrences
- No `ok: true` on any early/timeout branch in docs-find.ts — the single `{ ok: true }`
  return is the final line, reached only after `GDocsAdapter.hasSelection()` confirms the
  selection moved
- `.output/chrome-mv3/spike.html` exists after build

### Not run: `pnpm verify` (E2E suite, Playwright)

The plan's overall `<verification>` block asks for `pnpm verify` to still pass 33/33.
**Not run** — it drives a real Chromium instance via Playwright, and this environment
operates under a standing rule that a browser is never driven without the operator's
explicit permission (the same rule this plan's own Task 3 checkpoint invokes). None of this
plan's changes touch the code paths `pnpm verify` exercises (sidebar insertion flows,
existing adapters) — the new surface (`docs-auth`/`docs-get`/`docs-batch-update`,
`docs-find.ts`, `spike.html`) is additive and unreached by the existing suite. Recommend the
operator run `pnpm verify` themselves, or explicitly authorize it, before treating this as
fully verified.

## Known Stubs

None. `docs-find.ts` and the spike page are exploratory/probe code by design (per the plan),
not stubs — every code path either does the real thing against the real Docs API/DOM or
returns a specific failure reason. No hardcoded empty values, no "coming soon" placeholders.

## Threat Flags

None beyond what the plan's own threat model already covers (T-07-01 through T-07-05,
T-07-SC). No new network endpoints, auth paths, or schema changes were introduced outside
what Task 1/2 were scoped to build.

## Self-Check: PASSED

Files:
- FOUND: apps/extension/utils/protocol.ts
- FOUND: apps/extension/wxt.config.ts
- FOUND: apps/extension/entrypoints/background.ts
- FOUND: apps/extension/insertion/autonomous/docs-find.ts
- FOUND: apps/extension/entrypoints/spike/index.html
- FOUND: apps/extension/entrypoints/spike/main.ts
- FOUND: apps/extension/entrypoints/content/index.tsx
- FOUND: docs/GOOGLE-SETUP.md
- FOUND: apps/extension/.output/chrome-mv3/spike.html (build artifact)
- CONFIRMED MISSING (correctly): .planning/phases/07-autonomous-mode-answer-every-question-in-a-document/07-SPIKE.md — Task 3 not executed, per instructions

Commits:
- FOUND: 899d5c0 — feat(07-01): Docs API token plumbing behind granular-consent checks (D-16, D-17)
- FOUND: 468719f — feat(07-01): Find-positioning probe and four-probe spike page (D-16, D-16a)
