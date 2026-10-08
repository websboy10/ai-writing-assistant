import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import type Stripe from 'stripe';
import { env } from '../env.js';
import { verifyUser, anonRpc, isUuid, type AuthedUser } from '../supabase.js';
import { capture } from '../analytics.js';
import { stripe } from '../billing.js';
import { hogql } from '../analytics.js';
import { enforce, HOUR } from '../limit.js';
import { DASHBOARD_HTML } from './dashboard-page.js';

/**
 * The operator's dashboard: money, cost, and product, on one page.
 *
 * AUTHORISATION IS AN ALLOW-LIST OF PEOPLE, NOT A SHARED SECRET. A ?key=...
 * token in a URL ends up in browser history, in a referrer header and in
 * whatever chat window it was pasted into, and it cannot be revoked for one
 * person. This reuses the sign-in that already exists: the operator logs in
 * with their own password through the same throttled routes as everyone else,
 * and the server checks their address against ADMIN_EMAILS. Nothing new to leak.
 *
 * EVERY NUMBER IS FETCHED SERVER SIDE. The Stripe secret, the PostHog personal
 * key and the OpenRouter key all stay in the function; the browser receives
 * finished figures. A dashboard that shipped any of those to the page would
 * hand the whole account to anyone who opened it.
 *
 * IT COUNTS ONLY PEOPLE WE CAN NAME. Every figure is restricted to the ids of
 * real users in our own database — accounts that exist right now and are not in
 * public.internal_accounts (migrations 0015/0016). Subtracting our own accounts
 * instead was not enough: PostHog and Stripe keep the history of every test
 * account we ever deleted, whose uuid no longer resolves to anything, and that
 * history was most of the data. If the allow-list cannot be read, the section
 * that needed it reports an error rather than showing unfiltered numbers: a
 * dashboard quietly counting its own operator is the failure this is fixing.
 */
