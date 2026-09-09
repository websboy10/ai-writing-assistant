import type { AutonomousParagraph, AutonomousRequest, ChatMessage } from '@awa/shared';
import type { DetectedFill } from './parse.js';
import { FORMAT_MARKDOWN_RULES, VOICE_RULES } from '../prompt.js';

/**
 * Structured prompt assembly for autonomous mode (mirrors PROM-03's
 * discrete-section style in ../prompt.ts): planning and answering are two
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
 * decided with that in view. A cell carries its table, row and column since
 * 2026-09-09: a grid of verses × "Manden?"/"Kvinden?" is only a grid to a
 * reader who can tell which empty cell is in which row. Lines with no
 * structure (a textarea, a contenteditable) print exactly as they always did.
 */
function shapeTag(p: AutonomousParagraph): string {
  switch (p.kind) {
    case 'heading':
      return `(overskrift ${p.level ?? 1}) `;
    case 'bullet':
      return p.text ? '(punkt) ' : '(punkt, TOM)';
    case 'numbered':
      return p.text ? '(nummereret punkt) ' : '(nummereret punkt, TOM)';
    case 'cell': {
      const where = p.cell ? `tabel ${p.cell.table + 1}, række ${p.cell.row + 1}, kolonne ${p.cell.col + 1}` : 'tabelcelle';
      return p.text ? `(${where}) ` : `(${where}, TOM svarboks)`;
    }
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
      'You read a document (Danish or English) and plan how to fill it in: you find every question, and for ' +
        'each one you name the exact place or places its answer goes.',
      'A question mark is NOT required. Numbered fields ("2. Hvilke områder vil du gerne udvikle?"), ' +
        'imperative prompts ("Beskriv dine tre vigtigste resultater i år"), and headings with blank space ' +
        'left beneath them all count as things a person is expected to answer. A plain statement of fact ' +
        'is NOT a question and must not be included.',
      // Measured 2026-09-08 on a demo form: "Udfyld skemaet nedenfor. Svar så
      // konkret som muligt" — the form's own instruction to whoever fills it
      // in — was answered with a paragraph about the writer's year.
      'An instruction about HOW to fill in the form is not a question either: "Udfyld skemaet nedenfor", ' +
        '"Svar så konkret som muligt", "Brug gerne eksempler", "Sæt kryds", "Skriv med blokbogstaver". ' +
        'It addresses the reader about the form itself and asks for nothing that could be written under it. ' +
        'A line in bold at the top of a form or a section is usually such an instruction or a label; a ' +
        'numbered task in bold is still a task.',
      'Each line is prefixed with what kind of line it is. A line marked "tabel N, række R, kolonne K" is a ' +
        'table cell, and "TOM svarboks" after it means the cell is empty. An empty cell is never a question ' +
        'itself; it belongs to a question: the cell before it in its row, the header over its column, the ' +
        'label at the start of its row, or the line above its table. A heading is a section title, not a ' +
        'question, unless it is itself phrased as a task. A bullet or numbered point under a question is ' +
        'usually guidance for the answer, not a separate question, unless it is itself a question or task. ' +
        'An EMPTY point, marked (punkt, TOM) or (nummereret punkt, TOM), is an answer slot like an empty box. ' +
        'Table header cells such as "Spørgsmål", "Dit svar", "Mand", "Kvinde" are labels, not questions, ' +
        'even when they end with a question mark like "Manden?" over a column.',
      // The operator's own worksheet (2026-09-09): the first question had
      // its answer written under it already, and a table's answer cells held
      // a starter with "fortsæt herunder…" beneath. The first was answered a
      // second time; the second was refused as occupied.
      'A question that is ALREADY ANSWERED is left out entirely: its answer stands in the paragraph under it, ' +
        'or in the box beside or below it, written the way a person filling in the form writes. Text that ' +
        'only STARTS an answer and asks for more ("fortsæt herunder…", "uddyb", "skriv videre", a sentence ' +
        'that stops mid-thought) is not answered yet: it is continued.',
      // The plan. The operator's test form (2026-09-08): every question had a
      // box drawn under it and the answers went on the line under the
      // question instead, because the box was matched by a rule that could
      // not see a blank line. The model sees the whole form at once, so it
      // names the places. Since 2026-09-09 a question may have MANY places:
      // a grid, a table with empty rows, and places that are text to continue
      // under rather than empty boxes.
      'For each question, list its "fills": every place in the document that gets text for it, decided ' +
        'after reading the whole document. Each fill has "at", the bracketed number of a paragraph, and a ' +
        '"mode". "fill": [at] is an EMPTY place, an empty cell or an empty point, and the answer starts in ' +
        'it. "below": the answer goes on a new line under the text of [at]; that is the question itself when ' +
        'the document draws no empty place for it, or a cell whose text asks to be continued under it. ' +
        '"inline": the answer goes on the same line as [at], after a label that ends with a colon and has ' +
        'nothing after it ("Navn:", "Dato:", "Svar:").',
      'A table row with several empty cells is several fills, one per cell. A table with a header row and ' +
        'empty rows beneath it wants EVERY empty cell filled, row by row, each row one example of what the ' +
        'header asks for. A grid with labels down the side and headers across the top is one fill per empty ' +
        'cell. An empty list under a question is ONE fill at its first empty point; the whole list goes in ' +
        'that one answer. An empty place belongs to ONE question, the nearest above it unless the layout ' +
        'plainly says otherwise. One fill per place, never two.',
      'Every fill may carry "task": what belongs at that place, in a few words in the document\'s language, ' +
        '"Manden? for 1. Korintherbrev 11,3" or "Række 2: et nyt bibelcitat om køn". Leave it out when the ' +
        'question alone says it. Never give a question a "below" fill at itself when its answers go into ' +
        'boxes. When the document has no place at all for a question, its one fill is "below" at the ' +
        'question itself.',
      // "Besvar markeringen": the whole document is sent, as for "Besvar
      // alle", so the model sees the box under the marked question exactly
      // as it would see it for the whole form. Until 2026-09-09 only the
      // marked lines were sent, and a question marked without its box got
      // its answer on the line beneath it — the box was never in view.
      ...(req.marked
        ? [
            `The user MARKED lines [${req.marked.from}] to [${req.marked.to}] and asked for ONLY those to be answered. ` +
              'Find questions within that range and nowhere else. The rest of the document is there so you can see ' +
              'where each answer belongs and what shape it takes: a fill may well point at an empty place just ' +
              'outside the marking, such as the empty box directly under the last marked line.',
          ]
        : []),
      'Output ONLY a bare JSON array, no prose before or after it and no markdown code fence, of objects ' +
        'shaped { "paragraphIndex": number, "questionText": string, "fills": [ { "at": number, ' +
        '"mode": "fill" | "below" | "inline", "task": string } ] }. "paragraphIndex" is the bracketed number ' +
        'of the question. "questionText" must be quoted VERBATIM from that paragraph, never paraphrased. ' +
        'If the document contains no questions, output [].',
    ].join(' '),
  };

  const user: ChatMessage = {
    role: 'user',
    content:
      `DOCUMENT${req.documentTitle ? `: ${req.documentTitle}` : ''} (scope: ${req.scope})` +
      (req.marked ? `\nMARKED: lines [${req.marked.from}] to [${req.marked.to}]` : '') +
      `\n${paragraphLines(req)}`,
  };

  return [system, user];
}

