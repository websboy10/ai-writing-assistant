import 'dotenv/config';

function required(name: string): string {
  const v = process.env[name];
  if (!v) throw new Error(`Missing required env var: ${name}`);
  return v;
}

const port = Number(process.env.PORT ?? 8787);

export const env = {
  port,
  // Where auth emails (confirmation/recovery) send users. Must be set to the
  // deployed backend URL in production — the localhost default only works in dev.
  publicUrl: (process.env.PUBLIC_URL ?? `http://localhost:${port}`).replace(/\/+$/, ''),
  supabaseUrl: required('SUPABASE_URL'),
  supabaseAnonKey: required('SUPABASE_ANON_KEY'),
  openrouterKey: required('OPENROUTER_API_KEY'),
  // Compliance boundary (see PROJECT.md): free/training-enabled models are only
  // ever allowed for content the client explicitly declares synthetic. Real
  // content routes to the paid chain with data collection denied — and if that
  // chain is empty or unfunded, the request FAILS rather than falling through.
  freeChain: (process.env.FREE_MODEL_CHAIN ??
    'inclusionai/ling-3.0-flash:free,nvidia/nemotron-3-nano-30b-a3b:free,google/gemma-4-31b-it:free,nvidia/nemotron-3-super-120b-a12b:free'
  ).split(',').map((s) => s.trim()).filter(Boolean),
  paidChain: (process.env.PAID_MODEL_CHAIN ??
    'anthropic/claude-sonnet-5,google/gemini-3.5-flash,deepseek/deepseek-v4-flash'
  ).split(',').map((s) => s.trim()).filter(Boolean),
  /**
   * Ceiling on a single reply, and the reason the good models were unreachable.
   *
   * Omitting max_tokens does not mean "no limit" at OpenRouter — it means the
   * model's own maximum, and OpenRouter pre-authorises credit for that whole
   * amount before it will start. Measured 2026-08-25: every request asked for
   * 65536 tokens, so both `anthropic/claude-sonnet-5` and
   * `google/gemini-3.5-flash` answered
   *   HTTP 402 … you requested up to 65536 tokens, but can only afford 2615
   * and the chain silently fell through to the cheapest model on EVERY request,
   * paying two wasted round-trips of latency for the privilege.
   *
   * 4000 is the product's real ceiling: a long performance review or client
   * letter is ~1200 Danish words, and Danish tokenizes worse than English.
   */
  maxTokens: Number(process.env.MAX_TOKENS ?? 4000),
  stripeSecretKey: required('STRIPE_SECRET_KEY'),
  stripePriceId: required('STRIPE_PRICE_ID'),
  // Set in production once the webhook endpoint exists in the Stripe
  // dashboard. Locally the success-page + on-demand sync covers the flow.
  stripeWebhookSecret: process.env.STRIPE_WEBHOOK_SECRET ?? '',
  // Only enabled where a tax registration exists (live). Enabling it without
  // one makes Stripe silently collect no tax — the classic Stripe Tax trap.
  stripeAutomaticTax: process.env.STRIPE_AUTOMATIC_TAX === '1',
};
