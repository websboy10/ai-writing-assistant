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
  /**
   * Server-only key for the two Stripe push channels, which act on a user who
   * is not present (webhook, checkout-success landing).
   *
   * Optional on purpose. Absent, those two calls fail and are logged, and the
   * on-demand re-sync — which runs as the user — still unlocks a paying
   * customer. What must NEVER return is the previous arrangement, where the
   * privileged functions were granted to PUBLIC so the anon key would do: that
   * key is published in the extension, and it made the paywall openable by
   * anyone (see supabase/migrations/0006).
   */
  supabaseServiceKey: process.env.SUPABASE_SERVICE_ROLE_KEY ?? '',
  openrouterKey: required('OPENROUTER_API_KEY'),
  // Compliance boundary (see PROJECT.md): free/training-enabled models are only
  // ever allowed for content the client explicitly declares synthetic. Real
  // content routes to the paid chain with data collection denied — and if that
  // chain is empty or unfunded, the request FAILS rather than falling through.
  freeChain: (process.env.FREE_MODEL_CHAIN ??
    'inclusionai/ling-3.0-flash:free,nvidia/nemotron-3-nano-30b-a3b:free,google/gemma-4-31b-it:free,nvidia/nemotron-3-super-120b-a12b:free'
  ).split(',').map((s) => s.trim()).filter(Boolean),
  /**
   * The strong chain. Used when the request actually needs it: a long answer,
   * or an attached document to reason over.
   *
   * Sonnet led this chain until 2026-09-08 and now sits last, as the thing
   * that catches a bad day rather than the thing that answers. Bake-off across
   * fifteen models on five real Danish tasks plus an 8,845-character attached
   * document (scripts/bake-off-models.mjs):
   *
   *   sonnet-5              $0.0158 on the document, 9.2s   5/5 facts
   *   gemini-3.5-flash      $0.0079                 2.6s   5/5
   *   gemini-3-flash-prev   $0.0027                 3.1s   5/5
   *
   * Six times cheaper for the same five facts and the better Danish of the
   * three. Nothing here is a quality trade that was accepted — it is one that
   * was looked for and not found.
   */
  paidChain: (process.env.PAID_MODEL_CHAIN ??
    'google/gemini-3-flash-preview,google/gemini-3.5-flash,anthropic/claude-sonnet-5'
  ).split(',').map((s) => s.trim()).filter(Boolean),
  /**
   * The same models, cheapest and fastest first, for the requests that are the
   * bulk of real use: a short or medium answer with nothing attached.
   *
   * Both chains are paid and both deny provider data collection, so routing
   * between them cannot weaken the privacy boundary — see openrouter.ts. The
   * only thing that changes is which model is tried first, and a short Danish
   * paragraph does not need the most expensive model in the list to write it.
   *
   * Rebuilt 2026-09-08 from measurement, not from list prices. Per answer,
   * with the real prompt, in Danish (first token / cost):
   *
   *   gemini-3-flash-preview   853ms   $0.00053   best voice of any tried
   *   gemini-2.5-flash-lite   2390ms   $0.00016   good Danish, slower to start
   *   gemini-3.5-flash         940ms   $0.00171   the previous head
   *
   * deepseek-v4-flash left this chain despite being the cheapest thing that
   * writes decent Danish ($0.00009): across four runs it took 3.8s, 10.3s, and
   * once returned NO TOKENS AT ALL, served by three different providers.
   * Cheap is not cheap if the answer does not arrive.
   *
   * The head is a PREVIEW model, deliberately and with the risk named: a
   * preview can change or be withdrawn. If it goes, this chain does what it is
   * for — falls through to the next model, logs `model_fallback`, and the user
   * gets a slightly dearer answer rather than an error.
   */
  paidChainFast: (process.env.PAID_MODEL_CHAIN_FAST ??
    'google/gemini-3-flash-preview,google/gemini-2.5-flash-lite,google/gemini-3.5-flash'
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
  /** The 100 kr./md. recurring price. Card only — see stripePassPriceId. */
  stripePriceId: required('STRIPE_PRICE_ID'),
  /**
   * A one-off 100 kr price for the 30-day month pass, and the only way
   * MobilePay money can reach this product: MobilePay is single-use and
   * Stripe will not bill it again (docs.stripe.com/payments/mobilepay).
   *
   * Optional, so the backend still boots with only the subscription
   * configured — the pass button then reports plainly that it is not set up
   * rather than throwing on start and taking sign-in down with it.
   */
  stripePassPriceId: process.env.STRIPE_PASS_PRICE_ID ?? '',
  /** Days one pass buys. Must match the price it is sold at. */
  passDays: Number(process.env.PASS_DAYS ?? 30),
  // Set in production once the webhook endpoint exists in the Stripe
  // dashboard. Locally the success-page + on-demand sync covers the flow.
  stripeWebhookSecret: process.env.STRIPE_WEBHOOK_SECRET ?? '',
  // Only enabled where a tax registration exists (live). Enabling it without
  // one makes Stripe silently collect no tax — the classic Stripe Tax trap.
  stripeAutomaticTax: process.env.STRIPE_AUTOMATIC_TAX === '1',

  // ---- analytics ----
  /** Project write key. Absent → capture() is a no-op and nothing breaks. */
  posthogKey: process.env.POSTHOG_KEY ?? '',
  /** Personal API key, read side only. Never leaves the server. */
  posthogApiKey: process.env.POSTHOG_API_KEY ?? '',
  posthogProjectId: process.env.POSTHOG_PROJECT_ID ?? '',
  // EU by default: the account is in the EU region and PRIVACY.md says data
  // stays in the EU. A US host here would quietly make that untrue.
  posthogHost: (process.env.POSTHOG_HOST ?? 'https://eu.i.posthog.com').replace(/\/+$/, ''),
  // The query API lives on the app host, not the ingestion host.
  posthogApiHost: (process.env.POSTHOG_API_HOST ?? 'https://eu.posthog.com').replace(/\/+$/, ''),

  /**
   * Who may open /dashboard. A list of e-mail addresses, not a shared secret,
   * so it can sit in an env var without being a credential: whoever is listed
   * still has to sign in with their own password through the normal auth
   * routes, and the per-account throttle in routes/auth.ts still applies.
   */
  adminEmails: (process.env.ADMIN_EMAILS ?? '')
    .split(',')
    .map((e) => e.trim().toLowerCase())
    .filter(Boolean),
};
