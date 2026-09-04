import type { FastifyInstance } from 'fastify';
import { verifyUser, rest, isUuid } from '../supabase.js';
import { enforce, DAY } from '../limit.js';

const MAX_NAME = 60;
const MAX_INSTRUCTIONS = 4000;

export function templateRoutes(app: FastifyInstance): void {
  app.get('/api/templates', async (req, reply) => {
    const user = await verifyUser(req.headers.authorization);
    if (!user) return reply.code(401).send({ error: 'Log ind først', code: 'unauthenticated' });
    const res = await rest(user, '/templates?select=id,name,instructions&order=created_at.desc&limit=100');
    if (!res.ok) return reply.code(502).send({ error: 'Skabelonerne kunne ikke hentes', code: 'upstream_error' });
    return res.json();
  });

  app.post('/api/templates', async (req, reply) => {
    const user = await verifyUser(req.headers.authorization);
    if (!user) return reply.code(401).send({ error: 'Log ind først', code: 'unauthenticated' });
    // Rows in someone else's database are cheap to create and not free to
    // store. Nobody writes a hundred templates in a day.
    if (!(await enforce(req, reply, 'templates', user.id, [{ limit: 100, seconds: DAY }]))) return reply;
    const { name, instructions } = req.body as { name?: string; instructions?: string };
    if (!name?.trim() || !instructions?.trim()) {
      return reply.code(400).send({ error: 'En skabelon skal have et navn og sin tekst', code: 'bad_request' });
    }
    if (name.length > MAX_NAME || instructions.length > MAX_INSTRUCTIONS) {
      return reply.code(400).send({
        error: `Skabelongrænser: navn ${MAX_NAME} tegn, tekst ${MAX_INSTRUCTIONS} tegn.`,
        code: 'bad_request',
      });
    }
    const res = await rest(user, '/templates', {
      method: 'POST',
      body: JSON.stringify({ user_id: user.id, name: name.trim(), instructions }),
      prefer: 'return=representation',
    });
    if (!res.ok) return reply.code(502).send({ error: 'Skabelonen kunne ikke gemmes', code: 'upstream_error' });
    const rows = (await res.json()) as unknown[];
    return rows[0];
  });

  app.delete('/api/templates/:id', async (req, reply) => {
    const user = await verifyUser(req.headers.authorization);
    if (!user) return reply.code(401).send({ error: 'Log ind først', code: 'unauthenticated' });
    const { id } = req.params as { id: string };
    if (!isUuid(id)) return reply.code(400).send({ error: 'Ugyldigt skabelon-id', code: 'bad_request' });
    const res = await rest(user, `/templates?id=eq.${id}`, { method: 'DELETE' });
    if (!res.ok) return reply.code(502).send({ error: 'Sletning fejlede', code: 'upstream_error' });
    return { ok: true };
  });
}
