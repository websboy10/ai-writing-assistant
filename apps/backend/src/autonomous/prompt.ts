import type { AutonomousRequest, ChatMessage } from '@awa/shared';
import type { DetectedQuestion } from './parse.js';

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
    content: `# Document${req.documentTitle ? `: ${req.documentTitle}` : ''} (scope: ${req.scope})\n${paragraphLines(req)}`,
  };

  return [system, user];
}

/**
 * D-11: answers are grounded in the document plus whatever files are already
 * attached in the panel, in the same "# Attached context" shape as
 * ../prompt.ts's assembleMessages so both prompts read the same way.
 * D-12: the model must answer every question regardless of grounding — the
 * panel lists ungrounded answers, it never withholds one.
 */
export function answerMessages(req: AutonomousRequest, batch: DetectedQuestion[]): ChatMessage[] {
  const sections: string[] = [];

  sections.push(
    'You answer questions found in a document, grounded in that document and any attached context material. ' +
      'Answer EVERY question you are given below, even if you find nothing to base it on — never skip one. ' +
      'Set "grounded" to true only when the answer is actually based on something in the document or the ' +
      'attached context; set it to false when you had to guess or invent the answer.',
  );

  if (req.context?.length) {
    const ctx = req.context.map((c) => `## Source: ${c.name} (${c.kind})\n${c.text}`).join('\n\n');
    sections.push(
      `# Attached context\nUse this material as grounding alongside the document. Do not invent content that contradicts it.\n\n${ctx}`,
    );
  }

  const system: ChatMessage = { role: 'system', content: sections.join('\n\n') };

  const questionLines = batch.map((q) => `[${q.paragraphIndex}] ${q.questionText}`).join('\n');
  const user: ChatMessage = {
    role: 'user',
    content:
      `# Document${req.documentTitle ? `: ${req.documentTitle}` : ''}\n${paragraphLines(req)}\n\n` +
      `# Questions to answer\n${questionLines}\n\n` +
      'Output ONLY a bare JSON array — no prose before or after it, no markdown code fence — of objects ' +
      'shaped { "paragraphIndex": number, "answer": string, "grounded": boolean }, one per question above, in any order.',
  };

  return [system, user];
}
