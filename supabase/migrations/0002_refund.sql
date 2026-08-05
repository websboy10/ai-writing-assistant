-- 0002_refund: give the quota point back when a generation delivered nothing.
--
-- WHY: consume_quota runs BEFORE the AI call (QUOT-01, correct), but until now
-- there was no compensation when every model failed or policy blocked the
-- request — with free models 429ing routinely, a beta user could burn a whole
-- day's quota on zero output (review WR-06).
--
-- This delegates to the existing consume_quota(p_cost int) with a negative
-- cost so the refund stays correct regardless of how the usage table is
-- shaped — consume_quota is the single owner of that schema.
--
-- ASSUMPTION for the applier: consume_quota must accept a negative p_cost and
-- decrement the caller's usage (its quota check `used + p_cost > limit` is
-- trivially satisfied for negative costs). If consume_quota clamps or rejects
-- negative costs, replace the PERFORM below with a direct
-- `update ... set used = greatest(0, used - p_cost)` against the usage table
-- for auth.uid()'s current window.

create or replace function public.refund_quota(p_cost int default 1)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if p_cost <= 0 then
    return;
  end if;
  perform public.consume_quota(-p_cost);
end;
$$;

-- Callable by signed-in users only; the function scopes to auth.uid() via
-- consume_quota, so a user can only ever refund themselves.
revoke all on function public.refund_quota(int) from public, anon;
grant execute on function public.refund_quota(int) to authenticated;
