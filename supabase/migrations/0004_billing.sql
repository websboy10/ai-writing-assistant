-- Mirror of migration applied via Supabase MCP on 2026-08-06 (billing_and_trial_devices).
-- See apps/backend/src/billing.ts for the consuming code.

create table public.billing (
  user_id uuid primary key references auth.users(id) on delete cascade,
  stripe_customer_id text unique,
  stripe_subscription_id text,
  status text not null default 'trialing',
  trial_ends_at timestamptz not null,
  current_period_end timestamptz,
  updated_at timestamptz not null default now()
);
alter table public.billing enable row level security;
create policy "own billing readable" on public.billing
  for select using (auth.uid() = user_id);

create table public.trial_devices (
  install_hash text primary key,
  first_user_id uuid not null,
  trial_started_at timestamptz not null default now()
);
alter table public.trial_devices enable row level security;

-- Functions: billing_init(uuid,text), billing_set_subscription(uuid,text,text,text,timestamptz),
-- billing_user_for_customer(text) — security definer, granted to anon+authenticated.
-- Full definitions in the applied migration (supabase dashboard → database → migrations).
