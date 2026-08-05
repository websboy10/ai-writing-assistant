import type { ChatMessage, ChatRequest } from '@awa/shared';

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

  sections.push(
    'You are a writing assistant embedded in the user\'s browser. ' +
      'You produce text that is ready to be inserted into the document the user is working in. ' +
      'Output only the requested content — no preamble, no closing remarks, no markdown code fences unless asked. ' +
      'Reply in the same language as the user\'s request.',
  );

  sections.push(`# Task\n${OPERATION_INSTRUCTIONS[req.operation] ?? OPERATION_INSTRUCTIONS.chat}`);

  if (req.prefs) {
    const prefs: string[] = [];
    if (req.prefs.tone && req.prefs.tone !== 'neutral') prefs.push(`Tone: ${req.prefs.tone}.`);
    if (req.prefs.length === 'shorter') prefs.push('Be noticeably more concise than the source material.');
    if (req.prefs.length === 'longer') prefs.push('Be noticeably more detailed than the source material.');
    if (req.operation === 'translate') prefs.push(`Target language: ${req.prefs.language ?? 'English'}.`);
    if (prefs.length) sections.push(`# Output preferences\n${prefs.join(' ')}`);
  }

  if (req.context?.length) {
    const ctx = req.context
      .map((c) => `## Source: ${c.name} (${c.kind})\n${c.text}`)
      .join('\n\n');
    sections.push(`# Attached context\nUse this material as grounding. Do not invent content that contradicts it.\n\n${ctx}`);
  }

  const system: ChatMessage = { role: 'system', content: sections.join('\n\n') };

  const history: ChatMessage[] = req.messages.filter((m) => m.role !== 'system');

  // The subject (page selection / typed target text) rides on the final user
  // message so operations act on it regardless of conversation history.
  if (req.subject) {
    const last = history[history.length - 1];
    const subjectBlock = `# Subject text\n"""\n${req.subject}\n"""`;
    if (last?.role === 'user') {
      history[history.length - 1] = { role: 'user', content: `${last.content}\n\n${subjectBlock}` };
    } else {
      history.push({ role: 'user', content: subjectBlock });
    }
  }

  return [system, ...history];
}
