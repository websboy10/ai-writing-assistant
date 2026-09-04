import { createRequire } from 'node:module';
import path from 'node:path';
import type { FastifyInstance } from 'fastify';
import type { ParsedFile } from '@awa/shared';

// Kept in sync with packages/shared/src/index.ts. Values (not types) must be
// local: @awa/shared ships TS source, which Node can't load in the deployed
// serverless bundle — the backend's shared imports are type-only by contract.
const MAX_FILE_BYTES = 10 * 1024 * 1024;
const MAX_CONTEXT_CHARS_PER_ITEM = 60_000;
import { verifyUser } from '../supabase.js';
import { getEntitlement } from '../billing.js';
import { enforce, DAY, MINUTE } from '../limit.js';
import { capture } from '../analytics.js';

const require = createRequire(import.meta.url);

// OCR runs on a vision model, not tesseract: WASM OCR cannot ship reliably in
// a serverless bundle (its engine hard-requires files by path), and a vision
// model reads Danish better anyway. Routed with training denied — an uploaded
// file's contents are treated like real user data.
// A chain, not one model — for the same reason chat has one. A single vision
// model is a single point of failure, and the failure that actually happens is
// not "the model is down" but "this request costs more than the account can
// afford right now" (HTTP 402). One unaffordable model used to take screenshots
// and scanned PDFs down with it. Both entries are verified to exist and to
// accept images.
const OCR_CHAIN = (process.env.OCR_MODEL_CHAIN ?? process.env.OCR_MODEL ?? 'google/gemini-3.5-flash,anthropic/claude-sonnet-5')
  .split(',')
  .map((m) => m.trim())
  .filter(Boolean);

// A "scanned" PDF is one whose pages are images: pdf-parse succeeds but finds
// (nearly) no embedded text. Below this many characters we OCR instead.
const SCANNED_PDF_THRESHOLD = 50;
const MAX_OCR_PAGES = 6;

/**
 * Server-side file parsing (research: MV3 CSP makes client-side parsing a dead
 * end, and untrusted uploads belong behind hard limits — CTX-10/11).
 *
 * Every failure path returns a SPECIFIC reason. Parse work is wrapped in a
 * timeout so a pathological file cannot pin the event loop indefinitely.
 */
