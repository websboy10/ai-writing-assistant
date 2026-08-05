# Universal AI Writing Assistant (Browser Extension)

## What This Is

A Chrome extension that puts an AI writing assistant in a collapsible sidebar on
any webpage. Users feed it context — PDFs, Word documents, pasted text,
screenshots, images — ask it to draft, rewrite, summarize, translate or explain,
then watch the result land directly in whatever editor they're already in, at a
pace they control and can stop at any moment.

It is aimed at people who write inside web apps all day — email, documents,
social posts, CMSes — and are tired of the copy-paste round trip through a
separate chat tab. Built as a public product: hosted backend, user accounts, and
eventually a subscription.

## Core Value

**Generated text lands correctly in the editor the user is already in, arriving
at a pace they can read along with and stop mid-flow.** Everything else — the
uploads, the OCR, the prompt library — is in service of that moment.

## Requirements

### Validated

(None yet — ship to validate)

### Active

- [ ] Sidebar workspace injected on any page, collapsible, resizable, keyboard-shortcut and floating-button triggered, light/dark
- [ ] Conversational AI chat with streaming responses and session-scoped memory
- [ ] Structured prompt assembly from discrete sections (system, request, context, history, style, format)
- [ ] Text insertion into plain inputs and textareas
- [ ] Text insertion into contenteditable rich-text editors (LinkedIn, X, Slack, Gmail, Notion, CMSes)
- [ ] Text insertion into Google Docs via synthetic keystrokes
- [ ] Progressive insertion with live transport controls — pause, resume, stop, undo — and configurable pacing
- [ ] Instant insertion and copy-to-clipboard as alternatives
- [ ] Generated response is editable in the sidebar before insertion
- [ ] File upload and text extraction: PDF, DOCX, TXT, Markdown
- [ ] Image upload and screenshot capture with OCR text extraction
- [ ] Context manager combining multiple sources into one structured prompt
- [ ] User accounts with email/password and Google OAuth
- [ ] Per-user usage quotas to protect the shared API budget
- [ ] LLM provider abstraction, defaulting to OpenRouter with a configurable model
- [ ] Conversation history persisted across sessions
- [ ] Prompt templates for the common operations (summarize, rewrite, expand, simplify, translate, explain, continue)

### Out of Scope

- **Billing, subscriptions, payment processing** — v1 ships to a handful of beta
  users on the operator's own OpenRouter key. Quotas prevent overrun; Stripe is a
  post-validation concern.
- **Firefox and Safari** — separate manifests, API shims and (for Safari) an
  Xcode wrapper and App Store review. Chrome-only until the product is proven.
- **Code editors (Monaco, CodeMirror)** — each needs its own adapter and they are
  not where this product's users write prose.
- **Multi-document reasoning, knowledge collections, citation generation** — Phase
  5 material in the original spec; deferred until single-document context works.
- **Handwriting OCR** — printed-text OCR only. Handwriting accuracy is poor
  enough to damage trust in the context pipeline.
- **Team/collaboration features, shared workspaces** — single-user product first.

## Context

**Origin.** Built from a complete written specification (`docs/SPEC-initial.md`)
that laid out features, architecture and a five-phase roadmap. Questioning
narrowed a very broad spec to a shippable v1 and surfaced the decisions the spec
left open — target sites, audience, cost model and what "done" means.

**The hard part is insertion, not AI.** Web editors are hostile to programmatic
text entry in three distinct ways. Plain `input`/`textarea` elements accept value
assignment but need synthetic `input` events for React-controlled fields.
`contenteditable` editors (Slack, LinkedIn, Notion, Gmail) maintain their own
internal document models and ignore direct DOM mutation — they need
`beforeinput`/`InputEvent` or paste-event simulation, and each behaves slightly
differently. Google Docs renders to a `<canvas>` with no meaningful DOM at all
and requires dispatching synthetic keyboard events at its hidden input target.
These are three separate engines, not one with options.

**Progressive insertion is a review mechanism, not an animation.** The user
chose it so they can read text as it arrives and kill a bad paragraph before it
finishes. That makes pause/stop/undo mandatory and makes speed a comfort setting
rather than a disguise. Insertion state must be independent of AI generation —
generation can finish long before insertion does, and stopping insertion must not
abort the response.

