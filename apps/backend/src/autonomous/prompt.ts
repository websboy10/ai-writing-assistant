import type { AutonomousParagraph, AutonomousRequest, ChatMessage } from '@awa/shared';
import type { DetectedQuestion } from './parse.js';
import { FORMAT_MARKDOWN_RULES, VOICE_RULES } from '../prompt.js';

/**
 * Structured prompt assembly for autonomous mode (mirrors PROM-03's
 * discrete-section style in ../prompt.ts): detection and answering are two
 * separate single-shot calls, each built from named sections rather than one
 * concatenated string.
 */

/**
 * What a line IS, in front of what it says.
 *
 * Until 2026-09-08 the model saw a flat list and could not tell an empty
 * answer box from a blank line — the extension had thrown the difference
 * away before sending. Now every line carries its shape (docs-structure.ts on
 * the extension side), and the two things this feature was failing at — what
 * counts as a question, and what shape its answer should take — are both
 * decided with that in view. Lines with no structure (a textarea, a
 * contenteditable) print exactly as they always did.
 */
function shapeTag(p: AutonomousParagraph): string {
  switch (p.kind) {
    case 'heading':
      return `(overskrift ${p.level ?? 1}) `;
    case 'bullet':
      return p.text ? '(punkt) ' : '(punkt, TOM)';
    case 'numbered':
      return p.text ? '(nummereret punkt) ' : '(nummereret punkt, TOM)';
    case 'cell':
      return p.text ? '(tabelcelle) ' : '(tabelcelle, TOM svarboks)';
    default:
      return p.bold ? '(fed) ' : '';
  }
}

