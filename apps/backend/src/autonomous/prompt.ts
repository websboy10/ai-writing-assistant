import type { AutonomousRequest, ChatMessage } from '@awa/shared';
import type { DetectedQuestion } from './parse.js';
import { PROSE_RULES } from '../prompt.js';

/**
 * Structured prompt assembly for autonomous mode (mirrors PROM-03's
 * discrete-section style in ../prompt.ts): detection and answering are two
 * separate single-shot calls, each built from named sections rather than one
 * concatenated string.
 */

function paragraphLines(req: AutonomousRequest): string {
  return req.paragraphs.map((p) => `[${p.index}] ${p.text}`).join('\n');
}

/**
 * D-10: the AI decides what counts as a question. No hand-written rules
 * about `?` or numbering — the instruction below explicitly rejects a
 * question-mark requirement, because real questionnaires use imperative
 * prompts and headings with blank space beneath them as much as they use
 * literal questions.
 *
 * The model is asked for bare JSON, NOT assumed to support
 * `response_format: json_schema` (RESEARCH.md A4) — parse.ts's
 * parseDetection copes with prose/fences around the array either way.
 */
export function detectionMessages(req: AutonomousRequest): ChatMessage[] {
  const system: ChatMessage = {
    role: 'system',
    content: [
      'You read a document (Danish or English) and find every question in it.',
      'A question mark is NOT required. Numbered fields ("2. Hvilke områder vil du gerne udvikle?"), ' +
        'imperative prompts ("Beskriv dine tre vigtigste resultater i år"), and headings with blank space ' +
        'left beneath them all count as things a person is expected to answer. A plain statement of fact ' +
        'is NOT a question and must not be included.',
      'Output ONLY a bare JSON array — no prose before or after it, no markdown code fence — of objects ' +
        'shaped { "paragraphIndex": number, "questionText": string }. "paragraphIndex" is the bracketed ' +
        'number shown before each paragraph. "questionText" must be quoted VERBATIM from that paragraph, ' +
        'never paraphrased. If the document contains no questions, output [].',
    ].join(' '),
  };

  const user: ChatMessage = {
    role: 'user',
    content: `DOCUMENT${req.documentTitle ? `: ${req.documentTitle}` : ''} (scope: ${req.scope})\n${paragraphLines(req)}`,
  };

  return [system, user];
}

/**
 * D-11: answers are grounded in the document plus whatever files are already
 * attached in the panel, in the same "ATTACHED CONTEXT" shape as
 * ../prompt.ts's assembleMessages so both prompts read the same way.
 * D-12: the model must answer every question regardless of grounding — the
 * panel lists ungrounded answers, it never withholds one.
 */
export function answerMessages(
  req: AutonomousRequest,
  batch: DetectedQuestion[],
  /** Second attempt after a reply whose answers were all empty — say so plainly. */
  insist = false,
): ChatMessage[] {
  const sections: string[] = [];

  if (insist) {
    sections.push(
      'YOUR PREVIOUS REPLY WAS REJECTED because every "answer" in it was an empty string. ' +
        'An empty answer is not an acceptable response to any question, for any reason. ' +
        'If a question cannot be answered from the material, the answer is a sentence saying so — ' +
        'for example "Dokumentet indeholder ikke oplysninger om dette." — with grounded set to false.',
    );
  }

  sections.push(
    'You answer questions found in a document, grounded in that document and any attached context material. ' +
      'Answer EVERY question you are given below, even if you find nothing to base it on — never skip one. ' +
      'Set "grounded" to true only when the answer is actually based on something in the document or the ' +
      'attached context; set it to false when you had to guess or invent the answer. ' +
      // Measured 2026-08-25, right after the style rules below were added to
      // this prompt: the model returned perfectly-shaped JSON with the right
      // indices and "answer": "" for all three questions. Empty answers are
      // dropped by the parser (they would otherwise be written into the
      // document as blank lines), so the user waited, then read "3 spørgsmål
      // blev fundet, men ingen kunne besvares lige nu."
      //
      // "Do not overclaim beyond the sources" and "answer every question" pull
      // against each other on a question nothing supports, and saying nothing
      // is the model's way of obeying both. Naming the third option removes
      // the conflict — and it is the better answer anyway: a person reading
      // their document would rather see "dokumentet oplyser ikke dette" than a
      // silent gap.
      'An "answer" is NEVER an empty string. When neither the document nor the attached context says anything ' +
      'about a question, write one short sentence stating exactly that, and set "grounded" to false. ' +
      // Measured 2026-08-25: asked for an index "in any order", the model
      // answered every question with paragraphIndex -1 as a stand-in for "no
      // grounding", and every answer was then dropped as unaskable — the user
      // waited 30s and was told nothing could be answered. The index is an
      // address, never a verdict; groundedness has its own field.
      'The "paragraphIndex" of each answer MUST be copied exactly from the bracketed number of the question ' +
      'it answers. Never invent an index, never use -1, and never use an index that is not in the list below. ' +
      'A question you cannot ground still gets its own real index and grounded:false.',
  );

  // The style rules come AFTER the contract, not before it. These answers are
  // pasted straight under the question in the user's own document, so "**" is
  // a worse failure here than in the panel — nobody reads it before it lands —
  // but the shape of the reply has to be the first thing the model reads.
  sections.push(`How to write the text inside each "answer":\n\n${PROSE_RULES}`);

  if (req.context?.length) {
    const ctx = req.context.map((c) => `[Source: ${c.name} (${c.kind})]\n${c.text}`).join('\n\n');
    sections.push(
      `ATTACHED CONTEXT\nUse this material as grounding alongside the document. Do not invent content that contradicts it.\n\n${ctx}`,
    );
  }

  const system: ChatMessage = { role: 'system', content: sections.join('\n\n') };

  const questionLines = batch.map((q) => `[${q.paragraphIndex}] ${q.questionText}`).join('\n');
  const user: ChatMessage = {
    role: 'user',
    content:
      `DOCUMENT${req.documentTitle ? `: ${req.documentTitle}` : ''}\n${paragraphLines(req)}\n\n` +
      `QUESTIONS TO ANSWER\n${questionLines}\n\n` +
      'Output ONLY a bare JSON array — no prose before or after it, no markdown code fence — of objects ' +
      'shaped { "paragraphIndex": number, "answer": string, "grounded": boolean }: exactly one per question ' +
      'above, in the SAME ORDER as the questions are listed.',
  };

  return [system, user];
}
