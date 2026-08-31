-- Mirror of migration applied via Supabase MCP on 2026-08-31 (operator_free_access_kbhsyd).
--
-- Fourth operator account, same grant and same reasoning as
-- 0009_operator_free_access.sql — read that file for why this is data and not a
-- change to the paywall, and for why nothing overwrites these rows.
--
-- Created 07:49:34 and already 'expired' by 07:49:52: billing_init found this
-- browser's install_hash already claimed by an earlier account, so it wrote
-- trial_ends_at = now(). Every further account made in this browser will be born
-- expired the same way. That guard is working as designed; the grant is the
-- intended way around it, not a new trial.
update public.billing b
set status = 'active',
    trial_ends_at = now() + interval '100 years',
    updated_at = now()
from auth.users u
where u.id = b.user_id
  and u.email = '77656@kbhsyd.nu';