export function fileRoutes(app: FastifyInstance): void {
  // OCR is the most expensive compute on the box and sits outside the chat
  // quota — without its own limit one user can pin the CPU for free (WR-11).
  const limited = { config: { rateLimit: { max: 10, timeWindow: '1 minute' } } };

  app.post('/api/files', limited, async (req, reply) => {
    const user = await verifyUser(req.headers.authorization);
    if (!user) return reply.code(401).send({ error: 'Log ind først', code: 'unauthenticated' });

    // The paywall, on the other route that spends real money.
    //
    // This checked a session and nothing else, while OCR runs a scanned PDF
    // through up to six vision-model calls on the operator's OpenRouter
    // balance. So an account whose trial had run out could not chat, but could
    // still burn the bill by uploading files all day — a hole that cost money
    // rather than access, which is the worse kind. /api/chat has had this gate
    // since BILL-01; this route never got it.
    try {
      const installRaw = req.headers['x-awa-install'];
      const install = typeof installRaw === 'string' && installRaw.length >= 8 ? installRaw.slice(0, 128) : 'unknown-device';
      const ent = await getEntitlement(user, install);
      if (!ent.allowed) {
        await capture(user.id, 'paywall_hit', { route: 'files', status: ent.status });
        return reply.code(402).send({
          error: 'Din gratis prøveperiode er udløbet. Opgrader for at vedhæfte filer.',
          code: 'payment_required',
        });
      }
    } catch (err) {
      req.log.error(err, 'entitlement check failed on /api/files');
      return reply.code(503).send({
        error: 'Dit abonnement kunne ikke kontrolleres lige nu — prøv igen om få sekunder.',
        code: 'upstream_error',
      });
    }

    // The only hard cap on the most expensive call this product makes. A
    // paying account is entitled to the product, not to an unlimited vision
    // budget: one scanned PDF is up to six model calls, so 60 files a day is
    // already far past any real day's work and still bounds the bill.
    if (!(await enforce(req, reply, 'files', user.id, [
      { limit: 10, seconds: MINUTE },
      { limit: 60, seconds: DAY },
    ]))) {
      return reply;
    }

    const file = await req.file({ limits: { fileSize: MAX_FILE_BYTES } });
    if (!file) return reply.code(400).send({ error: 'Ingen fil i forespørgslen', code: 'bad_request' });

    let buffer: Buffer;
    try {
      buffer = await file.toBuffer();
    } catch {
      return reply.code(413).send({
        error: `"${file.filename}" er over grænsen på ${MAX_FILE_BYTES / 1024 / 1024} MB.`,
        code: 'file_too_large',
      });
    }

    const name = file.filename ?? 'file';
    const mime = file.mimetype ?? '';

    try {
      // 120s: a scanned PDF is up to 6 rendered pages of OCR, plus a one-time
      // language-data download on the very first OCR after a deploy.
      const parsed = await withTimeout(parse(buffer, name, mime), 120_000, (m) => req.log.warn(m));
      if (!parsed.text.trim()) {
        return reply.code(422).send({
          error: `Der kunne ikke udtrækkes tekst fra "${name}". Er det et scannet dokument, så prøv at uploade det som billede, så OCR kan læse det.`,
          code: 'no_text',
        });
      }
      await capture(user.id, 'file_parsed', { kind: parsed.kind, chars: parsed.chars, truncated: parsed.truncated });
      return finalize(parsed);
    } catch (err) {
      const message = err instanceof Error ? err.message : 'unknown error';
      if (message === 'timeout') {
        return reply.code(422).send({
          error: `Behandlingen af "${name}" tog for lang tid og blev stoppet. Prøv en mindre fil.`,
          code: 'parse_timeout',
        });
      }
      if (message === 'unsupported') {
        return reply.code(415).send({
          error: `"${name}" (${mime || 'ukendt type'}) understøttes ikke. Brug PDF, DOCX, TXT, Markdown, PNG eller JPG.`,
          code: 'unsupported_type',
        });
      }
      // OCR could not be bought or reached on any model in the chain. That is
      // our problem, not a fault in the user's file, and telling them to try a
      // different file would send them chasing a fix that cannot work.
      if (message.startsWith('ocr_unavailable')) {
        req.log.error({ err, name, mime }, 'OCR unavailable on every model in the chain');
        return reply.code(503).send({
          error: `Teksten i "${name}" kunne ikke læses lige nu. Det er en fejl hos os, ikke i din fil — prøv igen om lidt.`,
          code: 'upstream_error',
        });
      }
      // The raw message is a library's internal complaint — file paths, stack
      // fragments, whatever pdfjs felt like saying. It belongs in the log, not
      // in a sentence the user reads. (Same leak as the Stripe one fixed in
      // routes/billing.ts on 2026-08-25.)
      req.log.error({ err, name, mime }, 'file parse failed');
      return reply.code(422).send({
        error: `"${name}" kunne ikke behandles. Filen kan være beskadiget eller beskyttet med adgangskode.`,
        code: 'parse_failed',
      });
    }
  });
}

async function parse(buffer: Buffer, name: string, mime: string): Promise<ParsedFile> {
  const lower = name.toLowerCase();

  if (mime === 'application/pdf' || lower.endsWith('.pdf')) {
    // pdf-parse's index.js runs debug code when imported as ESM; import the lib directly.
    const { default: pdfParse } = await import('pdf-parse/lib/pdf-parse.js');
    const out = await pdfParse(buffer);
    const text = clean(out.text);
    // Scanned PDFs (each page an image) have no embedded text — the single
    // most common real-world upload failure. Render the pages and OCR them.
    if (text.length < SCANNED_PDF_THRESHOLD) {
      const ocrText = await ocrPdfPages(buffer);
      return { name, kind: 'pdf', text: ocrText, chars: 0, truncated: false };
    }
    return { name, kind: 'pdf', text, chars: 0, truncated: false };
  }

  if (
    mime === 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' ||
    lower.endsWith('.docx')
  ) {
    const mammoth = await import('mammoth');
    const out = await mammoth.extractRawText({ buffer });
    return { name, kind: 'docx', text: clean(out.value), chars: 0, truncated: false };
  }

  if (mime.startsWith('text/') || lower.endsWith('.txt') || lower.endsWith('.md')) {
    return { name, kind: 'text', text: clean(buffer.toString('utf8')), chars: 0, truncated: false };
  }

  if (mime === 'image/png' || mime === 'image/jpeg' || /\.(png|jpe?g)$/.test(lower)) {
    const text = await ocrBuffers([buffer]);
    return { name, kind: 'image', text, chars: 0, truncated: false };
  }

  throw new Error('unsupported');
}

