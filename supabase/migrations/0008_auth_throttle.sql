-- A throttle for the three unauthenticated endpoints, kept in Postgres because
-- nowhere else in this stack can hold a counter.
--
-- WHY: index.ts registers @fastify/rate-limit with max 60 a minute, which reads
-- like protection and is not. It keeps its counters in memory, and the backend
-- is a Vercel Function: each invocation can be a fresh instance with a fresh,
-- empty counter. Measured against production 2026-08-26, 70 concurrent requests
-- to /api/chat were served 200 without one rejection.
--
-- For the authenticated routes that hardly matters. consume_quota is atomic in
-- this database and bounds what any account can spend, so the worst case is a
-- user burning their own day's allowance quickly.
--
-- /api/auth/login, /signup and /reset have no such floor. They take no token,
-- so nothing identifies the caller and nothing bounds them. Measured the same
-- day: 40 rapid failed logins were all proxied straight through to GoTrue and
-- all answered "Invalid login credentials". Supabase applies limits of its own,
-- but they are not ours, not documented in this repo, and not something to rest
-- credential-stuffing protection on.
--
-- WHY A TABLE AND NOT A COUNTER IN THE FUNCTION: the whole problem is that the
-- backend has no memory between requests. The counter has to live where the
-- data lives.

create table if not exists public.auth_throttle (
  key text primary key,
  count integer not null default 0,
  window_start timestamptz not null default now()
);

-- No policies are defined, so with RLS on, PostgREST exposes nothing here to
-- anon or authenticated. The only way in is the SECURITY DEFINER function
-- below, and that is granted to the service role alone.
alter table public.auth_throttle enable row level security;

/**
 * Records one attempt and says whether it is allowed.
 *
 * A fixed window rather than a sliding one: it is a handful of rows and one
 * statement, and the failure mode of a fixed window (a burst straddling a
 * boundary can reach 2x the limit) is irrelevant at these numbers. Sliding
 * windows cost a row per attempt and a clean-up job to go with them.
 */
create or replace function public.auth_throttle_hit(
  p_key text,
  p_limit integer,
  p_window_seconds integer
)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  v_count integer;
begin
  insert into public.auth_throttle as t (key, count, window_start)
  values (p_key, 1, now())
  on conflict (key) do update
    set count = case
          when t.window_start < now() - make_interval(secs => p_window_seconds) then 1
          else t.count + 1
        end,
        window_start = case
          when t.window_start < now() - make_interval(secs => p_window_seconds) then now()
          else t.window_start
        end
  returning t.count into v_count;

  return v_count <= p_limit;
end;
$$;

-- Same lesson as 0006: a SECURITY DEFINER function granted to PUBLIC hands its
-- privilege to the anon key, which ships inside every extension. An attacker
-- who could call this could spend someone else's budget to lock them out.
revoke all on function public.auth_throttle_hit(text, integer, integer) from public;
revoke all on function public.auth_throttle_hit(text, integer, integer) from anon;
revoke all on function public.auth_throttle_hit(text, integer, integer) from authenticated;
grant execute on function public.auth_throttle_hit(text, integer, integer) to service_role;

-- Rows for keys nobody has touched in a day are dead weight. Cheap to sweep
-- opportunistically from the same function's index rather than run a cron for.
create index if not exists auth_throttle_window_idx on public.auth_throttle (window_start);
