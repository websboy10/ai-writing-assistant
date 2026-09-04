-- Read-only security audit. Paste the whole file into the Supabase SQL editor
-- (Database -> SQL editor) and read the six results.
--
-- WHY THIS IS A SCRIPT AND NOT A CLAIM IN A DOCUMENT. This machine cannot
-- reach this project's database: the Supabase login that can see it is not
-- attached to this session, and there is no backend .env here. So the honest
-- thing is a query that reports what is actually true, rather than a paragraph
-- asserting the schema is locked down because the migration files look right.
-- Migration 0001 was applied through the dashboard and is not in this repo at
-- all, so its policies have never been read by anyone auditing this code.
--
-- WHAT "BAD" LOOKS LIKE is written above each query. Anything a query returns
-- under a heading that says rows are bad needs fixing; an empty result is a
-- pass.

-- 1. BAD IF ANY ROWS. A public table without RLS is readable and writable by
--    anyone holding the publishable key, which ships inside every copy of the
--    extension.
select 'NO RLS' as finding, c.relname as table_name
from pg_class c
join pg_namespace n on n.oid = c.relnamespace
where n.nspname = 'public' and c.relkind = 'r' and not c.relrowsecurity
order by c.relname;

-- 2. INFORMATION. RLS on with no policies means "nobody may touch it except a
--    SECURITY DEFINER function". That is correct for auth_throttle and
--    trial_devices. Anything else in this list is a table the product cannot
--    read, which is usually a mistake rather than a lock.
select 'RLS ON, NO POLICIES' as finding, c.relname as table_name
from pg_class c
join pg_namespace n on n.oid = c.relnamespace
where n.nspname = 'public' and c.relkind = 'r' and c.relrowsecurity
  and not exists (select 1 from pg_policy p where p.polrelid = c.oid)
order by c.relname;

-- 3. BAD IF ANY ROWS. A policy whose USING clause is literally true, or that
--    applies to the anon role, opens the table to everyone. Every policy in
--    this product should compare auth.uid() against a user_id column.
select 'BROAD POLICY' as finding,
       c.relname as table_name, p.polname as policy, p.polcmd as command,
       pg_get_expr(p.polqual, p.polrelid) as using_clause,
       pg_get_expr(p.polwithcheck, p.polrelid) as with_check
from pg_policy p
join pg_class c on c.oid = p.polrelid
join pg_namespace n on n.oid = c.relnamespace
where n.nspname = 'public'
  and (
    coalesce(pg_get_expr(p.polqual, p.polrelid), 'true') = 'true'
    or 'anon' = any (select rolname from pg_roles where oid = any (p.polroles))
  )
order by c.relname, p.polname;

-- 4. BAD IF ANY ROWS. A SECURITY DEFINER function runs as its owner and
--    ignores RLS. One granted to PUBLIC or anon hands that privilege to the
--    publishable key. This is exactly the hole migration 0006 closed, measured
--    with plain curl on 2026-08-25: an expired account was switched to active
--    with no user token at all.
select 'DEFINER GRANTED TO PUBLIC/ANON' as finding,
       p.proname as function_name, pg_get_function_identity_arguments(p.oid) as args
from pg_proc p
join pg_namespace n on n.oid = p.pronamespace
where n.nspname = 'public' and p.prosecdef
  and (
    has_function_privilege('anon', p.oid, 'EXECUTE')
    or has_function_privilege('public', p.oid, 'EXECUTE')
  )
order by p.proname;

-- 5. BAD IF ANY ROWS. A SECURITY DEFINER function without a pinned
--    search_path can be hijacked: a caller who can create objects in a schema
--    earlier on the path makes the function call their code as the owner.
select 'DEFINER WITHOUT search_path' as finding,
       p.proname as function_name, pg_get_function_identity_arguments(p.oid) as args
from pg_proc p
join pg_namespace n on n.oid = p.pronamespace
where n.nspname = 'public' and p.prosecdef
  and not exists (
    select 1 from unnest(coalesce(p.proconfig, '{}')) cfg where cfg like 'search_path=%'
  )
order by p.proname;

-- 6. INFORMATION. Every table privilege anon holds. anon should hold nothing
--    in this product: the extension never talks to PostgREST directly, and the
--    backend always sends a user's own JWT, which authenticates as
--    `authenticated` rather than `anon`.
select 'ANON TABLE GRANT' as finding, table_name, privilege_type
from information_schema.role_table_grants
where grantee = 'anon' and table_schema = 'public'
order by table_name, privilege_type;
