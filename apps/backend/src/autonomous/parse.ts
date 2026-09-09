import type { AutonomousAnswer, AutonomousParagraph } from '@awa/shared';

// Kept in sync with packages/shared/src/index.ts. Values (not types) must be
// local: @awa/shared ships TS source, which Node can't load in the deployed
// serverless bundle — the backend's shared imports are type-only by contract
// (see apps/backend/src/routes/files.ts for the established pattern).
const MAX_AUTONOMOUS_QUESTIONS = 40;

export interface DetectedQuestion {
  paragraphIndex: number;
  questionText: string;
  /** The empty paragraph the model chose for the answer — see AutonomousAnswer.answerAt. */
  answerAt?: number;
}

/** What may hold an answer: an empty cell or an empty list item. A blank text line is not sent at all (Docs' copy leaves it out). */
const SLOT_KINDS = new Set(['cell', 'bullet', 'numbered']);
/** ParagraphKind, as values — see the note at the top of this file. */
const PARAGRAPH_KINDS = new Set(['heading', 'text', 'bullet', 'numbered', 'cell']);

const smallInt = (v: unknown, min: number, max: number): v is number => Number.isInteger(v) && (v as number) >= min && (v as number) <= max;

/**
 * The request body is untrusted (T-07-08). Every paragraph must have an
 * integer `index` and a string `text` before anything downstream — including
 * the model — sees it. Any malformed item rejects the whole request with a
 * specific reason rather than silently dropping data the client expected
 * to be answered.
 *
 * The paragraph handed downstream is built here, never the caller's own
 * object, so a field the client invents cannot ride along into the prompt.
 * The structure the extension reads off Docs — kind, level, bold, cell — is
 * copied only when well-formed, and dropped otherwise: a client without it
 * still gets its questions answered, just placed by the old rules.
 *
 * Until 2026-09-09 only index and text were copied, and the structure tags
 * the detection prompt was written around had never once reached the model:
 * every "(tabelcelle, TOM svarboks)" in the design was an empty string in
 * practice, and every answerAt the model returned was rejected for pointing
 * at a paragraph of no kind. Found by logging the plan.
 */
export function validateParagraphs(paragraphs: unknown): AutonomousParagraph[] | null {
  if (!Array.isArray(paragraphs) || paragraphs.length === 0) return null;
  const out: AutonomousParagraph[] = [];
  for (const p of paragraphs) {
    if (!p || typeof p !== 'object') return null;
    const rec = p as Record<string, unknown>;
    if (!Number.isInteger(rec.index) || typeof rec.text !== 'string') return null;
    const clean: AutonomousParagraph = { index: rec.index as number, text: rec.text };
    if (typeof rec.kind === 'string' && PARAGRAPH_KINDS.has(rec.kind)) clean.kind = rec.kind as AutonomousParagraph['kind'];
    if (smallInt(rec.level, 1, 9)) clean.level = rec.level;
    if (rec.bold === true) clean.bold = true;
    const cell = rec.cell as Record<string, unknown> | undefined;
    if (cell && typeof cell === 'object' && smallInt(cell.table, 0, 999) && smallInt(cell.row, 0, 999) && smallInt(cell.col, 0, 99)) {
      clean.cell = { table: cell.table, row: cell.row, col: cell.col };
    }
    out.push(clean);
  }
  return out;
}

/**
 * Bold, gone before the answer leaves the server.
 *
 * The operator's rule (2026-09-09): nothing this product writes is ever bold.
 * The prompt says so; this is the promise behind it, and it holds for every
 * extension already installed the moment the backend is deployed. The two
 * shapes are the ones the extension's own strippers recognise (plaintext.ts,
 * richsteps.ts), so a lone asterisk or a snake_case word survives unchanged.
 */
export function stripBold(text: string): string {
  return text
    .replace(/(\*{2})(?=\S)([\s\S]*?\S)\1/g, '$2')
    .replace(/(?<![\w\\])(_{2})(?=\S)([^\n]*?\S)\1(?!\w)/g, '$2');
}

