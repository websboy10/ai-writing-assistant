import type { FastifyInstance } from 'fastify';
import Stripe from 'stripe';
import { env } from '../env.js';
import { verifyUser, anonRpc, rpc, type AuthedUser } from '../supabase.js';
import { stripe, getEntitlement, applySubscription, mapStatus, periodEnd, isMissingInStripe } from '../billing.js';
import { enforce, HOUR } from '../limit.js';
import { capture } from '../analytics.js';

const installHashOf = (req: { headers: Record<string, unknown> }): string => {
  const raw = req.headers['x-awa-install'];
  return typeof raw === 'string' && raw.length >= 8 ? raw.slice(0, 128) : 'unknown-device';
};

export function billingRoutes(app: FastifyInstance): void {
  /** Freemium status for the header + paywall. Also initializes the trial. */
  app.get('/api/billing/status', async (req, reply) => {
    const user = await verifyUser(req.headers.authorization);
    if (!user) return reply.code(401).send({ error: 'Log ind først', code: 'unauthenticated' });
    // Uncaught, an upstream failure here was serialised straight to the client
    // — a raw Stripe error object, customer id included. The panel polls this
    // every five seconds, so anything thrown must come back as our own words.
    let ent: Awaited<ReturnType<typeof getEntitlement>>;
    try {
      ent = await getEntitlement(user, installHashOf(req));
    } catch (err) {
      req.log.error(err, 'billing status failed');
      return reply.code(503).send({
        error: 'Dit abonnement kunne ikke kontrolleres lige nu — prøv igen om få sekunder.',
        code: 'upstream_error',
      });
    }
    const daysFrom = (iso: string): number => Math.max(0, Math.ceil((new Date(iso).getTime() - Date.now()) / 86_400_000));
    return {
      status: ent.status,
      active: ent.allowed,
      subscribed: ent.subscribed,
      trialEndsAt: ent.trialEndsAt,
      trialDaysLeft: ent.status === 'trialing' ? daysFrom(ent.trialEndsAt) : 0,
      passEndsAt: ent.accessUntil,
      passDaysLeft: ent.accessUntil ? daysFrom(ent.accessUntil) : 0,
    };
  });

  /** Start Stripe Checkout for the 100 kr./md. subscription (card). */
  app.post('/api/billing/checkout', async (req, reply) => {
    const user = await verifyUser(req.headers.authorization);
    if (!user) return reply.code(401).send({ error: 'Log ind først', code: 'unauthenticated' });

    // Each call can mint a Stripe customer and always creates a Checkout
    // Session. Nothing else bounds that, and a loop here fills the dashboard
    // with junk objects nobody can tell from real ones.
    if (!(await enforce(req, reply, 'billing-checkout', user.id, [{ limit: 12, seconds: HOUR }]))) return reply;

    const customerId = await customerFor(user, installHashOf(req));

    const session = await stripe.checkout.sessions.create({
      mode: 'subscription',
      customer: customerId,
      line_items: [{ price: env.stripePriceId, quantity: 1 }],
      locale: 'da',
      allow_promotion_codes: true,
      subscription_data: { metadata: { user_id: user.id } },
      metadata: { user_id: user.id },
      success_url: `${env.publicUrl}/billing/success?session_id={CHECKOUT_SESSION_ID}`,
      cancel_url: `${env.publicUrl}/billing/cancel`,
      // Stripe Tax books the moms share of the tax-inclusive 100 kr price.
      // Needs the customer's billing address, hence customer_update.
      ...(env.stripeAutomaticTax
        ? { automatic_tax: { enabled: true }, customer_update: { address: 'auto' as const } }
        : {}),
      // Dashboard analytics tag (2026-03-25.dahlia+); harmless when older.
      ...({ integration_identifier: 'awa-extension-kqzvbnwt' } as Record<string, string>),
    });
    capture(user.id, 'checkout_started', { kind: 'subscription' });
    return { url: session.url };
  });

  /**
   * The MobilePay route: one month, paid once, no renewal.
   *
   * `mode: 'payment'` rather than 'subscription' is the whole point. MobilePay
   * is a single-use card wallet and Stripe lists it as not supporting recurring
   * payments at all, so it cannot appear on a subscription Checkout however the
   * dashboard is configured. Selling a fixed 30 days is the only shape that
   * takes MobilePay money honestly, and the button says so.
   *
   * Payment methods are NOT pinned here. Stripe's dynamic payment methods show
   * whatever the account has enabled and the currency supports, so MobilePay
   * appears the moment it is switched on in the dashboard and nothing here has
   * to change. Pinning payment_method_types would opt this session out of that
   * and freeze the list at whatever was true the day it was written.
   */
  app.post('/api/billing/pass', async (req, reply) => {
    const user = await verifyUser(req.headers.authorization);
    if (!user) return reply.code(401).send({ error: 'Log ind først', code: 'unauthenticated' });
    if (!env.stripePassPriceId) {
      return reply.code(501).send({
        error: 'Månedspas er ikke sat op endnu. Brug abonnementet med kort i stedet.',
        code: 'pass_not_configured',
      });
    }

    // Each call can mint a Stripe customer and always creates a Checkout
    // Session. Nothing else bounds that, and a loop here fills the dashboard
    // with junk objects nobody can tell from real ones.
    if (!(await enforce(req, reply, 'billing-pass', user.id, [{ limit: 12, seconds: HOUR }]))) return reply;

    const customerId = await customerFor(user, installHashOf(req));
    const session = await stripe.checkout.sessions.create({
      mode: 'payment',
      customer: customerId,
      line_items: [{ price: env.stripePassPriceId, quantity: 1 }],
      locale: 'da',
      // The one place a user id must survive the round trip: the webhook and
      // the success page both read it back to decide whose account to open.
      metadata: { user_id: user.id, kind: 'month_pass', days: String(env.passDays) },
      payment_intent_data: { metadata: { user_id: user.id, kind: 'month_pass' } },
      success_url: `${env.publicUrl}/billing/success?session_id={CHECKOUT_SESSION_ID}`,
      cancel_url: `${env.publicUrl}/billing/cancel`,
      ...(env.stripeAutomaticTax
        ? { automatic_tax: { enabled: true }, customer_update: { address: 'auto' as const } }
        : {}),
    });
    capture(user.id, 'checkout_started', { kind: 'month_pass' });
    return { url: session.url };
  });

  /** Customer Portal: cancel, change card, see invoices. */
  app.post('/api/billing/portal', async (req, reply) => {
    const user = await verifyUser(req.headers.authorization);
    if (!user) return reply.code(401).send({ error: 'Log ind først', code: 'unauthenticated' });
    if (!(await enforce(req, reply, 'billing-portal', user.id, [{ limit: 12, seconds: HOUR }]))) return reply;
    const { rest } = await import('../supabase.js');
    const rowRes = await rest(user, '/billing?select=stripe_customer_id');
    const rows = (await rowRes.json()) as { stripe_customer_id: string | null }[];
    const customerId = rows[0]?.stripe_customer_id;
    if (!customerId) return reply.code(400).send({ error: 'Intet abonnement endnu', code: 'bad_request' });
    const session = await stripe.billingPortal.sessions.create({
      customer: customerId,
      return_url: `${env.publicUrl}/billing/success`,
    });
    return { url: session.url };
  });

  /**
   * Landing page after Checkout. Retrieves the session server-side and applies
   * the subscription immediately — the local flow must not depend on webhooks.
   */
  app.get('/billing/success', async (req, reply) => {
    const { session_id } = req.query as { session_id?: string };
    let boughtPass = false;
    if (session_id && /^cs_[a-zA-Z0-9_]+$/.test(session_id)) {
      try {
        const session = await stripe.checkout.sessions.retrieve(session_id, { expand: ['subscription'] });
        boughtPass = session.metadata?.kind === 'month_pass';
        await applyCheckout(session);
      } catch (err) {
        req.log.error(err, 'checkout success sync failed — webhook/on-demand sync will recover');
      }
    }
    // A pass is not a subscription and must never be described as one. It runs
    // out, nothing renews it, and someone who thinks they subscribed will be
    // locked out in thirty days with no idea why.
    reply.type('text/html').send(
      boughtPass
        ? page(
            'Tak — dit månedspas er aktivt',
            'Du har adgang i 30 dage fra nu. Der trækkes ikke penge automatisk bagefter: når passet løber ud, køber du et nyt eller skifter til abonnement. Luk fanen og skriv videre i udvidelsen.',
          )
        : page(
            'Tak — dit abonnement er aktivt',
            'Du kan lukke denne fane og skrive videre i udvidelsen. God arbejdslyst!',
          ),
    );
  });

  app.get('/billing/cancel', async (_req, reply) => {
    reply.type('text/html').send(page('Betalingen blev afbrudt', 'Der er ikke trukket noget. Luk fanen og prøv igen fra udvidelsen, når du er klar.'));
  });

  /**
   * Stripe webhook (production push channel). Registered with a scoped raw-body
   * parser because signature verification needs the exact bytes.
   */
  app.register(async (scope) => {
    scope.addContentTypeParser('application/json', { parseAs: 'buffer' }, (_req, body, done) => done(null, body));
    scope.post('/api/stripe/webhook', async (req, reply) => {
      if (!env.stripeWebhookSecret) {
        return reply.code(501).send({ error: 'webhook secret not configured' });
      }
      let event: Stripe.Event;
      try {
        event = stripe.webhooks.constructEvent(
          req.body as Buffer,
          req.headers['stripe-signature'] as string,
          env.stripeWebhookSecret,
        );
      } catch {
        return reply.code(400).send({ error: 'invalid signature' });
      }

      if (event.type === 'checkout.session.completed') {
        await applyCheckout(event.data.object);
      } else if (
        event.type === 'customer.subscription.updated' ||
        event.type === 'customer.subscription.deleted' ||
        event.type === 'customer.subscription.created'
      ) {
        await applySubscription(event.data.object);
      }
      return { received: true };
    });
  });
}

