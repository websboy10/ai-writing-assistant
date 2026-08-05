import type { FastifyInstance } from 'fastify';
import { MAX_FILE_BYTES, MAX_CONTEXT_CHARS_PER_ITEM, type ParsedFile } from '@awa/shared';
import { verifyUser } from '../supabase.js';

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
      const parsed = await withTimeout(parse(buffer, name, mime), 60_000, (m) => req.log.warn(m));
      if (!parsed.text.trim()) {
        return reply.code(422).send({
          error: `Der kunne ikke udtrækkes tekst fra "${name}". Er det et scannet dokument, så prøv at uploade det som billede, så OCR kan læse det.`,
          code: 'no_text',
        });
      }
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
      return reply.code(422).send({
        error: `"${name}" kunne ikke behandles: ${message}`,
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
    return { name, kind: 'pdf', text: clean(out.text), chars: 0, truncated: false };
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
    const { createWorker } = await import('tesseract.js');
    const worker = await createWorker('eng');
    try {
      // Race the timeout HERE, not only around the whole parse: if recognize()
      // never settles, an outer race would return while this finally waits
      // forever, leaking the worker's threads and WASM memory permanently.
      // Racing inside means the finally runs at timeout and terminate() kills
      // the pending recognize.
      const { data } = await withTimeout(worker.recognize(buffer), 60_000);
      return { name, kind: 'image', text: clean(data.text), chars: 0, truncated: false };
    } finally {
      await worker.terminate().catch(() => {});
    }
  }

  throw new Error('unsupported');
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
