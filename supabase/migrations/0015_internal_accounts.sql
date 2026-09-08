-- The dashboard must not count the operator's own use as a customer's.
--
-- WHY THIS EXISTS. On 2026-09-08 three of the seven accounts in this database
-- were the operator's own or a test mailbox, and they accounted for 107 of the
-- 182 generations ever made. Every figure on /dashboard — accounts, conversion,
-- svar pr. dag, cost per answer, runway — was therefore mostly a measurement of
-- ourselves. A number nobody can act on is worse than no number.
--
-- WHY A TABLE AND NOT A LIST IN CODE. The same set has to be excluded in three
-- different places (this database, PostHog, Stripe), and the emails are already
-- hardcoded in 0009/0010 for the free-access grant. One row per account is the
-- single source of truth, and adding or removing one is an INSERT/DELETE rather
-- than a migration, a deploy and a code review.
create table if not exists public.internal_accounts (
  email    text primary key,
  note     text,
  added_at timestamptz not null default now(),
  -- Matching is done on lower(email); storing a capital here would create a row
  -- that silently never matches anything.
  constraint internal_accounts_email_is_lower check (email = lower(email))
);

alter table public.internal_accounts enable row level security;
revoke all on table public.internal_accounts from anon, authenticated;

-- The four operator accounts from 0009/0010 (two of which do not exist in this
-- project yet — listed so they are excluded the day they are created), plus the
-- +awatest mailbox the automated walks sign in as.
insert into public.internal_accounts (email, note) values
  ('sehit@degirmenci.dk',          'operatør'),
  ('sehitdd@gmail.com',            'operatør'),
  ('websboy10@gmail.com',          'operatør'),
  ('77656@kbhsyd.nu',              'operatør'),
  ('modestlyeu+awatest@gmail.com', 'testkonto')
on conflict (email) do nothing;

create or replace function public.internal_user_ids()
returns setof uuid
language sql
stable
security definer
set search_path to 'public'
as $$
  select u.id from auth.users u
  join public.internal_accounts i on lower(u.email) = i.email
$$;

revoke execute on function public.internal_user_ids() from public, anon, authenticated;
grant execute on function public.internal_user_ids() to service_role;

-- The same set, for the two sources this database cannot filter: PostHog keys
-- its events on the Supabase uuid, and Stripe keys its objects on the e-mail.
create or replace function public.admin_internal()
returns json
language sql
stable
security definer
set search_path to 'public'
as $$
  select json_build_object(
    'ids',    coalesce((select json_agg(id) from public.internal_user_ids() id), '[]'::json),
    'emails', coalesce((select json_agg(email order by email) from public.internal_accounts), '[]'::json)
  );
$$;

revoke execute on function public.admin_internal() from public, anon, authenticated;
grant execute on function public.admin_internal() to service_role;

-- admin_stats, with every count taken over real users only. Same output shape
-- as 0013 — only the population changed.
create or replace function public.admin_stats()
returns json
language sql
security definer
set search_path to 'public'
as $$
  with ext as (select array(select public.internal_user_ids()) as ids)
  select json_build_object(
    'accounts',            (select count(*) from auth.users u where not (u.id = any(ext.ids))),
    'accounts_7d',         (select count(*) from auth.users u where not (u.id = any(ext.ids))
                              and u.created_at > now() - interval '7 days'),
    'accounts_30d',        (select count(*) from auth.users u where not (u.id = any(ext.ids))
                              and u.created_at > now() - interval '30 days'),
    'confirmed',           (select count(*) from auth.users u where not (u.id = any(ext.ids))
                              and u.email_confirmed_at is not null),
    'trialing',            (select count(*) from billing where not (user_id = any(ext.ids))
                              and status = 'trialing' and trial_ends_at > now()),
    'trial_expired',       (select count(*) from billing
                            where not (user_id = any(ext.ids))
                              and status in ('trialing','expired') and trial_ends_at <= now()
                              and coalesce(access_until, '-infinity'::timestamptz) <= now()),
    'subscribed',          (select count(*) from billing where not (user_id = any(ext.ids))
                              and stripe_subscription_id is not null
                              and status in ('active','past_due')),
    'pass_active',         (select count(*) from billing where not (user_id = any(ext.ids))
                              and access_until > now()),
    'passes_sold',         (select count(*) from pass_purchases where not (user_id = any(ext.ids))),
    'passes_sold_30d',     (select count(*) from pass_purchases where not (user_id = any(ext.ids))
                              and granted_at > now() - interval '30 days'),
    'conversations',       (select count(*) from conversations where not (user_id = any(ext.ids))),
    'messages',            (select count(*) from messages m
                            where m.conversation_id in (select c.id from conversations c
                                                        where not (c.user_id = any(ext.ids)))),
    'templates',           (select count(*) from templates where not (user_id = any(ext.ids))),
    'requests_today',      (select coalesce(sum(requests), 0) from usage_counters
                            where not (user_id = any(ext.ids))
                              and day = (now() at time zone 'utc')::date),
    'requests_30d',        (select coalesce(sum(requests), 0) from usage_counters
                            where not (user_id = any(ext.ids))
                              and day > (now() at time zone 'utc')::date - 30),
    'daily_requests',      (select coalesce(json_agg(json_build_array(d.day, d.n) order by d.day), '[]'::json)
                            from (select day, sum(requests) as n from usage_counters
                                  where not (user_id = any(ext.ids))
                                    and day > (now() at time zone 'utc')::date - 30
                                  group by day) d),
    -- Said out loud on the page: a filtered dashboard that does not say it is
    -- filtered is the next way to be misled.
    'excluded_accounts',   (select count(*) from unnest(ext.ids))
  )
  from ext;
$$;

revoke execute on function public.admin_stats() from public, anon, authenticated;
grant execute on function public.admin_stats() to service_role;
