-- Real product numbers for the operator's dashboard.
--
-- WHY A FUNCTION AND NOT A QUERY. Every other database call this backend makes
-- runs with the signed-in user's own JWT, so RLS answers "your rows" — which is
-- exactly right everywhere else and useless here: "how many accounts do I have"
-- is a question about everyone's rows. This is the one legitimate cross-user
-- read in the product, so it is one function, returning counts only, reachable
-- by service_role alone.
--
-- IT RETURNS NO PERSONAL DATA. Counts and dates, never an address, never a
-- message, never a title. A dashboard does not need to know who; it needs to
-- know how many. That also means a leak of this function's output is a leak of
-- aggregates, not of customers.
create or replace function public.admin_stats()
returns json
language sql
security definer
set search_path to 'public'
as $$
  select json_build_object(
    'accounts',            (select count(*) from auth.users),
    'accounts_7d',         (select count(*) from auth.users where created_at > now() - interval '7 days'),
    'accounts_30d',        (select count(*) from auth.users where created_at > now() - interval '30 days'),
    'confirmed',           (select count(*) from auth.users where email_confirmed_at is not null),
    'trialing',            (select count(*) from billing where status = 'trialing' and trial_ends_at > now()),
    'trial_expired',       (select count(*) from billing
                            where status in ('trialing','expired') and trial_ends_at <= now()
                              and coalesce(access_until, '-infinity'::timestamptz) <= now()),
    'subscribed',          (select count(*) from billing where stripe_subscription_id is not null
                              and status in ('active','past_due')),
    'pass_active',         (select count(*) from billing where access_until > now()),
    'passes_sold',         (select count(*) from pass_purchases),
    'passes_sold_30d',     (select count(*) from pass_purchases where granted_at > now() - interval '30 days'),
    'conversations',       (select count(*) from conversations),
    'messages',            (select count(*) from messages),
    'templates',           (select count(*) from templates),
    'requests_today',      (select coalesce(sum(requests), 0) from usage_counters
                            where day = (now() at time zone 'utc')::date),
    'requests_30d',        (select coalesce(sum(requests), 0) from usage_counters
                            where day > (now() at time zone 'utc')::date - 30),
    -- Daily request volume straight from the quota counters. This is the one
    -- series that cannot be lost: it is written inside the same transaction
    -- that authorises the generation, so unlike the analytics events it cannot
    -- go missing to a frozen serverless invocation.
    'daily_requests',      (select coalesce(json_agg(json_build_array(d.day, d.n) order by d.day), '[]'::json)
                            from (select day, sum(requests) as n from usage_counters
                                  where day > (now() at time zone 'utc')::date - 30
                                  group by day) d)
  );
$$;

revoke execute on function public.admin_stats() from public, anon, authenticated;
grant execute on function public.admin_stats() to service_role;
