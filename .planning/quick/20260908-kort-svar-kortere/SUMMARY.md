---
status: complete
date: 2026-09-08
---

# "Kort" er nu kort

`LENGTH_INSTRUCTIONS.short` now asks for one sentence, two at the very most,
15 to 40 words, and forbids a third outright. `LENGTH_HINTS.short` says the
same in Danish so the picker's tooltip is not a lie. Medium, long and
`LENGTH_OVERRIDE` untouched.

## Observed, not assumed

Five ordinary Danish prompts through the local backend after the change:

| Prompt | Sentences | Words |
|---|---|---|
| Fordelene ved at arbejde hjemmefra | 2 | 34 |
| Sygemelding til chefen | 2 | 23 |
| Hvorfor himlen er blå | 2 | 34 |
| Overvejelser før jobskifte | 2 | 31 |
| Begrundelse for en prisstigning | 2 | 36 |

Five of five inside the contract, and the deliberate voice slips survived it
("håber og blive", "vigtigt og undersøge") — shortening the answer did not
quietly turn the humanising off.

## How the two halves ship

The prompt lives on the backend, so **every already-installed extension gets
the shorter answers the moment the backend is deployed** — no store update, no
user action. The tooltip is compiled into the bundle and only changes with a
new extension build.
