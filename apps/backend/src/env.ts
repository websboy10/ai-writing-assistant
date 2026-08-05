import 'dotenv/config';

function required(name: string): string {
  const v = process.env[name];
  if (!v) throw new Error(`Missing required env var: ${name}`);
  return v;
}

export const env = {
  port: Number(process.env.PORT ?? 8787),
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
};
