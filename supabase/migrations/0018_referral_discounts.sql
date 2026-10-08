-- Invitations pay in discounts, not in free days.
--
-- The operator's call, 2026-10-08: a friend who redeems a code gets a month at
-- half price, and so does the inviter once that friend has paid. 0017 gave the
-- friend a free trial and the inviter free days; nothing had been redeemed
-- when this replaced it (0 codes issued, 0 rows in referrals), so there is no
-- old promise to honour.
--
-- What changes hands, and where it is kept:
--   friend   a `pending` row in referrals IS the discount: their first
--            checkout carries the coupon, and the row leaves `pending` the
--            moment they pay.
--   inviter  with a running subscription: a credit on their Stripe balance,
--            drawn from the next invoice (as in 0017, sized by the percent).
--            without one: billing.discount_credits, a count of half-price
--            months waiting, spent one per checkout.
--
-- A refund of the friend's first payment takes the inviter's reward back
-- (referral_revoke). 0017 left that hole open: pay, get refunded, the inviter
-- keeps the reward.

alter table public.app_settings
  add column referral_discount_percent integer not null default 50
    check (referral_discount_percent between 1 and 100);

-- referral_claim grants free days only when this is above zero, so the trial
-- is switched off here rather than by rewriting the function.
update public.app_settings set referral_friend_trial_days = 0 where id = 1;

alter table public.billing
  add column discount_credits integer not null default 0 check (discount_credits >= 0);

alter table public.referrals drop constraint referrals_reward_kind_check;
alter table public.referrals add constraint referrals_reward_kind_check
  check (reward_kind in ('days', 'credit', 'discount'));
alter table public.referrals drop constraint referrals_status_check;
alter table public.referrals add constraint referrals_status_check
  check (status in ('pending', 'credit_due', 'rewarded', 'capped', 'refunded'));

-- One row per checkout that spent a credit. The success page and the webhook
-- both deliver the same purchase, and Stripe retries the webhook: the primary
-- key is what makes a credit get spent once.
create table public.discount_uses (
  stripe_session_id text primary key,
  user_id uuid not null references auth.users(id) on delete cascade,
  used_at timestamptz not null default now()
);
alter table public.discount_uses enable row level security;
revoke all on public.discount_uses from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- The discount this user's next checkout carries, if any. A friend's own
-- first-month discount comes before a credit they have earned as an inviter,
-- so the credit is still there for the month after.
-- ---------------------------------------------------------------------------
create or replace function public.referral_discount_for(p_user_id uuid)
returns json
language sql security definer set search_path = 'public'
as $$
  select case
    when exists (select 1 from referrals where referred_user_id = p_user_id and status = 'pending')
      then json_build_object('kind', 'friend', 'percent', s.referral_discount_percent)
    when coalesce((select discount_credits from billing where user_id = p_user_id), 0) > 0
      then json_build_object('kind', 'credit', 'percent', s.referral_discount_percent)
  end
  from app_settings s where s.id = 1;
$$;

create or replace function public.referral_discount_used(p_user_id uuid, p_session_id text)
returns void
language plpgsql security definer set search_path = 'public'
as $$
declare
  v_rows integer;
begin
  if p_user_id is null or p_session_id is null or length(p_session_id) < 8 then
    raise exception 'invalid discount arguments';
  end if;
  insert into discount_uses (stripe_session_id, user_id) values (p_session_id, p_user_id)
  on conflict (stripe_session_id) do nothing;
  get diagnostics v_rows = row_count;
  if v_rows > 0 then
    update billing set discount_credits = greatest(discount_credits - 1, 0), updated_at = now()
    where user_id = p_user_id;
  end if;
end $$;

-- ---------------------------------------------------------------------------
-- The friend paid for the first time: what the inviter is owed.
-- Same locking and the same yearly cap as 0017; only the reward differs.
-- ---------------------------------------------------------------------------
create or replace function public.referral_qualify(p_user_id uuid)
returns json
language plpgsql security definer set search_path = 'public'
as $$
declare
  r referrals%rowtype;
  v_s app_settings%rowtype;
  v_b billing%rowtype;
  v_used integer;
