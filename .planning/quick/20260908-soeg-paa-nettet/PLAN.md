---
id: 260908-web
slug: soeg-paa-nettet
date: 2026-09-08
---

# "Søg på nettet" — search without the links

OpenRouter carries web search itself: no new vendor, no new key, no new
dependency. The whole risk was that its stock instruction tells the model to
cite sources as markdown links, and every insertion path in this product
writes into a document, so `[Titel](https://…)` would arrive with brackets and
a URL in it.

Probed against the live API before writing any of this (2026-09-08):

- A custom `search_prompt` that forbids citations produced **0 markdown links,
  0 bare URLs and 0 bare domains** in the text, on both engines tried.
- Sources still come back, as `delta.annotations` on the stream, entirely
  separate from the text. So they can be shown in the sidebar and kept out of
  the document.
- A searched answer cost **$0.0085**, of which ~$0.005 was the search. An
  ordinary answer is ~$0.010.

## Files

1. `packages/shared/src/index.ts` — `ChatRequest.webSearch`, a `WebSource`
   type, and a `sources` stream event.
2. `apps/backend/src/openrouter.ts` — the `web` plugin, the no-citations
   search prompt, and `onSources` reading `delta.annotations`.
3. `apps/backend/src/routes/chat.ts` — pass the flag through, forward the
   sources, record on the analytics event so the real cost is visible.
4. `apps/extension/insertion/richtext.ts` — render a markdown link as a real
   hyperlink instead of leaving brackets in the document. A hole today
   regardless of search; search is just what would hit it first.
5. `apps/extension/sidebar/store.ts` — persisted `webSearch` flag, sources on
   the message.
6. `apps/extension/sidebar/chat.ts` — send the flag, keep the sources.
7. `apps/extension/sidebar/components/ChatView.tsx` — the toggle, off by
   default, and a "Kilder" line under the answer.

`plaintext.ts` is deliberately NOT changed. It turns `[Titel](url)` into
`Titel (url)`, which is right for a link the user actually asked for. The
search prompt is what keeps citations out, not the stripper.

## Proof required

Not a build. A real searched answer, in Danish, with no link in the text and
the sources visible beside it.
