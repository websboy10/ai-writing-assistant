import { createHash } from 'node:crypto';
import type { FastifyInstance, FastifyRequest } from 'fastify';
import { gotrue, anonRpc } from '../supabase.js';
import { capture } from '../analytics.js';
import { env } from '../env.js';

/**
 * Auth proxy: the extension talks only to this backend, one origin for
 * everything. GoTrue error messages pass through so failures stay specific.
 */
export function authRoutes(app: FastifyInstance): void {
  // Kept, and not the thing doing the work. @fastify/rate-limit holds its
  // counters in memory and this backend is a Vercel Function, so a fresh
  // instance gets a fresh empty counter: measured 2026-08-26, 70 concurrent
  // requests were served without one rejection, and 40 rapid failed logins all
  // reached GoTrue. It still helps a single warm instance, which is why it
  // stays, but it cannot be the floor.
  // Well above what any office produces, and only ever hit by a flood against a
  // single warm instance. The per-account limits below are what actually
  // protect an account; see index.ts for why this layer cannot be the floor.
  const tight = { config: { rateLimit: { max: 60, timeWindow: '1 minute' } } };

  /**
   * The real floor, counted in Postgres because nowhere else survives between
   * requests (migration 0008).
   *
   * These three routes take no token, so nothing identifies the caller and
   * nothing bounds them; every other route is bounded by consume_quota. The
   * caller is whatever the platform says the client IP is — spoofable in
   * principle, but each distinct value gets its own budget, so spoofing buys a
   * fresh bucket rather than someone else's.
   *
   * FAILS OPEN, LOUDLY. If the counter cannot be reached, sign-in must not stop
   * working for everyone; this is defence in depth over GoTrue's own limits,
   * not the only lock on the door. But it is logged as an error, because a
   * throttle that has quietly stopped throttling is exactly the kind of silent
   * failure this codebase keeps finding.
   */
  function clientIp(req: FastifyRequest): string {
    const forwarded = req.headers['x-forwarded-for'];
    return (typeof forwarded === 'string' ? forwarded.split(',')[0]?.trim() : '') || req.ip || 'unknown';
  }

  /**
   * Accounts are identified by a digest, never by the address itself.
   *
   * The throttle table has no other reason to hold anyone's e-mail, and a table
   * full of customer addresses is a thing to lose. The digest is enough: the
   * counter only ever needs to know that two attempts concerned the same
   * account, not which one.
   */
  function accountKey(email: string): string {
    return createHash('sha256').update(email.trim().toLowerCase()).digest('hex').slice(0, 32);
  }

  async function withinLimit(req: FastifyRequest, key: string, limit: number, windowSeconds: number): Promise<boolean> {
    try {
      return await anonRpc<boolean>('auth_throttle_hit', {
        p_key: key.slice(0, 200),
        p_limit: limit,
        p_window_seconds: windowSeconds,
      });
    } catch (err) {
      req.log.error(err, `auth throttle unavailable — ${key.split(':')[0]} is running unbounded`);
      return true;
    }
  }

  /**
   * Two buckets, because one cannot do this job.
   *
   * Per ACCOUNT, tight: this is what stops someone grinding at one person's
   * password, and it is the harm worth preventing.
   *
   * Per IP, loose: a backstop against broad abuse. It has to stay loose because
   * the first market is HR teams on Google Workspace, where an entire office
   * shares one address — a tight per-IP limit would lock out the ninth person
   * to sign in on a Monday morning, and they would have no idea why.
   */
  async function allowAuth(
    req: FastifyRequest,
    action: string,
    email: string,
    perAccount: { limit: number; seconds: number },
    perIp: { limit: number; seconds: number },
  ): Promise<boolean> {
    const [accountOk, ipOk] = await Promise.all([
      withinLimit(req, `${action}:acct:${accountKey(email)}`, perAccount.limit, perAccount.seconds),
      withinLimit(req, `${action}:ip:${clientIp(req)}`, perIp.limit, perIp.seconds),
    ]);
    return accountOk && ipOk;
  }

  const TOO_MANY = {
    error: 'For mange forsøg. Vent et par minutter, og prøv igen.',
    code: 'rate_limited',
  };

  app.post('/api/auth/signup', tight, async (req, reply) => {
    const { email, password } = req.body as { email?: string; password?: string };
    if (!email || !password) return reply.code(400).send({ error: 'E-mail og adgangskode er påkrævet', code: 'bad_request' });
    // Tighter than login: every attempt sends mail to an address the sender
    // does not have to own, so the cost lands in a stranger's inbox and on our
    // sending reputation.
    if (!(await allowAuth(req, 'signup', email, { limit: 3, seconds: 3600 }, { limit: 30, seconds: 3600 })))
      return reply.code(429).send(TOO_MANY);
    // GoTrue's REST API takes redirects as a query parameter — an `options`
    // field in the JSON body is a supabase-js convention it ignores (WR-10).
    const res = await gotrue(`/signup?redirect_to=${encodeURIComponent(`${env.publicUrl}/confirmed`)}`, {
      method: 'POST',
      body: JSON.stringify({ email, password }),
    });
    const body = await res.json().catch(() => ({ error: `Auth service returned ${res.status}` }));
    // The uuid, never the address. GoTrue returns the new user on success; on
    // failure there is nobody to attribute the event to and nothing is sent.
    const newId = (body as { id?: string; user?: { id?: string } }).id ?? (body as { user?: { id?: string } }).user?.id;
    if (res.ok && newId) capture(newId, 'signed_up', {});
    return reply.code(res.status).send(body);
  });

  app.post('/api/auth/login', tight, async (req, reply) => {
    const { email, password } = req.body as { email?: string; password?: string };
    if (!email || !password) return reply.code(400).send({ error: 'E-mail og adgangskode er påkrævet', code: 'bad_request' });
    // 20 in 5 minutes. A person mistyping a password needs a handful; anyone
    // needing twenty is not typing.
    if (!(await allowAuth(req, 'login', email, { limit: 10, seconds: 300 }, { limit: 200, seconds: 300 })))
      return reply.code(429).send(TOO_MANY);
    const res = await gotrue('/token?grant_type=password', {
      method: 'POST',
      body: JSON.stringify({ email, password }),
    });
    const body = await res.json().catch(() => ({ error: `Auth service returned ${res.status}` }));
    const who = (body as { user?: { id?: string } }).user?.id;
    if (res.ok && who) capture(who, 'signed_in', {});
    return reply.code(res.status).send(body);
  });

  app.post('/api/auth/refresh', async (req, reply) => {
    const { refresh_token } = req.body as { refresh_token?: string };
    if (!refresh_token) return reply.code(400).send({ error: 'refresh_token required', code: 'bad_request' });
    const res = await gotrue('/token?grant_type=refresh_token', {
      method: 'POST',
      body: JSON.stringify({ refresh_token }),
    });
    const body = await res.json().catch(() => ({ error: `Auth service returned ${res.status}` }));
    return reply.code(res.status).send(body);
  });

  app.post('/api/auth/logout', async (req, reply) => {
    const token = req.headers.authorization?.slice(7);
    if (token) await gotrue('/logout', { method: 'POST' }, token).catch(() => {});
    return reply.send({ ok: true });
  });

  app.post('/api/auth/reset', tight, async (req, reply) => {
    const { email } = req.body as { email?: string };
    if (!email) return reply.code(400).send({ error: 'E-mail er påkrævet', code: 'bad_request' });
    // Same cost as signup, and the same reason: this sends mail to an address
    // the sender does not have to own. Someone who knows a customer's address
    // could otherwise fill their inbox with our password-reset mails.
    if (!(await allowAuth(req, 'reset', email, { limit: 3, seconds: 3600 }, { limit: 30, seconds: 3600 })))
      return reply.code(429).send(TOO_MANY);
    const res = await gotrue(`/recover?redirect_to=${encodeURIComponent(`${env.publicUrl}/reset`)}`, {
      method: 'POST',
      body: JSON.stringify({ email }),
    });
    if (!res.ok) {
      const body = await res.json().catch(() => ({}));
      return reply.code(res.status).send(body);
    }
    return reply.send({ ok: true, message: 'Nulstillingsmail sendt — tjek din indbakke.' });
  });

  // The extension's Google sign-in uses chrome.identity.launchWebAuthFlow and
  // needs the GoTrue authorize URL without knowing the Supabase project.
  app.get('/api/auth/google-url', async (req, reply) => {
    const { redirect } = req.query as { redirect?: string };
    if (!redirect) return reply.code(400).send({ error: 'redirect required', code: 'bad_request' });
    return {
      url: `${env.supabaseUrl}/auth/v1/authorize?provider=google&redirect_to=${encodeURIComponent(redirect)}`,
    };
  });

  // Landing page for the confirmation link in signup emails.
  app.get('/confirmed', async (_req, reply) => {
    reply.type('text/html').send(page('E-mail bekræftet', 'Din e-mail er bekræftet. Gå tilbage til udvidelsen og log ind.'));
  });

  // Landing page for password-recovery links. The recovery token arrives in
  // the URL hash, so this must be handled in page JS against GoTrue directly
  // (the anon key is public by design).
  app.get('/reset', async (_req, reply) => {
    reply.type('text/html').send(`<!doctype html><meta charset="utf-8">
<title>Vælg en ny adgangskode</title>
<style>body{font-family:system-ui;max-width:26rem;margin:4rem auto;padding:0 1rem}input,button{font-size:1rem;padding:.6rem;width:100%;box-sizing:border-box;margin-top:.5rem}button{cursor:pointer}p.err{color:#b00}p.ok{color:#070}</style>
<h2>Vælg en ny adgangskode</h2>
<input id="pw" type="password" placeholder="Ny adgangskode (mindst 6 tegn)">
<button id="go">Gem ny adgangskode</button>
<p id="msg"></p>
<script>
const msg = document.getElementById('msg');
const params = new URLSearchParams(location.hash.slice(1));
const token = params.get('access_token');
if (!token) { msg.textContent = 'Linket er ugyldigt eller udløbet. Bed om en ny nulstillingsmail fra udvidelsen.'; msg.className='err'; }
document.getElementById('go').onclick = async () => {
  const pw = document.getElementById('pw').value;
  if (pw.length < 6) { msg.textContent = 'Adgangskoden skal være mindst 6 tegn.'; msg.className='err'; return; }
  const res = await fetch(${js(env.supabaseUrl)} + '/auth/v1/user', {
    method: 'PUT',
    headers: { apikey: ${js(env.supabaseAnonKey)}, Authorization: 'Bearer ' + token, 'Content-Type': 'application/json' },
    body: JSON.stringify({ password: pw }),
  });
  if (res.ok) { msg.textContent = 'Adgangskoden er opdateret. Gå tilbage til udvidelsen og log ind.'; msg.className='ok'; }
  else { const b = await res.json().catch(()=>({})); msg.textContent = 'Mislykkedes: ' + (b.msg || b.error_description || res.status); msg.className='err'; }
};
</script>`);
  });
}

/** JSON string literal safe to embed in an inline <script> ("</script>" cannot break out). */
function js(v: string): string {
  return JSON.stringify(v).replace(/</g, '\\u003c');
}

function page(title: string, text: string): string {
  return `<!doctype html><meta charset="utf-8"><title>${title}</title>
<style>body{font-family:system-ui;max-width:26rem;margin:4rem auto;padding:0 1rem;text-align:center}</style>
<h2>${title}</h2><p>${text}</p>`;
}