export function adminRoutes(app: FastifyInstance): void {
  async function requireAdmin(req: FastifyRequest, reply: FastifyReply): Promise<AuthedUser | null> {
    const user = await verifyUser(req.headers.authorization);
    if (!user) {
      reply.code(401).send({ error: 'Log ind først', code: 'unauthenticated' });
      return null;
    }
    // An empty list denies everyone. Defaulting to "allow" when nobody is
    // configured is how an admin page ends up open to every signed-up user.
    if (!env.adminEmails.includes(user.email.toLowerCase())) {
      // Deliberately shaped like any other refusal: an account that is not an
      // admin learns nothing about whether this route exists.
      reply.code(404).send({ error: 'Ikke fundet', code: 'not_found' });
      return null;
    }
    return user;
  }

  /**
   * Everything, in one request, with the four sources isolated from each other.
   *
   * allSettled rather than all: PostHog being down must not blank the revenue
   * figures, and an expired OpenRouter key must not hide how many people signed
   * up. Each section is either its numbers or its own error message, and the
   * page renders whatever arrived.
   */
  app.get('/api/admin/overview', async (req, reply) => {
    const user = await requireAdmin(req, reply);
    if (!user) return reply;
    if (!(await enforce(req, reply, 'admin', user.id, [{ limit: 240, seconds: HOUR }]))) return reply;

    // One read of the exclusion list, shared by the three sections that need
    // it. Each awaits the same promise, so a failure surfaces as that section's
    // own error and never as unfiltered figures.
    const internal = anonRpc<Internal>('admin_internal');

    const [money, cost, product, usage, excluded, site, referrals] = await Promise.allSettled([
      internal.then((i) => stripeSection(i)),
      internal.then((i) => openrouterSection(i.real_ids)),
      productSection(),
      internal.then((i) => posthogSection(i.real_ids)),
      internal,
      siteSection(),
      anonRpc<Record<string, unknown>>('admin_referrals'),
    ]);

    const unwrap = <T>(r: PromiseSettledResult<T>) =>
      r.status === 'fulfilled' ? r.value : { error: reasonOf(r.reason) };

    return {
      generatedAt: new Date().toISOString(),
      money: unwrap(money),
      cost: unwrap(cost),
      product: unwrap(product),
      usage: unwrap(usage),
      excluded: unwrap(excluded),
      site: unwrap(site),
      referrals: unwrap(referrals),
    };
  });

  /** Whether new signups get a trial or land straight on the paywall. */
  app.get('/api/admin/config', async (req, reply) => {
    const user = await requireAdmin(req, reply);
    if (!user) return reply;
    const [row] = await anonRpc<ConfigRow[]>('admin_get_config');
    if (!row) throw new Error('app_settings has no row');
    return {
      hardPaywall: row.hard_paywall,
      referral: {
        enabled: row.referral_enabled,
        discountPercent: row.referral_discount_percent,
        yearlyCap: row.referral_yearly_cap,
      },
    };
  });

  /**
   * Flips it. Turning it ON also expires everyone currently mid-trial, not
   * just future signups — see the migration for why that's the intended
   * behaviour, not a side effect.
   */
  app.post<{ Body: { enabled?: boolean } }>('/api/admin/config', async (req, reply) => {
    const user = await requireAdmin(req, reply);
    if (!user) return reply;
    const enabled = req.body?.enabled;
    if (typeof enabled !== 'boolean') {
      return reply.code(400).send({ error: 'enabled skal være true eller false', code: 'bad_request' });
    }
    await anonRpc('admin_set_hard_paywall', { p_enabled: enabled });
    await capture(user.id, 'admin_hard_paywall_toggled', { enabled });
    return { hardPaywall: enabled };
  });

  /**
   * The invitation offer: on or off, what the friend gets, what the inviter
   * gets, and the ceiling. Takes effect for the next code redeemed and the next
   * friend who pays; rewards already paid out are not touched.
   */
  app.post<{ Body: Record<string, unknown> }>('/api/admin/referral', async (req, reply) => {
    const user = await requireAdmin(req, reply);
    if (!user) return reply;
    const { enabled, discountPercent, yearlyCap } = req.body ?? {};
    const whole = (v: unknown, min: number, max: number): v is number =>
      typeof v === 'number' && Number.isInteger(v) && v >= min && v <= max;
    // The same ranges as the column checks in migrations 0017 and 0018, said
    // in Danish here so a typo is a sentence on screen rather than a Postgres error.
    if (typeof enabled !== 'boolean' || !whole(discountPercent, 1, 100) || !whole(yearlyCap, 0, 1000)) {
      return reply.code(400).send({
        error: 'Rabatten skal være 1-100 % og loftet 0-1000.',
        code: 'bad_request',
      });
    }
    await anonRpc('admin_set_referral', {
      p_enabled: enabled,
      p_discount_percent: discountPercent,
      p_yearly_cap: yearlyCap,
    });
    await capture(user.id, 'admin_referral_changed', { enabled, discountPercent, yearlyCap });
    return { referral: { enabled, discountPercent, yearlyCap } };
  });

  app.get('/dashboard', async (_req, reply) => {
    reply.type('text/html').send(DASHBOARD_HTML);
  });
}

interface ConfigRow {
  hard_paywall: boolean;
  referral_enabled: boolean;
  referral_discount_percent: number;
  referral_yearly_cap: number;
}

/** Who counts, and who we are. */
interface Internal {
  /** Real users: everyone in auth.users who is not one of ours. */
  real_ids: string[];
  /** Their Stripe customers, for objects that carry no metadata. */
  real_customers: string[];
  internal_ids: string[];
  emails: string[];
}

/**
 * `AND distinct_id IN (...)` for a HogQL literal.
 *
 * An allow-list, not a deny-list — see the route comment. With no real users
 * yet the clause must still match nothing, so it gets an id that cannot exist
 * rather than an empty `IN ()`, which is a syntax error.
 *
 * The ids come from auth.users, never from the request, but they are still
 * interpolated into a query — so a value that is not a uuid is a bug loud
 * enough to stop the section, not something to drop quietly and report a number
 * that counts everybody after all.
 */
function onlyRealUsers(ids: string[]): string {
  const bad = ids.find((id) => !isUuid(id));
  if (bad) throw new Error('Bruger-id er ikke en uuid');
  const list = ids.length ? ids : ['00000000-0000-0000-0000-000000000000'];
  return ` AND distinct_id IN (${list.map((id) => `'${id}'`).join(',')})`;
}

/** Never leak a stack or a provider's raw object to the page. */
function reasonOf(err: unknown): string {
  const msg = err instanceof Error ? err.message : String(err);
  return msg.slice(0, 200);
}

// ---- money -----------------------------------------------------------------

