-- 0002_refund: give the quota point back when a generation delivered nothing.
--
-- WHY: consume_quota runs BEFORE the AI call (QUOT-01, correct), but without
-- compensation a beta user could burn a whole day's quota on zero output when
-- free models 429 (review WR-06).
--
-- Applied to the live project 2026-08-05. Direct decrement with a floor at 0
-- rather than delegating with a negative cost — consume_quota's limit check is
-- meaningless for refunds and a stray refund must never drive the counter
-- negative.

create or replace function public.refund_quota(p_cost int default 1)
returns void
language plpgsql
security definer set search_path = public
as $$
begin
  if p_cost <= 0 or auth.uid() is null then
    return;
  end if;
  update public.usage_counters
    set requests = greatest(0, requests - p_cost)
    where user_id = auth.uid() and day = (now() at time zone 'utc')::date;
end;
$$;

-- Callable by signed-in users only; scoped to auth.uid() so a user can only
-- ever refund themselves.
revoke all on function public.refund_quota(int) from public, anon;
grant execute on function public.refund_quota(int) to authenticated;
