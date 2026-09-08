/**
 * Which model should write the Danish, and what does each one cost?
 *
 * The chain is the single biggest lever on running cost — Sonnet is $2/$10 per
 * million tokens against $0.089/$0.177 for deepseek-v4-flash, a fiftyfold gap —
 * but a cheap model that ignores the prose rules is not cheap, it is useless:
 * this text goes into a performance review with the user's name on it.
 *
 * So this measures the things a machine can judge and prints the Danish for a
 * person to judge. Never pick a model off the numbers alone.
 *
 * MACHINE-CHECKABLE (a model failing any of these is out, whatever it costs):
 *   markdown   an asterisk, hash or backtick reaching the user's document
 *   length     "Kort" means one or two sentences, 15-40 words
 *   danish     the reply is actually in Danish
 *   refusal    "jeg kan ikke se dokumentet" instead of a draft
 *   dashes     the em dash the prose rules forbid
 *   voice      the deliberate slips that stop it reading machine-written
 *
 * NOT MACHINE-CHECKABLE: whether the Danish is any good. That is the operator's
 * call, which is why every reply is printed in full.
 *
 * Runs against OpenRouter directly with the product's real system prompt, and
 * with data_collection deny — a model whose providers all refuse that is out
 * regardless of price (PRIVACY.md).
 *
 * COSTS REAL MONEY: models x prompts generations.
 *
 * Run: node scripts/bake-off-models.mjs [model ...]
 */
import { readFileSync } from 'node:fs';
import { assembleMessages } from '../apps/backend/src/prompt.ts';

const KEY = /^OPENROUTER_API_KEY=(.*)$/m.exec(readFileSync('apps/backend/.env', 'utf8'))?.[1]?.trim();
if (!KEY) throw new Error('no OPENROUTER_API_KEY in apps/backend/.env');

const CANDIDATES = process.argv.slice(2).length
  ? process.argv.slice(2)
  : [
      // The incumbents, for the comparison to mean anything.
      'anthropic/claude-sonnet-5',
      'google/gemini-3.5-flash',
      'deepseek/deepseek-v4-flash',
      // The cheap end, by price per million (input x0.6 + output x0.4).
      'openai/gpt-oss-120b',
      'qwen/qwen3.7-flash',
      'qwen/qwen3-30b-a3b-instruct-2507',
      'mistralai/mistral-small-24b-instruct-2501',
      'amazon/nova-micro-v1',
      'inclusionai/ling-3.0-flash',
    ];

/** Real work, one of each kind the product actually gets. */
const TASKS = [
  { name: 'kort svar', length: 'short', operation: 'chat', text: 'Hvad er fordelene ved at arbejde hjemmefra?' },
  { name: 'email', length: 'medium', operation: 'chat', text: 'Skriv en email til min chef om at jeg gerne vil have en lønsamtale.' },
  { name: 'MUS-referat', length: 'long', operation: 'chat', text: 'Skriv en opsummering af en medarbejderudviklingssamtale med Anders, der har haft et godt år, men skal blive bedre til at melde tilbage i tide.' },
  {
    name: 'omskriv',
    length: 'medium',
    operation: 'rewrite',
    text: 'Gør den her tekst venligere.',
    subject: 'Din faktura er forfalden. Betal straks, ellers sender vi sagen til inkasso.',
  },
  { name: 'nægter?', length: 'medium', operation: 'chat', text: 'Hvad var omsætningen i Q3 for firmaet i mit dokument?' },
];

const DANISH_WORDS = /\b(og|at|det|er|en|som|til|for|ikke|man|kan|der|med|på|har)\b/gi;
const REFUSAL = /(jeg kan ikke|jeg har ikke (adgang|modtaget)|kan ikke se|du har ikke (vedhæftet|delt)|send mig|uploade dokumentet)/i;
const SLIPS = /\b(og (skrive|lave|sige|gøre|blive|få|have)|håbe det|skal skriver|hans egen|hendes egen)\b/i;

