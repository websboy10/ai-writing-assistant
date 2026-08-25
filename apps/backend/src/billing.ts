import Stripe from 'stripe';
import { env } from './env.js';
import { rpc, anonRpc, type AuthedUser } from './supabase.js';

export const stripe = new Stripe(env.stripeSecretKey);

export interface BillingRow {
  status: 'trialing' | 'active' | 'past_due' | 'canceled' | 'expired';
  trial_ends_at: string;
  stripe_customer_id: string | null;
  stripe_subscription_id: string | null;
  current_period_end: string | null;
  updated_at: string;
}

export interface Entitlement {
  allowed: boolean;
  status: BillingRow['status'];
  trialEndsAt: string;
  subscribed: boolean;
}

/**
 * The freemium gate. Source of truth for subscriptions is Stripe; the billing
 * table is a cache kept fresh by (a) the success page, (b) webhooks in
 * production, and (c) an on-demand re-sync here whenever the cache says "not
 * allowed" but a Stripe customer exists — so a completed payment unlocks the
 * product even if every push channel failed.
 */
export async function getEntitlement(user: AuthedUser, installHash: string): Promise<Entitlement> {
  let row = await fetchRow(user);
  if (!row) {
    await rpc(user, 'billing_init', { p_user_id: user.id, p_install_hash: installHash });
    row = await fetchRow(user);
    if (!row) throw new Error('billing_init did not create a row');
  }

  if (!isAllowed(row)) {
    const synced = await syncFromStripe(user.id, row);
    if (synced) row = (await fetchRow(user)) ?? row;
  }

  return {
    allowed: isAllowed(row),
    status: row.status,
    trialEndsAt: row.trial_ends_at,
    subscribed: !!row.stripe_subscription_id && (row.status === 'active' || row.status === 'past_due'),
  };
}

function isAllowed(row: BillingRow): boolean {
  if (row.status === 'active') return true;
  // Grace while Stripe retries a failed renewal — cutting access on day one
  // of an expired card punishes paying customers for a bank hiccup.
  if (row.status === 'past_due') return true;
  if (row.status === 'trialing') return new Date(row.trial_ends_at).getTime() > Date.now();
  return false;
}

async function fetchRow(user: AuthedUser): Promise<BillingRow | null> {
  const { rest } = await import('./supabase.js');
  const res = await rest(
    user,
    '/billing?select=status,trial_ends_at,stripe_customer_id,stripe_subscription_id,current_period_end,updated_at',
  );
  if (!res.ok) throw new Error(`billing fetch failed: ${res.status}`);
  const rows = (await res.json()) as BillingRow[];
  return rows[0] ?? null;
}

/**
 * True when Stripe says the thing we asked about simply is not there — a
 * customer deleted in the dashboard, or a row left behind when the account was
 * moved between Stripe environments. That is a definitive answer, not an
 * outage, and it must not be retried forever.
 */
export function isMissingInStripe(err: unknown): boolean {
  return (
    typeof err === 'object' && err !== null && (err as { code?: string }).code === 'resource_missing'
  );
}

/** Pull the live subscription state for this customer down into the cache. */
async function syncFromStripe(userId: string, row: BillingRow): Promise<boolean> {
  if (!row.stripe_customer_id) return false;
  // Throttle: a fresh cache miss was already synced moments ago.
  if (Date.now() - new Date(row.updated_at).getTime() < 15_000) return false;

  let subs: Stripe.ApiList<Stripe.Subscription>;
  try {
    subs = await stripe.subscriptions.list({
      customer: row.stripe_customer_id,
      status: 'all',
      limit: 3,
    });
  } catch (err) {
    if (!isMissingInStripe(err)) throw err;
    // The cached customer no longer exists. Left alone, every entitlement
    // check threw here: /api/chat answered 503 "try again in a few seconds"
    // forever, and /api/billing/status leaked the raw Stripe error — customer
    // id and all — straight to the client. Measured on a real account
    // 2026-08-25. Forgetting the dead link lets the user fall back to their
    // trial, see the paywall honestly, and pay their way out.
    //
    // Its own RPC, not billing_set_subscription: that one coalesces its ids so
    // a null can never clear one, which is the right guard there and exactly
    // wrong here — the link would survive and every check would re-attempt the
    // same doomed call.
    await anonRpc('billing_forget_customer', { p_user_id: userId });
    return true;
  }

  const best = pickSubscription(subs.data);
  await anonRpc('billing_set_subscription', {
    p_user_id: userId,
    p_customer_id: row.stripe_customer_id,
    p_subscription_id: best?.id ?? null,
    p_status: best ? mapStatus(best.status) : row.status === 'trialing' ? 'trialing' : 'expired',
    p_period_end: best ? periodEnd(best) : null,
  });
  return true;
}

function pickSubscription(subs: Stripe.Subscription[]): Stripe.Subscription | null {
  const rank: Record<string, number> = { active: 0, trialing: 1, past_due: 2, unpaid: 3, canceled: 4 };
  return (
    [...subs].sort((a, b) => (rank[a.status] ?? 9) - (rank[b.status] ?? 9))[0] ?? null
  );
}

export function mapStatus(s: Stripe.Subscription.Status): BillingRow['status'] {
  if (s === 'active' || s === 'trialing') return 'active';
  if (s === 'past_due') return 'past_due';
  return 'canceled';
}

export function periodEnd(sub: Stripe.Subscription): string | null {
  const end = sub.items.data[0]?.current_period_end;
  return end ? new Date(end * 1000).toISOString() : null;
}

/** Idempotent: applies a subscription's state to whatever user owns the customer. */
export async function applySubscription(sub: Stripe.Subscription): Promise<void> {
  const customerId = typeof sub.customer === 'string' ? sub.customer : sub.customer.id;
  const userId =
    (sub.metadata?.user_id as string | undefined) ??
    (await anonRpc<string | null>('billing_user_for_customer', { p_customer_id: customerId }));
  if (!userId) return;
  await anonRpc('billing_set_subscription', {
    p_user_id: userId,
    p_customer_id: customerId,
    p_subscription_id: sub.id,
    p_status: mapStatus(sub.status),
    p_period_end: periodEnd(sub),
  });
}
