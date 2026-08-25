-- Lets the backend drop a Stripe customer link that Stripe no longer has.
--
-- billing_set_subscription deliberately coalesces its ids, so a null never
-- clears one — a good guard against a partial update wiping a live link, but
-- it also means a customer deleted in Stripe stays pointed at forever. Every
-- entitlement check then re-attempts the same doomed API call on the hot path
-- (chat, autonomous mode, and the panel's five-second status poll).
--
-- Measured 2026-08-25: tester2@example.com pointed at cus_V1SUAhHITKgrRm,
-- which no longer exists. /api/chat answered 503 and /api/billing/status
-- returned the raw Stripe error, customer id and all, to the client.
--
-- Additive only: no schema change, no data migration. See
-- apps/backend/src/billing.ts → syncFromStripe for the sole caller.
create or replace function public.billing_forget_customer(p_user_id uuid)
returns void
language plpgsql
security definer
set search_path to 'public'
as $$
begin
  update billing set
    stripe_customer_id = null,
    stripe_subscription_id = null,
    current_period_end = null,
    -- Falling back to the trial's own verdict: an expired trial stays expired,
    -- an unexpired one keeps the days it has left.
    status = case when trial_ends_at > now() then 'trialing' else 'expired' end,
    updated_at = now()
  where user_id = p_user_id;
end $$;

grant execute on function public.billing_forget_customer(uuid) to anon, authenticated;
