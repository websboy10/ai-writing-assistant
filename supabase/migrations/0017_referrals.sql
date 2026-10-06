-- Invitations: a user shares a code, the friend gets a free trial, and the
-- inviter is paid in free days once the friend pays for the first time.
--
-- THE REWARD IS TIED TO A PAYMENT, NOT A SIGNUP, and that is the whole fraud
-- design. A fake account earns its creator nothing until somebody has put 100
-- kroner through Stripe, so there is no signup farm to defend against and no
-- fraud system to build. What a fake account CAN still take is the friend's
-- trial, and that is bounded per device exactly as the ordinary trial always
-- was (trial_devices).
--
-- EVERYTHING IS REACHED THROUGH FUNCTIONS. The table has RLS on and no
-- policies, like app_settings (0014): the two functions a signed-in user may
-- call check auth.uid() themselves, the rest are service_role only.

alter table public.app_settings
  add column referral_enabled boolean not null default true,
  add column referral_friend_trial_days integer not null default 14
    check (referral_friend_trial_days between 0 and 90),
  add column referral_reward_days integer not null default 30
    check (referral_reward_days between 1 and 90),
  -- Rewards one inviter can earn in any rolling 365 days. Without a ceiling a
  -- single link that goes round a school gives the product away for good.
  add column referral_yearly_cap integer not null default 12
    check (referral_yearly_cap between 0 and 1000);

alter table public.billing add column referral_code text unique;

create table public.referrals (
  -- The friend is the key: a person can be invited once, ever.
  referred_user_id uuid primary key references auth.users(id) on delete cascade,
  referrer_id uuid not null references auth.users(id) on delete cascade,
  install_hash text,
  -- Trial days actually handed out. 0 when the device had already had one.
  trial_days integer not null default 0,
  -- pending:    the friend has not paid yet
  -- credit_due: the friend paid and the inviter subscribes, so the reward is a
  --             Stripe credit the backend still has to create
  -- rewarded:   paid out
  -- capped:     the friend paid, but the inviter had reached the yearly cap
  status text not null default 'pending'
    check (status in ('pending', 'credit_due', 'rewarded', 'capped')),
  reward_kind text check (reward_kind in ('days', 'credit')),
  reward_days integer,
  created_at timestamptz not null default now(),
  qualified_at timestamptz,
  rewarded_at timestamptz,
  check (referrer_id <> referred_user_id)
);
alter table public.referrals enable row level security;
revoke all on public.referrals from public, anon, authenticated;

create index referrals_referrer_idx on public.referrals (referrer_id, qualified_at);
-- One invitation trial per browser, whoever the inviter was.
create unique index referrals_trial_device_idx on public.referrals (install_hash) where trial_days > 0;

/**
 * The caller's own code and how their invitations are doing.
 *
 * Also records which account this browser belongs to. The hard paywall stopped
 * billing_init doing that (0014), and without it somebody could invite
 * themselves: sign out, make a second account in the same browser, enter their
 * own code and take the trial.
 */
create or replace function public.referral_mine(p_install_hash text)
returns json
language plpgsql security definer set search_path to 'public'
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

/**
 * Redeem a friend's code.
 *
 * Always records who invited whom when the code is good, and hands out the
 * trial only when this browser has not had one. The two are separate on
 * purpose: a friend on a used device gets no free days, but if they pay, the
 * inviter has still earned the reward.
 *
 * Refusals come back as a reason, not an exception, so the panel can say which
 * of them it was.
 */
create or replace function public.referral_claim(p_code text, p_install_hash text)
returns json
language plpgsql security definer set search_path to 'public'
as $$
declare
  v_uid uuid := auth.uid();
  v_s app_settings%rowtype;
  v_b billing%rowtype;
  v_referrer uuid;
  v_days integer := 0;
