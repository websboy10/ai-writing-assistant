-- Close an unauthenticated paywall bypass, and a self-serve quota reset.
--
-- WHY: supabase.ts says "the backend never holds a privileged key — every DB
-- access runs with the user's own JWT so RLS is the enforcement layer, not
-- backend discipline." That is a good principle, and these functions quietly
-- broke it. Each is SECURITY DEFINER (so it runs as the owner, ignoring RLS)
-- and each was granted to PUBLIC — which includes `anon`, the role behind the
-- publishable key that ships in every extension and is printed into the
-- password-reset page. Privilege the backend needed was handed to the whole
-- internet instead.
--
-- Measured against the live project 2026-08-25, both with plain curl:
--
--   billing_set_subscription  With ONLY the publishable key and NO user token
--                             at all, an expired account went from
--                             active:false to active:true. Anyone holding a
--                             user id gets the product free, permanently. It
--                             takes any p_user_id, so it works on other
--                             people's accounts too.
--
--   refund_quota              Any signed-in user reset their own daily counter
--                             at will (200/200 -> 150/200 in one call). The
--                             daily limit that PROJECT.md calls "a correctness
--                             requirement, not a feature", because it is what
--                             stops a shared operator-funded API key being
--                             drained, could not be enforced.
--
--   consume_quota             Took p_cost unchecked, so a negative cost was a
--                             second route to the same result.
--
-- HOW THIS IS SAFE TO DEPLOY: the functions that genuinely have no user
-- context are only the Stripe push channels (webhook, checkout-success). Every
-- one of those already logs and continues on failure, because the on-demand
-- re-sync in billing.ts is the designed safety net — a completed payment
-- unlocks the product even if every push channel fails. That re-sync DOES have
-- the user, so it moves to billing_sync_self below and keeps working with no
-- privileged key at all. Paying customers are never blocked by this change.

-- 1. Self-scoped functions: prove you are who you name.

create or replace function public.billing_init(p_user_id uuid, p_install_hash text)
returns table(status text, trial_ends_at timestamptz)
language plpgsql security definer set search_path to 'public'
as $$
declare
  v_device_used boolean;
  v_trial_end timestamptz;
begin
  -- The backend always calls this with the user's own JWT and their own id.
  if auth.uid() is null or auth.uid() <> p_user_id then
    raise exception 'forbidden';
  end if;

  if exists (select 1 from billing b where b.user_id = p_user_id) then
    return query select b.status, b.trial_ends_at from billing b where b.user_id = p_user_id;
    return;
  end if;

  select exists (
    select 1 from trial_devices d
    where d.install_hash = p_install_hash and d.first_user_id <> p_user_id
  ) into v_device_used;

  if v_device_used then
    v_trial_end := now();  -- no fresh trial on a device that already had one
  else
    v_trial_end := now() + interval '7 days';
    insert into trial_devices (install_hash, first_user_id)
    values (p_install_hash, p_user_id)
    on conflict (install_hash) do nothing;
  end if;

  insert into billing (user_id, status, trial_ends_at)
  values (p_user_id, case when v_device_used then 'expired' else 'trialing' end, v_trial_end);

  return query select b.status, b.trial_ends_at from billing b where b.user_id = p_user_id;
end $$;

-- Body kept byte-for-byte from 0005 apart from the guard: dropping
-- current_period_end and the trial-verdict status fallback here would have
-- quietly changed what "forget this customer" means.
create or replace function public.billing_forget_customer(p_user_id uuid)
returns void
language plpgsql security definer set search_path to 'public'
as $$
begin
  if auth.uid() is null or auth.uid() <> p_user_id then
    raise exception 'forbidden';
  end if;
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

-- 2. The on-demand re-sync, as a function that cannot touch anyone else.
--    Deliberately NOT given a p_user_id: there is nothing to forge.
create or replace function public.billing_sync_self(
  p_customer_id text,
  p_subscription_id text,
  p_status text,
  p_period_end timestamptz
)
returns void
language plpgsql security definer set search_path to 'public'
as $$
declare
  v_user uuid := auth.uid();
