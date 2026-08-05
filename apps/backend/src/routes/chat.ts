import type { FastifyInstance } from 'fastify';
import type { ChatRequest, ChatStreamEvent } from '@awa/shared';
import { verifyUser, rpc, rest, isUuid, type AuthedUser } from '../supabase.js';
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
      return reply.code(401).send({ error: 'Log ind for at bruge assistenten', code: 'unauthenticated' });
    }

    const body = req.body as ChatRequest;
    if (!Array.isArray(body?.messages) || body.messages.length === 0) {
      return reply.code(400).send({ error: 'messages required', code: 'bad_request' });
    }
    if (body.conversationId && !isUuid(body.conversationId)) {
      return reply.code(400).send({ error: 'Invalid conversation id', code: 'bad_request' });
    }

    // Quota is consumed atomically BEFORE the AI call (QUOT-01).
    let quota: QuotaResult;
    try {
      quota = await rpc<QuotaResult>(user, 'consume_quota', { p_cost: 1 });
    } catch (err) {
      req.log.error(err, 'consume_quota failed');
      return reply.code(503).send({
        error: 'Din kvote kunne ikke kontrolleres lige nu — prøv igen om få sekunder.',
        code: 'upstream_error',
      });
    }
    if (!quota.ok) {
      return reply.code(429).send({
        error: `Du har brugt alle ${quota.limit} forespørgsler for i dag. Din grænse nulstilles ${quota.resets_at}.`,
        code: 'quota_exceeded',
        used: quota.used,
        limit: quota.limit,
        resets_at: quota.resets_at,
      });
    }

    // SSE stream. hijack() tells Fastify we own the raw socket from here —
    // without it Fastify attempts its own send after the handler returns.
    reply.hijack();
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

      // Persist the exchange under the user's own JWT (RLS-scoped). A persist
      // failure must not fail a generation the user already received — log it
      // loudly instead of silently dropping history (WR-03).
      try {
        await persistExchange(user, conversationId, body, assistantText);
      } catch (persistErr) {
        req.log.error(persistErr, 'persistExchange failed — exchange missing from history');
      }
      if (tokensIn || tokensOut) {
        await rpc(user, 'record_tokens', { p_in: tokensIn, p_out: tokensOut }).catch(() => {});
      }

      // The usage lookup is bookkeeping; its failure must not mark a fully
      // delivered (and charged) response as errored (WR-04).
      let usage: { used: number; limit: number; resets_at: string } | null = null;
      try {
        usage = await rpc<{ used: number; limit: number; resets_at: string }>(user, 'get_usage');
      } catch (usageErr) {
        req.log.error(usageErr, 'get_usage after successful stream failed');
      }
      send({
        type: 'done',
        usage: usage ? { used: usage.used, limit: usage.limit, resetsAt: usage.resets_at } : null,
      });
    } catch (err) {
      // The quota point was consumed up front (QUOT-01). If the user received
      // zero tokens, give it back — charging for nothing burns beta quota on
      // routine free-model 429s (WR-06). Refund failure must not mask the
      // original error.
      if (!assistantText) {
        await rpc(user, 'refund_quota', { p_cost: 1 }).catch((refundErr) =>
          req.log.error(refundErr, 'refund_quota failed after zero-token generation failure'),
        );
      }
      if (err instanceof PolicyError) {
        send({
          type: 'error',
          code: 'policy_no_paid_models',
          message:
            'Dette indhold er markeret som rigtige persondata og kører kun på betalte modeller uden træning. Ingen er finansieret endnu — tank OpenRouter-kredit op, eller fjern fluebenet i "indeholder rigtige data", hvis det er testindhold.',
        });
      } else if (err instanceof NoModelsError) {
        send({
          type: 'error',
          code: 'all_models_failed',
          message: `Alle modeller i kæden er utilgængelige lige nu (${err.attempts
            .map((a) => a.model.split('/').pop())
            .join(', ')}). Det er som regel midlertidigt — prøv igen om et øjeblik.`,
        });
      } else if (!abort.signal.aborted) {
        send({
          type: 'error',
          code: 'upstream_error',
          message: `AI-svaret fejlede: ${err instanceof Error ? err.message : 'ukendt fejl'}`,
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
  const id = rows[0]?.id;
  if (!id) throw new Error('create conversation returned no row (RLS filtered the insert?)');
  return id;
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
  const insert = await rest(user, '/messages', { method: 'POST', body: JSON.stringify(rows) });
  if (!insert.ok) {
    throw new Error(`messages insert failed (${insert.status}): ${await insert.text().catch(() => '')}`);
  }
  const touch = await rest(user, `/conversations?id=eq.${conversationId}`, {
    method: 'PATCH',
    body: JSON.stringify({ updated_at: new Date().toISOString() }),
  });
  if (!touch.ok) {
    throw new Error(`conversation touch failed (${touch.status}): ${await touch.text().catch(() => '')}`);
  }
}
