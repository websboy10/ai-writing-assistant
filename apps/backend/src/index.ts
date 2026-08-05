import Fastify from 'fastify';
import cors from '@fastify/cors';
import multipart from '@fastify/multipart';
import { env } from './env.js';
import { authRoutes } from './routes/auth.js';
import { chatRoutes } from './routes/chat.js';
import { conversationRoutes } from './routes/conversations.js';
import { fileRoutes } from './routes/files.js';
import { verifyUser, rpc } from './supabase.js';

const app = Fastify({ logger: { level: 'info' } });

await app.register(cors, {
  // Extension pages have chrome-extension:// origins whose ID changes per
  // install in dev — reflect the origin rather than pinning one.
  origin: true,
  credentials: false,
});
await app.register(multipart);

app.get('/api/health', async () => ({ ok: true, name: 'ai-writing-assistant backend' }));

app.get('/api/usage', async (req, reply) => {
  const user = await verifyUser(req.headers.authorization);
  if (!user) return reply.code(401).send({ error: 'Sign in required', code: 'unauthenticated' });
  const usage = await rpc<{ used: number; limit: number; resets_at: string }>(user, 'get_usage');
  return { used: usage.used, limit: usage.limit, resetsAt: usage.resets_at };
});

authRoutes(app);
chatRoutes(app);
conversationRoutes(app);
fileRoutes(app);

app.listen({ port: env.port, host: '127.0.0.1' }).then(() => {
  app.log.info(`backend listening on http://127.0.0.1:${env.port}`);
});
