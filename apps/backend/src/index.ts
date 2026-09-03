import Fastify from 'fastify';
import cors from '@fastify/cors';
import multipart from '@fastify/multipart';
import rateLimit from '@fastify/rate-limit';
import { env } from './env.js';
import { authRoutes } from './routes/auth.js';
import { billingRoutes } from './routes/billing.js';
import { chatRoutes } from './routes/chat.js';
import { conversationRoutes } from './routes/conversations.js';
import { fileRoutes } from './routes/files.js';
import { templateRoutes } from './routes/templates.js';
import { verifyUser, rpc } from './supabase.js';

export const app = Fastify({ logger: { level: 'info' } });

await app.register(cors, {
  // Extension pages have chrome-extension:// origins whose ID changes per
  // install in dev — reflect the origin rather than pinning one.
  origin: true,
  credentials: false,
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

authRoutes(app);
billingRoutes(app);
chatRoutes(app);
conversationRoutes(app);
fileRoutes(app);
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
