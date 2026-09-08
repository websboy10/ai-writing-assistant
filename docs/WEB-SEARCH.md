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

## What was built (2026-09-08)

**The model decides. There is no toggle.** A toggle was built first and thrown
away the same hour, on the operator's call: a person cannot tell which of their
own questions the model is shaky on — that is the reason they are asking it —
so an off-by-default switch means the answers that most needed the web are
exactly the ones that silently don't get it.

`apps/backend/src/websearch.ts` decides, in two stages:

1. **Free, no call at all.** `summarize`, `rewrite`, `expand`, `simplify`,
   `translate` and `continue` never search — they work on text the user already
   handed over. Neither does anything with an attached file or a page selection:
   that material *is* the grounding, and going to the web instead would answer
   from a stranger's page. This covers most real use and adds zero latency.
2. **A cheap classifier** for what's left (a typed question). One
   `gemini-3-flash-preview` call, `max_tokens: 16`, ~780 ms and ~$0.00018. Fails
   to NO, so a bad minute at OpenRouter can never turn into spending. Note the
   cheapest model in the chain cannot do this job — `gemini-2.5-flash-lite`
   scored 2/14 on the same requests against 14/14 here. Judging a question is
   harder than answering one.

The user's request is quoted to the classifier as DATA inside triple quotes. Sent
plainly, the model *obeys* it instead of classifying it: 7 of 14 cases came back
as an actual email or an actual translation. That one framing change took the
score from 7/14 to 13/14, and naming literary analysis explicitly took it to
14/14.

The rule, in the operator's own words: *"a mathematics problem, it knows, easy.
But analyzing a specific novel — do a web search there."* Recalling a real named
work from memory is where a confident wrong detail does the most damage, so any
named real thing is a JA.

**Sources appear under the answer, never in it.** With no toggle, that line is
the only signal a search happened. Titles only — a full URL wraps over three
lines in a 360 px panel and says less than the page's own name.

Measured end to end (`scripts/verify-web-search.mjs`, 42/42): the three
memory questions searched nothing, the three fact questions all searched, and
no answer carried a link in either destination. The decider costs about 0.7 s
on a typed question and nothing at all on the insertion operations.

The per-answer cost is recorded on every `chat_completed` event, now with
`web_search` beside it, so the dashboard can separate a searched answer from an
ordinary one rather than averaging the two into one misleading number.
