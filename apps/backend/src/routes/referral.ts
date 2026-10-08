import type { FastifyInstance } from 'fastify';
import type { ReferralInfo } from '@awa/shared';
import { verifyUser, rpc, type AuthedUser } from '../supabase.js';
import { enforce, HOUR } from '../limit.js';
import { capture } from '../analytics.js';

const installHashOf = (req: { headers: Record<string, unknown> }): string => {
  const raw = req.headers['x-awa-install'];
  return typeof raw === 'string' && raw.length >= 8 ? raw.slice(0, 128) : 'unknown-device';
};

interface Mine {
  code: string;
  enabled: boolean;
  friend_trial_days: number;
  reward_days: number;
  discount_percent: number;
  my_discount: boolean;
  yearly_cap: number;
  invited: number;
  paid: number;
  rewards: number;
  rewards_this_year: number;
  can_claim: boolean;
}

type Claim = { ok: true; trial_days: number } | { ok: false; reason: string };

/** Why a code was refused, in words the person holding it can act on. */
const REFUSALS: Record<string, string> = {
  disabled: 'Invitationer er slået fra lige nu.',
  unknown_code: 'Den kode findes ikke. Tjek, at den er skrevet rigtigt.',
  own_code: 'Det er din egen kode. Den er til dine venner.',
  already_claimed: 'Du har allerede brugt en invitationskode.',
  already_customer: 'Invitationskoder er til nye brugere, og du har allerede købt adgang.',
  mutual: 'I kan ikke invitere hinanden begge veje.',
};

/**
 * Both functions answer "no billing row" instead of creating one, because
 * creating it is billing_init's job and it has rules of its own (the hard
 * paywall, one trial per device). A brand new account can reach these routes
 * before the panel has asked for its billing status, so: make the row, ask again.
 */
async function withBillingRow<T>(user: AuthedUser, installHash: string, ask: () => Promise<T>, missing: (r: T) => boolean): Promise<T> {
  const first = await ask();
  if (!missing(first)) return first;
  await rpc(user, 'billing_init', { p_user_id: user.id, p_install_hash: installHash });
  return ask();
}

export function referralRoutes(app: FastifyInstance): void {
  /** The caller's own code, the current offer, and how their invitations are doing. */
  app.get('/api/referral', async (req, reply) => {
    const user = await verifyUser(req.headers.authorization);
    if (!user) return reply.code(401).send({ error: 'Log ind først', code: 'unauthenticated' });
    const hash = installHashOf(req);
    const m = await withBillingRow(
      user,
      hash,
      () => rpc<Mine | null>(user, 'referral_mine', { p_install_hash: hash }),
      (r) => r === null,
    );
    if (!m) throw new Error('referral_mine returned nothing after billing_init');
    const info: ReferralInfo = {
      enabled: m.enabled,
      code: m.code,
      friendTrialDays: m.friend_trial_days,
      rewardDays: m.reward_days,
      discountPercent: m.discount_percent,
      myDiscount: m.my_discount,
      invited: m.invited,
      paid: m.paid,
      rewards: m.rewards,
      capReached: m.rewards_this_year >= m.yearly_cap,
      canClaim: m.can_claim,
    };
    return info;
  });

  /** Redeem a friend's code. */
  app.post<{ Body: { code?: unknown } }>('/api/referral/claim', async (req, reply) => {
    const user = await verifyUser(req.headers.authorization);
    if (!user) return reply.code(401).send({ error: 'Log ind først', code: 'unauthenticated' });
    // Codes are six characters from a 32-letter alphabet; ten tries an hour
    // makes guessing one a project measured in centuries.
    if (!(await enforce(req, reply, 'referral-claim', user.id, [{ limit: 10, seconds: HOUR }]))) return reply;

    const code = typeof req.body?.code === 'string' ? req.body.code.trim() : '';
    if (!/^[A-Za-z0-9]{4,12}$/.test(code)) {
      return reply.code(400).send({ error: REFUSALS.unknown_code, code: 'unknown_code' });
    }
    const hash = installHashOf(req);
    const res = await withBillingRow(
      user,
      hash,
      () => rpc<Claim>(user, 'referral_claim', { p_code: code, p_install_hash: hash }),
      (r) => !r.ok && r.reason === 'no_account',
    );
    if (!res.ok) {
      return reply.code(400).send({ error: REFUSALS[res.reason] ?? 'Koden kunne ikke bruges.', code: res.reason });
    }
    await capture(user.id, 'referral_claimed', { trial_days: res.trial_days });
    return { trialDays: res.trial_days };
  });

  /**
   * "Somebody copied their link." The only step of the funnel the server
   * cannot see for itself, and the one that says whether people are being
   * asked in the right place — so the panel reports it.
   */
  app.post('/api/referral/shared', async (req, reply) => {
    const user = await verifyUser(req.headers.authorization);
    if (!user) return reply.code(401).send({ error: 'Log ind først', code: 'unauthenticated' });
    if (!(await enforce(req, reply, 'referral-shared', user.id, [{ limit: 30, seconds: HOUR }]))) return reply;
    await capture(user.id, 'referral_link_copied');
    return { ok: true };
  });
}
