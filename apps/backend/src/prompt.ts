import type { ChatMessage, ChatRequest } from '@awa/shared';

/**
 * The two things every reply must get right, shared by chat and autonomous
 * mode (../autonomous/prompt.ts imports it).
 *
 * PLAIN TEXT is not a style preference — it is the product working at all.
 * Every insertion path writes `text/plain`, so `**Salgsteknikker**` reaches the
 * user's Google Doc with the asterisks in it. Measured on production
 * 2026-08-25: two of three ordinary Danish prompts came back containing
 * markdown. The extension strips it as a backstop
 * (apps/extension/insertion/plaintext.ts), but a strip can only remove
 * characters — it cannot turn a heading back into a sentence, so the model
 * must not reach for the formatting in the first place.
 *
 * THE VOICE is the other half. The tells listed below are the ones that make a
 * draft read as machine-written at a glance, and this text goes into a
 * performance review or a client letter with the user's name on it.
 */
export const PROSE_RULES = [
  'FORMAT. The destination is a plain document that renders no formatting at all, so any formatting',
  'character you type arrives as that literal character in the finished text.',
  '- Never use asterisk or underscore characters to mark emphasis. Emphasise with word choice instead.',
  '- Never begin a line with hash characters to make a heading. A heading is an ordinary line of words.',
  '- Never use backtick characters, and never fence a block of text.',
  '- Never draw a table out of pipe and dash characters.',
  '- A list, where one genuinely helps, starts its lines with a hyphen and a space, or "1. ".',
  '- Never leave trailing spaces at the end of a line.',
  '',
  'VOICE — write the way a capable colleague writes, not the way an assistant answers:',
  '- Start with the substance. Never open by restating the request or with "Her er", "Selvfølgelig" or "Absolut".',
  '- Stop when the point is made. No closing summary, no "Sammenfattende", no "Lad mig vide hvis…", no offer to help further.',
  '- Cut the connective filler: "Det er vigtigt at bemærke", "Det er værd at nævne", "I en verden hvor", "Når alt kommer til alt".',
  '- Vary sentence length. Several medium sentences in a row is the clearest sign a machine wrote them.',
  '- Do not force everything into three parallel points. Use the number of points the subject actually has.',
  '- Prefer the concrete: a figure, a date, a name, an actual example over "forskellige faktorer" or "en række områder".',
  '- Commit to what the sources support. Do not hedge every sentence, and do not overclaim beyond them either.',
  '- When rewriting or continuing existing text, match its register, tense and vocabulary rather than your own default.',
].join('\n');

const SYSTEM_VOICE = [
  "You are a writing assistant embedded in the user's browser. What you write is pasted directly into the",
  'document they are working in, so it must be finished prose, not a chat reply about their request.',
  '',
  PROSE_RULES,
  '',
  "Reply in the language of the user's request — Danish unless they clearly write otherwise.",
  'Output only the requested content.',
  '',
  // Last line on purpose. Models weight the end of a system prompt heavily,
  // and this is the one rule whose breach damages the user's own document
  // rather than merely reading badly.
  'Before you answer, check once more: not a single asterisk, hash or backtick anywhere in what you write.',
].join('\n');

/** Tone as an instruction rather than a bare adjective the model must interpret. */
const TONE_INSTRUCTIONS: Record<string, string> = {
  formal: 'Keep the register formal and professional: full sentences, no contractions, no exclamation marks.',
  friendly: 'Keep the register warm and approachable, addressing the reader directly, without becoming chatty.',
  confident: 'Write with conviction: direct claims, active voice, no hedging qualifiers.',
  casual: 'Keep it relaxed and conversational, the way a colleague writes to a colleague.',
  neutral: '',
};

const OPERATION_INSTRUCTIONS: Record<string, string> = {
  chat: 'Answer the user helpfully and directly.',
  summarize: 'Summarize the subject text. Preserve the key facts and conclusions. Do not add information.',
  rewrite: 'Rewrite the subject text with the requested tone, keeping its meaning and factual content intact.',
  expand: 'Expand the subject text with more depth and supporting detail, staying faithful to its intent.',
  simplify: 'Rewrite the subject text in plain, simple language a non-expert understands. Keep it accurate.',
  explain: 'Explain the subject text clearly. Define jargon. Use short examples where they help.',
  translate: 'Translate the subject text. Preserve tone, formatting and meaning. Output only the translation.',
  continue: 'Continue writing from where the subject text ends, matching its voice, tense and style seamlessly.',
};

/**
 * Structured prompt assembly (requirement PROM-03): the request is built from
 * discrete sections rather than one concatenated string, so each section can
 * evolve independently and be inspected in isolation.
 */
export function assembleMessages(req: ChatRequest): ChatMessage[] {
  const sections: string[] = [];

  sections.push(SYSTEM_VOICE);

  // Section headers are deliberately NOT markdown. A system prompt that
  // structures itself with "# Task" and "## Source:" while forbidding markdown
  // teaches the model the opposite of what it says, and the model follows the
  // demonstration over the instruction: measured 2026-08-25, the ban alone
  // changed nothing and replies still came back full of "**". Plain uppercase
  // labels carry the same structure without modelling the syntax.
  sections.push(`TASK\n${OPERATION_INSTRUCTIONS[req.operation] ?? OPERATION_INSTRUCTIONS.chat}`);

  if (req.prefs) {
    const prefs: string[] = [];
    if (req.prefs.tone && req.prefs.tone !== 'neutral') prefs.push(`${TONE_INSTRUCTIONS[req.prefs.tone]}`);
    if (req.prefs.length === 'shorter') prefs.push('Be noticeably more concise than the source material.');
    if (req.prefs.length === 'longer') prefs.push('Be noticeably more detailed than the source material.');
    if (req.operation === 'translate') prefs.push(`Target language: ${req.prefs.language ?? 'English'}.`);
    if (prefs.length) sections.push(`OUTPUT PREFERENCES\n${prefs.join(' ')}`);
  }

  if (req.context?.length) {
    const ctx = req.context
      .map((c) => `[Source: ${c.name} (${c.kind})]\n${c.text}`)
      .join('\n\n');
    sections.push(`ATTACHED CONTEXT\nUse this material as grounding. Do not invent content that contradicts it.\n\n${ctx}`);
  }

  const system: ChatMessage = { role: 'system', content: sections.join('\n\n') };

  const history: ChatMessage[] = req.messages.filter((m) => m.role !== 'system');

  // The subject (page selection / typed target text) rides on the final user
  // message so operations act on it regardless of conversation history.
  if (req.subject) {
    const last = history[history.length - 1];
    const subjectBlock = `SUBJECT TEXT\n"""\n${req.subject}\n"""`;
    if (last?.role === 'user') {
      history[history.length - 1] = { role: 'user', content: `${last.content}\n\n${subjectBlock}` };
    } else {
      history.push({ role: 'user', content: subjectBlock });
    }
  }

  return [system, ...history];
}
