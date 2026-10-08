import type { FastifyInstance } from 'fastify';
import type { AutonomousAnswer, AutonomousRequest, AutonomousResponse, AutonomousStreamEvent, ContentClass } from '@awa/shared';
import { verifyUser, rpc, danishTime, anonRpc } from '../supabase.js';
import { getEntitlement } from '../billing.js';
import { collect } from '../autonomous/complete.js';
import { detectionMessages, answerMessages } from '../autonomous/prompt.js';
import {
  batchFills,
  collapseForOldClients,
  parseDetection,
  parseAnswers,
  validateMarked,
  validateParagraphs,
} from '../autonomous/parse.js';
import { NoModelsError, PolicyError } from '../openrouter.js';
import { needsWebSearch, webResearch } from '../websearch.js';

// Kept in sync with packages/shared/src/index.ts. Values (not types) must be
// local: @awa/shared ships TS source, which Node can't load in the deployed
// serverless bundle — the backend's shared imports are type-only by contract
// (see apps/backend/src/routes/files.ts for the established pattern).
const MAX_AUTONOMOUS_DOC_CHARS = 60_000;
const ANSWER_BATCH_SIZE = 10;

interface QuotaResult {
  ok: boolean;
  used: number;
  limit: number;
  resets_at: string;
}

/**
 * POST /api/autonomous/answer — the thinking half of "Besvar alle spørgsmål"
 * (AUTO-03/04/05): find every question in a document (or a marked
 * selection) and answer all of them, grounded in the document plus whatever
 * files are already attached in the panel (D-11). Ungrounded answers are
 * flagged, never withheld (D-12). No insertion, no Google Docs knowledge —
 * this route only maps paragraphs to answers.
 */