// Resolve the canvas path BEFORE patching (require.resolve itself goes
// through _resolveFilename — resolving inside the patch recurses forever),
// and patch exactly once per process.
let canvasRedirectInstalled = false;
function installCanvasRedirect(): void {
  if (canvasRedirectInstalled) return;
  canvasRedirectInstalled = true;
  const canvasPath = require.resolve('@napi-rs/canvas');
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const nodeModule = require('node:module') as {
    _resolveFilename: (request: string, ...rest: unknown[]) => string;
  };
  const origResolve = nodeModule._resolveFilename;
  nodeModule._resolveFilename = function (request: string, ...rest: unknown[]) {
    if (request === '@napi-rs/canvas') return canvasPath;
    return origResolve.call(this, request, ...rest);
  };
}

/** Render a scanned PDF's pages to PNG (pdfjs + napi canvas) and OCR them. */
async function ocrPdfPages(buffer: Buffer): Promise<string> {
  // pdfjs discovers @napi-rs/canvas via its own require, which fails inside
  // the serverless bundle's pnpm layout. Import it explicitly so it ships,
  // provide the DOM globals pdfjs expects in Node, and redirect pdfjs's
  // module lookup to the copy we can resolve.
  const canvas = await import('@napi-rs/canvas');
  const g = globalThis as Record<string, unknown>;
  g.DOMMatrix ??= canvas.DOMMatrix;
  g.ImageData ??= canvas.ImageData;
  g.Path2D ??= canvas.Path2D;
  installCanvasRedirect();
  // Same bundler-visibility issue for the worker: pdfjs looks it up by file
  // path at runtime; importing it registers globalThis.pdfjsWorker instead.
  await import('pdfjs-dist/legacy/build/pdf.worker.mjs');
  const { getDocument } = await import('pdfjs-dist/legacy/build/pdf.mjs');
  // cmaps/standard_fonts improve glyph rendering for text-based PDFs, but the
  // OCR fallback only runs on image-based (scanned) pages — so they're a
  // nice-to-have locally and absent in the serverless bundle.
  let pdfjsRoot: string | null = null;
  try {
    pdfjsRoot = path.dirname(require.resolve('pdfjs-dist/package.json'));
    if (!(await import('node:fs')).existsSync(path.join(pdfjsRoot, 'cmaps'))) pdfjsRoot = null;
  } catch {
    pdfjsRoot = null;
  }
  const loadingTask = getDocument({
    data: new Uint8Array(buffer),
    ...(pdfjsRoot
      ? {
          cMapUrl: path.join(pdfjsRoot, 'cmaps') + '/',
          cMapPacked: true,
          standardFontDataUrl: path.join(pdfjsRoot, 'standard_fonts') + '/',
        }
      : {}),
  });
  const doc = await loadingTask.promise;
  try {
    const pages: Buffer[] = [];
    const count = Math.min(doc.numPages, MAX_OCR_PAGES);
    for (let i = 1; i <= count; i++) {
      const page = await doc.getPage(i);
      const viewport = page.getViewport({ scale: 2 });
      // pdfjs ships a Node canvas factory backed by @napi-rs/canvas.
      const factory = (doc as unknown as { canvasFactory: { create(w: number, h: number): { canvas: { toBuffer(t: string): Buffer }; context: unknown } } }).canvasFactory;
      const { canvas, context } = factory.create(viewport.width, viewport.height);
      await page.render({ canvasContext: context as never, viewport }).promise;
      pages.push(canvas.toBuffer('image/png'));
      page.cleanup();
    }
    const text = await ocrBuffers(pages);
    if (doc.numPages > MAX_OCR_PAGES) {
      return `${text}\n\n[Kun de første ${MAX_OCR_PAGES} af ${doc.numPages} sider er læst.]`;
    }
    return text;
  } finally {
    await loadingTask.destroy().catch(() => {});
  }
}

