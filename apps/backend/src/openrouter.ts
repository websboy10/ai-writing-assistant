import type { ChatMessage, ContentClass } from '@awa/shared';
import { env } from './env.js';

export interface StreamHandlers {
  onToken: (text: string) => void;
  onMeta: (model: string) => void;
  onUsage: (tokensIn: number, tokensOut: number) => void;
  /**
   * Why the model stopped. 'length' means the reply was CUT OFF at the token
   * ceiling — the text is a fragment, not an answer. Callers that parse the
   * reply as a whole (autonomous mode parses it as JSON) must be able to tell
   * that apart from a model that legitimately returned nothing, because the
   * two need opposite responses: retry smaller vs. report "no questions".
   */
  onFinish?: (reason: string) => void;
}

export class NoModelsError extends Error {
  code = 'all_models_failed' as const;
  constructor(public attempts: { model: string; reason: string }[]) {
    super('All models in the chain failed');
  }
}

export class PolicyError extends Error {
  code = 'policy_no_paid_models' as const;
  constructor() {
    super('Real content requires paid no-training models and none are configured/funded');
  }
}

/**
 * Stream a completion, falling back through an ordered model chain.
 *
 * Policy gate (QUOT-05): contentClass 'real' → paid chain with provider data
 * collection denied. Anything else that is not explicitly 'synthetic' is
 * treated as 'real'. This routing decision lives here, server-side, and no
 * client input can widen it to free/training-enabled endpoints.
 *
 * Fallback rule: a model only counts as failed if it failed BEFORE emitting
 * any token — once tokens have reached the client we cannot switch models
 * without producing a stitched-together response.
 */
export async function streamChat(
  messages: ChatMessage[],
  contentClass: ContentClass,
  signal: AbortSignal,
  handlers: StreamHandlers,
): Promise<void> {
  const isSynthetic = contentClass === 'synthetic';
  const chain = isSynthetic ? env.freeChain : env.paidChain;
  if (!chain.length) throw new PolicyError();

  const attempts: { model: string; reason: string }[] = [];

  for (const model of chain) {
    let emitted = false;
    try {
      await streamOne(model, messages, isSynthetic, signal, {
        ...handlers,
        onToken: (t) => {
          emitted = true;
          handlers.onToken(t);
        },
      });
      return;
    } catch (err) {
      if (signal.aborted) return;
      const reason = err instanceof Error ? err.message : String(err);
      attempts.push({ model, reason });
      if (emitted) {
        // Mid-stream failure after tokens went out: surface it, don't stitch.
        throw new Error(`Model ${model} failed mid-response: ${reason}`);
      }
    }
  }
  throw new NoModelsError(attempts);
}

async function streamOne(
  model: string,
  messages: ChatMessage[],
  isSynthetic: boolean,
  signal: AbortSignal,
  handlers: StreamHandlers,
): Promise<void> {
  // 30s to FIRST BYTE only. The timer must be detached once headers arrive:
  // a fetch signal governs body consumption too, so leaving it attached would
  // kill every generation longer than 30s mid-stream — exactly the long,
  // read-along generations the product exists for.
  const firstByte = new AbortController();
  const firstByteTimer = setTimeout(() => firstByte.abort(), 30_000);

  let res: Response;
  try {
    res = await fetch('https://openrouter.ai/api/v1/chat/completions', {
      method: 'POST',
      signal: AbortSignal.any([signal, firstByte.signal]),
      headers: {
        Authorization: `Bearer ${env.openrouterKey}`,
        'Content-Type': 'application/json',
        'HTTP-Referer': 'https://github.com/websboy10/ai-writing-assistant',
        'X-Title': 'AI Writing Assistant',
      },
      body: JSON.stringify({
        model,
        messages,
        stream: true,
        usage: { include: true },
        // For real content, refuse providers that collect/train on prompts.
        ...(isSynthetic ? {} : { provider: { data_collection: 'deny' } }),
      }),
    });
  } finally {
    // Headers received (or fetch failed) — from here only the caller's abort
    // applies, because the cleared timer can never fire firstByte.abort().
    clearTimeout(firstByteTimer);
  }

  if (!res.ok) {
    const body = await res.text().catch(() => '');
    throw new Error(`HTTP ${res.status}: ${body.slice(0, 300)}`);
  }
  if (!res.body) throw new Error('No response body');

  handlers.onMeta(model);

  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';

  // After the stream is open, only the caller's abort applies.
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    if (signal.aborted) {
      await reader.cancel().catch(() => {});
      return;
    }
    buffer += decoder.decode(value, { stream: true });

    let idx: number;
    while ((idx = buffer.indexOf('\n')) !== -1) {
      const line = buffer.slice(0, idx).trim();
      buffer = buffer.slice(idx + 1);
      if (!line.startsWith('data: ')) continue;
      const data = line.slice(6);
      if (data === '[DONE]') return;
      try {
        const parsed = JSON.parse(data);
        const delta = parsed.choices?.[0]?.delta?.content;
        if (typeof delta === 'string' && delta.length) handlers.onToken(delta);
        const finish = parsed.choices?.[0]?.finish_reason;
        if (typeof finish === 'string' && finish) handlers.onFinish?.(finish);
        if (parsed.usage) {
          handlers.onUsage(parsed.usage.prompt_tokens ?? 0, parsed.usage.completion_tokens ?? 0);
        }
        // OpenRouter surfaces upstream provider errors as an SSE data payload.
        if (parsed.error) throw new Error(parsed.error.message ?? 'provider error');
      } catch (e) {
        if (e instanceof SyntaxError) continue; // partial JSON keepalive noise
        throw e;
      }
    }
  }
}
