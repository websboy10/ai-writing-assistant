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
    if (!user) return reply.code(401).send({ error: 'Sign in required', code: 'unauthenticated' });

    const file = await req.file({ limits: { fileSize: MAX_FILE_BYTES } });
    if (!file) return reply.code(400).send({ error: 'No file in request', code: 'bad_request' });

    let buffer: Buffer;
    try {
      buffer = await file.toBuffer();
    } catch {
      return reply.code(413).send({
        error: `"${file.filename}" is over the ${MAX_FILE_BYTES / 1024 / 1024} MB limit.`,
        code: 'file_too_large',
      });
    }

    const name = file.filename ?? 'file';
    const mime = file.mimetype ?? '';

    try {
      const parsed = await withTimeout(parse(buffer, name, mime), 60_000);
      if (!parsed.text.trim()) {
        return reply.code(422).send({
          error: `No text could be extracted from "${name}". If it's a scanned document, try uploading it as an image so OCR can read it.`,
          code: 'no_text',
        });
      }
      return finalize(parsed);
    } catch (err) {
      const message = err instanceof Error ? err.message : 'unknown error';
      if (message === 'timeout') {
        return reply.code(422).send({
          error: `Processing "${name}" took too long and was stopped. Try a smaller file.`,
          code: 'parse_timeout',
        });
      }
      if (message === 'unsupported') {
        return reply.code(415).send({
          error: `"${name}" (${mime || 'unknown type'}) isn't supported. Use PDF, DOCX, TXT, Markdown, PNG or JPG.`,
          code: 'unsupported_type',
        });
      }
      return reply.code(422).send({
        error: `"${name}" could not be processed: ${message}`,
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
      const { data } = await worker.recognize(buffer);
      return { name, kind: 'image', text: clean(data.text), chars: 0, truncated: false };
    } finally {
      await worker.terminate();
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

function withTimeout<T>(p: Promise<T>, ms: number): Promise<T> {
  return Promise.race([
    p,
    new Promise<never>((_, rej) => setTimeout(() => rej(new Error('timeout')), ms)),
  ]);
}
