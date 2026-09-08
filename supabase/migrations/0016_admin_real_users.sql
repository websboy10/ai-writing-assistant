-- Count only people we can name, instead of subtracting the ones we can.
--
-- WHY 0015 WAS NOT ENOUGH. It removed our own accounts by looking them up in
-- auth.users, which can only see accounts that still exist. Every test account
-- deleted along the way — and there have been many since June — kept its events
-- in PostHog and its objects in Stripe under a uuid that no longer resolves, so
-- the funnel, the model split, the failure list and the cost per answer were
-- still mostly us. The same hole opens again for every future account we delete.
--
-- So the rule is inverted: a figure counts a person only if their id is a real
-- user in this database right now and not one of ours. Anything else — a deleted
-- account, a test account, an id from a database we no longer have — is not
-- counted. The cost of that trade is that a real customer who deletes their
-- account leaves the history, which for a product with a handful of users is a
-- much smaller lie than the one it replaces.
create or replace function public.admin_internal()
returns json
language sql
stable
security definer
set search_path to 'public'
as $$
  select json_build_object(
    -- The allow-list: everyone who is a real user of the product today.
    'real_ids',       coalesce((select json_agg(u.id)
                                from auth.users u
                                where u.id not in (select public.internal_user_ids())), '[]'::json),
    -- Their Stripe customers, so a payment can be matched even when the object
    -- carries no metadata (a subscription invoice does not).
    'real_customers', coalesce((select json_agg(b.stripe_customer_id)
                                from billing b
                                where b.stripe_customer_id is not null
                                  and b.user_id not in (select public.internal_user_ids())), '[]'::json),
    'internal_ids',   coalesce((select json_agg(id) from public.internal_user_ids() id), '[]'::json),
    'emails',         coalesce((select json_agg(email order by email) from public.internal_accounts), '[]'::json)
  );
$$;

revoke execute on function public.admin_internal() from public, anon, authenticated;
grant execute on function public.admin_internal() to service_role;
