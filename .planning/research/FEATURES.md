# Feature Research

**Domain:** AI writing-assistant browser extensions (sidebar/chat-in-page category)
**Researched:** 2026-08-05
**Confidence:** MEDIUM — competitive landscape and complaint patterns are well-evidenced via multiple independent reviews (G2, Trustpilot, Product Hunt, Chrome Web Store review pages); insertion-engine internals are LOW-MEDIUM confidence because vendors don't document their DOM/canvas techniques and the evidence is inferred from adjacent "auto-typer" tooling rather than Grammarly/Merlin/Sider source.

## Competitive Landscape Summary

Six products were reviewed for this domain: **Grammarly** (grammar/rewrite, browser + desktop + Office), **Compose AI** (lightweight autocomplete extension, largely abandoned), **Merlin** (ChatGPT-in-browser, Cmd+M launcher), **Sider** (multi-model sidebar, "chat with all AI"), **HARPA AI** (automation + AI copilot, most feature-dense), **MaxAI.me** (quick actions across sites), **Monica** (all-in-one AI assistant, high Chrome Web Store rating). None of these is a close analog to this project's core bet — a transport-controlled, pace-readable insertion engine — which is a genuine gap in the market as observed, not just claimed.

**What every one of them ships:** a sidebar or popup chat UI, streaming responses, "use on any website" positioning, one-click actions on selected text, and *some* form of insert-into-page. None publicly document a robust three-engine insertion architecture (plain fields / contenteditable / canvas). Insertion in the reviewed products appears to lean on `execCommand('insertText')`, clipboard simulation, or direct DOM writes — techniques that break on React-controlled inputs and are silent about Google Docs specifically. This absence, not a documented failure, is the strongest evidence that insertion is underbuilt across the category.

**What every one of them gets complaints about:** billing/refund handling, "unlimited" claims that turn out limited, support unresponsiveness, and — recurring across at least four of six — **reliability regressions after updates** and **broken/flaky states with no error surfaced to the user**. This is the single most consistent signal in the research: users don't primarily complain that the AI is bad, they complain that the *product breaks silently* (extension won't load, credits vanish with no output, features stop working post-update). That is a direct pointer to what this project's PITFALLS and UX should treat as existential risk: silent failure in the insertion path is worse than a slow response.

## Feature Landscape

### Table Stakes (Users Expect These)

| Feature | Why Expected | Complexity | Notes |
|---------|--------------|------------|-------|
| Sidebar/panel injected on any page, toggle via keyboard shortcut and floating button | Every competitor offers this as the primary entry point; users expect it to appear instantly, not after a page reload | LOW | Already in PROJECT.md scope. Content-script injection is a solved MV3 pattern. |
| Streaming AI responses | All six competitors stream; a non-streaming response reads as broken/slow in 2026 | LOW | Table stakes, already scoped. |
| Copy-to-clipboard as a fallback to insertion | Every competitor has this because insertion is the failure-prone part; it's the escape hatch when insertion doesn't work on a given site | LOW | Cheap and de-risks insertion bugs — ship this alongside insertion, not after. |
| Prompt templates for common ops (summarize, rewrite, expand, simplify, translate, explain) | This is the baseline expectation of "AI writing assistant" — Grammarly's Rewrite, Merlin/Sider/Monica's quick actions all ship this | LOW | Already scoped. Keep the template list short at launch (6-8), competitors bloat this and it doesn't move retention. |
| Editable response before it's used | Users assume the AI draft is a starting point, not final; Grammarly, Merlin, all sidebar tools let you edit in-panel first | LOW | Already scoped. |
| Session-scoped conversation memory | Table stakes for a "workspace," not a one-shot tool; every competitor keeps a running thread | LOW | Already scoped. |
| Light/dark theme matching host OS/browser | Minor but consistently present; its absence reads as an unfinished product in reviews of competing extensions | LOW | Cheap, don't skip. |
| Basic error visibility (request failed, quota exceeded, retry) | The dominant complaint across Merlin, HARPA, MaxAI, Monica is *silent* failure — spinner forever, credits gone, no explanation | LOW-MEDIUM | This is table stakes precisely because competitors fail at it. Treat visible, specific error states as a launch requirement, not a nice-to-have. |
| Working on the top web-app editors (Gmail, LinkedIn, Slack, Google Docs, Notion) | This IS the product category; an "AI writing assistant" that only works in plain textareas is a different, lesser product | MEDIUM-HIGH | Already scoped as three insertion adapters. This is where competitors are weakest — see Differentiators. |
| Reasonably minimal, justified permissions with a privacy policy | Chrome Web Store enforcement tightened August 1, 2026: any data collection must map to a disclosed single purpose, and undisclosed post-install changes to data handling are now a removal trigger | LOW-MEDIUM | Not a user-facing "feature" but a submission-blocking requirement — see Anti-Features/Store Realities below. |

