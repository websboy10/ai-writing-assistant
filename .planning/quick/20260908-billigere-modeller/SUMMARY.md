---
status: complete
date: 2026-09-08
---

# Billigere modeller — målt, ikke gættet

Sonnet led the strong chain at $2/$10 per million tokens. Fifteen models were
run through the product's real prompt on five real Danish tasks plus an 8,845
character attached document (`scripts/bake-off-models.mjs`, kept — model prices
move and this decision will be made again).

## What changed

| | before | after |
|---|---|---|
| fast chain | gemini-3.5-flash → deepseek-v4-flash → sonnet-5 | **gemini-3-flash-preview → gemini-2.5-flash-lite → gemini-3.5-flash** |
| strong chain | **sonnet-5** → gemini-3.5-flash → deepseek-v4-flash | gemini-3-flash-preview → gemini-3.5-flash → **sonnet-5 (last)** |
| search decider | gemini-3.5-flash | gemini-3-flash-preview |

## Measured, per answer, with the real prompt in Danish

| model | first token | short answer | 8.8k-char document | facts |
|---|---|---|---|---|
| claude-sonnet-5 | 1564 ms | $0.00254 | $0.01579 | 5/5 |
| gemini-3.5-flash | 940 ms | $0.00171 | $0.00792 | 5/5 |
| **gemini-3-flash-preview** | **853 ms** | **$0.00053** | **$0.00274** | 5/5 |
| gemini-2.5-flash-lite | 2390 ms | $0.00016 | $0.00064 | 5/5 |

Roughly **3× cheaper on an ordinary answer and 6× on a document answer**, while
being the fastest of the three to the first word — and with the best Danish of
anything tried, slips and all.

## What was rejected, and why the numbers alone would have got it wrong

Every one of these passed the automated checks. All were caught by reading the
Danish:

- `gpt-oss-120b` — "arbejde i comfy tøj", "it's giver mere frihed". English leaks.
- `qwen3-30b` — "ikke har lunsj". Not a Danish word.
- `ling-3.0-flash` — fluent but the wrong register entirely: formal, zero slips,
  "tilbagekaldelser" for feedback, "bureaucratiet". Reads like a translation.
- `nova-micro-v1` — "mindre rejsetider". Headlines, not sentences.
- `mistral-small-24b` — 3 of 5 requests errored.
- `deepseek-v4-flash` — the one cheap model whose Danish is genuinely good
  ($0.00009/answer), but across four runs: 3.8s, 10.3s, and once **no tokens at
  all**, served by three different providers. Removed from the chain.

## The risk, named

The new head is a **preview** model and a preview can change or be withdrawn.
If it goes, the chain does what it exists for: falls through, logs
`model_fallback`, and the answer costs more rather than failing. Two proven GA
models sit behind it.

## Observed

`pnpm typecheck` clean, `verify-web-search.mjs` 42/42 on the new chain — routing
still correct on all seven cases and the voice intact ("ved **og** gange",
"nødt til **og** blive", "vi **håbe**").

Ships with a backend deploy; no extension change.