async function stripeSection(internal: Internal) {
  const now = Math.floor(Date.now() / 1000);
  const day = 86_400;

  const realUsers = new Set(internal.real_ids);
  const realCustomers = new Set(internal.real_customers);
  // Every checkout this product opens stamps the user id into metadata
  // (routes/billing.ts), and every customer it creates is recorded in billing.
  // An object matching neither belongs to an account we no longer have — a
  // deleted test account, almost always ours — and is not a customer.
  const isReal = (customer: unknown, metadata: Stripe.Metadata | null | undefined) => {
    const userId = metadata?.user_id;
    if (userId) return realUsers.has(userId);
    const id = typeof customer === 'string' ? customer
      : customer && typeof customer === 'object' && 'id' in customer ? (customer as { id: string }).id
      : null;
    return id !== null && realCustomers.has(id);
  };

  const [allSubs, allCharges, allCustomers, allSessions] = await Promise.all([
    stripe.subscriptions.list({ status: 'all', limit: 100, expand: ['data.items'] }),
    stripe.charges.list({ limit: 100, created: { gte: now - 90 * day } }),
    stripe.customers.list({ limit: 100, created: { gte: now - 90 * day } }),
    stripe.checkout.sessions.list({ limit: 100, created: { gte: now - 90 * day } }),
  ]);

  const subs = { ...allSubs, data: allSubs.data.filter((x) => isReal(x.customer, x.metadata)) };
  const charges = { ...allCharges, data: allCharges.data.filter((x) => isReal(x.customer, x.metadata)) };
  const customers = { ...allCustomers, data: allCustomers.data.filter((x) => isReal(x.id, x.metadata)) };
  const sessions = { ...allSessions, data: allSessions.data.filter((x) => isReal(x.customer, x.metadata)) };

  const byStatus: Record<string, number> = {};
  let mrrOre = 0;
  for (const s of subs.data) {
    byStatus[s.status] = (byStatus[s.status] ?? 0) + 1;
    if (s.status === 'active' || s.status === 'trialing') {
      for (const item of s.items.data) {
        const amount = item.price.unit_amount ?? 0;
        // A yearly plan is a twelfth of a month's revenue, not a month's.
        const per = item.price.recurring?.interval === 'year' ? amount / 12 : amount;
        mrrOre += per * (item.quantity ?? 1);
      }
    }
  }

  const paid = charges.data.filter((c) => c.paid && c.status === 'succeeded');
  const inWindow = (c: Stripe.Charge, days: number) => c.created >= now - days * day;
  // Net of refunds throughout: gross revenue that ignores money given back is
  // a number that flatters itself.
  const sum = (list: Stripe.Charge[]) => list.reduce((n, c) => n + c.amount - c.amount_refunded, 0);

  const passes = sessions.data.filter(
    (s) => s.mode === 'payment' && s.metadata?.kind === 'month_pass' && s.payment_status === 'paid',
  );

  // Revenue per day, for the chart. Keyed by local date so the bars line up
  // with the days the operator actually lived through.
  const perDay = new Map<string, number>();
  for (const c of paid) {
    const d = new Date(c.created * 1000).toISOString().slice(0, 10);
    perDay.set(d, (perDay.get(d) ?? 0) + (c.amount - c.amount_refunded) / 100);
  }

  return {
    mrr_dkk: Math.round(mrrOre / 100),
    subscriptions: byStatus,
    revenue_dkk: {
      d7: Math.round(sum(paid.filter((c) => inWindow(c, 7))) / 100),
      d30: Math.round(sum(paid.filter((c) => inWindow(c, 30))) / 100),
      d90: Math.round(sum(paid) / 100),
    },
    daily_revenue: [...perDay.entries()].sort().map(([d, v]) => [d, Math.round(v)]),
    payments: { succeeded_90d: paid.length, failed_90d: charges.data.filter((c) => c.status === 'failed').length },
    passes: {
      d30: passes.filter((s) => s.created >= now - 30 * day).length,
      d90: passes.length,
      revenue_d90_dkk: Math.round(passes.reduce((n, s) => n + (s.amount_total ?? 0), 0) / 100),
    },
    checkout: {
      started_90d: sessions.data.length,
      completed_90d: sessions.data.filter((s) => s.payment_status === 'paid').length,
    },
    customers_90d: customers.data.length,
    // Said out loud rather than silently undercounting: 100 is Stripe's page
    // size, and a business that outgrows it deserves to be told.
    truncated: subs.has_more || charges.has_more || customers.has_more || sessions.has_more,
    recent: paid.slice(0, 12).map((c) => ({
      at: new Date(c.created * 1000).toISOString(),
      dkk: Math.round((c.amount - c.amount_refunded) / 100),
      refunded: c.amount_refunded > 0,
    })),
  };
}