### Differentiators (Competitive Advantage)

| Feature | Value Proposition | Complexity | Notes |
|---------|-------------------|------------|-------|
| **Progressive insertion with live transport controls (pause/resume/stop/undo)** | No competitor reviewed documents this. "Auto-typer" tools (Human Auto Typer, Duey.ai, Auto Typer) exist as a *separate category* built for a different purpose — disguising AI authorship as human typing to evade AI-detectors — and even those only offer basic pause/resume, not stop+undo+independent-of-generation-state. Framed as a *reading/review* mechanism rather than a typing-speed disguise, this is a genuinely unclaimed position. | HIGH | This is the core bet per PROJECT.md. Complexity is real: insertion state must be decoupled from generation state (stop insertion ≠ abort response), and each of the three insertion surfaces needs its own pause point. Build this first, not last — if it's hard, better to discover in phase 1. |
| **Insertion that actually survives contenteditable's internal document model** (not naive `execCommand`/DOM writes) | Category-wide evidence suggests competitors lean on `execCommand('insertText')` or clipboard-paste simulation, which is exactly the kind of insertion that silently drops formatting or fails on React-controlled contenteditable (Slack, Notion). A working `beforeinput`/`InputEvent`-based adapter per editor is differentiation through correctness, not features. | HIGH | Three separate adapters (plain field, contenteditable, Google Docs canvas) as scoped in PROJECT.md — treat as three build efforts, not one abstraction with options. |
| **Google Docs insertion via the actual editable surface, not a workaround** | Google Docs renders visibly to `<canvas>`, but the editable text lives in a hidden iframe/contenteditable that Docs uses for input handling; correct insertion targets that hidden surface with synthetic `beforeinput`/keyboard events rather than trying to draw into the canvas. No competitor reviewed advertises working, reliable Google Docs insertion as a headline feature — it's mentioned in passing at best (Merlin) with no complaint evidence either way, suggesting it's under-tested rather than solved. | HIGH | Highest-risk, highest-differentiation single feature. Confidence on the exact DOM mechanism is LOW — Google changes Docs' internals without notice, so this needs its own throwaway spike before being trusted in a roadmap phase. |
| **Visible, specific failure states instead of silent breakage** | The single most repeated complaint across HARPA, MaxAI, Monica, Merlin is the product going flaky/silent — spinners that never resolve, credits consumed with no output, features that stop working post-update with no user-facing signal. A competitor that simply *tells the user what broke* stands out by default. | LOW-MEDIUM | Cheap to build, expensive to skip. Ties into error recovery already scoped in original spec's AI Engine section. |
| Structured prompt assembly from discrete sections (system/request/context/history/style/format) | Not a user-visible feature but improves output quality and consistency in ways ad-hoc single-string prompts don't; none of the six competitors document this publicly, though some (HARPA) likely do something similar internally | MEDIUM | Already scoped. Internal quality lever, not a marketing feature — don't expose the raw structure to users, just the better output. |
| Context manager combining multiple sources (PDF, DOCX, images/OCR, pasted text) into one prompt | Table stakes to have *some* file upload; the differentiator is combining several kinds of context into a single coherent prompt without the user manually stitching them, which competitors mostly don't do (most support one attachment type at a time, e.g. "upload a PDF" xor "paste text") | MEDIUM-HIGH | Already scoped. Real complexity is context-window budgeting across mixed sources, not the extraction itself. |

