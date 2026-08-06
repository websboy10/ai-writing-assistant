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
 * Answers: only accepted for a paragraphIndex that was actually asked about
 * in this batch — a model cannot invent an answer for a question we never
 * sent it. `grounded` is coerced to false when missing or non-boolean: a
 * question with no proven evidence of grounding must never be silently
 * presented as sourced (D-12).
 */
export function parseAnswers(raw: string, askedQuestions: DetectedQuestion[]): AutonomousAnswer[] {
  const items = extractJsonArray(raw);
  if (!items) return [];

  const askedByIndex = new Map(askedQuestions.map((q) => [q.paragraphIndex, q]));
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
    const grounded = typeof rec.grounded === 'boolean' ? rec.grounded : false;

    seen.add(paragraphIndex as number);
    out.push({ paragraphIndex: paragraphIndex as number, questionText: asked.questionText, answer, grounded });
  }
  return out;
}