begin
  select * into r from referrals
  where referred_user_id = p_user_id and status in ('pending', 'credit_due')
  for update;
  if not found then return null; end if;

  -- Locking the inviter's row is what makes the cap hold when two of their
  -- friends pay in the same second.
  select * into v_b from billing where user_id = r.referrer_id for update;
  if not found then return null; end if;
  select * into v_s from app_settings where id = 1;

  if r.status = 'pending' then
    select count(*) into v_used from referrals
    where referrer_id = r.referrer_id
      and status in ('rewarded', 'credit_due')
      and qualified_at > now() - interval '365 days';
    if v_used >= v_s.referral_yearly_cap then
      update referrals set status = 'capped', qualified_at = now() where referred_user_id = p_user_id;
      return json_build_object('referrer_id', r.referrer_id, 'kind', 'capped');
    end if;

    if v_b.stripe_subscription_id is null or v_b.status not in ('active', 'past_due') then
      update billing set discount_credits = discount_credits + 1, updated_at = now()
      where user_id = r.referrer_id;
      update referrals set
        status = 'rewarded', reward_kind = 'discount', qualified_at = now(), rewarded_at = now()
      where referred_user_id = p_user_id;
      return json_build_object('referrer_id', r.referrer_id, 'kind', 'discount', 'percent', v_s.referral_discount_percent);
    end if;

    update referrals set status = 'credit_due', reward_kind = 'credit', qualified_at = now()
    where referred_user_id = p_user_id;
  end if;

  return json_build_object(
    'referrer_id', r.referrer_id,
    'kind', 'credit',
    'percent', v_s.referral_discount_percent,
    'customer_id', v_b.stripe_customer_id,
    'subscription_id', v_b.stripe_subscription_id
  );
end $$;

-- ---------------------------------------------------------------------------
-- The friend's first payment was refunded: the reward goes back.
--
-- Only within 30 days of that first payment: a refund of some later month has
-- nothing to do with the invitation.
--
-- A credit that is already spent cannot be taken back and is not chased: the
-- count simply stops at zero. A Stripe balance credit is reversed by the
-- backend, which is told so here (kind = 'credit').
-- ---------------------------------------------------------------------------
create or replace function public.referral_revoke(p_user_id uuid)
returns json
language plpgsql security definer set search_path = 'public'
as $$
declare
  r referrals%rowtype;
  v_customer text;
begin
  select * into r from referrals
  where referred_user_id = p_user_id and status in ('rewarded', 'credit_due')
    and qualified_at > now() - interval '30 days'
  for update;
  if not found then return null; end if;

  if r.reward_kind = 'discount' then
    update billing set discount_credits = greatest(discount_credits - 1, 0), updated_at = now()
    where user_id = r.referrer_id;
  end if;
  update referrals set status = 'refunded' where referred_user_id = p_user_id;

  select stripe_customer_id into v_customer from billing where user_id = r.referrer_id;
  return json_build_object(
    'referrer_id', r.referrer_id,
    'kind', r.reward_kind,
    -- Only a credit that was actually written to Stripe has anything to reverse.
    'reverse_credit', r.reward_kind = 'credit' and r.status = 'rewarded',
    'customer_id', v_customer
  );
end $$;

-- ---------------------------------------------------------------------------
-- What the panel shows: the offer, and whether a discount is waiting for the
-- caller themselves.
-- ---------------------------------------------------------------------------
create or replace function public.referral_mine(p_install_hash text)
returns json
language plpgsql security definer set search_path = 'public'
as $$
declare
  v_uid uuid := auth.uid();
  v_s app_settings%rowtype;
  v_b billing%rowtype;
  v_code text;
begin
  if v_uid is null then raise exception 'forbidden'; end if;

  select * into v_b from billing where user_id = v_uid;
  if not found then return null; end if;
  select * into v_s from app_settings where id = 1;

  v_code := v_b.referral_code;
  while v_code is null loop
    begin
      -- No I, O, 0 or 1: the code gets read aloud and typed from a screenshot.
      update billing set referral_code = (
        select string_agg(substr('ABCDEFGHJKLMNPQRSTUVWXYZ23456789', 1 + floor(random() * 32)::int, 1), '')
        from generate_series(1, 6)
      )
      where user_id = v_uid and referral_code is null;
      select referral_code into v_code from billing where user_id = v_uid;
    exception when unique_violation then
      null; -- somebody else has that one; draw again
    end;
  end loop;

  if length(coalesce(p_install_hash, '')) >= 8 and p_install_hash <> 'unknown-device' then
    insert into trial_devices (install_hash, first_user_id)
    values (p_install_hash, v_uid)
    on conflict (install_hash) do nothing;
  end if;

  return json_build_object(
    'code', v_code,
    'enabled', v_s.referral_enabled,
    'friend_trial_days', v_s.referral_friend_trial_days,
    'reward_days', v_s.referral_reward_days,
    'discount_percent', v_s.referral_discount_percent,
    'my_discount', exists (select 1 from referrals where referred_user_id = v_uid and status = 'pending')
                   or v_b.discount_credits > 0,
    'yearly_cap', v_s.referral_yearly_cap,
    'invited', (select count(*) from referrals where referrer_id = v_uid),
    'paid', (select count(*) from referrals where referrer_id = v_uid and status <> 'pending'),
    'rewards', (select count(*) from referrals where referrer_id = v_uid and status in ('rewarded', 'credit_due')),
    'rewards_this_year', (select count(*) from referrals where referrer_id = v_uid
                            and status in ('rewarded', 'credit_due')
                            and qualified_at > now() - interval '365 days'),
    'can_claim', v_s.referral_enabled
                 and v_b.stripe_subscription_id is null
                 and not exists (select 1 from referrals where referred_user_id = v_uid)
                 and not exists (select 1 from pass_purchases where user_id = v_uid)
  );
