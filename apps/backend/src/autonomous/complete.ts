import type { ChatMessage, ContentClass } from '@awa/shared';
import { streamChat } from '../openrouter.js';

/**
 * Thin non-streaming wrapper around `streamChat`: this route needs the whole
 * response text before it can be parsed as JSON, not a token-by-token SSE
 * feed. Reuses the existing policy gate, ordered model fallback chain and
 * abort handling in openrouter.ts untouched — no second provider path.
 */
export async function collect(
  messages: ChatMessage[],
  contentClass: ContentClass,
  signal: AbortSignal,
): Promise<string> {
  let text = '';
  await streamChat(messages, contentClass, signal, {
    onToken: (t) => {
      text += t;
    },
    onMeta: () => {},
    onUsage: () => {},
  });
  return text;
}
