import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import type Stripe from 'stripe';
import { env } from '../env.js';
import { verifyUser, type AuthedUser } from '../supabase.js';
import { stripe } from '../billing.js';
import { hogql } from '../analytics.js';
import { enforce, HOUR } from '../limit.js';

/**
 * The operator's dashboard: what the money is doing, and what the product is
 * doing, on one page.
 *
 * AUTHORISATION IS AN ALLOW-LIST OF PEOPLE, NOT A SHARED SECRET. A
 * ?key=... token in a URL ends up in browser history, in a referrer header and
 * in whatever chat window it was pasted into, and it cannot be revoked for one
 * person. This reuses the sign-in that already exists: the operator logs in with
 * their own password, through the same throttled routes as everyone else, and
 * the server checks their address against ADMIN_EMAILS. Nothing new to leak.
 *
 * EVERY NUMBER IS FETCHED SERVER SIDE. The Stripe secret key and the PostHog
 * personal API key both stay in the function; the page receives finished
 * figures. A dashboard that shipped either key to the browser would hand the
 * whole account to anyone who opened it.
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
      // Deliberately the same shape as any other refusal: an account that is
      // not an admin learns nothing about whether this route exists.
      reply.code(404).send({ error: 'Ikke fundet', code: 'not_found' });
      return null;
    }
    return user;
  }

  /** Money. Read straight from Stripe, which is the only source of truth for it. */
  app.get('/api/admin/stripe', async (req, reply) => {
    const user = await requireAdmin(req, reply);
    if (!user) return reply;
    if (!(await enforce(req, reply, 'admin', user.id, [{ limit: 120, seconds: HOUR }]))) return reply;

    const now = Math.floor(Date.now() / 1000);
    const day = 86_400;

    try {
      // Stripe paginates at 100. These are the numbers of a business with tens
      // of customers, so one page each is the whole picture; when it stops
      // being, has_more says so on the page rather than silently undercounting.
      const [subs, charges, customers, sessions] = await Promise.all([
        stripe.subscriptions.list({ status: 'all', limit: 100, expand: ['data.items'] }),
        stripe.charges.list({ limit: 100, created: { gte: now - 90 * day } }),
        stripe.customers.list({ limit: 100, created: { gte: now - 90 * day } }),
        stripe.checkout.sessions.list({ limit: 100, created: { gte: now - 90 * day } }),
      ]);

      const byStatus: Record<string, number> = {};
      let mrrOre = 0;
      for (const s of subs.data) {
        byStatus[s.status] = (byStatus[s.status] ?? 0) + 1;
        if (s.status === 'active' || s.status === 'trialing') {
          for (const item of s.items.data) {
            const amount = item.price.unit_amount ?? 0;
            const per = item.price.recurring?.interval === 'year' ? amount / 12 : amount;
            mrrOre += per * (item.quantity ?? 1);
          }
        }
      }

      const paid = charges.data.filter((c) => c.paid && c.status === 'succeeded');
      const failed = charges.data.filter((c) => c.status === 'failed');
      const inWindow = (c: Stripe.Charge, days: number) => c.created >= now - days * day;
      const sum = (list: Stripe.Charge[]) => list.reduce((n, c) => n + c.amount - c.amount_refunded, 0);

      // A pass is a paid Checkout Session in payment mode carrying our own
      // marker, which is what the webhook keys on too — so this counts exactly
      // what granted access, not every one-off charge that ever happened.
      const passes = sessions.data.filter(
        (s) => s.mode === 'payment' && s.metadata?.kind === 'month_pass' && s.payment_status === 'paid',
      );
      const startedSessions = sessions.data.length;

      return {
        currency: 'dkk',
        mrr_dkk: Math.round(mrrOre / 100),
        subscriptions: byStatus,
        subscriptions_total: subs.data.length,
        revenue_dkk: {
          d7: Math.round(sum(paid.filter((c) => inWindow(c, 7))) / 100),
          d30: Math.round(sum(paid.filter((c) => inWindow(c, 30))) / 100),
          d90: Math.round(sum(paid) / 100),
        },
        payments: { succeeded_90d: paid.length, failed_90d: failed.length },
        passes: {
          d30: passes.filter((s) => s.created >= now - 30 * day).length,
          d90: passes.length,
          revenue_d90_dkk: Math.round(passes.reduce((n, s) => n + (s.amount_total ?? 0), 0) / 100),
        },
        // Started but never paid — the honest denominator for the checkout flow.
        checkout: {
          started_90d: startedSessions,
          completed_90d: sessions.data.filter((s) => s.payment_status === 'paid').length,
        },
        customers_90d: customers.data.length,
        truncated: subs.has_more || charges.has_more || customers.has_more || sessions.has_more,
        recent: paid.slice(0, 15).map((c) => ({
          at: new Date(c.created * 1000).toISOString(),
          dkk: Math.round((c.amount - c.amount_refunded) / 100),
          description: c.description ?? '',
          refunded: c.amount_refunded > 0,
        })),
      };
    } catch (err) {
      req.log.error(err, 'admin stripe read failed');
      return reply.code(502).send({ error: 'Stripe svarede ikke. Prøv igen.', code: 'upstream_error' });
    }
  });

  /**
   * Product. Every query below is a literal — nothing from the request reaches
   * HogQL, which is what keeps a SQL endpoint off the attack surface.
   */
  app.get('/api/admin/posthog', async (req, reply) => {
    const user = await requireAdmin(req, reply);
    if (!user) return reply;
    if (!(await enforce(req, reply, 'admin', user.id, [{ limit: 120, seconds: HOUR }]))) return reply;
    if (!env.posthogApiKey || !env.posthogProjectId) {
      return reply.code(501).send({
        error: 'PostHog er ikke sat op endnu (POSTHOG_API_KEY og POSTHOG_PROJECT_ID mangler).',
        code: 'not_configured',
      });
    }

    try {
      const [daily, byEvent, actives, models, failures, funnel] = await Promise.all([
        hogql<[string, number, number]>(
          `SELECT toDate(timestamp) AS d, count() AS events, uniq(distinct_id) AS people
           FROM events WHERE timestamp > now() - INTERVAL 30 DAY
           GROUP BY d ORDER BY d`,
        ),
        hogql<[string, number]>(
          `SELECT event, count() AS n FROM events
           WHERE timestamp > now() - INTERVAL 30 DAY
           GROUP BY event ORDER BY n DESC LIMIT 20`,
        ),
        hogql<[number, number]>(
          `SELECT
             uniqIf(distinct_id, timestamp > now() - INTERVAL 7 DAY) AS wau,
             uniqIf(distinct_id, timestamp > now() - INTERVAL 30 DAY) AS mau
           FROM events WHERE timestamp > now() - INTERVAL 30 DAY`,
        ),
        hogql<[string, number, number, number]>(
          `SELECT properties.model AS model, count() AS n,
                  round(avg(toFloat(properties.ms))) AS avg_ms,
                  round(avg(toFloat(properties.tokens_out))) AS avg_tokens
           FROM events WHERE event = 'chat_completed' AND timestamp > now() - INTERVAL 30 DAY
           GROUP BY model ORDER BY n DESC LIMIT 10`,
        ),
        hogql<[string, number]>(
          `SELECT properties.code AS code, count() AS n
           FROM events WHERE event = 'chat_failed' AND timestamp > now() - INTERVAL 30 DAY
           GROUP BY code ORDER BY n DESC LIMIT 10`,
        ),
        // The whole business in five numbers: signed up, used it, hit the wall,
        // opened checkout, paid.
        hogql<[string, number]>(
          `SELECT event, uniq(distinct_id) AS people FROM events
           WHERE timestamp > now() - INTERVAL 90 DAY
             AND event IN ('signed_up','chat_completed','paywall_hit','checkout_started','pass_granted','subscription_state')
           GROUP BY event`,
        ),
      ]);
      return { daily, byEvent, actives: actives[0] ?? [0, 0], models, failures, funnel };
    } catch (err) {
      req.log.error(err, 'admin posthog read failed');
      return reply.code(502).send({
        error: err instanceof Error ? err.message : 'PostHog svarede ikke.',
        code: 'upstream_error',
      });
    }
  });

  app.get('/dashboard', async (_req, reply) => {
    reply.type('text/html').send(DASHBOARD_HTML);
  });
}

