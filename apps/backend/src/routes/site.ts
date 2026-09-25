import type { FastifyInstance } from 'fastify';
import { createHash } from 'node:crypto';
import { env } from '../env.js';
import { capture } from '../analytics.js';

/**
 * Visits to chatbotskriv.dk, counted without cookies.
 *
 * WHY THROUGH THE BACKEND: the PostHog write key lives here already, and the
 * landing page is static. A browser SDK would be a second copy of the key, a
 * few dozen kilobytes on every guide, and a cookie or localStorage id, which
 * under the Danish cookie rules needs a consent banner before it may be set.
 *
 * WHO IS A VISITOR: a hash of IP, user agent and today's date, salted with a
 * server secret. Nothing is stored in the browser, the IP never leaves this
 * function, and tomorrow the same person is a new id, so "visitors" means
 * visitors per day. The same trade-off Plausible makes.
 *
 * Events land as site_pageview / site_store_click. Their distinct_id starts with
 * "site_", so the dashboard's real-user filter can never count them as accounts.
 */
const BOT = /bot|crawl|spider|slurp|preview|headless|lighthouse|monitor|curl|wget|python|node-fetch/i;
const EVENTS = new Set(['pageview', 'store_click']);
const clip = (v: unknown, n: number) => (typeof v === 'string' ? v.slice(0, n) : undefined);

export function siteRoutes(app: FastifyInstance): void {
  app.post('/api/site-event', async (req, reply) => {
    // sendBeacon posts text/plain so the browser skips the CORS preflight.
    let body: Record<string, unknown>;
    try {
      body = typeof req.body === 'string' ? JSON.parse(req.body) : ((req.body as Record<string, unknown>) ?? {});
    } catch {
      return reply.code(400).send({ error: 'bad json', code: 'bad_request' });
    }
    const ua = req.headers['user-agent'] ?? '';
    const event = clip(body.e, 20);
    if (!event || !EVENTS.has(event) || BOT.test(ua)) return reply.code(204).send();

    // Vercel's edge sets x-real-ip to the client; req.ip is the proxy.
    const ip = String(req.headers['x-real-ip'] ?? req.ip);
    const day = new Date().toISOString().slice(0, 10);
    const visitor = createHash('sha256')
      .update(`${env.posthogKey}|${day}|${ip}|${ua}`)
      .digest('hex')
      .slice(0, 24);

    let referrer: string | undefined;
    try {
      const r = clip(body.r, 500);
      referrer = r ? new URL(r).hostname.replace(/^www\./, '') : undefined;
    } catch {
      /* a malformed referrer is just no referrer */
    }

    await capture(`site_${visitor}`, `site_${event}`, {
      path: clip(body.p, 200),
      referrer: referrer === 'chatbotskriv.dk' ? undefined : referrer,
      utm_source: clip(body.us, 100),
      utm_medium: clip(body.um, 100),
      utm_campaign: clip(body.uc, 100),
      mobile: /Mobi/i.test(ua),
      $process_person_profile: false,
    });
    return reply.code(204).send();
  });
}