end $$;

-- ---------------------------------------------------------------------------
-- Admin: one percentage where there were two day counts.
-- ---------------------------------------------------------------------------
drop function public.admin_get_config();
create function public.admin_get_config()
returns table (hard_paywall boolean, referral_enabled boolean, referral_discount_percent integer, referral_yearly_cap integer)
language sql security definer set search_path = 'public'
as $$
  select hard_paywall, referral_enabled, referral_discount_percent, referral_yearly_cap
  from app_settings where id = 1;
$$;

drop function public.admin_set_referral(boolean, integer, integer, integer);
create function public.admin_set_referral(p_enabled boolean, p_discount_percent integer, p_yearly_cap integer)
returns void
language sql security definer set search_path = 'public'
as $$
  update app_settings set
    referral_enabled = p_enabled,
    referral_discount_percent = p_discount_percent,
    referral_yearly_cap = p_yearly_cap,
    updated_at = now()
  where id = 1;
$$;

create or replace function public.admin_referrals()
returns json
language sql security definer set search_path = 'public'
as $$
  with ext as (select array(select public.internal_user_ids()) as ids),
  list as (
    select r.*, ru.email as referrer_email, fu.email as friend_email,
           (r.referrer_id = any(ext.ids) or r.referred_user_id = any(ext.ids)) as internal
    from referrals r
    join auth.users ru on ru.id = r.referrer_id
    join auth.users fu on fu.id = r.referred_user_id
    cross join ext
  ),
  real as (select * from list where not internal)
  select json_build_object(
    'invited',           (select count(*) from real),
    'inviters',          (select count(distinct referrer_id) from real),
    'paid',              (select count(*) from real where status <> 'pending'),
    'rewarded_discount', (select count(*) from real where status = 'rewarded' and reward_kind = 'discount'),
    'rewarded_credit',   (select count(*) from real where status = 'rewarded' and reward_kind = 'credit'),
    'credit_due',        (select count(*) from real where status = 'credit_due'),
    'capped',            (select count(*) from real where status = 'capped'),
    'refunded',          (select count(*) from real where status = 'refunded'),
    'top',    (select coalesce(json_agg(t), '[]'::json) from (
                 select referrer_email as email, count(*) as invited,
                        count(*) filter (where status not in ('pending', 'refunded')) as paid,
                        count(*) filter (where status in ('rewarded', 'credit_due')) as rewards
                 from real group by referrer_email
                 order by paid desc, invited desc limit 20) t),
    'recent', (select coalesce(json_agg(t), '[]'::json) from (
                 select created_at, referrer_email, friend_email, status, reward_kind, internal
                 from list order by created_at desc limit 30) t)
  );
$$;

-- Explicit anon/authenticated revokes, not just PUBLIC: this project's default
-- privileges grant EXECUTE to `authenticated` on every new function (see 0014).
revoke all on function public.referral_discount_for(uuid) from public, anon, authenticated;
revoke all on function public.referral_discount_used(uuid, text) from public, anon, authenticated;
revoke all on function public.referral_revoke(uuid) from public, anon, authenticated;
revoke all on function public.admin_get_config() from public, anon, authenticated;
revoke all on function public.admin_set_referral(boolean, integer, integer) from public, anon, authenticated;

grant execute on function public.referral_discount_for(uuid) to service_role;
grant execute on function public.referral_discount_used(uuid, text) to service_role;
grant execute on function public.referral_revoke(uuid) to service_role;
grant execute on function public.admin_get_config() to service_role;
grant execute on function public.admin_set_referral(boolean, integer, integer) to service_role;
