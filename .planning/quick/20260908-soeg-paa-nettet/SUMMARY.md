---
status: complete
date: 2026-09-08
---

# Web search, decided by the model

## What it does

A question the model can answer from memory is answered from memory. A question
that turns on a real fact is looked up first. Nobody presses anything — the
operator's call mid-build, after a manual toggle had already been written and
was then deleted: a person cannot tell which of their own questions the model is
unsure about, so an off-by-default switch would leave the answers that most
needed the web without it.

## Observed (scripts/verify-web-search.mjs, 42/42)

| Request | Searched? | Wanted |
|---|---|---|
| Hvad er 17 gange 24? | no | no |
| Skriv en email til min chef | no | no |
| Forklar hvad inflation er | no | no |
| Analyser temaerne i "Babettes gæstebud" | **yes** — Babette's Feast (Wikipedia) | yes |
| Hvad er sket med elpriserne for nylig? | **yes** — Elpris udvikling | yes |
| Hvem er borgmester i Aarhus? | **yes** — Aarhus Kommune byrådsmøde | yes |
| Gør den kortere (summarize + subject) | no, and no decider call either | no |

Seven of seven routed correctly, and no answer carried a markdown link, a web
address or a bare domain — checked in both destinations, the plain text a
textarea receives and the HTML "Indsæt straks" pastes into Google Docs.

## The trap this had to clear

OpenRouter's stock search instruction asks the model to cite sources as markdown
links, and everything here writes into a document the user is editing. Passing
the plugin with our own `search_prompt` produced zero links across every run.
`:online` is shorthand for the stock config and must never be used.

## Cost

| | |
|---|---|
| ordinary answer | ~$0.010 |
| the decider, per typed question | ~$0.0005, ~690 ms |
| a searched answer | ~$0.007–0.009 (Parallel turbo, $1/1,000) |

`engine: 'native'` also lets the model decide and was measured first: it cost
**$0.052–0.108** per searched answer and added ~2,800 prompt tokens to every
request on Sonnet even when it searched nothing. Rejected on both counts — and
its own judgement said NO to the novel, which is the case the operator named.

## Also fixed

`richtext.ts` had no link handling at all, so a markdown link would have arrived
in a Google Doc with its brackets and address showing. It now becomes a real
hyperlink; a non-http scheme is left as inert text. Five tests added, 20/20.

## Ships how

Backend-only decision, so **every already-installed extension gets this the
moment the backend is deployed**. The "Kilder" line under the answer needs a new
extension build.
