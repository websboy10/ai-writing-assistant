import type { ChatMessage, ContentClass, OutputLength, WebSource } from '@awa/shared';
import { env } from './env.js';

export interface StreamHandlers {
  onToken: (text: string) => void;
  onMeta: (model: string) => void;
  /**
   * `cost` is what this one generation actually cost, in OpenRouter credits.
   *
   * It arrives free with `usage: { include: true }`, which this file already
   * asks for, and was being dropped on the floor. Recording it is the
   * difference between a dashboard that can say "answers cost 0.004 credits
   * each and the balance lasts 41 days" and one that can only say how many
   * tokens went past. Null when the provider did not report one.
   */
  onUsage: (tokensIn: number, tokensOut: number, cost: number | null) => void;
  /**
   * Why the model stopped. 'length' means the reply was CUT OFF at the token
   * ceiling — the text is a fragment, not an answer. Callers that parse the
   * reply as a whole ("Besvar alle spørgsmål" parses it as JSON) must be able
   * to tell that apart from a model that legitimately returned nothing,
   * because the two need opposite responses: retry smaller vs. report "no
   * questions".
   */
  onFinish?: (reason: string) => void;
  /**
   * A model in the chain failed and the next one is being tried.
   *
   * Without this the fallback is completely silent: `attempts` is collected but
   * only ever surfaced if EVERY model fails, so a chain whose first two entries
   * are broken looks identical to one that is working perfectly — the user just
   * quietly gets the last model, slower. Measured 2026-08-25: every request was
   * being served by the third model in the paid chain and nothing anywhere said
   * so.
   */
  onModelFailed?: (model: string, reason: string) => void;
  /**
   * Pages a web-searched answer was based on.
   *
   * Fires only when the request asked for search. These are for the sidebar,
   * never for the document — see NO_CITATIONS_PROMPT.
   */
  onSources?: (sources: WebSource[]) => void;
}

export class NoModelsError extends Error {
  code = 'all_models_failed' as const;
  constructor(public attempts: { model: string; reason: string }[]) {
    super('All models in the chain failed');
  }

  /**
   * Every model refused for lack of credit rather than for being busy.
   *
   * The distinction is the difference between an honest message and a false
   * one: a rate limit clears in seconds, an empty OpenRouter balance never
   * clears on its own, so telling the user "try again in a moment" would be a
   * lie that costs them their afternoon. Measured 2026-08-25 with a balance of
   * $0, where both paid models answered HTTP 402 on every single request.
   */
  get isOutOfCredit(): boolean {
    return (
      this.attempts.length > 0 &&
      this.attempts.every((a) => a.reason.includes('402') || /requires more credits/i.test(a.reason))
    );
  }
}

export class PolicyError extends Error {
  code = 'policy_no_paid_models' as const;
  constructor() {
    super('Real content requires paid no-training models and none are configured/funded');
  }
}

/**
 * Models that refused for want of credit, and when.
 *
 * A 402 is not a busy signal — it is the wallet, and it will say the same thing
 * to the next request a second later. Left unremembered, every single call paid
 * for the same two doomed round-trips before reaching a model that could
 * answer: measured 2026-08-25 on a balance of $0, both paid models 402'd on
 * every request and the user waited through both.
 *
 * Deliberately short, and deliberately in memory. Topping the account up must
 * take effect on its own within a minute or two, without a redeploy and without
 * anyone remembering that a cache exists — and on Vercel each cold function
 * starts with an empty map anyway, which is the right default.
 */
const outOfCreditUntil = new Map<string, number>();
const CREDIT_COOLDOWN_MS = 60_000;

function isCreditRefusal(reason: string): boolean {
  return reason.includes('402') || /requires more credits/i.test(reason);
}

/** What the request is asking for, as far as it changes the upstream call. */
export interface RouteHint {
  length?: OutputLength;
  /** Attach the web plugin. Costs a search on every request that sets it. */
  webSearch?: boolean;
}

/**
 * The instruction that replaces OpenRouter's own, and the only reason web
 * search can ship in this product at all.
 *
 * The stock `search_prompt` tells the model to cite its sources AS MARKDOWN
 * LINKS. Every insertion path here writes into a document the user is editing,
 * so `[Titel](https://…)` arrives with the brackets and the address in it —
 * the exact failure PROSE_RULES was written to stop. Appending ':online' to a
 * model slug is shorthand for the stock config, INCLUDING that prompt, which
 * is why this file never does that and passes the plugin explicitly instead.
 *
 * Measured 2026-09-08 against the live API on two engines: with this wording,
 * zero markdown links, zero bare URLs and zero bare domains reached the text,
 * while the sources still arrived as annotations for the sidebar to show.
 */
const NO_CITATIONS_PROMPT = [
  'A web search was run for this request. Use the results below as facts you already know.',
  'Write the answer as ordinary prose in the language of the request.',
  'Do NOT cite anything. Do not name your sources, do not write any URL or web address,',
  'do not write square brackets or parentheses containing a link, and do not add a list of',
  'sources at the end. The reader is looking at a document, not a web page.',
].join(' ');

/**
 * Parallel in turbo mode: $1 per 1,000 searches, against $7 for Exa, the
 * engine OpenRouter falls back to when none is named. One answer costs about
 * $0.010, so this is a tenth of an answer rather than most of one.
 *
 * Three results, not ten. The model is writing a paragraph of Danish prose,
 * not a literature review, and every result is prompt tokens paid for twice —
 * once in money and once in the latency before the first word appears.
 */