begin
  if v_uid is null then raise exception 'forbidden'; end if;

  select * into v_s from app_settings where id = 1;
  if not v_s.referral_enabled then
    return json_build_object('ok', false, 'reason', 'disabled');
  end if;

  select user_id into v_referrer from billing where referral_code = upper(btrim(coalesce(p_code, '')));
  if v_referrer is null then
    return json_build_object('ok', false, 'reason', 'unknown_code');
  end if;
  if v_referrer = v_uid then
    return json_build_object('ok', false, 'reason', 'own_code');
  end if;

  -- Locked, so two tabs redeeming at once cannot both get past the checks.
  select * into v_b from billing where user_id = v_uid for update;
  if not found then
    return json_build_object('ok', false, 'reason', 'no_account');
  end if;
  if exists (select 1 from referrals where referred_user_id = v_uid) then
    return json_build_object('ok', false, 'reason', 'already_claimed');
  end if;
  -- An invitation is for somebody who has never paid. Otherwise every existing
  -- customer redeems a colleague's code and the inviter is rewarded for a
  -- payment that was coming anyway.
  if v_b.stripe_subscription_id is not null
     or exists (select 1 from pass_purchases where user_id = v_uid) then
    return json_build_object('ok', false, 'reason', 'already_customer');
  end if;
  -- Two people inviting each other would each be paid for the other.
  if exists (select 1 from referrals where referred_user_id = v_referrer and referrer_id = v_uid) then
    return json_build_object('ok', false, 'reason', 'mutual');
  end if;

  if v_s.referral_friend_trial_days > 0
     and v_b.status in ('trialing', 'expired')
     and length(coalesce(p_install_hash, '')) >= 8 and p_install_hash <> 'unknown-device'
     and not exists (select 1 from trial_devices d
                     where d.install_hash = p_install_hash and d.first_user_id <> v_uid)
     and not exists (select 1 from referrals r
                     where r.install_hash = p_install_hash and r.trial_days > 0)
  then
    v_days := v_s.referral_friend_trial_days;
    update billing set
      status = 'trialing',
      -- greatest(...) so somebody already on a longer trial never loses days.
      trial_ends_at = greatest(trial_ends_at, now() + make_interval(days => v_days)),
      updated_at = now()
    where user_id = v_uid;
    insert into trial_devices (install_hash, first_user_id)
    values (p_install_hash, v_uid)
    on conflict (install_hash) do nothing;
  end if;

  insert into referrals (referred_user_id, referrer_id, install_hash, trial_days)
  values (v_uid, v_referrer, p_install_hash, v_days);

  return json_build_object('ok', true, 'trial_days', v_days);
end $$;

/**
 * The friend has paid: pay the inviter, exactly once.
 *
 * Called on every completed checkout and every subscription update, so it must
 * be cheap when there is nothing to do (one indexed lookup, then null) and safe
 * when the same payment is delivered three times (the status moves off
 * 'pending' under a row lock, so only the first delivery pays).
 *
 * An inviter WITHOUT a subscription is paid here, in days, in the same
 * transaction. An inviter WITH one cannot be: free days do nothing for someone
 * Stripe charges every month, so the reward has to be a credit on their Stripe
 * balance, and Postgres cannot call Stripe. Those come back as 'credit' and stay
 * 'credit_due' until the backend confirms with referral_credit_done — and every
 * later call returns them again, so a credit that failed half way is retried
 * rather than lost.
 *
 * Switching invitations off stops new codes being redeemed. It does not cancel
 * rewards already promised to people whose friends are still on trial.
 */
create or replace function public.referral_qualify(p_user_id uuid)
returns json
language plpgsql security definer set search_path to 'public'
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

  if r.status = 'pending' then
    select * into v_s from app_settings where id = 1;

    select count(*) into v_used from referrals
    where referrer_id = r.referrer_id
      and status in ('rewarded', 'credit_due')
      and qualified_at > now() - interval '365 days';
    if v_used >= v_s.referral_yearly_cap then
      update referrals set status = 'capped', qualified_at = now() where referred_user_id = p_user_id;
      return json_build_object('referrer_id', r.referrer_id, 'kind', 'capped');
    end if;

    if v_b.stripe_subscription_id is null or v_b.status not in ('active', 'past_due') then
      update billing set
        -- Added after whatever access they already have, trial included, so the
        -- reward is never swallowed by days they were getting anyway.
        access_until = greatest(
          coalesce(access_until, now()),
          case when status = 'trialing' then trial_ends_at else now() end,
          now()
        ) + make_interval(days => v_s.referral_reward_days),
        updated_at = now()
      where user_id = r.referrer_id;
      update referrals set
        status = 'rewarded', reward_kind = 'days', reward_days = v_s.referral_reward_days,
        qualified_at = now(), rewarded_at = now()
      where referred_user_id = p_user_id;
      return json_build_object('referrer_id', r.referrer_id, 'kind', 'days', 'days', v_s.referral_reward_days);
    end if;

    update referrals set
      status = 'credit_due', reward_kind = 'credit', reward_days = v_s.referral_reward_days,
      qualified_at = now()
    where referred_user_id = p_user_id;
    r.reward_days := v_s.referral_reward_days;
  end if;

  return json_build_object(
    'referrer_id', r.referrer_id,
    'kind', 'credit',
    'days', r.reward_days,
    'customer_id', v_b.stripe_customer_id,
    'subscription_id', v_b.stripe_subscription_id
  );
