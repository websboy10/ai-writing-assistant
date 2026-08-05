import type { FastifyInstance } from 'fastify';
import type { ChatRequest, ChatStreamEvent } from '@awa/shared';
import { verifyUser, rpc, rest, type AuthedUser } from '../supabase.js';
import { assembleMessages } from '../prompt.js';
import { streamChat, NoModelsError, PolicyError } from '../openrouter.js';

interface QuotaResult {
  ok: boolean;
  used: number;
  limit: number;
  resets_at: string;
}

export function chatRoutes(app: FastifyInstance): void {
  app.post('/api/chat', async (req, reply) => {
    const user = await verifyUser(req.headers.authorization);
    if (!user) {
      return reply.code(401).send({ error: 'Sign in to use the assistant', code: 'unauthenticated' });
    }

    const body = req.body as ChatRequest;
    if (!Array.isArray(body?.messages) || body.messages.length === 0) {
      return reply.code(400).send({ error: 'messages required', code: 'bad_request' });
    }

    // Quota is consumed atomically BEFORE the AI call (QUOT-01).
    const quota = await rpc<QuotaResult>(user, 'consume_quota', { p_cost: 1 });
    if (!quota.ok) {
      return reply.code(429).send({
        error: `You've used all ${quota.limit} requests for today. Your limit resets at ${quota.resets_at}.`,
        code: 'quota_exceeded',
        used: quota.used,
        limit: quota.limit,
        resets_at: quota.resets_at,
      });
    }

    // SSE stream
    reply.raw.writeHead(200, {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache, no-transform',
      Connection: 'keep-alive',
      'Access-Control-Allow-Origin': (req.headers.origin as string) ?? '*',
    });

    const send = (event: ChatStreamEvent) => {
      reply.raw.write(`data: ${JSON.stringify(event)}\n\n`);
    };
    const heartbeat = setInterval(() => reply.raw.write(': ping\n\n'), 15_000);

    const abort = new AbortController();
    req.raw.on('close', () => abort.abort());

    let assistantText = '';
    let tokensIn = 0;
    let tokensOut = 0;

    try {
      const conversationId = await ensureConversation(user, body);
      send({ type: 'meta', conversationId, model: 'pending' });

      await streamChat(assembleMessages(body), body.contentClass, abort.signal, {
        onMeta: (model) => send({ type: 'meta', conversationId, model }),
        onToken: (text) => {
          assistantText += text;
          send({ type: 'token', text });
        },
        onUsage: (i, o) => {
          tokensIn = i;
          tokensOut = o;
        },
      });

      // Persist the exchange under the user's own JWT (RLS-scoped).
      await persistExchange(user, conversationId, body, assistantText);
      if (tokensIn || tokensOut) {
        await rpc(user, 'record_tokens', { p_in: tokensIn, p_out: tokensOut }).catch(() => {});
      }

      const usage = await rpc<{ used: number; limit: number; resets_at: string }>(user, 'get_usage');
      send({ type: 'done', usage: { used: usage.used, limit: usage.limit, resetsAt: usage.resets_at } });
    } catch (err) {
      if (err instanceof PolicyError) {
        send({
          type: 'error',
          code: 'policy_no_paid_models',
          message:
            'This content is marked as real personal data, which only runs on paid no-training models. None are funded yet — top up OpenRouter credits, or untick "contains real data" if this is test content.',
        });
      } else if (err instanceof NoModelsError) {
        send({
          type: 'error',
          code: 'all_models_failed',
          message: `Every model in the chain is currently unavailable (${err.attempts
            .map((a) => a.model.split('/').pop())
            .join(', ')}). This is usually temporary — try again in a minute.`,
        });
      } else if (!abort.signal.aborted) {
        send({
          type: 'error',
          code: 'upstream_error',
          message: `The AI response failed: ${err instanceof Error ? err.message : 'unknown error'}`,
        });
      }
    } finally {
      clearInterval(heartbeat);
      reply.raw.end();
    }
  });
}

async function ensureConversation(user: AuthedUser, body: ChatRequest): Promise<string> {
  if (body.conversationId) return body.conversationId;
  const firstUser = body.messages.find((m) => m.role === 'user');
  const title = (body.subject ?? firstUser?.content ?? 'New conversation').slice(0, 60);
  const res = await rest(user, '/conversations', {
    method: 'POST',
    body: JSON.stringify({ user_id: user.id, title }),
    prefer: 'return=representation',
  });
  if (!res.ok) throw new Error(`create conversation failed: ${res.status}`);
  const rows = (await res.json()) as { id: string }[];
  return rows[0].id;
}

async function persistExchange(
  user: AuthedUser,
  conversationId: string,
  body: ChatRequest,
  assistantText: string,
): Promise<void> {
  const lastUser = [...body.messages].reverse().find((m) => m.role === 'user');
  const rows = [];
  if (lastUser) rows.push({ conversation_id: conversationId, role: 'user', content: lastUser.content });
  if (assistantText) rows.push({ conversation_id: conversationId, role: 'assistant', content: assistantText });
  if (!rows.length) return;
  await rest(user, '/messages', { method: 'POST', body: JSON.stringify(rows) });
  await rest(user, `/conversations?id=eq.${conversationId}`, {
    method: 'PATCH',
    body: JSON.stringify({ updated_at: new Date().toISOString() }),
  });
}