// ---- cost ------------------------------------------------------------------

/**
 * What the AI is costing, and how long the balance lasts.
 *
 * The balance comes from OpenRouter. The burn rate does NOT — OpenRouter only
 * reports a lifetime total, which cannot give a rate without storing yesterday's
 * copy of it. Instead every generation records its own cost (openrouter.ts
 * reports it, chat.ts sends it to PostHog), so spend over any window is a sum of
 * real charges and the runway is that rate divided into what is left. No cron,
 * no snapshot table, and the figure is exact rather than extrapolated.
 */
async function openrouterSection(realIds: string[]) {
  const res = await fetch('https://openrouter.ai/api/v1/credits', {
    headers: { Authorization: `Bearer ${env.openrouterKey}` },
    signal: AbortSignal.timeout(10_000),
  });
  if (!res.ok) throw new Error(`OpenRouter svarede ${res.status}`);
  const body = (await res.json()) as { data?: { total_credits?: number; total_usage?: number } };
  const total = body.data?.total_credits ?? 0;
  const used = body.data?.total_usage ?? 0;
  const left = total - used;

  const mineOut = onlyRealUsers(realIds);
  let spend30: number | null = null;
  let answers30: number | null = null;
  try {
    const rows = await hogql<[number, number]>(
      `SELECT round(sum(toFloat(properties.cost)), 4) AS spend, count() AS answers
       FROM events WHERE event = 'chat_completed' AND timestamp > now() - INTERVAL 30 DAY
       ${mineOut}`,
    );
    spend30 = rows[0]?.[0] ?? 0;
    answers30 = rows[0]?.[1] ?? 0;
  } catch {
    // PostHog not configured or unreachable. The balance is still worth
    // showing on its own, so this is not fatal to the section.
  }

  const perDay = spend30 && spend30 > 0 ? spend30 / 30 : null;
  return {
    total_credits: round4(total),
    used_credits: round4(used),
    left_credits: round4(left),
    spend_30d: spend30 === null ? null : round4(spend30),
    answers_30d: answers30,
    cost_per_answer: spend30 !== null && answers30 ? round4(spend30 / answers30) : null,
    // Deliberately null rather than Infinity when nothing has been spent: a
    // dashboard reading "∞ days left" is a dashboard nobody believes.
    runway_days: perDay && left > 0 ? Math.floor(left / perDay) : null,
  };
}

const round4 = (n: number) => Math.round(n * 10_000) / 10_000;

// ---- product ---------------------------------------------------------------

/**
 * Counts from our own database, which is the only source that cannot lose a
 * row. usage_counters is written inside the transaction that authorises a
 * generation, so its daily series is exact where an analytics event can be
 * dropped by a frozen serverless invocation.
 */
async function productSection() {
  return anonRpc<Record<string, unknown>>('admin_stats');
}

// ---- behaviour -------------------------------------------------------------

/**
 * Every query here is a literal. Nothing from the request reaches HogQL — the
 * only interpolated values are our own users' ids, checked as uuids first.
 */