export function autonomousRoutes(app: FastifyInstance): void {
  app.post('/api/autonomous/answer', async (req, reply) => {
    const user = await verifyUser(req.headers.authorization);
    if (!user) {
      return reply.code(401).send({ error: 'Log ind for at besvare spørgsmål i dokumentet', code: 'unauthenticated' });
    }

    // The freemium hard paywall (BILL-01), identical gate to /api/chat.
    try {
      const installRaw = req.headers['x-awa-install'];
      const install = typeof installRaw === 'string' && installRaw.length >= 8 ? installRaw.slice(0, 128) : 'unknown-device';
      const ent = await getEntitlement(user, install);
      if (!ent.allowed) {
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

    const body = req.body as Partial<AutonomousRequest> | undefined;
    const paragraphs = validateParagraphs(body?.paragraphs);
    if (!paragraphs) {
      return reply.code(400).send({
        error: 'Ingen gyldige afsnit at analysere blev sendt med',
        code: 'bad_request',
      });
    }
    const totalChars = paragraphs.reduce((sum, p) => sum + p.text.length, 0);
    if (totalChars > MAX_AUTONOMOUS_DOC_CHARS) {
      return reply.code(400).send({
        error: `Dokumentet er for langt til at blive besvaret i ét stykke (grænse ${MAX_AUTONOMOUS_DOC_CHARS.toLocaleString('da-DK')} tegn).`,
        code: 'bad_request',
      });
    }

    const marked = validateMarked(body?.marked, paragraphs.length);
    const autoReq: AutonomousRequest = {
      scope: body?.scope === 'selection' ? 'selection' : 'document',
      paragraphs,
      ...(marked ? { marked } : {}),
      documentTitle: typeof body?.documentTitle === 'string' ? body.documentTitle : undefined,
      context: Array.isArray(body?.context) ? body.context : undefined,
      prefs: body?.prefs,
      fills: body?.fills === true,
      // Only together with fills: an extension that joins a question's fills
      // into one answer has no line to write into.
      replace: body?.fills === true && body?.replace === true,
    };

    // Quota is consumed atomically BEFORE any AI call (QUOT-01): a run costs
    // a detection call plus at least one answer call, charged honestly as 2
    // — refunded below on every path that produces zero answers (WR-06).
    let quota: QuotaResult;
    try {
      quota = await rpc<QuotaResult>(user, 'consume_quota', { p_cost: 2 });
    } catch (err) {
      req.log.error(err, 'quota consumption failed');
      return reply.code(503).send({
        error: 'Din kvote kunne ikke kontrolleres lige nu — prøv igen om få sekunder.',
        code: 'upstream_error',
      });
    }
    if (!quota.ok) {
      return reply.code(429).send({
        error: `Du har brugt alle ${quota.limit} forespørgsler for i dag. Grænsen nulstilles ${danishTime(quota.resets_at)}.`,
        code: 'quota_exceeded',
        used: quota.used,
        limit: quota.limit,
        resets_at: quota.resets_at,
      });
    }

    // T-07-06: this route sends whole documents to the model — the first
    // known use case is a manager's written assessment of a named employee,
    // which is personal data under GDPR. This route ALWAYS routes as 'real'
    // (the paid, no-training chain); contentClass is never read from the
    // request body and the client cannot widen it. This is a property of THIS
    // route only — it deliberately does NOT touch the separately-deferred
    // chat.ts:48 contentClass routing defect recorded in STATE.md.
    const contentClass: ContentClass = 'real';

    const abort = new AbortController();
    req.raw.on('close', () => abort.abort());

    // From here the reply is either one JSON body (extensions up to 0.2.4) or
    // a stream of stages ending in the same body (AutonomousRequest.stream).
    // Everything above answers as plain JSON in both cases: nothing has
    // started yet, so there is nothing to narrate.
    const streaming = body?.stream === true;
    let heartbeat: ReturnType<typeof setInterval> | undefined;
    if (streaming) {
      reply.hijack();
      reply.raw.writeHead(200, {
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache, no-transform',
        Connection: 'keep-alive',
        'Access-Control-Allow-Origin': (req.headers.origin as string) ?? '*',
      });
      heartbeat = setInterval(() => reply.raw.write(': ping\n\n'), 15_000);
    }
    const emit = (event: AutonomousStreamEvent) => {
      if (streaming) reply.raw.write(`data: ${JSON.stringify(event)}\n\n`);
    };
    const finish = (status: number, payload: AutonomousResponse | { error: string; code: string }) => {
      if (!streaming) return reply.code(status).send(payload);
      emit('error' in payload ? { type: 'error', code: payload.code, message: payload.error } : { type: 'result', response: payload });
      clearInterval(heartbeat);
      reply.raw.end();
    };

    // What the run was actually given. Answers that say "the attached context
    // holds nothing" are indistinguishable, from the outside, between a model
    // ignoring the attachment and an attachment that never arrived — and the
    // difference decides whether the bug is in the prompt or in the panel.
    req.log.info(
      {
        scope: autoReq.scope,
        marked: marked ?? null,
        paragraphs: paragraphs.length,
        docChars: totalChars,
        contextItems: autoReq.context?.length ?? 0,
        contextChars: autoReq.context?.reduce((n, c) => n + (c.text?.length ?? 0), 0) ?? 0,
      },
      'autonomous run input',
    );

    // Decided inside the try, read by the failure log in the catch.
    let webSearch = false;
    try {
      const detection = await collect(detectionMessages(autoReq), contentClass, abort.signal);
      // Which model answered, and which ones we burned getting there. Silent
      // fallback hid an entire broken chain once already — see openrouter.ts.
      if (detection.failures.length) {
        req.log.warn({ served: detection.model, failures: detection.failures }, 'model chain fallback');
      }
      const detected = parseDetection(detection.text, paragraphs.length, paragraphs, marked, autoReq.replace);
      // The plan, as validated: every fill, as question → mode@place. A run
      // where every fill is "below" at its own question and the raw reply
      // never says "fills" means the model ignored the field, not that the
      // form had no boxes.
      req.log.info(
        {
          plan: detected.map((f) => `${f.paragraphIndex}→${f.mode}@${f.options?.join('/') ?? f.at}`),
          rawMentionsPlan: /"fills"/.test(detection.text),
          rawHead: detection.text.slice(0, 500),
        },
        'detection plan',
      );
      if (detected.length === 0 && detection.text.trim()) {
        req.log.warn(
          { finishReason: detection.finishReason, chars: detection.text.length, tail: detection.text.slice(-300) },
          'detection produced no questions from a non-empty reply',
        );
      }

      // Zero questions found is a RESULT, not an error — the panel says so
      // plainly, and the quota charge for a run that did nothing is refunded.
      if (detected.length === 0) {
        await anonRpc('refund_quota_for', { p_user_id: user.id, p_cost: 2 }).catch((refundErr) =>
          req.log.error(refundErr, 'refund_quota failed after zero-question detection'),
        );

        return finish(200, { answers: [], detected: 0 });
      }

      const batches = batchFills(detected, ANSWER_BATCH_SIZE);
      // A question's fills all quote the same question; the web is asked about
      // the questions, once each, and the tasks that say more than they do.
      const questions = [...new Set(detected.map((f) => f.questionText))];
      const lookups = [...new Set(detected.map((f) => f.task ?? f.questionText))];
      emit({ type: 'stage', stage: 'found', questions: questions.length, places: detected.length });

      // The same rule the chat route uses, once for the whole run: a form
      // about a named novel or this year's tax rules gets looked up, a form
      // about the user's own year at work does not. An attached file settles
      // it as NO before any call is made — the attachment IS the grounding.
      webSearch = await needsWebSearch(
        {
          messages: [{ role: 'user', content: questions.join('\n') }],
          operation: 'chat',
          contentClass,
          context: autoReq.context,
        },
        abort.signal,
      );
      // The lookup is its own short call, and its findings ride into every
      // batch as attached context. The answer call itself never carries the
      // search plugin — see websearch.ts webResearch for the measured reason.
      if (webSearch) {
        emit({ type: 'stage', stage: 'searching' });
        const note = await webResearch(lookups, contentClass, abort.signal);
        req.log.info({ chars: note.length }, 'web research');
        if (note) {
          autoReq.context = [
            ...(autoReq.context ?? []),
            { id: 'web-research', name: 'Websøgning', kind: 'text', text: note, chars: note.length, truncated: false },
          ];
        }
      }

      // Batches are independent — each carries the whole document as context
      // and only its own questions — so running them one after another just
      // made the user wait twice as long. Measured 2026-08-25: ten questions
      // took up to 68s sequentially, and every second of that is a person
      // watching a progress bar with nothing else to do.
      let answered = 0;
      emit({ type: 'stage', stage: 'answering', done: 0, total: detected.length });
      const perBatch = await Promise.all(
        batches.map(async (batch) => {
          const run = async (insist: boolean) => {
            const completion = await collect(answerMessages(autoReq, batch, insist), contentClass, abort.signal);
            if (completion.failures.length) {
              req.log.warn({ served: completion.model, failures: completion.failures }, 'model chain fallback');
            }
            return { completion, parsed: parseAnswers(completion.text, batch, paragraphs) };
          };

          let { completion, parsed } = await run(false);

          // Nothing usable out of a whole batch is a different animal from
          // "some answers were dropped": measured on a real document roughly
          // one run in four, the model returned perfectly-shaped JSON with the
          // right indices and "" for every answer. The parser is right to drop
          // those — written out they are blank lines in the user's document —
          // but the user then waited half a minute to be told nothing could be
          // answered, about questions that were found.
          //
          // One retry, and only in this case. The quota point was charged up
          // front for the whole run, so this costs the user nothing; the alt-
          // ernative is a wasted run and a person clicking the button again
          // anyway. It matters most on the cheapest model in the chain, which
          // is exactly the one an unfunded key falls through to.
          if (parsed.length === 0 && batch.length > 0) {
            req.log.warn(
              { asked: batch.length, finishReason: completion.finishReason, tail: completion.text.slice(-300) },
              'answer batch yielded nothing usable — retrying once',
            );
            ({ completion, parsed } = await run(true));
          }

          if (parsed.length < batch.length) {
            req.log.warn(
              {
                asked: batch.length,
                parsed: parsed.length,
                finishReason: completion.finishReason,
                chars: completion.text.length,
                tail: completion.text.slice(-300),
              },
              'answer batch parsed fewer answers than questions asked',
            );
          }
          answered = Math.min(detected.length, answered + batch.length);
          emit({ type: 'stage', stage: 'answering', done: answered, total: detected.length });
          return parsed;
        }),
      );
      const all: AutonomousAnswer[] = perBatch.flat();
      const answers = autoReq.fills ? all : collapseForOldClients(all);

      if (answers.length === 0) {
        await anonRpc('refund_quota_for', { p_user_id: user.id, p_cost: 2 }).catch((refundErr) =>
          req.log.error(refundErr, 'refund_quota failed after zero-answer run'),
        );
      }

      return finish(200, { answers, detected: questions.length });
    } catch (err) {
      if (abort.signal.aborted) {
        // Client disconnected: nothing to send, but a hijacked reply is ours to close.
        clearInterval(heartbeat);
        if (streaming) reply.raw.end();
        return;
      }

      await anonRpc('refund_quota_for', { p_user_id: user.id, p_cost: 2 }).catch((refundErr) =>
        req.log.error(refundErr, 'refund_quota failed after autonomous run error'),
      );

      if (err instanceof PolicyError) {
        return finish(503, {
          error:
            'Denne funktion kører kun på betalte modeller uden træning, fordi den sender hele dokumenter. Ingen er finansieret endnu — tank OpenRouter-kredit op.',
          code: 'policy_no_paid_models',
        });
      }
      if (err instanceof NoModelsError) {
        // The reasons, or the next one of these is undiagnosable: on
        // 2026-09-09 two runs died here and the log held only the 503.
        req.log.error({ attempts: err.attempts, webSearch }, 'all models failed');
        return finish(503, {
          error: `Alle modeller i kæden er utilgængelige lige nu (${err.attempts
            .map((a) => a.model.split('/').pop())
            .join(', ')}). Det er som regel midlertidigt — prøv igen om et øjeblik.`,
          code: 'all_models_failed',
        });
      }
      req.log.error(err, 'autonomous run failed');
      return finish(502, {
        error: `AI-svaret fejlede: ${err instanceof Error ? err.message : 'ukendt fejl'}`,
        code: 'upstream_error',
      });
    }
  });
}