/** The place of a fill, as the answer call reads it: where the text lands, and what the model said belongs there. */
function fillLine(req: AutonomousRequest, f: DetectedFill): string {
  const place = req.paragraphs[f.at];
  const text = (place?.text ?? '').slice(0, 80);
  let where: string;
  if (f.mode === 'fill') where = `into the empty place [${f.at}] ${shapeTag(place).trim()}`;
  else if (f.mode === 'inline') where = `on the same line as [${f.at}], after "${text}"`;
  else if (f.at === f.paragraphIndex) where = 'under the question';
  else where = `on a new line under [${f.at}] "${text}"`;
  return `#${f.id} [${f.paragraphIndex}] ${f.questionText}\n   goes ${where}${f.task ? `: ${f.task}` : ''}`;
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
  batch: DetectedFill[],
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
    'You fill in a document on the user\'s behalf. Every item below is one PLACE in the document and gets a ' +
      'real, usable, specific answer. Answer EVERY item you are given. Never skip one. ' +
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
      // waited 30s and was told nothing could be answered. The id is an
      // address, never a verdict; groundedness has its own field.
      'The "id" of each answer MUST be the number of the item it answers, copied exactly. Never invent one, ' +
      'never use -1, and never use a number that is not in the list below. An item you had to invent an ' +
      'answer for still gets its own real id, like any other.',
  );

  // The style rules come AFTER the contract, not before it: the shape of the
  // reply has to be the first thing the model reads. The format rules are the
  // markdown subset the extension can TYPE as real formatting into Google Docs
  // (richsteps.ts); everywhere else the extension flattens it, so nothing the
  // model is allowed here can arrive as a literal asterisk.
  sections.push(
    `How to write the text inside each "answer":\n\n${FORMAT_MARKDOWN_RULES}\n\n` +
      'SHAPE. Each item names the PLACE its answer goes, and the answer must fit that place. ' +
      'Into an empty table cell: short, like the filled cells around it. If the filled row above holds a ' +
      'phrase or one sentence per cell, write a phrase or one sentence; never more than three short sentences ' +
      'in a cell, and never a list. The cells of one table row belong together: the quote or example in the ' +
      'first cell is what the other cells in that row describe, so write a row as one consistent whole, and ' +
      'make every row different from the rows already in the table. ' +
      'On a new line under a cell that asks to be continued ("fortsæt herunder…"): continue the thought that ' +
      'was started, without repeating it, in a few sentences. ' +
      'On the same line after a label: a few words, no sentence. ' +
      'Into an empty numbered point: a numbered list "1. ", "2. "; into an empty bullet point: a bullet ' +
      'list "- "; a question that asks for several things gets exactly that many items, one per line. ' +
      'Under a question with room beneath it: paragraphs. ' +
      'A question that asks for a word in bold still gets that word plain: nothing is ever written in bold. ' +
      'Never write a heading.\n\n' +
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

  // The document stays in the USER message, next to the item list. It was
  // moved into the system message for an hour on 2026-09-09 (to keep the
  // user message under the web plugin's length limit, websearch.ts) and the
  // model promptly answered every question in the form instead of the ones
  // listed, on two runs out of two. The web is consulted in its own short
  // call instead (websearch.ts webResearch) and this call never carries the
  // plugin.
  const items = batch.map((f) => fillLine(req, f)).join('\n');
  const user: ChatMessage = {
    role: 'user',
    content:
      `DOCUMENT${req.documentTitle ? `: ${req.documentTitle}` : ''}\n${paragraphLines(req)}\n\n` +
      `PLACES TO FILL IN, one answer each\n${items}\n\n` +
      'Output ONLY a bare JSON array, no prose before or after it and no markdown code fence, of objects ' +
      'shaped { "id": number, "answer": string }: exactly one per item above, in the SAME ORDER as the ' +
      'items are listed, "id" copied from the item\'s number.',
  };

  return [system, user];
}