const WEB_PLUGIN = {
  id: 'web',
  engine: 'parallel',
  mode: 'turbo',
  max_results: 3,
  search_prompt: NO_CITATIONS_PROMPT,
};

/**
 * The point at which a prompt is carrying a document rather than a question.
 *
 * A typed instruction with no attachment is a few hundred characters. An
 * attached PDF or a read-in Google Doc runs to tens of thousands (the per-item
 * cap is 60,000). Six thousand sits well clear of the first and well below the
 * second, so it separates the two without needing to know which one it is.
 */
const HEAVY_PROMPT_CHARS = 6_000;

/**
 * Smart routing: pick the chain by what the request needs, not by a constant.
 *
 * Both chains hold the same paid, no-training models — only the order differs —
 * so this can never route real user content anywhere the privacy boundary
 * forbids. That property is why the decision is safe to make from the request
 * at all, and it must survive any future edit here: if a cheaper chain ever
 * gains a training-enabled model, this function becomes a data leak rather than
 * a saving.
 *
 * The rule is deliberately two measurable facts and no cleverness. Guessing
 * "is this a hard question" from the wording is exactly the kind of heuristic
 * that works in testing and then sends a legal letter to the cheapest model.
 */
export function pickChain(messages: ChatMessage[], hint: RouteHint): string[] {
  const chars = messages.reduce((n, m) => n + m.content.length, 0);
  const heavy = hint.length === 'long' || chars > HEAVY_PROMPT_CHARS;
  const chain = heavy ? env.paidChain : env.paidChainFast;
  // A misconfigured FAST chain must not silently disable the product; fall
  // back to the one that is required to exist.
  return chain.length ? chain : env.paidChain;
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
  hint: RouteHint = {},
): Promise<void> {
  const isSynthetic = contentClass === 'synthetic';
  const chain = isSynthetic ? env.freeChain : pickChain(messages, hint);
  if (!chain.length) throw new PolicyError();

  const attempts: { model: string; reason: string }[] = [];

  // Skip models we already know cannot afford this request — but never skip
  // the last one, so an exhausted account still gets a real attempt and a real
  // error instead of an empty chain and a misleading "all models failed".
  const now = Date.now();
  const affordable = chain.filter((m) => (outOfCreditUntil.get(m) ?? 0) <= now);
  const order = affordable.length ? affordable : [chain[chain.length - 1]];

  for (const model of order) {
    let emitted = false;
    try {
      await streamOne(model, messages, isSynthetic, hint.webSearch === true, signal, {
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
      if (isCreditRefusal(reason)) outOfCreditUntil.set(model, Date.now() + CREDIT_COOLDOWN_MS);
      handlers.onModelFailed?.(model, reason);
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
  webSearch: boolean,
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
        // Never omit this — see env.maxTokens. An absent ceiling is not
        // "unlimited", it is "the model's maximum", and OpenRouter reserves
        // credit for all of it before answering.
        max_tokens: env.maxTokens,
        /**
         * The single biggest thing wrong with this product's speed, measured
         * 2026-09-08 against the live API with the real prompt.
         *
         * These models think before they write, and the thinking is neither
         * free nor hidden from the budget. Asked for a short plan, four runs
         * in four burned 3.5k-5.1k characters of reasoning and then hit the
         * max_tokens ceiling — so every answer came back TRUNCATED mid
         * sentence, 359 to 595 characters of actual text, finish_reason
         * "length". That is the whole of "it is slow and sometimes it does not
         * answer": the wait was the model thinking, and the missing answer was
         * the ceiling being spent on thought instead of words.
         *
         *   as today          first token 8.1s, 4 of 4 truncated
         *   effort: minimal   first token 0.7s, 0 of 4 truncated, answers
         *                     1335-1572 characters and finish_reason "stop"
         *
         * `exclude: true` is NOT the fix and was measured too: it only hides
         * the reasoning from the response, and still costs 7.9s. The thinking
         * has to be turned down, not turned invisible. It cannot be turned off
         * either — some endpoints answer HTTP 400 "Reasoning is mandatory for
         * this endpoint and cannot be disabled" — so minimal is the floor.
         *
         * Nothing here needs a model that reasons: the product writes a first
         * draft in a plain voice for a person to edit.
         */
        reasoning: { effort: 'minimal' },
        usage: { include: true },
        ...(webSearch ? { plugins: [WEB_PLUGIN] } : {}),
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
        // Sources ride the stream as `delta.annotations`, observed 2026-09-08
        // — not on a final message object, which is where the non-streaming
        // docs put them. They arrive in one chunk, so this replaces rather
        // than accumulates.
        const annotations = parsed.choices?.[0]?.delta?.annotations;
        if (Array.isArray(annotations) && annotations.length) {
          const sources = annotations
            .filter((a: { type?: string }) => a?.type === 'url_citation')
            .map((a: { url_citation?: { url?: string; title?: string } }) => ({
              url: a.url_citation?.url ?? '',
              title: a.url_citation?.title ?? a.url_citation?.url ?? '',
            }))
            .filter((s: WebSource) => s.url);
          if (sources.length) handlers.onSources?.(sources);
        }
        const finish = parsed.choices?.[0]?.finish_reason;
        if (typeof finish === 'string' && finish) handlers.onFinish?.(finish);
        if (parsed.usage) {
          const cost = typeof parsed.usage.cost === 'number' ? parsed.usage.cost : null;
          handlers.onUsage(parsed.usage.prompt_tokens ?? 0, parsed.usage.completion_tokens ?? 0, cost);
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
