-- Mirror of migration applied via Supabase MCP on 2026-08-31 (operator_free_access).
--
-- The operator's own three accounts get the product free. Granted as data rather
-- than code: isAllowed() in apps/backend/src/billing.ts already opens the gate on
-- status='active', so the paywall itself is untouched and no other user changes.
-- Revoking is setting status back to 'expired'.
--
-- Durable because every writer that could overwrite status is unreachable for
-- these rows:
--   billing_init            only inserts when no row exists
--   billing_sync_self       only runs when the gate says not-allowed, and only
--   billing_forget_customer when stripe_customer_id is set — these rows have none
--   billing_set_subscription needs a Stripe webhook for a customer they lack
--
-- trial_ends_at is pushed out as well, so the row stays allowed even if a later
-- change reads the trial date instead of the status.
--
-- Why three accounts and not one: the Google Docs permission is held by the
-- Google identity Chrome is signed into, which is not the Supabase login the
-- gate keys on, so the two cannot be matched from the database. All three are
-- the operator's own.
update public.billing b
set status = 'active',
    trial_ends_at = now() + interval '100 years',
    updated_at = now()
from auth.users u
where u.id = b.user_id
  and u.email in ('sehit@degirmenci.dk', 'websboy10@gmail.com', 'sehitdd@gmail.com');
