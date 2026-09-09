import type { AutonomousAnswer, AutonomousParagraph, FillMode } from '@awa/shared';

// Kept in sync with packages/shared/src/index.ts. Values (not types) must be
// local: @awa/shared ships TS source, which Node can't load in the deployed
// serverless bundle — the backend's shared imports are type-only by contract
// (see apps/backend/src/routes/files.ts for the established pattern).
const MAX_AUTONOMOUS_ANSWERS = 80;

/**
 * One place the model chose, with the question it answers. The unit of a run
 * since 2026-09-09: a question may have many of these (a grid, a table with
 * empty rows), and a place may be text to continue under rather than an
 * empty box. See AutonomousAnswer in packages/shared.
 */
export interface DetectedFill {
  paragraphIndex: number;
  questionText: string;
  task?: string;
  at: number;
  mode: FillMode;
}

/** What may hold a `fill`: an empty cell or an empty list item. A blank text line is not sent at all (Docs' copy leaves it out). */
const SLOT_KINDS = new Set(['cell', 'bullet', 'numbered']);
/** ParagraphKind, as values — see the note at the top of this file. */
const PARAGRAPH_KINDS = new Set(['heading', 'text', 'bullet', 'numbered', 'cell']);
const FILL_MODES = new Set<FillMode>(['fill', 'below', 'inline']);
const TASK_MAX_LEN = 200;

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
 * The structure the extension reads off Docs — kind, level, bold, cell,
 * lastLine — is copied only when well-formed, and dropped otherwise: a client
 * without it still gets its questions answered, just placed by the old rules.
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
    if (typeof rec.lastLine === 'string' && rec.lastLine.trim()) clean.lastLine = rec.lastLine;
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
 * One place the model named, checked against OUR paragraph list and never
 * trusted: a `fill` must be an empty cell or list item after the question; a
 * `below` or `inline` must be a paragraph with text, the question itself or
 * one after it. A missing mode is read off the paragraph — empty means fill,
 * text means below — so a model that drops the field still places well.
 * One fill per paragraph across the whole run.
 */
function validFill(
  value: unknown,
  questionIndex: number,
  paragraphs: AutonomousParagraph[] | undefined,
  claimed: Set<number>,
): { at: number; mode: FillMode; task?: string } | null {
  if (!paragraphs || !value || typeof value !== 'object') return null;
  const rec = value as Record<string, unknown>;
  if (!Number.isInteger(rec.at)) return null;
  const at = rec.at as number;
  const place = paragraphs[at];
  if (!place || claimed.has(at)) return null;
  const empty = place.text.trim() === '';
  const mode: FillMode = FILL_MODES.has(rec.mode as FillMode) ? (rec.mode as FillMode) : empty ? 'fill' : 'below';
  if (mode === 'fill') {
    if (!empty || !SLOT_KINDS.has(place.kind ?? '') || at <= questionIndex) return null;
  } else if (empty || at < questionIndex) {
    return null;
  }
  claimed.add(at);
  const task = typeof rec.task === 'string' && rec.task.trim() ? rec.task.trim().slice(0, TASK_MAX_LEN) : undefined;
  return { at, mode, ...(task ? { task } : {}) };
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
 * Detection: the model tells us which paragraphs hold a question, quoted from
 * the paragraph, and where each answer goes. `paragraphIndex` is validated
 * against `paragraphCount` — the length of the paragraph array WE built and
 * sent — never trusted as an offset into anything else (RESEARCH.md Pitfall
 * 3). A question the model gives no usable place gets the one place that
 * always exists: under the question itself — unless the model DID name
 * boxes for it, in which case a `below` at the question is dropped, since an
 * answer that also sits under the question would double what is in the boxes.
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
): DetectedFill[] {
  const items = extractJsonArray(raw);
  if (!items) return [];

  const out: DetectedFill[] = [];
  const claimed = new Set<number>();
  for (const item of items) {
    if (out.length >= MAX_AUTONOMOUS_ANSWERS) break;
    if (!item || typeof item !== 'object') continue;
    const rec = item as Record<string, unknown>;

    const paragraphIndex = rec.paragraphIndex;
    if (!Number.isInteger(paragraphIndex)) continue;
    if ((paragraphIndex as number) < 0 || (paragraphIndex as number) >= paragraphCount) continue;
    if (marked && ((paragraphIndex as number) < marked.from || (paragraphIndex as number) > marked.to)) continue;

    const questionText = rec.questionText;
    if (typeof questionText !== 'string' || !questionText.trim()) continue;

    const wanted = Array.isArray(rec.fills) ? rec.fills : [];
    let places = wanted
      .map((f) => validFill(f, paragraphIndex as number, paragraphs, claimed))
      .filter((f): f is NonNullable<typeof f> => f !== null);
    if (places.some((f) => f.mode === 'fill')) {
      places = places.filter((f) => !(f.mode === 'below' && f.at === paragraphIndex));
    }
    if (places.length === 0) {
      if (claimed.has(paragraphIndex as number)) continue;
      claimed.add(paragraphIndex as number);
      places = [{ at: paragraphIndex as number, mode: 'below' }];
    }
    for (const place of places) {
      if (out.length >= MAX_AUTONOMOUS_ANSWERS) break;
      out.push({ paragraphIndex: paragraphIndex as number, questionText: questionText.trim(), ...place });
    }
  }
  return out;
}

/**
 * Fills into answer calls. A question's fills always travel together — the
 * cells of one table row must agree with each other, and only a model that
 * sees the whole row can make them — so a group is never split, and a group
 * larger than `size` is a batch by itself.
 */
