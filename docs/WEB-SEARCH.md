# Web search — what it would cost and the trap in it

Researched 2026-09-04. Nothing is built; this is the note that stops the next
person re-deciding it from scratch, and stops them shipping the obvious version.

## It is a few lines

OpenRouter carries search itself, so no new vendor, no new key, no new
dependency. Either append `:online` to a model slug, or pass the plugin, which
is the version worth using because it can be configured:

```ts
plugins: [{ id: 'web', engine: 'exa', max_results: 3, search_prompt: '…' }]
```

## It is cheap — cheaper than assumed

Charged per search, not per token:

| Engine | Price | On top of one answer |
|---|---|---|
| Parallel Turbo/Fast | $1 / 1,000 requests | +$0.001 (+10%) |
| Exa (the default fallback) | $7 / 1,000 requests, ≤10 results | +$0.007 (+70%) |
| Perplexity | $5 / request | never |
| Native (Anthropic, Google) | provider passthrough by context size | unpredictable |

Measured 2026-09-04, an answer costs **$0.010** (0.0104 and 0.0093 credits on
two real generations). So even Exa lands at $0.017. A heavy user at 100 answers
a month costs $1.70 against 100 kr of revenue. Cost is not the reason to say no.

## THE TRAP: the default search prompt asks for markdown citations

OpenRouter's stock `search_prompt` instructs the model to cite its sources **as
markdown links**. Every insertion path in this product writes `text/plain`, so
`[Titel](https://…)` arrives in the user's Google Doc with the brackets and the
URL in it. That is the exact failure `PROSE_RULES` exists to prevent — measured
2026-08-25, two of three ordinary Danish prompts came back containing markdown
before those rules were written — and search would reintroduce it on every
searched answer.

**So `:online` must never be used.** It is shorthand for the default plugin
settings, and the default settings include that prompt. Pass the plugin
explicitly with a `search_prompt` that forbids markdown, links and citations.

## The shape to build

A **"Søg på nettet" toggle** in the composer, beside the tempo slider, **off by
default** — the same shape as "Skriv som et menneske", for the same reason: a
first-time user who sees web phrasing appear in their document should have asked
for it.

Off by default is also the honest default for the work this product does. A
performance review, an email to a colleague, a rewrite of text the user pasted:
none of it has anything to search for, and searching anyway spends money and
drags borrowed web phrasing into a document that is supposed to sound like the
person writing it.

The per-answer cost is already recorded on every `chat_completed` event, so the
dashboard will show what search actually costs the day it ships, rather than
what this file estimated.
