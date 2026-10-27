-- The admin can see and act on one person, not just counts.
--
-- WHY. Until now the dashboard returned totals only, and the three things the
-- operator actually does to an account (mark it internal, give it free access,
-- raise its daily limit) were SQL typed by hand. The War Room (and /dashboard)
-- now do them through the admin API, which calls these functions.
--
-- PRIVACY. One row per account carries counts and dates only: never a
-- conversation title, a message or a template (PRIVACY.md).
--
-- Every function is service_role only. This project's default privileges grant
-- EXECUTE to authenticated on every new function, so the revoke names all three.

-- Everyone, newest first, our own accounts included and flagged so the list can
-- show them; every figure elsewhere still leaves them out.
create or replace function public.admin_users(p_q text default null, p_limit int default 200)
returns json
language sql
stable
security definer
set search_path to 'public'
as $$
  select coalesce(json_agg(r order by r.signed_up desc), '[]'::json)
  from (
    select
      u.id, u.email, u.created_at as signed_up, u.last_sign_in_at as last_sign_in,
      u.email_confirmed_at is not null as confirmed,
      i.email is not null as internal,
      b.status, b.trial_ends_at, b.current_period_end, b.access_until,
      b.stripe_customer_id, b.stripe_subscription_id, b.referral_code, b.discount_credits,
      coalesce(p.daily_limit, 200) as daily_limit,
      case
        when b.user_id is null then 'no billing row'
        when b.access_until > now() then 'pass'
        when b.stripe_subscription_id is not null and b.status in ('active', 'past_due') then b.status
        when b.status = 'active' then 'free'
        when b.status = 'trialing' and b.trial_ends_at > now() then 'trial'
        else 'expired'
      end as plan,
      coalesce(uc.today, 0) as answers_today,
      coalesce(uc.d7, 0) as answers_7d,
      coalesce(uc.d30, 0) as answers_30d,
      coalesce(uc.total, 0) as answers_total,
      coalesce(uc.capped_30d, 0) as capped_days_30d,
      uc.last_day as last_used,
      (select count(*) from conversations c where c.user_id = u.id) as conversations
    from auth.users u
    left join billing b on b.user_id = u.id
    left join profiles p on p.id = u.id
    left join internal_accounts i on i.email = lower(u.email)
    left join lateral (
      select
        sum(requests) filter (where day = (now() at time zone 'utc')::date) as today,
        sum(requests) filter (where day > (now() at time zone 'utc')::date - 7) as d7,
        sum(requests) filter (where day > (now() at time zone 'utc')::date - 30) as d30,
        sum(requests) as total,
        count(*) filter (where day > (now() at time zone 'utc')::date - 30
                           and requests >= coalesce(p.daily_limit, 200)) as capped_30d,
        max(day) as last_day
      from usage_counters x where x.user_id = u.id
    ) uc on true
    where p_q is null or p_q = '' or u.email ilike '%' || p_q || '%'
    order by u.created_at desc
    limit least(greatest(coalesce(p_limit, 200), 1), 500)
  ) r;
$$;

-- On = a row in internal_accounts (left out of every number); off = no row.
create or replace function public.admin_set_internal(p_email text, p_internal boolean, p_note text default null)
returns boolean
language plpgsql
security definer
set search_path to 'public'
as $$
begin
  if p_email is null or position('@' in p_email) = 0 then
    raise exception 'email required';
  end if;
  if p_internal then
    insert into internal_accounts (email, note) values (lower(trim(p_email)), nullif(trim(p_note), ''))
    on conflict (email) do update set note = coalesce(excluded.note, internal_accounts.note);
  else
    delete from internal_accounts where email = lower(trim(p_email));
  end if;
  return p_internal;
end;
$$;

-- Free access rides on the month-pass column, which isAllowed() already checks
-- first, instead of the 100-year-trial hack of 0009/0010. No pass_purchases row:
-- nothing was sold. p_days = 0 ends any running pass now.
create or replace function public.admin_grant_access(p_user_id uuid, p_days int)
returns timestamptz
language plpgsql
security definer
set search_path to 'public'
as $$
declare v_until timestamptz;
begin
  if p_days is null or p_days < 0 or p_days > 3650 then
    raise exception 'days must be 0-3650';
  end if;
  update billing
     set access_until = case when p_days = 0 then now()
                             else greatest(coalesce(access_until, now()), now()) + make_interval(days => p_days) end,
         updated_at = now()
   where user_id = p_user_id
  returning access_until into v_until;
  if not found then raise exception 'no billing row for that user'; end if;
  return v_until;
end;
$$;

create or replace function public.admin_set_daily_limit(p_user_id uuid, p_limit int)
returns int
language plpgsql
security definer
set search_path to 'public'
as $$
begin
  if p_limit is null or p_limit < 1 or p_limit > 100000 then
    raise exception 'limit must be 1-100000';
  end if;
  update profiles set daily_limit = p_limit where id = p_user_id;
  if not found then raise exception 'no profile for that user'; end if;
  return p_limit;
end;
$$;

revoke execute on function public.admin_users(text, int) from public, anon, authenticated;
revoke execute on function public.admin_set_internal(text, boolean, text) from public, anon, authenticated;
revoke execute on function public.admin_grant_access(uuid, int) from public, anon, authenticated;
revoke execute on function public.admin_set_daily_limit(uuid, int) from public, anon, authenticated;
grant execute on function public.admin_users(text, int) to service_role;
grant execute on function public.admin_set_internal(text, boolean, text) to service_role;
grant execute on function public.admin_grant_access(uuid, int) to service_role;
grant execute on function public.admin_set_daily_limit(uuid, int) to service_role;
