-- Close the whole class of hole that migration 0006 closed one function at a
-- time.
--
-- 0006 revoked four named functions from anon and PUBLIC after two of them were
-- proven exploitable with nothing but the publishable key: an expired account
-- was switched to active with no user token at all, measured with plain curl
-- against the live project on 2026-08-25. That fixed the functions that existed.
-- It did not stop the next one. Postgres grants EXECUTE on a new function to
-- PUBLIC by default, so every function added since — and every function added
-- after today — is born reachable by the anon key that ships inside every copy
-- of the extension.
--
-- THIS IS SAFE FOR THE RUNNING PRODUCT. Nothing legitimately calls an RPC as
-- anon. The extension never reaches PostgREST at all; it only ever talks to the
-- backend. The backend sends either the user's own JWT (which authenticates as
-- `authenticated`) or, for the two Stripe push channels, the service role. The
-- anon key appears only as the `apikey` header beside one of those two tokens,
-- and as GoTrue's key on the auth routes. Neither is an RPC.
--
-- WHY IT GRANTS BROADLY THEN REVOKES BY NAME, rather than granting by name.
-- Migration 0001 was applied through the dashboard and is not in this repo, so
-- the full list of functions this product calls cannot be read from these files.
-- Granting a guessed list would leave whatever was guessed wrong revoked, and
-- the first sign of that would be a paying customer seeing an error. Granting
-- everything to `authenticated` and then naming the dangerous ones fails the
-- safe way round: the worst case is a signed-in account reaching a harmless
-- self-scoped function, not the product breaking.

-- 1. Take back what the default grant handed out.
revoke execute on all functions in schema public from anon;
revoke execute on all functions in schema public from public;

-- 2. Signed-in accounts keep the ordinary self-scoped functions working.
grant execute on all functions in schema public to authenticated;

-- 3. The genuinely privileged ones, closed by name. Each either takes a
--    p_user_id it does not verify, or exists to be called with no user at all.
--    Already revoked by 0006 for the first four; restated because step 2 above
--    would otherwise have handed them straight back.
revoke execute on function public.billing_set_subscription(uuid, text, text, text, timestamptz)
  from anon, authenticated;
revoke execute on function public.billing_user_for_customer(text) from anon, authenticated;
revoke execute on function public.refund_quota_for(uuid, integer) from anon, authenticated;
revoke execute on function public.refund_quota(integer) from anon, authenticated;
-- A user who could call this would grant themselves the product for free.
revoke execute on function public.billing_grant_pass(uuid, integer, text, integer)
  from anon, authenticated;
-- A user who could call this could spend someone else's login budget and lock
-- them out of their own account.
revoke execute on function public.auth_throttle_hit(text, integer, integer) from anon, authenticated;

grant execute on function public.billing_set_subscription(uuid, text, text, text, timestamptz) to service_role;
grant execute on function public.billing_user_for_customer(text) to service_role;
grant execute on function public.refund_quota_for(uuid, integer) to service_role;
grant execute on function public.billing_grant_pass(uuid, integer, text, integer) to service_role;
grant execute on function public.auth_throttle_hit(text, integer, integer) to service_role;

-- 4. Stop the next one being born open. Default privileges decide what a
--    function created tomorrow is granted, and the default is PUBLIC.
alter default privileges in schema public revoke execute on functions from public;
alter default privileges in schema public revoke execute on functions from anon;

-- 5. anon has no business reading or writing any table here. RLS already blocks
--    it wherever a policy exists; this makes a table added without one
--    impossible to reach rather than merely unlikely to be noticed.
revoke all on all tables in schema public from anon;
alter default privileges in schema public revoke all on tables from anon;
