---
status: complete
date: 2026-09-08
---

# Ingen stavefejl — nogensinde

The operator's rule: no spelling mistakes, ever, while keeping the deliberate
grammar slips that stop a draft reading machine-written.

## The contradiction that was actually causing it

`PROSE_RULES` already said "Spell every word correctly" — and four lines above
it asked the model to **drop the r in a verb** ("jeg håbe det går godt"). Two
rules in the same prompt arguing, and the model could only obey one. The slip
list was the louder of the two because it came with examples.

## What changed

The dropped and added r is gone from the slip list. Every remaining slip is an
**ordinary correctly spelled word in the wrong place**, which is the selection
rule now written into the prompt: og for at, nogle/nogen, synes/syntes,
ligge/lægge, ad/af, hans/hendes for sin, a repeated subject, and wrong verb
placement after an opening adverbial.

Four new slip types were added deliberately. Seven slips are wanted in ten
sentences with "never the same slip twice running" right after — a short list
runs dry halfway through a long answer and the rule quietly stops being obeyed.

The spelling rule was also raised to an absolute and repeated in the closing
check, where models weight hardest.

## A correction worth recording

**"jeg håbe" is not a spelling mistake.** `håbe` is a real Danish word — the
infinitive — used in a place that wants the present `håber`. macOS's own Danish
dictionary passes it, so no spell checker on earth would have caught what the
operator was seeing. It needed its own detector.

## Observed (`pnpm verify:spelling`, 18/18)

Six real Danish tasks through the running backend, three checks each:

- **spelling** — macOS's own Danish dictionary (the one Mail and Pages use), via
  `scripts/spellcheck-da.swift`. Nothing installed; Swift ships with the OS.
- **wrong verb form** — the dropped r after a subject, the added r after a
  modal. Zero of both.
- **voice** — 18 surviving slips across the six answers ("glæder mig til **og**
  høre", "begynder **og** regne", nogle/nogen, synes/syntes), so the drafts did
  not quietly turn correct-and-lifeless.

One of six answers came back with no slip at all. That is within what the prompt
asks for ("a clean sentence should be the exception, not the norm") but it is
the number to watch if the voice ever starts feeling thin.
