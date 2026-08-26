import type { AutonomousParagraph } from '@awa/shared';
import { env } from '../env.js';

/**
 * Turns pictures in a document into text, so the rest of autonomous mode never
 * has to know they existed.
 *
 * Real questionnaires put the task in a picture more often than is comfortable:
 * a photographed maths problem, a scanned grammar exercise, a diagram with the
 * question printed underneath. Those paragraphs carry no text at all, so
 * detection saw nothing and the user was told their document had no questions
 * in it.
 *
 * The choice made here is to describe the image INTO the paragraph's text
 * rather than to make the answering call multimodal. It costs one extra call
 * per picture, and in exchange every downstream part stays exactly as it is and
 * as well tested as it is: detection, batching, ordering, placement, pause,
 * undo. It also keeps the answering model free to be the best writer available
 * rather than the best writer that happens to accept images.
 *
 * A description, not a transcription. "Trekant ABC, ret vinkel ved B, AB = 3
 * cm" is answerable; a bare transcription of a diagram is not.
 */

// Both verified image-capable. Kept in step with routes/files.ts's OCR_CHAIN,
// which solves the same problem for uploads, and overridable by the same env
// var so one setting moves both.
const VISION_CHAIN = (process.env.OCR_MODEL_CHAIN ?? process.env.OCR_MODEL ?? 'google/gemini-3.5-flash,anthropic/claude-sonnet-5')
  .split(',')
  .map((m) => m.trim())
  .filter(Boolean);

const VISION_TIMEOUT_MS = 30_000;
const MAX_IMAGES_PER_RUN = 12;
// The route checks MAX_AUTONOMOUS_DOC_CHARS before this runs, so descriptions
// are text the cap never saw. Twelve of them at the 1500-token ceiling would be
// ~72k characters — more than the whole document is allowed to be. Bound what
// gets folded in so that invariant survives the feature that outflanks it.
const MAX_DESCRIPTION_CHARS = 6_000;
const MAX_TOTAL_DESCRIPTION_CHARS = 30_000;

const INSTRUCTION =
  'This picture is taken from a document someone has to fill in. Write down what it asks for, in full, as plain text, ' +
  'so that a person who cannot see the picture could still answer it. ' +
  'Copy every word, number, symbol and equation in it exactly as written, keeping the reading order. ' +
  'If it holds a drawing, a diagram, a graph, a table or a geometric figure, describe it precisely enough to work from: ' +
  'name the labels, the values on the axes, the lengths, the angles, what is marked as known and what is asked for. ' +
  'Reply in the language of the picture. ' +
  'Output ONLY what the picture says and shows. No commentary, no preamble, and never a note about what you cannot see. ' +
  'If the picture holds no task and no text at all, output nothing.';

async function describeOne(dataUrl: string, model: string): Promise<string> {
  const ac = new AbortController();
  const timer = setTimeout(() => ac.abort(), VISION_TIMEOUT_MS);
  try {
    const res = await fetch('https://openrouter.ai/api/v1/chat/completions', {
      method: 'POST',
      headers: { Authorization: `Bearer ${env.openrouterKey}`, 'Content-Type': 'application/json' },
      signal: ac.signal,
      body: JSON.stringify({
        model,
        // The picture is a page out of the user's own document and may hold
        // personal data, exactly like an upload (QUOT-05). Never trainable.
        provider: { data_collection: 'deny' },
        // Without an explicit cap OpenRouter reserves the model's whole context
        // upfront and the request 402s on a thinly funded key — the failure
        // that hid an entire broken model chain once already (see openrouter.ts).
        max_tokens: 1500,
        messages: [
          {
            role: 'user',
            content: [
              { type: 'text', text: INSTRUCTION },
              { type: 'image_url', image_url: { url: dataUrl } },
            ],
          },
        ],
      }),
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}: ${(await res.text().catch(() => '')).slice(0, 200)}`);
    const body = (await res.json()) as { choices?: { message?: { content?: string } }[] };
    return (body.choices?.[0]?.message?.content ?? '').trim();
  } finally {
    clearTimeout(timer);
  }
}

/** One image, walking the chain until a model answers. Empty string on total failure. */
async function describeWithFallback(
  dataUrl: string,
  log: (obj: Record<string, unknown>, msg: string) => void,
): Promise<string> {
  let lastReason = '';
  for (const model of VISION_CHAIN) {
    try {
      return await describeOne(dataUrl, model);
    } catch (err) {
      lastReason = err instanceof Error ? err.message : String(err);
      log({ model, reason: lastReason.slice(0, 200) }, 'vision model failed, trying next');
    }
  }
  // Never fatal: one unreadable picture costs one task, not the whole run.
  log({ reason: lastReason.slice(0, 200) }, 'every vision model failed for one image');
  return '';
}

/**
 * Folds every paragraph's images into its text, in place of nothing.
 *
 * Returns paragraphs with `images` stripped — downstream never sees them, and
 * the detection prompt gets a document that reads as though the tasks had been
 * typed. Paragraphs without images are passed through untouched, so a document
 * with no pictures costs nothing at all.
 */
export async function foldImagesIntoText(
  paragraphs: AutonomousParagraph[],
  log: (obj: Record<string, unknown>, msg: string) => void,
): Promise<{ paragraphs: AutonomousParagraph[]; described: number }> {
  const withImages = paragraphs.filter((p) => p.images?.length);
  if (withImages.length === 0) return { paragraphs, described: 0 };

  // Flat list first, so the cap counts pictures rather than paragraphs and one
  // paragraph holding ten of them cannot starve the rest of the document.
  const jobs: { index: number; dataUrl: string }[] = [];
  for (const p of withImages) {
    for (const dataUrl of p.images ?? []) {
      if (jobs.length >= MAX_IMAGES_PER_RUN) break;
      jobs.push({ index: p.index, dataUrl });
    }
  }

  // In parallel: a document of six scanned exercises would otherwise wait for
  // six sequential vision calls before detection has even started.
  const results = await Promise.all(jobs.map((j) => describeWithFallback(j.dataUrl, log).then((text) => ({ ...j, text }))));

  const byIndex = new Map<number, string[]>();
  let spent = 0;
  for (const r of results) {
    if (!r.text) continue;
    const text = r.text.slice(0, MAX_DESCRIPTION_CHARS);
    if (spent + text.length > MAX_TOTAL_DESCRIPTION_CHARS) {
      log({ index: r.index, spent }, 'description budget spent — remaining images left undescribed');
      break;
    }
    spent += text.length;
    const list = byIndex.get(r.index) ?? [];
    list.push(text);
    byIndex.set(r.index, list);
  }

  let described = 0;
  const out = paragraphs.map(({ images, ...p }) => {
    const described_ = byIndex.get(p.index);
    if (!images?.length || !described_?.length) return p;
    described += described_.length;
    const joined = described_.join('\n');
    return { ...p, text: p.text.trim() ? `${p.text.trim()}\n${joined}` : joined };
  });

  return { paragraphs: out, described };
}