### Anti-Features (Commonly Requested, Often Problematic)

| Feature | Why Requested | Why Problematic | Alternative |
|---------|---------------|------------------|-------------|
| "Undetectable"/humanized typing to evade AI-detection or plagiarism tools | A visible sub-market exists for this (Human Auto Typer, Duey.ai, Phrasly humanize-and-autotype) and it's tempting to market progressive insertion the same way | This project's spec is explicit that pacing is "a presentation preference rather than a representation of authorship" — marketing it as detection-evasion invites the exact reputational and possibly Chrome Web Store policy risk (deceptive functionality) this project should avoid; it also attracts a low-trust user base focused on cheating rather than the target "write inside web apps all day" user | Keep pacing framed and documented as a *reading/review* aid. Don't build detection-evasion features (randomized inter-keystroke jitter tuned to evade specific detectors, etc.). |
| Broad `<all_urls>` / "works on every website" permission requested up front | Feels like the safest choice for a "universal" extension and matches the product's name | Chrome Web Store reviewers explicitly flag `<all_urls>` when the extension's real usage is a smaller set of sites, triggering "in-depth review" delays; Unit 42 (Palo Alto Networks) has specifically called out AI browser extensions for over-requesting access relative to what they use — this is a documented rejection/review-delay pattern, not speculation | Request `activeTab` plus injection only where the sidebar is actually opened, or scope `host_permissions` to the known target editor domains (Gmail, LinkedIn, Slack, Notion, Docs, X) and expand later if beta users need more sites |
| Web automation / agentic actions beyond writing (HARPA's "monitor a site," "run workflows," browser-agent behavior) | Adjacent products (HARPA, Merlin) bundle this and it looks like more value for the same install | Directly conflicts with Chrome Web Store's single-purpose policy language and 2026's tightened stance on extensions that act autonomously on a user's behalf without clear disclosure; also the single largest source of "confusing/cluttered" complaints in reviews (HARPA specifically) | Stay a writing assistant. If automation is ever wanted, it's a different single-purpose extension, not a bolt-on. |
| "Unlimited" or vague usage framing on quotas | Competitors (MaxAI, Sider) market "unlimited" and it reads well in a listing | The single most repeated *trust*-destroying complaint across Sider, MaxAI, Monica is exactly this — users feeling misled by "unlimited" that turns out capped, followed by bad refund/support experiences | Show the beta user's real quota state plainly in the UI (e.g., "X of Y requests used this week"). Precise and boring beats optimistic marketing language, especially with only 10-50 beta users who will notice immediately. |
| Handwriting OCR | Feels like a natural extension of "OCR" and appears in the original spec's feature list | Already correctly flagged as out-of-scope in PROJECT.md — handwriting OCR accuracy is poor enough to actively damage trust in the context pipeline the first time it silently mangles someone's notes | Printed-text OCR only, already decided. |
| Auto-detecting "supported editor" allowlist UI with per-site configuration screens | Feels like good product hygiene — show users where the extension works | Adds a maintenance burden (editors change their DOM constantly) and a UI surface with no payoff at 10-50 beta users; competitors that expose this (none of the six do, notably) would just be advertising where insertion breaks | Let insertion fail gracefully to copy-to-clipboard on unrecognized editors; don't build a status/config page for this pre-validation. |
| Multiple LLM provider selection UI in v1 | Sider and Monica market "chat with all AI" (multi-model) as a headline feature, and it's tempting to compete on the same axis | PROJECT.md already scopes this out — OpenRouter abstraction exists precisely so the *default model* is a config change, not a user-facing picker; building a model-selector UI adds surface area with zero validation signal at beta scale | Provider abstraction stays internal/config-only until there's a real reason (cost, capability gap) to expose it. |
| Remote-loaded prompt templates or remotely configurable behavior fetched at runtime | Convenient for iterating on prompts without shipping a new extension version | Manifest V3 and Chrome Web Store policy prohibit remotely hosted/executed code; fetching *data* (e.g., a JSON prompt list) is technically allowed but blurs into a grey zone reviewers scrutinize, and it's unnecessary risk for a private-repo, 10-50-user beta | Bundle prompt templates in the extension build; update via new version releases during beta. |

## Feature Dependencies

```
Sidebar workspace (injected, toggleable)
    └──requires──> Content script injection framework
                       └──requires──> Manifest V3 scaffold, host permission scoping

Text insertion (any mode) 
    └──requires──> Per-editor adapter detection (plain field / contenteditable / canvas-Docs)
                       └──requires──> DOM/editor research spike (HIGH uncertainty, esp. Google Docs)

Progressive insertion with transport controls
    └──requires──> Text insertion (instant) working first, per adapter
    └──requires──> Insertion state machine decoupled from generation state

Context manager (multi-source prompt assembly)
    └──requires──> File upload + extraction (PDF, DOCX, TXT, MD) working independently
    └──requires──> Image/screenshot OCR working independently
    └──enhances──> AI Engine output quality (not a hard blocker, but low-context answers are worse)

Structured prompt assembly
    └──requires──> Nothing upstream — can ship before Context manager, degrades gracefully with less context

Per-user quotas
    └──requires──> User accounts (auth) working first
    └──conflicts with──> "Unlimited" marketing language (see Anti-Features) — be precise instead

Visible error states / error recovery
    └──enhances──> every other feature — should be built alongside insertion and AI engine, not bolted on after
```

### Dependency Notes

- **Text insertion requires the DOM/editor research spike before roadmap commitment.** Google Docs specifically is the highest-uncertainty item in this entire feature set — no competitor documents their approach, and Docs' internal DOM structure (hidden iframe + contenteditable target) is undocumented by Google and known to shift without notice. This should be a dedicated, timeboxed spike early in the roadmap, not assumed solvable inside a normal implementation phase.
- **Progressive insertion strictly requires instant insertion working first, per adapter.** Building pacing/transport controls before the underlying "can this land correctly at all" problem is solved for a given editor would be building on sand — three separate times (plain field, contenteditable, Docs).
- **Visible error states enhance everything and should not be deferred to a later phase.** Given that "silent breakage" is the single most repeated complaint across the reviewed competitors, treating error visibility as a cross-cutting requirement from phase 1 (not a phase 4 polish item) is the strongest single lesson from this research.
- **Context manager and structured prompt assembly are independent enough to parallelize** — structured prompt assembly can ship with zero uploaded context (system + request + history only) and still deliver value; the context manager adds richness on top later.

## MVP Definition

### Launch With (v1)

- [ ] Sidebar workspace with keyboard shortcut + floating button trigger — table stakes, no competitor ships without this
- [ ] Streaming AI chat with session memory — table stakes
- [ ] Prompt templates for the 6-7 core operations already scoped — table stakes, keep the list short
- [ ] Text insertion for plain fields and contenteditable (Gmail, LinkedIn, Slack, Notion) — this is most of the differentiator's value; ships before Docs if a cut is needed
- [ ] Progressive insertion with pause/resume/stop/undo for the editors where instant insertion already works — this is the actual product bet; do not ship without it
- [ ] Copy-to-clipboard and instant-insert as fallbacks — cheap, de-risks insertion gaps on unsupported sites
- [ ] Visible, specific error states (quota exceeded, generation failed, insertion failed) — cheapest possible differentiation given category-wide silent-failure complaints
- [ ] File upload for PDF/DOCX/TXT/MD with text extraction — table stakes for "context collection"
- [ ] Accounts + per-user quotas with honest, visible usage display — required for the shared-key economics; visible quota avoids the "unlimited" trust failure seen across competitors

### Add After Validation (v1.x)

- [ ] Google Docs insertion (canvas adapter) — highest technical risk in the whole feature set; validate the other two adapters and the transport-control UX first, then invest in Docs once the pattern is proven elsewhere
- [ ] Image upload + OCR — valuable but independent of the core insertion bet; add once text-only context flow is validated
- [ ] Conversation history search/organization — competitors get complaints about this being *missing* (Merlin) but it's a retention feature, not an activation one
- [ ] Expanded prompt template library — grow based on what beta users actually ask for, not speculative breadth

### Future Consideration (v2+)

- [ ] Multiple LLM provider selection UI — defer until there's a concrete reason (cost ceiling, capability gap) to expose model choice; competitors' "chat with all AI" positioning didn't protect them from the same complaint patterns as everyone else
- [ ] Firefox/Safari support — explicitly deferred per PROJECT.md, separate manifest/API-shim cost
- [ ] Code editor adapters (Monaco/CodeMirror) — explicitly deferred per PROJECT.md, not where this audience writes prose
- [ ] Multi-document reasoning / knowledge collections — explicitly deferred per PROJECT.md as Phase 5 material
- [ ] Team/collaboration, shared workspaces — explicitly deferred per PROJECT.md, single-user product first
- [ ] Billing/subscriptions — explicitly deferred per PROJECT.md until validation

## Feature Prioritization Matrix

| Feature | User Value | Implementation Cost | Priority |
|---------|------------|---------------------|----------|
| Sidebar + streaming chat | HIGH | LOW | P1 |
| Text insertion: plain field + contenteditable | HIGH | MEDIUM-HIGH | P1 |
| Progressive insertion with transport controls | HIGH | HIGH | P1 |
| Copy-to-clipboard / instant-insert fallback | MEDIUM | LOW | P1 |
| Visible error states | HIGH | LOW | P1 |
| File upload + text extraction (PDF/DOCX/TXT/MD) | MEDIUM-HIGH | MEDIUM | P1 |
| Accounts + visible quotas | HIGH (structural, not exciting) | MEDIUM | P1 |
| Google Docs canvas insertion | HIGH (if it works) | HIGH, high uncertainty | P2 |
| Image/screenshot OCR | MEDIUM | MEDIUM | P2 |
| Conversation history organization | LOW-MEDIUM | LOW-MEDIUM | P2 |
| Multi-provider model picker UI | LOW at beta scale | LOW-MEDIUM | P3 |
| Billing/subscriptions | LOW at beta scale | MEDIUM | P3 |
| Team/collaboration | LOW at beta scale | HIGH | P3 |

**Priority key:**
- P1: Must have for launch
- P2: Should have, add when possible
- P3: Nice to have, future consideration

## Competitor Feature Analysis

| Feature | Grammarly | Merlin / Sider / HARPA / MaxAI / Monica (category pattern) | Our Approach |
|---------|-----------|--------------------------------------------------------------|--------------|
| Insertion into web editors | Rewrite happens in-place via its own overlay UI on supported fields; no evidence of a documented canvas/Docs-specific engine | Mostly "insert response" via clipboard or generic DOM write; no product documents a contenteditable- or canvas-specific adapter | Three explicit adapters (plain, contenteditable, Docs canvas), each engineered for its editor's actual input model |
| Progressive/paced insertion with user control | Not offered — Grammarly's model is inline suggestion/rewrite, not generation-then-insertion | Not offered as a reviewed feature by any of the five; adjacent "auto-typer" tools exist as a separate, differently-motivated category (AI-detection evasion) | Core differentiator: pause/resume/stop/undo, framed as review not disguise |
| Error visibility on failure | Mixed — free-tier suggestion-hiding is itself a complaint, not a failure state | Weak across the board — the dominant complaint theme (HARPA, MaxAI, Monica, Merlin) is silent/flaky failure | Explicit, specific error states from day one |
| Usage/quota transparency | Free tier limits are visible but criticized as newly restrictive | "Unlimited" marketing that turns out capped is the top trust complaint (Sider, MaxAI, Monica) | Precise, always-visible quota display; no "unlimited" language |
| Scope of "AI assistant" features | Narrow (grammar/rewrite), well-executed | Broad ("chat with all AI," web automation, monitoring) — correlates with "confusing/cluttered" complaints (HARPA specifically) | Narrow: writing + insertion only, resist scope creep into automation |

## Sources

- [Grammarly Review 2026 — ToolsBrief](https://toolsbrief.org/grammarly-review-2026/)
- [Grammarly Reviews — G2](https://www.g2.com/products/grammarly/reviews)
- [Grammarly's learn-by-doing demo document — GoodUX/Appcues](https://goodux.appcues.com/blog/grammarlys-demo-document)
- [Compose AI Review — Originality.AI](https://originality.ai/blog/compose-ai-review)
- [Compose AI Reviews — Slashdot](https://slashdot.org/software/p/Compose-AI/)
- [Merlin AI Reviews — Product Hunt](https://www.producthunt.com/products/merlin-chatgpt-powered-browser-cmd-g/reviews)
- [Merlin AI review 2026 — eesel AI](https://www.eesel.ai/blog/merlin-ai)
- [Sider: Chat with all AI — Chrome-Stats](https://chrome-stats.com/d/difoiogjjojoaoomphldepapgpbgkhkb)
- [Sider Permissions/Stats — ExtWise](https://extwise.com/extension/sider-chat-with-all-ai-gpt-5-claude-deepseek-gemini-grok/)
- [HARPA AI Reviews — Chrome Web Store](https://chromewebstore.google.com/detail/harpa-ai-web-automation-w/eanggfilgoajaocelnaflolkadkeghjp/reviews)
- [HARPA AI Review — Unite.AI](https://www.unite.ai/harpa-ai-review/)
- [MaxAI.me Reviews — Trustpilot](https://www.trustpilot.com/review/maxai.me)
- [MaxAI.me Review 2026 — SaaSCRMReview](https://saascrmreview.com/maxai-review/)
- [Monica Reviews — G2](https://www.g2.com/products/stack-network-limited-monica/reviews)
- [Monica: All-In-One AI Assist — Chrome Web Store](https://chromewebstore.google.com/detail/monica-all-in-one-ai-assi/ofpnmcalabcbjgholdjcjblkibolbppb?hl=en-US)
- [Human Typing Simulator — Chrome Web Store](https://chromewebstore.google.com/detail/human-typing-simulator/lnoblmfpofmlapgdieejikeeaabjojgl)
- [Auto Typer — Chrome Web Store](https://chromewebstore.google.com/detail/auto-typer/bgpnjdahpmkaflfpbkdplndklnmghklp?hl=en)
- [Duey.ai Auto Typer for Google Docs — Chrome Web Store](https://chromewebstore.google.com/detail/dueyai-humanizer-+-auto-t/ilamopeagajnekeaogejpdmffneankjf)
- [Why Chrome Extensions Get Rejected — ExtensionRadar](https://www.extensionradar.com/blog/chrome-extension-rejected)
- [Troubleshooting Chrome Web Store violations — Chrome for Developers](https://developer.chrome.com/docs/webstore/troubleshooting)
- [Deal with remote hosted code violations — Chrome for Developers](https://developer.chrome.com/docs/extensions/develop/migrate/remote-hosted-code)
- [Chrome Web Store policy updates 2026 — Chrome for Developers Blog](https://developer.chrome.com/blog/cws-policy-updates-2026)
- [Google Chrome extensions must meet new privacy standards by August 1 — CyberInsider](https://cyberinsider.com/google-chrome-extensions-must-meet-new-privacy-standards-by-august-1/)
- [Google updates Chrome Web Store rules on extension data collection and AI safeguards — Digital Information World](https://www.digitalinformationworld.com/2026/07/google-updates-chrome-web-store-rules.html)

---
*Feature research for: AI writing-assistant browser extension (universal sidebar category)*
*Researched: 2026-08-05*