/** Vision-model OCR, one image per request, pages joined in order. */
async function ocrBuffers(images: Buffer[]): Promise<string> {
  const out: string[] = [];
  const key = (await import('../env.js')).env.openrouterKey;
  for (const img of images) {
    let res: { choices?: { message?: { content?: string } }[] } | null = null;
    let lastReason = '';
    for (const model of OCR_CHAIN) {
      try {
        res = await ocrOnce(key, model, img);
        break;
      } catch (err) {
        lastReason = err instanceof Error ? err.message : String(err);
      }
    }
    if (!res) throw new Error(`ocr_unavailable: ${lastReason}`);
    const text = res.choices?.[0]?.message?.content ?? '';
    if (text.trim()) out.push(clean(text));
  }
  return out.join('\n\n');
}

async function ocrOnce(key: string, model: string, img: Buffer) {
  return withTimeout(
      fetch('https://openrouter.ai/api/v1/chat/completions', {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${key}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          model,
          // Compliance (QUOT-05): uploads may contain real personal data —
          // never allow the provider to train on or retain them.
          provider: { data_collection: 'deny' },
          // One page of dense text transcribes well under this; without an
          // explicit cap OpenRouter reserves the model's 65k max upfront.
          max_tokens: 4000,
          messages: [
            {
              role: 'user',
              content: [
                {
                  type: 'text',
                  // A transcription alone loses whatever is not a word, and on
                  // a task sheet that is often the answer. Measured 2026-08-26:
                  // a right-triangle diagram came back as "Find laengden af AC.
                  // A 9 cm B 12 cm C" — every label and number, and no mention
                  // of the right angle, which is the one fact needed to get 15.
                  // The same picture read through the Docs image path, whose
                  // prompt asks for a description, produced the working.
                  //
                  // Transcription stays the job, because this also runs over
                  // scanned PDF pages where inventing structure would be wrong.
                  // The figure clause only adds what a transcription cannot say.
                  text:
                    'Transcribe ALL text in this image exactly as written, preserving line breaks and reading order. ' +
                    'If the image also holds a diagram, figure, chart, table or geometric drawing, add a short plain ' +
                    'description of it afterwards, precise enough to work from: the labels, the values, the lengths ' +
                    'and angles, what is marked as known, and what is being asked for. ' +
                    // This text is shown to the user when they open an attached
                    // item, and it is fed to the model as context. Measured on
                    // production 2026-08-26, the figure description came back as
                    // "**Diagram Description**" with hyphen bullets and
                    // "$9\\text{ cm}$" — unreadable to a person, and a worked
                    // example of markdown handed to a model this project has
                    // already caught copying the demonstration over the rule.
                    'Write it as plain text. No asterisks, no hash headings, no backticks, no LaTeX and no maths ' +
                    'delimiters: write "9 cm", never "$9\\text{ cm}$". ' +
                    'Output only that. No commentary. If the image holds no text and no figure, output nothing.',
                },
                { type: 'image_url', image_url: { url: `data:image/png;base64,${img.toString('base64')}` } },
              ],
            },
          ],
        }),
      }).then(async (r) => {
        if (!r.ok) throw new Error(`${model} svarede ${r.status}: ${(await r.text()).slice(0, 160)}`);
        return (await r.json()) as { choices?: { message?: { content?: string } }[] };
      }),
      60_000,
  );
}

function clean(text: string): string {
  return text
    .replace(/\r\n/g, '\n')
    .replace(/[ \t]+\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

function finalize(parsed: ParsedFile): ParsedFile {
  const truncated = parsed.text.length > MAX_CONTEXT_CHARS_PER_ITEM;
  const text = truncated ? parsed.text.slice(0, MAX_CONTEXT_CHARS_PER_ITEM) : parsed.text;
  return { ...parsed, text, chars: text.length, truncated };
}

function withTimeout<T>(p: Promise<T>, ms: number, log?: (msg: string) => void): Promise<T> {
  return Promise.race([
    p,
    new Promise<never>((_, rej) =>
      setTimeout(() => {
        // pdf-parse/mammoth cannot be cancelled — the loser keeps pinning the
        // event loop. Observe when it finally settles so that is at least
        // visible in the logs instead of an unexplained stall.
        const timedOutAt = Date.now();
        p.then(
          () => log?.(`timed-out parse settled ${Date.now() - timedOutAt} ms after its ${ms} ms budget`),
          (err) =>
            log?.(
              `timed-out parse failed ${Date.now() - timedOutAt} ms after its ${ms} ms budget: ${
                err instanceof Error ? err.message : String(err)
              }`,
            ),
        );
        rej(new Error('timeout'));
      }, ms),
    ),
  ]);
}
