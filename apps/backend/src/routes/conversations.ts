import type { FastifyInstance } from 'fastify';
import { verifyUser, rest, isUuid } from '../supabase.js';

export function conversationRoutes(app: FastifyInstance): void {
  app.get('/api/conversations', async (req, reply) => {
    const user = await verifyUser(req.headers.authorization);
    if (!user) return reply.code(401).send({ error: 'Sign in required', code: 'unauthenticated' });

    const res = await rest(
      user,
      '/conversations?select=id,title,updated_at,messages(count)&order=updated_at.desc&limit=100',
    );
    if (!res.ok) return reply.code(502).send({ error: 'Could not load conversations', code: 'upstream_error' });
    const rows = (await res.json()) as { id: string; title: string; updated_at: string; messages: { count: number }[] }[];
    return rows.map((r) => ({
      id: r.id,
      title: r.title,
      updatedAt: r.updated_at,
      messageCount: r.messages?.[0]?.count ?? 0,
    }));
  });

  app.get('/api/conversations/:id', async (req, reply) => {
    const user = await verifyUser(req.headers.authorization);
    if (!user) return reply.code(401).send({ error: 'Sign in required', code: 'unauthenticated' });
    const { id } = req.params as { id: string };
    // The id lands in a PostgREST filter string — %-decoded params can inject
    // extra query parameters unless the format is pinned down first (WR-05).
    if (!isUuid(id)) return reply.code(400).send({ error: 'Invalid conversation id', code: 'bad_request' });

    const res = await rest(user, `/messages?conversation_id=eq.${id}&select=role,content,created_at&order=created_at.asc`);
    if (!res.ok) return reply.code(502).send({ error: 'Could not load conversation', code: 'upstream_error' });
    return res.json();
  });

  app.delete('/api/conversations/:id', async (req, reply) => {
    const user = await verifyUser(req.headers.authorization);
    if (!user) return reply.code(401).send({ error: 'Sign in required', code: 'unauthenticated' });
    const { id } = req.params as { id: string };
    if (!isUuid(id)) return reply.code(400).send({ error: 'Invalid conversation id', code: 'bad_request' });

    // Messages cascade via FK; RLS restricts to the owner.
    const res = await rest(user, `/conversations?id=eq.${id}`, { method: 'DELETE' });
    if (!res.ok) return reply.code(502).send({ error: 'Delete failed', code: 'upstream_error' });
    return { ok: true };
  });
}