/**
 * The paragraphs the user marked, as a range into the paragraph list: the
 * questions to answer lie inside it, the rest of the document is context.
 * Untrusted like everything else in the body — both ends must be integers
 * inside the list, in order.
 */
export function validateMarked(marked: unknown, paragraphCount: number): { from: number; to: number } | undefined {
  if (!marked || typeof marked !== 'object') return undefined;
  const { from, to } = marked as Record<string, unknown>;
  if (!smallInt(from, 0, paragraphCount - 1) || !smallInt(to, 0, paragraphCount - 1) || to < from) return undefined;
  return { from, to };
}

/**
 * The model's chosen place for an answer is an index into OUR paragraph list,
 * so it is checked against that list, never trusted: it must be an empty
 * cell or list item, after the question, and claimed by one question only.
 * Anything else means "no plan", and the extension places the answer by its
 * own rules — exactly as it did before the model had a say.
 */
function validAnswerAt(
  value: unknown,
  questionIndex: number,
  paragraphs: AutonomousParagraph[] | undefined,
  claimed: Set<number>,
): number | undefined {
  if (!paragraphs || !Number.isInteger(value)) return undefined;
  const at = value as number;
  const slot = paragraphs[at];
  if (!slot || at <= questionIndex) return undefined;
  if (slot.text.trim() !== '' || !SLOT_KINDS.has(slot.kind ?? '')) return undefined;
  if (claimed.has(at)) return undefined;
  claimed.add(at);
  return at;
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
 *
 * With a `marked` range ("Besvar markeringen"), a question outside it is
 * dropped here whatever the model thought: the user marked what they wanted
 * answered, and the rest of the document was sent so the model could see the
 * boxes, not so it could fill them.
 */
export function parseDetection(
  raw: string,
  paragraphCount: number,
  paragraphs?: AutonomousParagraph[],
  marked?: { from: number; to: number },
): DetectedQuestion[] {
  const items = extractJsonArray(raw);
  if (!items) return [];

  const out: DetectedQuestion[] = [];
  const claimed = new Set<number>();
  for (const item of items) {
    if (out.length >= MAX_AUTONOMOUS_QUESTIONS) break;
    if (!item || typeof item !== 'object') continue;
    const rec = item as Record<string, unknown>;

    const paragraphIndex = rec.paragraphIndex;
    if (!Number.isInteger(paragraphIndex)) continue;
    if ((paragraphIndex as number) < 0 || (paragraphIndex as number) >= paragraphCount) continue;
    if (marked && ((paragraphIndex as number) < marked.from || (paragraphIndex as number) > marked.to)) continue;

    const questionText = rec.questionText;
    if (typeof questionText !== 'string' || !questionText.trim()) continue;

    const answerAt = validAnswerAt(rec.answerAt, paragraphIndex as number, paragraphs, claimed);
    out.push({
      paragraphIndex: paragraphIndex as number,
      questionText: questionText.trim(),
      ...(answerAt !== undefined ? { answerAt } : {}),
    });
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
      ...(asked[i].answerAt !== undefined ? { answerAt: asked[i].answerAt } : {}),
      answer: typeof rec.answer === 'string' ? stripBold(rec.answer) : '',
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

    const answer = typeof rec.answer === 'string' ? stripBold(rec.answer) : '';
    // An empty answer is not an answer. Writing it puts a blank line into the
    // user's document under their question, which reads as a bug they caused
    // — measured happening to 5 of 10 questions in one live run. Dropping it
    // here means the question is simply left alone, and a run where EVERY
    // answer came back empty falls into the existing "nothing could be
    // answered" path, which refunds the quota and says so plainly.
    if (!answer.trim()) continue;
    const grounded = typeof rec.grounded === 'boolean' ? rec.grounded : true;

    seen.add(paragraphIndex as number);
    out.push({
      paragraphIndex: paragraphIndex as number,
      questionText: asked.questionText,
      ...(asked.answerAt !== undefined ? { answerAt: asked.answerAt } : {}),
      answer,
      grounded,
    });
  }
  return out;
}