async function run(model, task) {
  const messages = assembleMessages({
    messages: [{ role: 'user', content: task.text }],
    operation: task.operation,
    contentClass: 'real',
    prefs: { length: task.length },
    ...(task.subject ? { subject: task.subject } : {}),
  });
  const t0 = Date.now();
  let res;
  try {
    res = await fetch('https://openrouter.ai/api/v1/chat/completions', {
      method: 'POST',
      headers: { Authorization: `Bearer ${KEY}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model,
        messages,
        max_tokens: 4000,
        reasoning: { effort: 'minimal' },
        usage: { include: true },
        provider: { data_collection: 'deny' },
      }),
    });
  } catch (e) {
    return { err: String(e?.message ?? e) };
  }
  if (!res.ok) return { err: `HTTP ${res.status} ${(await res.text()).slice(0, 120)}` };
  const j = await res.json();
  const text = (j.choices?.[0]?.message?.content ?? '').trim();
  return {
    text,
    ms: Date.now() - t0,
    cost: j.usage?.cost ?? 0,
    finish: j.choices?.[0]?.finish_reason,
  };
}

const results = [];

for (const model of CANDIDATES) {
  console.log(`\n${'='.repeat(78)}\n${model}`);
  let cost = 0, ms = 0, markdown = 0, dashes = 0, refusals = 0, nonDanish = 0, shortBad = 0, slips = 0, errs = 0;
  for (const task of TASKS) {
    const r = await run(model, task);
    if (r.err) {
      console.log(`\n  [${task.name}] ERROR ${r.err}`);
      errs++;
      continue;
    }
    cost += r.cost;
    ms += r.ms;
    const words = r.text.split(/\s+/).filter(Boolean).length;
    const sentences = (r.text.match(/[.!?](\s|$)/g) ?? []).length || (r.text ? 1 : 0);
    const hasMd = /[*#`]|^\s*-\s/m.test(r.text);
    const hasDash = /[—–]|\s-\s/.test(r.text);
    const danishHits = (r.text.match(DANISH_WORDS) ?? []).length;
    const isDanish = danishHits >= Math.max(3, words / 25);
    const refused = REFUSAL.test(r.text);
    if (hasMd) markdown++;
    if (hasDash) dashes++;
    if (refused) refusals++;
    if (!isDanish) nonDanish++;
    if (SLIPS.test(r.text)) slips++;
    if (task.length === 'short' && (sentences > 2 || words > 45)) shortBad++;

    const flags = [
      hasMd ? 'MARKDOWN' : '',
      hasDash ? 'DASH' : '',
      refused ? 'NÆGTER' : '',
      !isDanish ? 'IKKE-DANSK' : '',
      task.length === 'short' && (sentences > 2 || words > 45) ? 'FOR LANG' : '',
      r.finish === 'length' ? 'AFSKÅRET' : '',
    ].filter(Boolean).join(' ');
    console.log(`\n  [${task.name}] ${words} ord, ${sentences} sætn., ${r.ms}ms, $${r.cost.toFixed(5)} ${flags ? `  ⚠ ${flags}` : ''}`);
    console.log(r.text.split('\n').map((l) => `    ${l}`).join('\n'));
  }
  results.push({ model, cost, ms, markdown, dashes, refusals, nonDanish, shortBad, slips, errs });
}

console.log(`\n${'='.repeat(78)}\nSAMMENLIGNING (${TASKS.length} opgaver hver)\n`);
console.log('model                                       $ i alt   ms/svar  md  dash  nægt  ikke-da  forlang  slips  fejl');
for (const r of results.sort((a, b) => a.cost - b.cost)) {
  console.log(
    `${r.model.padEnd(43)} ${('$' + r.cost.toFixed(5)).padEnd(9)} ${String(Math.round(r.ms / TASKS.length)).padStart(6)}  ` +
      `${String(r.markdown).padStart(2)}  ${String(r.dashes).padStart(4)}  ${String(r.refusals).padStart(4)}  ` +
      `${String(r.nonDanish).padStart(7)}  ${String(r.shortBad).padStart(7)}  ${String(r.slips).padStart(5)}  ${String(r.errs).padStart(4)}`,
  );
}
console.log('\nmd/dash/nægt/ikke-da/forlang are FAILURES — lower is better. slips is the human voice, higher is better.');
console.log('The numbers cannot tell you if the Danish is any good. Read the replies above.');
