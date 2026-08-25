import type { FastifyInstance } from 'fastify';
import Stripe from 'stripe';
import { env } from '../env.js';
import { verifyUser, anonRpc, rpc } from '../supabase.js';
import { stripe, getEntitlement, applySubscription, mapStatus, periodEnd, isMissingInStripe } from '../billing.js';

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
    const msLeft = new Date(ent.trialEndsAt).getTime() - Date.now();
    return {
      status: ent.status,
      active: ent.allowed,
      subscribed: ent.subscribed,
      trialEndsAt: ent.trialEndsAt,
      trialDaysLeft: ent.status === 'trialing' ? Math.max(0, Math.ceil(msLeft / 86_400_000)) : 0,
    };
  });

  /** Start Stripe Checkout for the 50 kr./md. subscription. */
  app.post('/api/billing/checkout', async (req, reply) => {
    const user = await verifyUser(req.headers.authorization);
    if (!user) return reply.code(401).send({ error: 'Log ind først', code: 'unauthenticated' });

    // Reuse the existing Stripe customer so one user never becomes two.
    const { rest } = await import('../supabase.js');
    const rowRes = await rest(user, '/billing?select=stripe_customer_id,status,trial_ends_at');
    const rows = (await rowRes.json()) as { stripe_customer_id: string | null; status: string }[];
    if (!rows.length) {
      await rpc(user, 'billing_init', { p_user_id: user.id, p_install_hash: installHashOf(req) });
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
      // Stripe Tax books the moms share of the tax-inclusive 50 kr price.
      // Needs the customer's billing address, hence customer_update.
      ...(env.stripeAutomaticTax
        ? { automatic_tax: { enabled: true }, customer_update: { address: 'auto' as const } }
        : {}),
      // Dashboard analytics tag (2026-03-25.dahlia+); harmless when older.
      ...({ integration_identifier: 'awa-extension-kqzvbnwt' } as Record<string, string>),
    });
    return { url: session.url };
  });

  /** Customer Portal: cancel, change card, see invoices. */
  app.post('/api/billing/portal', async (req, reply) => {
    const user = await verifyUser(req.headers.authorization);
    if (!user) return reply.code(401).send({ error: 'Log ind først', code: 'unauthenticated' });
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
    if (session_id && /^cs_[a-zA-Z0-9_]+$/.test(session_id)) {
      try {
        const session = await stripe.checkout.sessions.retrieve(session_id, { expand: ['subscription'] });
        const sub = session.subscription as Stripe.Subscription | null;
        const userId = session.metadata?.user_id;
        if (sub && userId) {
          await anonRpc('billing_set_subscription', {
            p_user_id: userId,
            p_customer_id: typeof session.customer === 'string' ? session.customer : (session.customer?.id ?? null),
            p_subscription_id: sub.id,
            p_status: mapStatus(sub.status),
            p_period_end: periodEnd(sub),
          });
        }
      } catch (err) {
        req.log.error(err, 'checkout success sync failed — webhook/on-demand sync will recover');
      }
    }
    reply.type('text/html').send(page('Tak — dit abonnement er aktivt', 'Du kan lukke denne fane og skrive videre i udvidelsen. God arbejdslyst!'));
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
        const session = event.data.object;
        if (session.subscription) {
          const sub = await stripe.subscriptions.retrieve(session.subscription as string);
          await applySubscription(sub);
        }
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

function page(title: string, body: string): string {
  return `<!doctype html><html lang="da"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${title}</title>
<style>body{font-family:Charter,Georgia,serif;background:#fff;color:#111;display:grid;place-items:center;min-height:100vh;margin:0}main{max-width:26rem;padding:2rem;text-align:center}h1{font-size:1.5rem;margin-bottom:.75rem}p{color:#555;line-height:1.6}</style>
</head><body><main><h1>${title}</h1><p>${body}</p></main></body></html>`;
}
