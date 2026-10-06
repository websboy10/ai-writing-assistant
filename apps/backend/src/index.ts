import Fastify from 'fastify';
import cors from '@fastify/cors';
import multipart from '@fastify/multipart';
import rateLimit from '@fastify/rate-limit';
import { env } from './env.js';
import { adminRoutes } from './routes/admin.js';
import { authRoutes } from './routes/auth.js';
import { autonomousRoutes } from './routes/autonomous.js';
import { billingRoutes } from './routes/billing.js';
import { chatRoutes } from './routes/chat.js';
import { conversationRoutes } from './routes/conversations.js';
import { fileRoutes } from './routes/files.js';
import { referralRoutes } from './routes/referral.js';
import { siteRoutes } from './routes/site.js';
import { templateRoutes } from './routes/templates.js';
import { verifyUser, rpc } from './supabase.js';

export const app = Fastify({ logger: { level: 'info' } });

await app.register(cors, {
  /**
   * Reflect only origins that could legitimately be this product.
   *
   * This used to be `origin: true`, which reflects whatever origin asked —
   * every website on the internet included. That was not the hole it looks
   * like, because credentials are off and every route needs a bearer token a
   * page cannot obtain, but it did mean any site could probe the API and read
   * the answers. There is no reason to let them.
   *
   * chrome-extension:// stays open-ended on purpose: the ID differs per
   * unpacked install and would otherwise have to be edited for every developer
   * and every test run. A hostile extension can reach any origin regardless of
   * CORS, so pinning one buys nothing real.
   *
   * A request with no Origin at all — curl, a server, the Stripe webhook — is
   * allowed through: CORS is a browser rule and refusing here would break the
   * webhook while stopping nobody.
   */
  origin: (origin, cb) => {
    if (!origin) return cb(null, true);
    const ok =
      origin.startsWith('chrome-extension://') ||
      origin === env.publicUrl ||
      /^https:\/\/ai-skriveassistent(-api)?\.vercel\.app$/.test(origin) ||
      /^https:\/\/(www\.)?chatbotskriv\.dk$/.test(origin) ||
      /^http:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/.test(origin);
    cb(null, ok);
  },
  credentials: false,
});

/**
 * Security headers on everything this server sends.
 *
 * Most responses here are JSON to an extension, where these matter little. The
 * HTML pages are why they exist: /dashboard shows live revenue, and
 * /billing/success is a page a payment provider redirects to. Neither should be
 * frameable, sniffable, or able to leak its URL through a referrer.
 */
app.addHook('onSend', async (_req, reply, payload) => {
  reply.header('X-Content-Type-Options', 'nosniff');
  reply.header('Referrer-Policy', 'no-referrer');
  reply.header('X-Frame-Options', 'DENY');
  reply.header('Cross-Origin-Opener-Policy', 'same-origin');
  if (String(reply.getHeader('content-type') ?? '').startsWith('text/html')) {
    // The pages are self-contained: no CDN, no external font, no image host.
    // 'unsafe-inline' covers the one inline script and style each page carries;
    // there is no user-supplied content on any of them for it to widen.
    reply.header(
      'Content-Security-Policy',
      "default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; " +
        "connect-src 'self'; img-src 'self' data:; base-uri 'none'; form-action 'none'; frame-ancestors 'none'",
    );
  }
  return payload;
});
await app.register(multipart);
// A burst guard for one warm instance, and nothing more than that.
//
// This keeps its counters in memory, and the backend is a Vercel Function: a
// fresh instance starts with a fresh empty counter, so the limit is whatever
// the platform's scheduling happens to make it. Measured 2026-08-26: 70
// concurrent requests to /api/chat were all served 200.
//
// Which means it can neither be relied on NOR made tight. Tight was worse than
// useless: it counts per IP, so on a warm instance the eleventh sign-in from an
// office sharing one address was refused — measured the same day, a legitimate
// account was locked out by attempts against a completely different one. The
// first market is HR teams on Google Workspace, where that IS the normal shape.
//
// The real floor is in Postgres, per account, in routes/auth.ts (migration
// 0008), and the per-user AI spend is bounded by consume_quota. This is left
// only to blunt a single-instance flood.
await app.register(rateLimit, {
  max: 300,
  timeWindow: '1 minute',
  // Its default body is English and shaped nothing like ours. Anything a user
  // can see says the same thing in the same language, whichever layer said it.
  errorResponseBuilder: () => ({
    error: 'For mange forsøg. Vent et par minutter, og prøv igen.',
    code: 'rate_limited',
  }),
});

app.get('/api/health', async () => ({ ok: true, name: 'ai-writing-assistant backend' }));

// Local test harness for manual insertion testing (dev convenience; the file
// doesn't exist in the deployed bundle — 404 there instead of a crash).
app.get('/harness', async (_req, reply) => {
  try {
    const { readFileSync } = await import('node:fs');
    const { resolve } = await import('node:path');
    const html = readFileSync(resolve(process.cwd(), '../../test-pages/harness.html'), 'utf8');
    reply.type('text/html').send(html);
  } catch {
    reply.code(404).send({ error: 'harness is a local-dev page' });
  }
});

app.get('/api/usage', async (req, reply) => {
  const user = await verifyUser(req.headers.authorization);
  if (!user) return reply.code(401).send({ error: 'Log ind først', code: 'unauthenticated' });
  const usage = await rpc<{ used: number; limit: number; resets_at: string }>(user, 'get_usage');
  return { used: usage.used, limit: usage.limit, resetsAt: usage.resets_at };
});

adminRoutes(app);
authRoutes(app);
autonomousRoutes(app);
billingRoutes(app);
chatRoutes(app);
siteRoutes(app);
conversationRoutes(app);
fileRoutes(app);
referralRoutes(app);
templateRoutes(app);

// On Vercel the function adapter (api/index.ts) owns the socket; only local
// dev binds a port.
if (!process.env.VERCEL) {
  app.listen({ port: env.port, host: '127.0.0.1' }).then(
    () => app.log.info(`backend listening on http://127.0.0.1:${env.port}`),
    (err) => {
      app.log.error(err, 'listen failed');
      process.exit(1);
    },
  );
}