async function posthogSection(realIds: string[]) {
  if (!env.posthogApiKey || !env.posthogProjectId) {
    throw new Error('PostHog er ikke sat op (POSTHOG_API_KEY / POSTHOG_PROJECT_ID)');
  }
  const mineOut = onlyRealUsers(realIds);
  const [daily, byEvent, actives, models, lengths, failures, funnel, speed] = await Promise.all([
    hogql<[string, number, number]>(
      `SELECT toDate(timestamp) AS d, count() AS events, uniq(distinct_id) AS people
       FROM events WHERE timestamp > now() - INTERVAL 30 DAY ${mineOut} GROUP BY d ORDER BY d`,
    ),
    hogql<[string, number]>(
      `SELECT event, count() AS n FROM events WHERE timestamp > now() - INTERVAL 30 DAY ${mineOut}
       GROUP BY event ORDER BY n DESC LIMIT 20`,
    ),
    hogql<[number, number, number]>(
      `SELECT uniqIf(distinct_id, timestamp > now() - INTERVAL 1 DAY) AS dau,
              uniqIf(distinct_id, timestamp > now() - INTERVAL 7 DAY) AS wau,
              uniq(distinct_id) AS mau
       FROM events WHERE timestamp > now() - INTERVAL 30 DAY ${mineOut}`,
    ),
    hogql<[string, number, number]>(
      `SELECT properties.model AS model, count() AS n, round(avg(toFloat(properties.ms))) AS avg_ms
       FROM events WHERE event = 'chat_completed' AND timestamp > now() - INTERVAL 30 DAY ${mineOut}
       GROUP BY model ORDER BY n DESC LIMIT 8`,
    ),
    hogql<[string, number]>(
      `SELECT properties.length AS len, count() AS n
       FROM events WHERE event = 'chat_completed' AND timestamp > now() - INTERVAL 30 DAY ${mineOut}
       GROUP BY len ORDER BY n DESC`,
    ),
    hogql<[string, number]>(
      `SELECT properties.code AS code, count() AS n
       FROM events WHERE event = 'chat_failed' AND timestamp > now() - INTERVAL 30 DAY ${mineOut}
       GROUP BY code ORDER BY n DESC LIMIT 8`,
    ),
    // The whole business in six numbers: signed up, wrote something, hit the
    // wall, opened checkout, paid.
    hogql<[string, number]>(
      `SELECT event, uniq(distinct_id) AS people FROM events
       WHERE timestamp > now() - INTERVAL 90 DAY
         AND event IN ('signed_up','chat_completed','paywall_hit','checkout_started','pass_granted','subscription_state')
         ${mineOut}
       GROUP BY event`,
    ),
    hogql<[number, number, number]>(
      `SELECT round(quantile(0.5)(toFloat(properties.ms))) AS p50,
              round(quantile(0.95)(toFloat(properties.ms))) AS p95,
              round(avg(toFloat(properties.chars_out))) AS avg_chars
       FROM events WHERE event = 'chat_completed' AND timestamp > now() - INTERVAL 30 DAY ${mineOut}`,
    ),
  ]);
  return {
    daily,
    byEvent,
    actives: actives[0] ?? [0, 0, 0],
    models,
    lengths,
    failures,
    funnel,
    speed: speed[0] ?? [0, 0, 0],
  };
}

/**
 * chatbotskriv.dk, from the cookieless site_* events (routes/site.ts). Visitor
 * ids rotate daily, so a 30-day "visitors" figure is a sum of daily visitors:
 * someone who came on three days counts three times. The page says so.
 */
async function siteSection() {
  const views = `event = 'site_pageview' AND timestamp > now() - INTERVAL 30 DAY`;
  const [totals, daily, pages, referrers] = await Promise.all([
    hogql<[number, number, number, number, number]>(
      `SELECT countIf(event = 'site_pageview') AS views,
              countIf(event = 'site_pageview' AND timestamp > now() - INTERVAL 7 DAY) AS views_7d,
              uniqIf(concat(distinct_id, toString(toDate(timestamp))), event = 'site_pageview') AS visitors,
              countIf(event = 'site_store_click') AS clicks,
              countIf(event = 'site_store_click' AND timestamp > now() - INTERVAL 7 DAY) AS clicks_7d
       FROM events WHERE event IN ('site_pageview', 'site_store_click') AND timestamp > now() - INTERVAL 30 DAY`,
    ),
    hogql<[string, number]>(
      `SELECT toDate(timestamp) AS d, uniq(distinct_id) AS visitors
       FROM events WHERE ${views} GROUP BY d ORDER BY d`,
    ),
    hogql<[string, number, number]>(
      `SELECT properties.path AS path, countIf(event = 'site_pageview') AS views, countIf(event = 'site_store_click') AS clicks
       FROM events WHERE event IN ('site_pageview', 'site_store_click') AND timestamp > now() - INTERVAL 30 DAY
       GROUP BY path ORDER BY views DESC LIMIT 15`,
    ),
    hogql<[string, number]>(
      `SELECT coalesce(nullIf(properties.utm_source, ''), properties.referrer) AS source, uniq(distinct_id) AS visitors
       FROM events WHERE ${views} GROUP BY source ORDER BY visitors DESC LIMIT 15`,
    ),
  ]);
  return { totals: totals[0] ?? [0, 0, 0, 0, 0], daily, pages, referrers };
}