**Cost model is deliberately staged.** OpenRouter with free/cheap models to
start, because it exposes dozens of models behind one API and the default can
change in config rather than code. The long-term intent is a subscription, but
v1's economic protection is per-user quotas, not payment.

**Free models are individually unreliable.** Verified 2026-08-05 against the live
OpenRouter key: of the free models tested, one answered cleanly and another
returned HTTP 429 on a first, single request. Free tiers are shared and
congested. The provider layer therefore needs an ordered fallback chain and
transparent retry, not one configured default — a beta user hitting silence
because one upstream was busy will assume the product is broken.

**Deferred but designed for.** The provider abstraction, quota accounting and
context pipeline should be built so that adding a second provider, a paid tier,
or multi-document reasoning is additive — but none of those are built now.

## Constraints

- **Platform**: Chrome, Manifest V3 — service worker background, no persistent
  background page, strict CSP in extension pages. Rules out several common
  bundling and eval-based patterns.
- **Tech stack**: React + TypeScript + Vite + Tailwind for the extension UI;
  Node + TypeScript backend; PostgreSQL + Prisma. Specified by the operator up
  front.
- **Managed services**: Supabase provides PostgreSQL, authentication and file
  storage; Vercel hosts the backend. Both on free tiers — beta must cost nothing
  to run.
- **AI provider**: OpenRouter, cheapest/free models initially, behind a provider
  abstraction so the model is a config value.
- **Budget**: Shared API key funds all beta usage. Per-user quotas are a
  correctness requirement, not a feature.
- **Ship bar**: A handful (10–50) of real beta users on a hosted backend, giving
  feedback. Not a store listing, not a paying customer.
- **Operator is non-technical** — planning docs, progress reports and decisions
  must lead with plain language and business consequence before mechanism.

## Key Decisions

| Decision | Rationale | Outcome |
|----------|-----------|---------|
| Chrome only for v1 | Firefox/Safari cost a parallel manifest, API shims and store review per feature; prove the product first | — Pending |
| Universal insertion, including Google Docs | Insertion is the core value; restricting to easy fields would gut the differentiator | — Pending |
| Three insertion adapters, not one generic engine | Plain fields, contenteditable and canvas-based Docs fail in genuinely different ways; a single abstraction would be a lie | — Pending |
| Progressive insertion has transport controls | User's stated reason is reading along and stopping bad output — a speed slider alone doesn't deliver that | — Pending |
| Insertion decoupled from generation | Stopping insertion must not abort the LLM response, and vice versa | — Pending |
| OpenRouter as the provider | One API, many models, swap the default in config not code; free tier covers beta | — Pending |
| No billing in v1 | Beta users on the operator's key; quotas provide the economic protection billing would | — Pending |
| Hosted backend with accounts from Phase 1 | The API key cannot ship inside a public extension, so a backend proxy is required from the first AI call | — Pending |
| Code editors deferred | Monaco/CodeMirror each need bespoke adapters and aren't where prose gets written | — Pending |
| Supabase for auth, database and storage | One free service replaces hand-built accounts, sessions, password reset and S3; removes security-sensitive work with no upside to owning. PostgreSQL and Prisma unchanged | — Pending |
| Private GitHub repo under `websboy10` | Commercial product; repo carries configuration detail not worth indexing | — Pending |
| Ordered model fallback chain, not a single default | Free OpenRouter models 429 unpredictably; verified live on day one. Silence reads as a broken product | — Pending |

## Evolution

This document evolves at phase transitions and milestone boundaries.

**After each phase transition** (via `/gsd-transition`):
1. Requirements invalidated? → Move to Out of Scope with reason
2. Requirements validated? → Move to Validated with phase reference
3. New requirements emerged? → Add to Active
4. Decisions to log? → Add to Key Decisions
5. "What This Is" still accurate? → Update if drifted

**After each milestone** (via `/gsd:complete-milestone`):
1. Full review of all sections
2. Core Value check — still the right priority?
3. Audit Out of Scope — reasons still valid?
4. Update Context with current state

---
*Last updated: 2026-08-05 after initialization*