/**
 * One user, one Stripe customer, whichever thing they are buying.
 *
 * Both checkout routes need this and both used to be able to mint a customer,
 * which is how one account quietly becomes two in the dashboard and how a
 * subscription and a pass end up on different customers with only one of them
 * findable.
 */
async function customerFor(user: AuthedUser, installHash: string): Promise<string> {
  const { rest } = await import('../supabase.js');
  const rowRes = await rest(user, '/billing?select=stripe_customer_id,status,trial_ends_at');
  const rows = (await rowRes.json()) as { stripe_customer_id: string | null; status: string }[];
  if (!rows.length) {
    await rpc(user, 'billing_init', { p_user_id: user.id, p_install_hash: installHash });
  }
  let customerId = rows[0]?.stripe_customer_id ?? null;
  // A stored customer that Stripe no longer has would make Checkout throw,
  // leaving the user staring at a paywall they cannot pay their way past.
  // Verify before reusing, and mint a new one if it is gone.
  if (customerId) {
    try {
      const existing = await stripe.customers.retrieve(customerId);
      if ((existing as Stripe.DeletedCustomer).deleted) customerId = null;
    } catch (err) {
      if (!isMissingInStripe(err)) throw err;
      customerId = null;
    }
  }
  if (!customerId) {
    const customer = await stripe.customers.create({
      email: user.email || undefined,
      metadata: { user_id: user.id },
    });
    customerId = customer.id;
    // The user is right here, storing their own customer id — this never
    // needed the privileged function, and reaching for it was how the
    // paywall bypass got its foothold. Self-scoped, so nothing to forge.
    await rpc(user, 'billing_sync_self', {
      p_customer_id: customerId,
      p_subscription_id: null,
      p_status: rows[0]?.status ?? 'expired',
      p_period_end: null,
    });
  }
  return customerId;
}

