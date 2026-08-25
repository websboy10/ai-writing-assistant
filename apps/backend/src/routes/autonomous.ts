import type { FastifyInstance } from 'fastify';
import type { AutonomousAnswer, AutonomousParagraph, AutonomousRequest, AutonomousResponse, ContentClass } from '@awa/shared';
import { verifyUser, rpc } from '../supabase.js';
import { getEntitlement } from '../billing.js';
import { collect } from '../autonomous/complete.js';
import { detectionMessages, answerMessages } from '../autonomous/prompt.js';
import { parseDetection, parseAnswers, type DetectedQuestion } from '../autonomous/parse.js';
import { NoModelsError, PolicyError } from '../openrouter.js';

// Kept in sync with packages/shared/src/index.ts. Values (not types) must be
// local: @awa/shared ships TS source, which Node can't load in the deployed
// serverless bundle — the backend's shared imports are type-only by contract
// (see apps/backend/src/routes/files.ts for the established pattern).
const MAX_AUTONOMOUS_DOC_CHARS = 60_000;
const ANSWER_BATCH_SIZE = 5;

interface QuotaResult {
  ok: boolean;
  used: number;
  limit: number;
  resets_at: string;
}

/**
 * POST /api/autonomous/answer — the thinking half of autonomous mode
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
      return reply.code(401).send({ error: 'Log ind for at bruge autonom tilstand', code: 'unauthenticated' });
    }

    // The freemium hard paywall (BILL-01), identical gate to /api/chat.
    try {
      const installRaw = req.headers['x-awa-install'];
      const install = typeof installRaw === 'string' && installRaw.length >= 8 ? installRaw.slice(0, 128) : 'unknown-device';
      const ent = await getEntitlement(user, install);
      if (!ent.allowed) {
        return reply.code(402).send({
          error: 'Din gratis prøveperiode er udløbet. Opgrader for 50 kr. om måneden for at skrive videre.',
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
        error: `Dokumentet er for langt til autonom tilstand (grænse ${MAX_AUTONOMOUS_DOC_CHARS.toLocaleString('da-DK')} tegn). Marker i stedet et mindre afsnit og brug "Besvar markeringen".`,
        code: 'bad_request',
      });
    }

    const autoReq: AutonomousRequest = {
      scope: body?.scope === 'selection' ? 'selection' : 'document',
      paragraphs,
      documentTitle: typeof body?.documentTitle === 'string' ? body.documentTitle : undefined,
      context: Array.isArray(body?.context) ? body.context : undefined,
      prefs: body?.prefs,
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
        error: `Du har brugt alle ${quota.limit} forespørgsler for i dag. Din grænse nulstilles ${quota.resets_at}.`,
        code: 'quota_exceeded',
        used: quota.used,
        limit: quota.limit,
        resets_at: quota.resets_at,
      });
    }

    // T-07-06: autonomous mode sends whole documents to the model — the
    // first known use case is a manager's written assessment of a named
    // employee, which is personal data under GDPR. This route ALWAYS routes
    // as 'real' (the paid, no-training chain); contentClass is never read
    // from the request body and the client cannot widen it. This is a
    // property of THIS route only — it deliberately does NOT touch the
    // separately-deferred chat.ts:48 contentClass routing defect recorded
    // in STATE.md.
    const contentClass: ContentClass = 'real';

    const abort = new AbortController();
    req.raw.on('close', () => abort.abort());

    try {
      const detection = await collect(detectionMessages(autoReq), contentClass, abort.signal);
      const detected = parseDetection(detection.text, paragraphs.length);
      if (detected.length === 0 && detection.text.trim()) {
        req.log.warn(
          { finishReason: detection.finishReason, chars: detection.text.length, tail: detection.text.slice(-300) },
          'detection produced no questions from a non-empty reply',
        );
      }

      // Zero questions found is a RESULT, not an error — the panel says so
      // plainly, and the quota charge for a run that did nothing is refunded.
      if (detected.length === 0) {
        await rpc(user, 'refund_quota', { p_cost: 2 }).catch((refundErr) =>
          req.log.error(refundErr, 'refund_quota failed after zero-question detection'),
        );
        const response: AutonomousResponse = { answers: [], detected: 0 };
        return reply.send(response);
      }

      const batches: DetectedQuestion[][] = [];
      for (let i = 0; i < detected.length; i += ANSWER_BATCH_SIZE) {
        batches.push(detected.slice(i, i + ANSWER_BATCH_SIZE));
      }

      // Batches are independent — each carries the whole document as context
      // and only its own questions — so running them one after another just
      // made the user wait twice as long. Measured 2026-08-25: ten questions
      // took up to 68s sequentially, and every second of that is a person
      // watching a progress bar with nothing else to do.
      const perBatch = await Promise.all(
        batches.map(async (batch) => {
          const completion = await collect(answerMessages(autoReq, batch), contentClass, abort.signal);
          const parsed = parseAnswers(completion.text, batch);
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
          return parsed;
        }),
      );
      const answers: AutonomousAnswer[] = perBatch.flat();

      if (answers.length === 0) {
        await rpc(user, 'refund_quota', { p_cost: 2 }).catch((refundErr) =>
          req.log.error(refundErr, 'refund_quota failed after zero-answer run'),
        );
      }

      const response: AutonomousResponse = { answers, detected: detected.length };
      return reply.send(response);
    } catch (err) {
      if (abort.signal.aborted) return; // client disconnected — nothing to send

      await rpc(user, 'refund_quota', { p_cost: 2 }).catch((refundErr) =>
        req.log.error(refundErr, 'refund_quota failed after autonomous run error'),
      );

      if (err instanceof PolicyError) {
        return reply.code(503).send({
          error:
            'Autonom tilstand kører kun på betalte modeller uden træning, fordi den sender hele dokumenter. Ingen er finansieret endnu — tank OpenRouter-kredit op.',
          code: 'policy_no_paid_models',
        });
      }
      if (err instanceof NoModelsError) {
        return reply.code(503).send({
          error: `Alle modeller i kæden er utilgængelige lige nu (${err.attempts
            .map((a) => a.model.split('/').pop())
            .join(', ')}). Det er som regel midlertidigt — prøv igen om et øjeblik.`,
          code: 'all_models_failed',
        });
      }
      req.log.error(err, 'autonomous run failed');
      return reply.code(502).send({
        error: `AI-svaret fejlede: ${err instanceof Error ? err.message : 'ukendt fejl'}`,
        code: 'upstream_error',
      });
    }
  });
}

/**
 * The request body is untrusted (T-07-08). Every paragraph must have an
 * integer `index` and a string `text` before anything downstream — including
 * the model — sees it. Any malformed item rejects the whole request with a
 * specific reason rather than silently dropping data the client expected
 * to be answered.
 */
function validateParagraphs(paragraphs: unknown): AutonomousParagraph[] | null {
  if (!Array.isArray(paragraphs) || paragraphs.length === 0) return null;
  const out: AutonomousParagraph[] = [];
  for (const p of paragraphs) {
    if (!p || typeof p !== 'object') return null;
    const rec = p as Record<string, unknown>;
    if (!Number.isInteger(rec.index) || typeof rec.text !== 'string') return null;
    out.push({ index: rec.index as number, text: rec.text });
  }
  return out;
}
