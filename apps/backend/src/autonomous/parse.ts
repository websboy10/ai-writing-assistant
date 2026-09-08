import type { AutonomousAnswer } from '@awa/shared';

// Kept in sync with packages/shared/src/index.ts. Values (not types) must be
// local: @awa/shared ships TS source, which Node can't load in the deployed
// serverless bundle — the backend's shared imports are type-only by contract
// (see apps/backend/src/routes/files.ts for the established pattern).
const MAX_AUTONOMOUS_QUESTIONS = 40;

export interface DetectedQuestion {
  paragraphIndex: number;
  questionText: string;
}

/**
 * Defensive parsing of the model's raw text into a JSON array (research
 * Pitfall 4 / A4): strips ```json fences and any surrounding prose, then
 * JSON.parse's only the outermost [...] span. Never throws — anything that
 * doesn't parse as an array of objects yields an empty array, because the
 * caller must always be able to fall back to "no answer produced" rather
 * than crash on untrusted model output.
 */
function extractJsonArray(raw: string): unknown[] | null {
  if (typeof raw !== 'string') return null;
  let text = raw.trim();
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/i);
  if (fenced) text = fenced[1].trim();

  const start = text.indexOf('[');
  const end = text.lastIndexOf(']');
  if (start === -1 || end === -1 || end < start) return null;

  try {
    const parsed = JSON.parse(text.slice(start, end + 1));
    return Array.isArray(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

/**
 * Detection: the model tells us which paragraphs contain a question and what
 * it is, quoted from the paragraph. `paragraphIndex` is validated against
 * `paragraphCount` — the length of the paragraph array WE built and sent —
 * never trusted as an offset into anything else (RESEARCH.md Pitfall 3).
 */
export function parseDetection(raw: string, paragraphCount: number): DetectedQuestion[] {
  const items = extractJsonArray(raw);
  if (!items) return [];

  const out: DetectedQuestion[] = [];
  for (const item of items) {
    if (out.length >= MAX_AUTONOMOUS_QUESTIONS) break;
    if (!item || typeof item !== 'object') continue;
    const rec = item as Record<string, unknown>;

    const paragraphIndex = rec.paragraphIndex;
    if (!Number.isInteger(paragraphIndex)) continue;
    if ((paragraphIndex as number) < 0 || (paragraphIndex as number) >= paragraphCount) continue;

    const questionText = rec.questionText;
    if (typeof questionText !== 'string' || !questionText.trim()) continue;

    out.push({ paragraphIndex: paragraphIndex as number, questionText: questionText.trim() });
  }
  return out;
}

/**
 * Rescue for the one failure mode that loses a WHOLE run: the model abandons
 * the index protocol entirely and stamps every answer with the same unusable
 * index (measured: -1 on all five, used as shorthand for "no grounding").
 * Every answer is then dropped as unaskable and the user — who has waited
 * half a minute — is told nothing could be answered.
 *
 * The prompt asks for one answer per question in the same order, so position
 * is a real signal. It is only trusted under conditions strict enough that a
 * partially-correct reply can never be silently re-ordered onto the wrong
 * questions, because a mis-assigned answer lands in the user's document:
 *
 *   - the reply holds exactly one item per question asked, and
 *   - EVERY item is an object whose index is unusable — not one of them names
 *     a question in this batch. A mixture means the model was addressing
 *     questions by index after all, and position proves nothing.
 */
function positionalFallback(
  items: unknown[],
  asked: DetectedQuestion[],
  askedByIndex: Map<number, DetectedQuestion>,
): AutonomousAnswer[] | null {
  if (items.length !== asked.length || asked.length === 0) return null;

  const records: Record<string, unknown>[] = [];
  for (const item of items) {
    if (!item || typeof item !== 'object') return null;
    const rec = item as Record<string, unknown>;
    if (Number.isInteger(rec.paragraphIndex) && askedByIndex.has(rec.paragraphIndex as number)) return null;
    records.push(rec);
  }

  return records
    .map((rec, i) => ({
      paragraphIndex: asked[i].paragraphIndex,
      questionText: asked[i].questionText,
      answer: typeof rec.answer === 'string' ? rec.answer : '',
      grounded: typeof rec.grounded === 'boolean' ? rec.grounded : true,
    }))
    .filter((a) => a.answer.trim().length > 0);
}

/**
 * Answers: only accepted for a paragraphIndex that was actually asked about
 * in this batch — a model cannot invent an answer for a question we never
 * sent it.
 *
 * `grounded` is no longer asked for or acted on. The prompt now writes a
 * plausible answer for every question whether or not the sources hold one
 * (operator's call, 2026-08-26), so the flag had nothing left to distinguish
 * and the panel no longer reports it. It survives in the type only so the
 * shape stays stable, and defaults to true.
 */
export function parseAnswers(raw: string, askedQuestions: DetectedQuestion[]): AutonomousAnswer[] {
  const items = extractJsonArray(raw);
  if (!items) return [];

  const askedByIndex = new Map(askedQuestions.map((q) => [q.paragraphIndex, q]));

  const positional = positionalFallback(items, askedQuestions, askedByIndex);
  if (positional) return positional;
  const seen = new Set<number>();
  const out: AutonomousAnswer[] = [];

  for (const item of items) {
    if (!item || typeof item !== 'object') continue;
    const rec = item as Record<string, unknown>;

    const paragraphIndex = rec.paragraphIndex;
    if (!Number.isInteger(paragraphIndex)) continue;
    const asked = askedByIndex.get(paragraphIndex as number);
    if (!asked) continue;
    if (seen.has(paragraphIndex as number)) continue;

    const answer = typeof rec.answer === 'string' ? rec.answer : '';
    // An empty answer is not an answer. Writing it puts a blank line into the
    // user's document under their question, which reads as a bug they caused
    // — measured happening to 5 of 10 questions in one live run. Dropping it
    // here means the question is simply left alone, and a run where EVERY
    // answer came back empty falls into the existing "nothing could be
    // answered" path, which refunds the quota and says so plainly.
    if (!answer.trim()) continue;
    const grounded = typeof rec.grounded === 'boolean' ? rec.grounded : true;

    seen.add(paragraphIndex as number);
    out.push({ paragraphIndex: paragraphIndex as number, questionText: asked.questionText, answer, grounded });
  }
  return out;
}