/**
 * One file, no build step, no framework, no CDN.
 *
 * It is served from the API's own origin, so the fetches below need no CORS and
 * no key — just the operator's own bearer token, held in sessionStorage so it
 * dies with the tab.
 */
const DASHBOARD_HTML = `<!doctype html>
<html lang="da"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>ChatBot Skriv — dashboard</title>
<style>
:root{--ink:#141414;--paper:#fbfbf9;--soft:#6b6b66;--line:#e4e4de;--good:#1c6b3f;--bad:#94341f}
*{box-sizing:border-box}
body{margin:0;background:var(--paper);color:var(--ink);font:15px/1.5 -apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,sans-serif}
.wrap{max-width:1080px;margin:0 auto;padding:32px 20px 80px}
h1{font-family:Charter,Georgia,serif;font-size:1.7rem;margin:0 0 4px}
.sub{color:var(--soft);margin:0 0 28px;font-size:.9rem}
h2{font-size:.72rem;letter-spacing:.09em;text-transform:uppercase;color:var(--soft);margin:34px 0 12px;font-weight:600}
.grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(160px,1fr));gap:12px}
.card{border:1px solid var(--line);border-radius:12px;padding:14px 16px;background:#fff}
.card .k{font-size:.7rem;letter-spacing:.07em;text-transform:uppercase;color:var(--soft)}
.card .v{font-size:1.6rem;font-variant-numeric:tabular-nums;margin-top:4px}
.card .n{font-size:.78rem;color:var(--soft);margin-top:2px}
table{width:100%;border-collapse:collapse;font-size:.88rem;background:#fff;border:1px solid var(--line);border-radius:12px;overflow:hidden}
th,td{text-align:left;padding:8px 12px;border-bottom:1px solid var(--line)}
th{font-size:.68rem;letter-spacing:.07em;text-transform:uppercase;color:var(--soft);font-weight:600}
tr:last-child td{border-bottom:0}
td.num,th.num{text-align:right;font-variant-numeric:tabular-nums}
.bars{display:flex;align-items:flex-end;gap:3px;height:110px;padding:10px;border:1px solid var(--line);border-radius:12px;background:#fff}
.bar{flex:1;background:var(--ink);border-radius:2px 2px 0 0;min-height:1px}
.note{color:var(--soft);font-size:.82rem;margin:8px 0 0}
.err{color:var(--bad);font-size:.88rem;margin:8px 0 0}
form{max-width:320px;margin:80px auto;display:flex;flex-direction:column;gap:10px}
input,button{font:inherit;padding:10px 12px;border-radius:10px;border:1px solid var(--line)}
button{background:var(--ink);color:var(--paper);border-color:var(--ink);cursor:pointer}
#app{display:none}
</style></head><body><div class="wrap">
<form id="login"><h1>Dashboard</h1><p class="sub">Log ind med din administratorkonto.</p>
<input id="email" type="email" placeholder="E-mail" autocomplete="username">
<input id="password" type="password" placeholder="Adgangskode" autocomplete="current-password">
<button type="submit">Log ind</button><p class="err" id="loginErr"></p></form>

<div id="app">
  <h1>ChatBot Skriv</h1>
  <p class="sub" id="stamp"></p>
  <h2>Penge (Stripe)</h2><div class="grid" id="money"></div><p class="err" id="stripeErr"></p>
  <h2>Seneste betalinger</h2><div id="recent"></div>
  <h2>Brug (PostHog)</h2><div class="grid" id="usage"></div><p class="err" id="phErr"></p>
  <h2>Aktivitet, 30 dage</h2><div class="bars" id="bars"></div><p class="note" id="barsNote"></p>
  <h2>Modeller</h2><div id="models"></div>
  <h2>Fejl</h2><div id="failures"></div>
  <h2>Hændelser</h2><div id="events"></div>
</div>
</div>
<script>
const $ = (id) => document.getElementById(id);
let token = sessionStorage.getItem('awa_admin');

const card = (k, v, n) => '<div class="card"><div class="k">' + k + '</div><div class="v">' + v +
  '</div>' + (n ? '<div class="n">' + n + '</div>' : '') + '</div>';
const esc = (s) => String(s ?? '').replace(/[&<>"]/g, (c) => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c]));
const table = (cols, rows) => rows.length
  ? '<table><tr>' + cols.map((c, i) => '<th' + (i ? ' class="num"' : '') + '>' + c + '</th>').join('') + '</tr>' +
    rows.map((r) => '<tr>' + r.map((c, i) => '<td' + (i ? ' class="num"' : '') + '>' + esc(c) + '</td>').join('') + '</tr>').join('') +
    '</table>'
  : '<p class="note">Ingen data endnu.</p>';

$('login').addEventListener('submit', async (e) => {
  e.preventDefault();
  $('loginErr').textContent = '';
  const r = await fetch('/api/auth/login', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: $('email').value, password: $('password').value }),
  });
  const b = await r.json().catch(() => ({}));
  if (!r.ok || !b.access_token) { $('loginErr').textContent = b.error_description || b.error || 'Login mislykkedes.'; return; }
  token = b.access_token;
  sessionStorage.setItem('awa_admin', token);
  start();
});

async function get(path) {
  const r = await fetch(path, { headers: { Authorization: 'Bearer ' + token } });
  const b = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(b.error || ('HTTP ' + r.status));
  return b;
}

async function start() {
  $('login').style.display = 'none';
  $('app').style.display = 'block';
  $('stamp').textContent = 'Hentet ' + new Date().toLocaleString('da-DK');

  try {
    const s = await get('/api/admin/stripe');
    const subs = s.subscriptions || {};
    $('money').innerHTML =
      card('MRR', s.mrr_dkk + ' kr.', 'løbende abonnementer') +
      card('Aktive abonnementer', subs.active || 0, (subs.trialing || 0) + ' i prøve · ' + (subs.past_due || 0) + ' forfaldne') +
      card('Omsætning 30 dage', s.revenue_dkk.d30 + ' kr.', '7 dage: ' + s.revenue_dkk.d7 + ' kr.') +
      card('Omsætning 90 dage', s.revenue_dkk.d90 + ' kr.', s.payments.succeeded_90d + ' betalinger') +
      card('Månedspas 30 dage', s.passes.d30, s.passes.d90 + ' på 90 dage · ' + s.passes.revenue_d90_dkk + ' kr.') +
      card('Checkout gennemført', s.checkout.completed_90d + ' / ' + s.checkout.started_90d,
           s.checkout.started_90d ? Math.round(100 * s.checkout.completed_90d / s.checkout.started_90d) + '% af påbegyndte' : 'ingen endnu') +
      card('Nye kunder 90 dage', s.customers_90d, '') +
      card('Mislykkede betalinger', s.payments.failed_90d, 'seneste 90 dage');
    $('recent').innerHTML = table(['Tidspunkt', 'Beløb'],
      (s.recent || []).map((p) => [new Date(p.at).toLocaleString('da-DK'), p.dkk + ' kr.' + (p.refunded ? ' (delvist refunderet)' : '')]));
    if (s.truncated) $('stripeErr').textContent = 'Bemærk: mere end 100 rækker i mindst én liste — tallene er undervurderede.';
  } catch (e) { $('stripeErr').textContent = e.message; }

  try {
    const p = await get('/api/admin/posthog');
    const f = Object.fromEntries((p.funnel || []).map((r) => [r[0], r[1]]));
    $('usage').innerHTML =
      card('Aktive 7 dage', p.actives[0] ?? 0, 'unikke brugere') +
      card('Aktive 30 dage', p.actives[1] ?? 0, 'unikke brugere') +
      card('Tilmeldt', f.signed_up || 0, 'seneste 90 dage') +
      card('Har skrevet', f.chat_completed || 0, 'mindst ét svar') +
      card('Ramt betalingsmur', f.paywall_hit || 0, '') +
      card('Åbnet checkout', f.checkout_started || 0, '') +
      card('Betalt', (f.pass_granted || 0) + (f.subscription_state || 0), 'pas eller abonnement');
    const d = p.daily || [];
    const max = Math.max(1, ...d.map((r) => r[1]));
    $('bars').innerHTML = d.map((r) => '<div class="bar" style="height:' + Math.round(100 * r[1] / max) + '%" title="' +
      esc(r[0]) + ': ' + r[1] + ' hændelser, ' + r[2] + ' personer"></div>').join('') || '';
    $('barsNote').textContent = d.length ? d[0][0] + ' til ' + d[d.length - 1][0] + ' · hold musen over en søjle' : 'Ingen hændelser endnu.';
    $('models').innerHTML = table(['Model', 'Svar', 'Gns. ms', 'Gns. tokens'], (p.models || []).map((r) => [r[0], r[1], r[2], r[3]]));
    $('failures').innerHTML = table(['Fejlkode', 'Antal'], (p.failures || []).map((r) => [r[0], r[1]]));
    $('events').innerHTML = table(['Hændelse', 'Antal 30 dage'], (p.byEvent || []).map((r) => [r[0], r[1]]));
  } catch (e) { $('phErr').textContent = e.message; }
}

if (token) start();
</script></body></html>`;
