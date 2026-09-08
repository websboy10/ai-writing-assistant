import type { ChatMessage, ContentClass } from '@awa/shared';
import { streamChat, type RouteHint } from '../openrouter.js';

export interface Completion {
  text: string;
  /** 'length' means the reply was cut off at the token ceiling — see below. */
  finishReason: string;
  /** Which model actually answered, and which ones failed on the way there. */
  model: string;
  failures: { model: string; reason: string }[];
}

/**
 * Thin non-streaming wrapper around `streamChat`: this route needs the whole
 * response text before it can be parsed as JSON, not a token-by-token SSE
 * feed. Reuses the existing policy gate, ordered model fallback chain and
 * abort handling in openrouter.ts untouched — no second provider path.
 *
 * Returns the finish reason as well as the text, because a JSON reply that
 * stopped at the token ceiling is a FRAGMENT: it parses to nothing, which is
 * indistinguishable from "the model found nothing to say" unless the caller
 * can see why the model stopped.
 */
export async function collect(
  messages: ChatMessage[],
  contentClass: ContentClass,
  signal: AbortSignal,
  hint: RouteHint = {},
): Promise<Completion> {
  let text = '';
  let finishReason = '';
  let model = '';
  const failures: { model: string; reason: string }[] = [];
  await streamChat(messages, contentClass, signal, {
    onToken: (t) => {
      text += t;
    },
    onMeta: (m) => {
      model = m;
    },
    onUsage: () => {},
    onFinish: (reason) => {
      finishReason = reason;
    },
    onModelFailed: (m, reason) => failures.push({ model: m, reason }),
  }, hint);
  return { text, finishReason, model, failures };
}
