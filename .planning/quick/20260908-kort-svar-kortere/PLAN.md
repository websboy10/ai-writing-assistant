---
id: 260908-j1b
slug: kort-svar-kortere
date: 2026-09-08
---

# "Kort" skal være kort — én til to sætninger

The picker's short setting promised 40 to 70 words and up to four sentences.
That is a short paragraph, not a short answer, and the operator asked for one
or two sentences at the most.

Two string constants, no logic:

1. `apps/backend/src/prompt.ts` — `LENGTH_INSTRUCTIONS.short`. One or two
   sentences, 15 to 40 words, one paragraph, no list, no closing line.
2. `packages/shared/src/index.ts` — `LENGTH_HINTS.short`. The Danish tooltip
   has to say the same thing the prompt now demands, or the picker lies.

`LENGTH_OVERRIDE` is untouched: a size the user types themselves still wins.
Medium and long are untouched.

Two halves ship differently. The prompt lives on the backend, so it reaches
every already-installed extension the moment the backend is deployed. The
tooltip is in the bundle and needs a new extension build to change.