/**
 * Apply a finished Checkout Session, whichever kind it is.
 *
 * Written once and called from both delivery channels — the success-page
 * redirect and the webhook — because they carry the same event and used to
 * disagree about what to do with it: the redirect handled subscriptions only,
 * so a pass bought while the webhook was misconfigured unlocked nothing and
 * the customer had paid.
 *
 * Both channels can fire for the same purchase, and Stripe retries the webhook.
 * Granting is idempotent per session id in the database (migration 0011), so a
 * double delivery adds thirty days once, not twice.
 */
async function applyCheckout(session: Stripe.Checkout.Session): Promise<void> {
  const userId = session.metadata?.user_id;

  if (session.mode === 'subscription' && session.subscription) {
    const sub =
      typeof session.subscription === 'string'
        ? await stripe.subscriptions.retrieve(session.subscription)
        : session.subscription;
    await applySubscription(sub);
    return;
  }

  if (session.mode === 'payment' && session.metadata?.kind === 'month_pass') {
    // payment_status, not the event name: an asynchronous method can complete
    // the session while the money is still pending, and granting access on
    // that is granting it for free.
    if (session.payment_status !== 'paid' || !userId) return;
    const days = Number(session.metadata?.days ?? 30);
    capture(userId, 'pass_granted', {
      days: Number.isFinite(days) && days > 0 ? Math.min(400, Math.round(days)) : 30,
      amount_dkk: session.amount_total != null ? Math.round(session.amount_total / 100) : null,
    });
    await anonRpc('billing_grant_pass', {
      p_user_id: userId,
      p_days: Number.isFinite(days) && days > 0 ? Math.min(400, Math.round(days)) : 30,
      p_session_id: session.id,
      p_amount_dkk: session.amount_total != null ? Math.round(session.amount_total / 100) : null,
    });
  }
}

function page(title: string, body: string): string {
  return `<!doctype html><html lang="da"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${title}</title>
<style>body{font-family:Charter,Georgia,serif;background:#fff;color:#111;display:grid;place-items:center;min-height:100vh;margin:0}main{max-width:26rem;padding:2rem;text-align:center}h1{font-size:1.5rem;margin-bottom:.75rem}p{color:#555;line-height:1.6}</style>
</head><body><main><h1>${title}</h1><p>${body}</p></main></body></html>`;
}
