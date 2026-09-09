import type { FastifyInstance } from 'fastify';
import type { ChatRequest, ChatStreamEvent, WebSource } from '@awa/shared';
import { verifyUser, rpc, rest, isUuid, type AuthedUser, danishTime, anonRpc } from '../supabase.js';
import { assembleMessages } from '../prompt.js';
import { streamChat, NoModelsError, PolicyError } from '../openrouter.js';
import { getEntitlement } from '../billing.js';
import { capture } from '../analytics.js';
import { needsWebSearch } from '../websearch.js';

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
    // Both of these mean the client sent something malformed, which is our bug
    // and not something the user did — but the panel renders `error` verbatim,
    // so it has to read like the rest of the product rather than like a stack
    // trace. The `code` is what a developer reads.
    if (!Array.isArray(body?.messages) || body.messages.length === 0) {
      return reply.code(400).send({ error: 'Beskeden nåede ikke frem. Prøv igen.', code: 'bad_request' });
    }
    if (body.conversationId && !isUuid(body.conversationId)) {
      return reply.code(400).send({ error: 'Samtalen kunne ikke genfindes. Start en ny, og prøv igen.', code: 'bad_request' });
    }

    // The freemium hard paywall (BILL-01): no active trial or subscription →
    // no AI, enforced here on the server, not in the UI.
    try {
      const installRaw = req.headers['x-awa-install'];
      const install = typeof installRaw === 'string' && installRaw.length >= 8 ? installRaw.slice(0, 128) : 'unknown-device';
      const ent = await getEntitlement(user, install);
      if (!ent.allowed) {
        await capture(user.id, 'paywall_hit', { route: 'chat', status: ent.status });
        return reply.code(402).send({
          error: 'Din gratis prøveperiode er udløbet. Opgrader for 100 kr. om måneden for at skrive videre.',
          code: 'payment_required',
        });
      }
    } catch (err) {
      req.log.error(err, 'entitlement check failed');
      return reply.code(503).send({
        error: 'Dit abonnement kunne ikke kontrolleres lige nu — prøv igen om få sekunder.',
        code: 'upstream_error',
      });
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
      await capture(user.id, 'quota_exceeded', { limit: quota.limit });
      return reply.code(429).send({
        error: `Du har brugt alle ${quota.limit} forespørgsler for i dag. Grænsen nulstilles ${danishTime(quota.resets_at)}.`,
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
    let costCredits: number | null = null;
    let servedBy = '';
    let sources: WebSource[] = [];
    const startedAt = Date.now();
    // Decided inside the try, read by the failure log in the catch.
    let webSearch = false;

    try {
      const conversationId = await ensureConversation(user, body);
      send({ type: 'meta', conversationId, model: 'pending' });
      send({ type: 'status', state: 'thinking' });

      // Decided here, never by the client: the user cannot tell which of their
      // own questions the model is shaky on — that is why they are asking it.
      // Costs nothing on the operations that act on the user's own text, which
      // are most of them; see websearch.ts.
      webSearch = await needsWebSearch(body, abort.signal);
      // Said before the search starts, not after: this is the longest silence
      // in the whole request (2-4s) and the only one the user would otherwise
      // have no explanation for.
      if (webSearch) send({ type: 'status', state: 'searching' });

      await streamChat(assembleMessages(body), body.contentClass, abort.signal, {
        onMeta: (model) => {
          servedBy = model;
          send({ type: 'meta', conversationId, model });
        },
        onToken: (text) => {
          assistantText += text;
          send({ type: 'token', text });
        },
        onUsage: (i, o, cost) => {
          tokensIn = i;
          tokensOut = o;
          costCredits = cost;
        },
        // Straight through to the sidebar and nowhere near the document — the
        // whole point of searching without citations is that the user can
        // still see where an answer came from.
        onSources: (list) => {
          sources = list;
          send({ type: 'sources', sources: list });
        },
        // A fallback that nobody can see is a fallback nobody fixes: the chain
        // silently served every request from its last model for an unknown
        // length of time before this line existed.
        onModelFailed: (model, reason) => {
          req.log.warn({ model, reason }, 'model chain fallback');
          // Counted, not just logged: a chain whose first entry is permanently
          // broken looks like a working product with a latency problem, and the
          // logs are the one place nobody looks until someone complains.
          //
          // The one capture deliberately NOT awaited. It fires mid-stream while
          // the next model is being reached for, and blocking there would make
          // recovering from a failure slower than the failure itself. This one
          // may be lost to a frozen invocation; a completion may not.
          void capture(user.id, 'model_fallback', { model, reason: reason.slice(0, 120) });
        },
      },
      // Smart routing (openrouter.ts → pickChain): a short answer with nothing
      // attached does not need the most expensive model in the chain.
      { length: body.prefs?.length, webSearch });

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
      await capture(user.id, 'chat_completed', {
        model: servedBy,
        length: body.prefs?.length ?? 'medium',
        tokens_in: tokensIn,
        tokens_out: tokensOut,
        chars_out: assistantText.length,
        context_items: body.context?.length ?? 0,
        // Search is billed per search on top of the generation, so the two
        // have to be separable on the dashboard: "answers cost X" stops being
        // one number the day some of them search and some do not.
        web_search: webSearch,
        sources: sources.length,
        ms: Date.now() - startedAt,
        // What this answer cost, in OpenRouter credits. Summed over a window
        // this is real spend, and divided into the remaining balance it is a
        // runway in days — both on the dashboard, neither guessed.
        cost: costCredits,
      });
    } catch (err) {
      // The quota point was consumed up front (QUOT-01). If the user received
      // zero tokens, give it back — charging for nothing burns beta quota on
      // routine free-model 429s (WR-06). Refund failure must not mask the
      // original error.
      if (!assistantText) {
        await anonRpc('refund_quota_for', { p_user_id: user.id, p_cost: 1 }).catch((refundErr) =>
          req.log.error(refundErr, 'refund_quota failed after zero-token generation failure'),
        );
      }
      await capture(user.id, 'chat_failed', {
        code:
          err instanceof PolicyError
            ? 'policy_no_paid_models'
            : err instanceof NoModelsError
              ? err.isOutOfCredit
                ? 'out_of_credit'
                : 'all_models_failed'
              : abort.signal.aborted
                ? 'aborted_by_user'
                : 'upstream_error',
        partial: assistantText.length > 0,
        ms: Date.now() - startedAt,
      });
      if (err instanceof PolicyError) {
        send({
          type: 'error',
          code: 'policy_no_paid_models',
          message:
            'Dette indhold er markeret som rigtige persondata og kører kun på betalte modeller uden træning. Ingen er finansieret endnu — tank OpenRouter-kredit op, eller fjern fluebenet i "indeholder rigtige data", hvis det er testindhold.',
        });
      } else if (err instanceof NoModelsError) {
        // "Try again shortly" is true for a busy model and false for an empty
        // account, and the user cannot tell them apart — so we must.
        if (err.isOutOfCredit) {
          req.log.error({ attempts: err.attempts }, 'OPENROUTER OUT OF CREDIT — every paid model refused');
          send({
            type: 'error',
            code: 'all_models_failed',
            message:
              'Assistenten kan ikke svare lige nu. Det er en fejl hos os, ikke hos dig, og den går ikke væk af sig selv — vi er på sagen. Din kvote er ikke blevet brugt.',
          });
        } else {
          req.log.error({ attempts: err.attempts, webSearch }, 'all models failed');
          send({
            type: 'error',
            code: 'all_models_failed',
            message: `Alle modeller i kæden er utilgængelige lige nu (${err.attempts
              .map((a) => a.model.split('/').pop())
              .join(', ')}). Det er som regel midlertidigt — prøv igen om et øjeblik.`,
          });
        }
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
