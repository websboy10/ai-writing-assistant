-- The MobilePay route: a month pass, bought once, that expires on its own.
--
-- WHY THIS EXISTS AT ALL. MobilePay is the payment method Danish customers ask
-- for, and Stripe cannot use it for a subscription: it is a single-use card
-- wallet, and Stripe's own documentation lists "Recurring payments: No"
-- (docs.stripe.com/payments/mobilepay). There is no flag to turn that on and no
-- mandate to save. So the only honest way to take MobilePay money is to sell
-- one month at a time, and to say so on the button.
--
-- The gate stays exactly where it was. isAllowed() in apps/backend/src/billing.ts
-- gains one clause — access_until in the future — and nothing else about the
-- paywall moves. A pass and a subscription are the same product; only the
-- renewal differs.

alter table public.billing add column if not exists access_until timestamptz;

-- Idempotency, in the database rather than in the handler.
--
-- The same purchase reaches us up to three times: the success-page redirect,
-- the checkout.session.completed webhook, and Stripe's own retry of that
-- webhook if our reply is slow. Adding 30 days per delivery would hand out a
-- quarter of a year for 100 kroner, and it would happen on the very first real
-- payment rather than in some rare edge case.
create table if not exists public.pass_purchases (
  stripe_session_id text primary key,
  user_id uuid not null references auth.users(id) on delete cascade,
  days integer not null,
  amount_dkk integer,
  granted_at timestamptz not null default now()
);
alter table public.pass_purchases enable row level security;

-- Read your own receipts, write none of them. Every insert goes through the
-- SECURITY DEFINER function below, which is service_role only.
drop policy if exists "own passes readable" on public.pass_purchases;
create policy "own passes readable" on public.pass_purchases
  for select using (auth.uid() = user_id);

create index if not exists pass_purchases_user_idx on public.pass_purchases (user_id, granted_at desc);

/**
 * Grant one pass, exactly once per Stripe session.
 *
 * Returns the access_until the account ends up with, whether this call was the
 * one that granted it or a duplicate delivery of a purchase already applied —
 * so the caller never has to tell the two apart, and a retry is free.
 *
 * Extends rather than replaces: buying a second pass on day 20 gives 40 days
 * left, not 30. Anything else quietly takes ten days off a paying customer.
 */
create or replace function public.billing_grant_pass(
  p_user_id uuid,
  p_days integer,
  p_session_id text,
  p_amount_dkk integer default null
)
returns timestamptz
language plpgsql security definer set search_path to 'public'
as $$
declare
  v_rows integer;
  v_until timestamptz;
begin
  -- A bad argument here spends someone's money or gives the product away, so
  -- none of them are trusted. 400 days is well past any pass we sell and well
  -- short of the "free forever" an unbounded number would grant.
  if p_user_id is null or p_session_id is null or length(p_session_id) < 8 then
    raise exception 'invalid pass arguments';
  end if;
  if p_days is null or p_days <= 0 or p_days > 400 then
    raise exception 'invalid pass length';
  end if;

  insert into pass_purchases (stripe_session_id, user_id, days, amount_dkk)
  values (p_session_id, p_user_id, p_days, p_amount_dkk)
  on conflict (stripe_session_id) do nothing;

  -- ROW_COUNT is an integer, not a boolean: 1 when this call is the one that
  -- recorded the purchase, 0 when Stripe has delivered it to us before.
  get diagnostics v_rows = row_count;

  if v_rows > 0 then
    update billing set
      -- greatest(...) so a pass bought while one is still running adds to it,
      -- and one bought after a gap starts from today rather than from a date
      -- in the past.
      access_until = greatest(coalesce(access_until, now()), now()) + make_interval(days => p_days),
      updated_at = now()
    where user_id = p_user_id;
  end if;

  select b.access_until into v_until from billing b where b.user_id = p_user_id;
  return v_until;
end $$;

revoke execute on function public.billing_grant_pass(uuid, integer, text, integer)
  from public, anon, authenticated;
grant execute on function public.billing_grant_pass(uuid, integer, text, integer) to service_role;