function paragraphLines(req: AutonomousRequest): string {
  return req.paragraphs.map((p) => `[${p.index}] ${shapeTag(p)}${p.text}`).join('\n');
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
      'Each line is prefixed with what kind of line it is. A line marked (tabelcelle, TOM svarboks) is an ' +
        'empty answer box: it is never a question itself, and it belongs to the question in the cell before ' +
        'it or on the line above its table — that question IS one to answer. A heading is a section title, not ' +
        'a question, unless it is itself phrased as a task. A bullet or numbered point under a question is ' +
        'usually guidance for the answer, not a separate question — unless it is itself a question or task. ' +
        'An EMPTY point, marked (punkt, TOM) or (nummereret punkt, TOM), is an answer slot like an empty box: ' +
        'never a question, and it belongs to the line above it. ' +
        'Table header cells such as "Spørgsmål" or "Dit svar" are labels, not questions.',
      'Output ONLY a bare JSON array, no prose before or after it and no markdown code fence, of objects ' +
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
        'Read the ATTACHED CONTEXT below in full. That is where the answers usually are. Answer from it. ' +
        'Where it holds nothing on a question, invent a plausible answer and write it as if it were simply true.',
    );
  }

  sections.push(
    'You fill in a document on the user\'s behalf. Every question below gets a real, usable, specific answer. ' +
      'Answer EVERY question you are given. Never skip one. ' +
      'Where the document or the ATTACHED CONTEXT holds the answer, use it: the user attached that material ' +
      'BECAUSE it holds the answers, so read it properly before writing anything of your own. ' +
      // The operator's call, 2026-08-26, and the right one for this product:
      // what lands in the document is a FIRST DRAFT the person edits, and an
      // invented-but-sensible answer is something to edit. A refusal is not —
      // it leaves them exactly where they started, having waited 30s for it.
      'Where they do not hold it, write a plausible answer anyway. Invent the specifics, meaning figures, dates, ' +
      'names and examples, so they fit the subject, tone and any details already in the document. It does not ' +
      'have to be true; it has to make sense and be worth editing. ' +
      // Every hedge is noise here. The user knows they asked a machine to fill
      // in their form; being told so, inside the form, in their own document,
      // is both useless and something they then have to delete by hand.
      'NEVER state or imply that anything is missing, unknown, uncertain or not covered. Never write ' +
      '"det fremgår ikke", "dokumentet oplyser ikke", "der er ingen oplysninger om", "baseret på det ' +
      'vedhæftede" or any equivalent, in any language. Do not hedge, do not qualify, do not mention sources ' +
      'or their absence at all. Write it the way the person filling in the form would write it. ' +
      'Obey any size the question asks for: if it asks for three things, give three; if it sets a minimum ' +
      'number of words, sentences or paragraphs, meet it and never fall short. Where it names no size, ' +
      'answer in one to three sentences. Write in the same language as the question. ' +
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
      // …and then the escape hatch became the easy road. Measured a few hours
      // later, on the acceptance run that attaches a briefing file: with a
      // permitted way to say "the document does not cover this", the model
      // stopped opening the attached file at all and answered "Dokumentet
      // indeholder ikke nogen oplysninger om status på projektet" — about a
      // question the attachment answers in full.
      //
      // So the hatch has to be narrow AND the search has to be named. The
      // document is usually the questionnaire — blank by definition — and the
      // answers usually live in what the user attached. That is why they
      // attached it.
      'The document is often a form with nothing filled in; the answers usually live in the ATTACHED CONTEXT ' +
      'below. An "answer" is NEVER an empty string and never a sentence about what you could not find. ' +
      // Measured 2026-08-25: asked for an index "in any order", the model
      // answered every question with paragraphIndex -1 as a stand-in for "no
      // grounding", and every answer was then dropped as unaskable — the user
      // waited 30s and was told nothing could be answered. The index is an
      // address, never a verdict; groundedness has its own field.
      'The "paragraphIndex" of each answer MUST be copied exactly from the bracketed number of the question ' +
      'it answers. Never invent an index, never use -1, and never use an index that is not in the list below. ' +
      'A question you had to invent an answer for still gets its own real index, like any other.',
  );

  // The style rules come AFTER the contract, not before it: the shape of the
  // reply has to be the first thing the model reads. The format rules are the
  // markdown subset the extension can TYPE as real formatting into Google Docs
  // (richsteps.ts); everywhere else the extension flattens it, so nothing the
  // model is allowed here can arrive as a literal asterisk.
  sections.push(
    `How to write the text inside each "answer":\n\n${FORMAT_MARKDOWN_RULES}\n\n` +
      'SHAPE. Each question in the document list carries what kind of line it is and what follows it. ' +
      'Match that shape. A question followed by an empty numbered point, (nummereret punkt, TOM), gets a ' +
      'numbered list "1. ", "2. "; one followed by an empty bullet point, (punkt, TOM), gets a bullet list ' +
      '"- "; a question that asks for several things gets exactly that many items, one per line; a question ' +
      'in a table cell with an empty box beside or beneath it gets a plain answer that fits a box, one or two ' +
      'short paragraphs at most; a question with room beneath it gets paragraphs. When a question asks for ' +
      'a word or phrase in bold, write it as **bold**. Never write a heading.\n\n' +
      VOICE_RULES,
  );

  if (req.context?.length) {
    const ctx = req.context.map((c) => `[Source: ${c.name} (${c.kind})]\n${c.text}`).join('\n\n');
    sections.push(
      `ATTACHED CONTEXT. The user attached this BECAUSE it holds the answers.\n` +
        `Read it before deciding a question cannot be answered. Do not invent content that contradicts it.\n\n${ctx}`,
    );
  }

  const system: ChatMessage = { role: 'system', content: sections.join('\n\n') };

  const questionLines = batch.map((q) => `[${q.paragraphIndex}] ${q.questionText}`).join('\n');
  const user: ChatMessage = {
    role: 'user',
    content:
      `DOCUMENT${req.documentTitle ? `: ${req.documentTitle}` : ''}\n${paragraphLines(req)}\n\n` +
      `QUESTIONS TO ANSWER\n${questionLines}\n\n` +
      'Output ONLY a bare JSON array, no prose before or after it and no markdown code fence, of objects ' +
      'shaped { "paragraphIndex": number, "answer": string }: exactly one per question ' +
      'above, in the SAME ORDER as the questions are listed.',
  };

  return [system, user];
}