end $$;

create or replace function public.referral_credit_done(p_user_id uuid)
returns void
language sql security definer set search_path to 'public'
as $$
  update referrals set status = 'rewarded', rewarded_at = now()
  where referred_user_id = p_user_id and status = 'credit_due';
$$;

-- ---- the dashboard ---------------------------------------------------------

-- The return type grows, which create-or-replace refuses to do.
drop function public.admin_get_config();
create function public.admin_get_config()
returns table(
  hard_paywall boolean,
  referral_enabled boolean,
  referral_friend_trial_days integer,
  referral_reward_days integer,
  referral_yearly_cap integer
)
language sql security definer set search_path = 'public'
as $$
  select hard_paywall, referral_enabled, referral_friend_trial_days, referral_reward_days, referral_yearly_cap
  from app_settings where id = 1;
$$;

-- Out-of-range numbers are refused by the column checks above, so a typo in
-- the dashboard is an error on screen and never a 9000-day trial.
create or replace function public.admin_set_referral(
  p_enabled boolean,
  p_friend_trial_days integer,
  p_reward_days integer,
  p_yearly_cap integer
)
returns void
language sql security definer set search_path = 'public'
as $$
  update app_settings set
    referral_enabled = p_enabled,
    referral_friend_trial_days = p_friend_trial_days,
    referral_reward_days = p_reward_days,
    referral_yearly_cap = p_yearly_cap,
    updated_at = now()
  where id = 1;
$$;

/**
 * Totals count real users only, like every other figure on the dashboard
 * (0015/0016). The recent list shows our own test invitations too, marked, so
 * the operator can try the flow and see that it registered.
 */
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
    'invited',         (select count(*) from real),
    'inviters',        (select count(distinct referrer_id) from real),
    'trials',          (select count(*) from real where trial_days > 0),
    'paid',            (select count(*) from real where status <> 'pending'),
    'rewarded_days',   (select count(*) from real where status = 'rewarded' and reward_kind = 'days'),
    'rewarded_credit', (select count(*) from real where status = 'rewarded' and reward_kind = 'credit'),
    'credit_due',      (select count(*) from real where status = 'credit_due'),
    'capped',          (select count(*) from real where status = 'capped'),
    'top',    (select coalesce(json_agg(t), '[]'::json) from (
                 select referrer_email as email, count(*) as invited,
                        count(*) filter (where status <> 'pending') as paid,
                        count(*) filter (where status in ('rewarded', 'credit_due')) as rewards
                 from real group by referrer_email
                 order by paid desc, invited desc limit 20) t),
    'recent', (select coalesce(json_agg(t), '[]'::json) from (
                 select created_at, referrer_email, friend_email, status, reward_kind, trial_days, internal
                 from list order by created_at desc limit 30) t)
  );
$$;

-- Explicit anon/authenticated revokes, not just PUBLIC: this project's default
-- privileges grant EXECUTE to `authenticated` on every new function (see 0014).
revoke all on function public.referral_mine(text) from public, anon, authenticated;
revoke all on function public.referral_claim(text, text) from public, anon, authenticated;
revoke all on function public.referral_qualify(uuid) from public, anon, authenticated;
revoke all on function public.referral_credit_done(uuid) from public, anon, authenticated;
revoke all on function public.admin_get_config() from public, anon, authenticated;
revoke all on function public.admin_set_referral(boolean, integer, integer, integer) from public, anon, authenticated;
revoke all on function public.admin_referrals() from public, anon, authenticated;

grant execute on function public.referral_mine(text) to authenticated, service_role;
grant execute on function public.referral_claim(text, text) to authenticated, service_role;
grant execute on function public.referral_qualify(uuid) to service_role;
grant execute on function public.referral_credit_done(uuid) to service_role;
grant execute on function public.admin_get_config() to service_role;
grant execute on function public.admin_set_referral(boolean, integer, integer, integer) to service_role;
grant execute on function public.admin_referrals() to service_role;