export function batchFills(fills: DetectedFill[], size: number): DetectedFill[][] {
  const groups = new Map<number, DetectedFill[]>();
  for (const f of fills) {
    const group = groups.get(f.paragraphIndex);
    if (group) group.push(f);
    else groups.set(f.paragraphIndex, [f]);
  }
  const batches: DetectedFill[][] = [];
  let current: DetectedFill[] = [];
  for (const group of groups.values()) {
    if (current.length && current.length + group.length > size) {
      batches.push(current);
      current = [];
    }
    current.push(...group);
  }
  if (current.length) batches.push(current);
  return batches;
}

function toAnswer(fill: DetectedFill, answer: string, grounded: boolean): AutonomousAnswer {
  return {
    paragraphIndex: fill.paragraphIndex,
    questionText: fill.questionText,
    ...(fill.task ? { task: fill.task } : {}),
    at: fill.at,
    mode: fill.mode,
    ...(fill.mode === 'fill' ? { answerAt: fill.at } : {}),
    answer,
    grounded,
  };
}

/**
 * Rescue for the one failure mode that loses a WHOLE run: the model abandons
 * the address protocol entirely and stamps every answer with the same
 * unusable number (measured: -1 on all five, used as shorthand for "no
 * grounding"). Every answer is then dropped as unaskable and the user — who
 * has waited half a minute — is told nothing could be answered.
 *
 * The prompt asks for one answer per fill in the same order, so position is
 * a real signal. It is only trusted under conditions strict enough that a
 * partially-correct reply can never be silently re-ordered onto the wrong
 * places, because a mis-assigned answer lands in the user's document:
 *
 *   - the reply holds exactly one item per fill asked, and
 *   - EVERY item is an object whose place is unusable — not one of them names
 *     a fill in this batch. A mixture means the model was addressing fills by
 *     place after all, and position proves nothing.
 */
function positionalFallback(items: unknown[], asked: DetectedFill[], askedAt: Map<number, DetectedFill>): AutonomousAnswer[] | null {
  if (items.length !== asked.length || asked.length === 0) return null;

  const records: Record<string, unknown>[] = [];
  for (const item of items) {
    if (!item || typeof item !== 'object') return null;
    const rec = item as Record<string, unknown>;
    if (Number.isInteger(rec.at) && askedAt.has(rec.at as number)) return null;
    records.push(rec);
  }

  return records
    .map((rec, i) =>
      toAnswer(asked[i], typeof rec.answer === 'string' ? stripBold(rec.answer) : '', typeof rec.grounded === 'boolean' ? rec.grounded : true),
    )
    .filter((a) => a.answer.trim().length > 0);
}

/**
 * Answers, keyed by the PLACE they go: the paragraph index `at`, which is the
 * one number a fill has. There was a separate 1-based item id for a few
 * hours on 2026-09-09; on the operator's own worksheet the model answered
 * with the place numbers instead ("id": 17 for the cell at paragraph 17),
 * two of which happened to be valid ids, so five answers were dropped and
 * two landed in the wrong cells. One identity per fill, and it is the place.
 * Only accepted for a place actually asked about in this batch — a model
 * cannot invent an answer for a place we never sent it.
 *
 * `grounded` is no longer asked for or acted on. The prompt now writes a
 * plausible answer for every question whether or not the sources hold one
 * (operator's call, 2026-08-26), so the flag had nothing left to distinguish
 * and the panel no longer reports it. It survives in the type only so the
 * shape stays stable, and defaults to true.
 */
export function parseAnswers(raw: string, asked: DetectedFill[]): AutonomousAnswer[] {
  const items = extractJsonArray(raw);
  if (!items) return [];

  const askedAt = new Map(asked.map((f) => [f.at, f]));

  const positional = positionalFallback(items, asked, askedAt);
  if (positional) return positional;
  const seen = new Set<number>();
  const out: AutonomousAnswer[] = [];

  for (const item of items) {
    if (!item || typeof item !== 'object') continue;
    const rec = item as Record<string, unknown>;

    if (!Number.isInteger(rec.at)) continue;
    const fill = askedAt.get(rec.at as number);
    if (!fill || seen.has(fill.at)) continue;

    const answer = typeof rec.answer === 'string' ? stripBold(rec.answer) : '';
    // An empty answer is not an answer. Writing it puts a blank line into the
    // user's document under their question, which reads as a bug they caused
    // — measured happening to 5 of 10 questions in one live run. Dropping it
    // here means the place is simply left alone, and a run where EVERY
    // answer came back empty falls into the existing "nothing could be
    // answered" path, which refunds the quota and says so plainly.
    if (!answer.trim()) continue;

    seen.add(fill.at);
    out.push(toAnswer(fill, answer, typeof rec.grounded === 'boolean' ? rec.grounded : true));
  }
  return out;
}

/**
 * One answer per question for an extension built before fills existed: it
 * types every answer it is given under that answer's question, so a grid's
 * twenty-five cells would land one under the other beneath the question.
 * Its fills are joined into one answer, placed where the first of them went.
 */
export function collapseForOldClients(answers: AutonomousAnswer[]): AutonomousAnswer[] {
  const byQuestion = new Map<number, AutonomousAnswer>();
  for (const a of answers) {
    const first = byQuestion.get(a.paragraphIndex);
    if (!first) byQuestion.set(a.paragraphIndex, { ...a });
    else first.answer = `${first.answer}\n\n${a.answer}`;
  }
  return [...byQuestion.values()];
}