begin
  if v_user is null then
    raise exception 'unauthenticated';
  end if;
  if p_status not in ('trialing','active','past_due','canceled','expired') then
    raise exception 'invalid status';
  end if;
  update billing set
    stripe_customer_id = coalesce(p_customer_id, stripe_customer_id),
    stripe_subscription_id = coalesce(p_subscription_id, stripe_subscription_id),
    status = p_status,
    current_period_end = p_period_end,
    updated_at = now()
  where user_id = v_user;
end $$;

revoke execute on function public.billing_sync_self(text, text, text, timestamptz) from public;
grant execute on function public.billing_sync_self(text, text, text, timestamptz) to authenticated, service_role;

-- 3. A cost is a cost. Negative spending is not a discount.
create or replace function public.consume_quota(p_cost integer default 1)
returns json
language plpgsql security definer set search_path to 'public'
as $$
declare
  v_user uuid := auth.uid();
  v_limit int;
  v_used int;
  v_reset timestamptz := (date_trunc('day', now() at time zone 'utc') + interval '1 day') at time zone 'utc';
begin
  if v_user is null then
    raise exception 'unauthenticated';
  end if;
  if p_cost is null or p_cost <= 0 then
    raise exception 'invalid cost';
  end if;

  select daily_limit into v_limit from public.profiles where id = v_user;
  if v_limit is null then
    v_limit := 200;
  end if;

  insert into public.usage_counters (user_id, day, requests)
  values (v_user, (now() at time zone 'utc')::date, p_cost)
  on conflict (user_id, day)
  do update set requests = usage_counters.requests + p_cost
  where usage_counters.requests + p_cost <= v_limit
  returning requests into v_used;

  if v_used is null then
    select requests into v_used from public.usage_counters
      where user_id = v_user and day = (now() at time zone 'utc')::date;
    return json_build_object('ok', false, 'used', coalesce(v_used, 0), 'limit', v_limit, 'resets_at', v_reset);
  end if;

  return json_build_object('ok', true, 'used', v_used, 'limit', v_limit, 'resets_at', v_reset);
end $$;

-- 4. Genuinely privileged, so genuinely restricted.
--
-- refund_quota is the interesting one: it MUST NOT be reachable by the person
-- it benefits, and the backend's every call site already tolerates it failing
-- (each one is `.catch(log)`), because a missed refund costs one quota point
-- and a self-serve refund costs the whole limit. Until the backend is given a
-- service-role key it will simply stop refunding, loudly, which is the correct
-- way round to fail.
-- A service-callable variant, because the original resolves its target with
-- auth.uid(): called as service_role there is no auth.uid(), so it would have
-- become a permanent silent no-op rather than a restricted function.
create or replace function public.refund_quota_for(p_user_id uuid, p_cost integer)
returns void
language plpgsql security definer set search_path to 'public'
as $$
begin
  if p_cost is null or p_cost <= 0 or p_user_id is null then
    return;
  end if;
  update public.usage_counters
    set requests = greatest(0, requests - p_cost)
    where user_id = p_user_id and day = (now() at time zone 'utc')::date;
end $$;

revoke execute on function public.refund_quota_for(uuid, integer) from public, anon, authenticated;
grant execute on function public.refund_quota_for(uuid, integer) to service_role;

revoke execute on function public.refund_quota(integer) from public, anon, authenticated;
grant execute on function public.refund_quota(integer) to service_role;

revoke execute on function public.billing_set_subscription(uuid, text, text, text, timestamptz)
  from public, anon, authenticated;
grant execute on function public.billing_set_subscription(uuid, text, text, text, timestamptz) to service_role;

revoke execute on function public.billing_user_for_customer(text) from public, anon, authenticated;
grant execute on function public.billing_user_for_customer(text) to service_role;

-- billing_init and billing_forget_customer now check auth.uid() themselves, so
-- they stay reachable by a signed-in user and by nobody else.
revoke execute on function public.billing_init(uuid, text) from public, anon;
grant execute on function public.billing_init(uuid, text) to authenticated, service_role;
revoke execute on function public.billing_forget_customer(uuid) from public, anon;
grant execute on function public.billing_forget_customer(uuid) to authenticated, service_role;
