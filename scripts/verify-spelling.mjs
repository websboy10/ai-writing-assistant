/**
 * No misspelled words, and the human voice still intact.
 *
 * The operator's rule (2026-09-08): "remove all spelling mistakes, no spelling
 * mistakes ever" — while keeping the deliberate grammar slips that stop a draft
 * reading machine-written. Those two things pull against each other, so both
 * are checked here and neither is allowed to win quietly.
 *
 * Three independent checks over real generated Danish:
 *
 *   1 SPELLING (hard fail) — macOS's own Danish dictionary, the one Mail and
 *     Pages use, via scripts/spellcheck-da.swift. Nothing to install.
 *   2 WRONG VERB FORM (hard fail) — the check the spell checker CANNOT do.
 *     "jeg håbe" is not a misspelling: håbe is a real word, the infinitive. It
 *     is the wrong form after a subject, and it is exactly what the operator
 *     was seeing. Verbs listed are ones whose past tense is -ede, so a bare -e
 *     after a subject cannot be a legitimate past tense.
 *   3 VOICE (reported, not asserted) — the surviving slips must still show up,
 *     or "no spelling mistakes" has silently become "no personality". A prompt
 *     is a request and no wording makes a model comply every time, so this one
 *     prints rather than fails.
 *
 * Prereqs: backend on 127.0.0.1:8787. COSTS REAL MODEL QUOTA.
 *
 * Run: node scripts/verify-spelling.mjs
 */
import { execFileSync } from 'node:child_process';

const BACKEND = process.env.AWA_BACKEND ?? 'http://127.0.0.1:8787';
const EMAIL = process.env.AWA_EMAIL ?? 'modestlyeu+awatest@gmail.com';
const PASSWORD = process.env.AWA_PASSWORD ?? 'awa-test-2026-xK9';

const PROMPTS = [
  ['Skriv en email til min chef om at jeg gerne vil have en lønsamtale.', 'medium'],
  ['Skriv en opsummering af en MUS-samtale med Anders, der har haft et godt år men skal melde tilbage i tide.', 'long'],
  ['Hvad er fordelene ved at arbejde hjemmefra?', 'short'],
  ['Skriv en besked til forældrene om at klassen skal på tur på fredag.', 'medium'],
  ['Forklar hvorfor det er vigtigt at holde pauser i løbet af arbejdsdagen.', 'medium'],
  ['Skriv en kort tak til en kollega der har hjulpet mig med et projekt.', 'short'],
];

/**
 * Verbs whose past tense is -ede, so a bare -e right after a subject is always
 * the infinitive in a place that wants the present -r. Keeping the list to
 * these avoids flagging "han kunne", "vi ville", "de havde", which are correct.
 */
const DROPPED_R = new RegExp(
  String.raw`\b(jeg|du|han|hun|vi|de|man|den|det)\s+(håbe|klare|prøve|arbejde|snakke|hjælpe|ønske|elske|savne|huske|bruge|lave|spille|kigge|tjekke)\b`,
  'gi',
);
/** The added r after a modal: "han skal skriver det". */
const ADDED_R = /\b(skal|kan|vil|må|skulle|kunne|ville|burde)\s+([a-zæøå]+er)\b/gi;

/** The slips that survive — real words in the wrong place. */
const VOICE = [
  [/\b(til|prøver?|forsøger?|begynder?|glæder mig til|lyst til)\s+og\s+[a-zæøå]+e\b/gi, 'og for at'],
  [/\b(nogle|nogen)\b/gi, 'nogle/nogen'],
  [/\b(synes|syntes)\b/gi, 'synes/syntes'],
  [/\b(hans|hendes)\s+egen?\b/gi, 'hans/hendes for sin'],
  [/\b(ligge|lægge|ligger|lægger)\b/gi, 'ligge/lægge'],
];

let failures = 0;
const ok = (name, cond, detail = '') => {
  console.log(`    ${cond ? 'OK  ' : 'FAIL'}  ${name}${cond || !detail ? '' : `  — ${detail}`}`);
  if (!cond) failures++;
};

function spellcheck(text) {
  try {
    execFileSync('swift', ['scripts/spellcheck-da.swift'], { input: text, encoding: 'utf8' });
    return [];
  } catch (e) {
    if (e.status !== 1) throw new Error(`spellcheck failed: ${e.message}`);
    return (e.stdout ?? '').trim().split('\n').filter(Boolean).map((l) => l.split('\t')[0]);
  }
}

const login = await fetch(`${BACKEND}/api/auth/login`, {
  method: 'POST',
  headers: { 'content-type': 'application/json' },
  body: JSON.stringify({ email: EMAIL, password: PASSWORD }),
}).then((r) => r.json());
if (!login.access_token) throw new Error(`no token: ${JSON.stringify(login)}`);

const install = `verify-spell-${Date.now()}`;
let voiceTotal = 0;
const allText = [];

for (const [prompt, length] of PROMPTS) {
  const res = await fetch(`${BACKEND}/api/chat`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', authorization: `Bearer ${login.access_token}`, 'x-awa-install': install },
    body: JSON.stringify({
      messages: [{ role: 'user', content: prompt }],
      operation: 'chat',
      contentClass: 'real',
      prefs: { length },
    }),
  });
  let text = '';
  for (const line of (await res.text()).split('\n')) {
    if (!line.startsWith('data: ')) continue;
    const d = line.slice(6);
    if (d === '[DONE]') break;
    try {
      const p = JSON.parse(d);
      if (p.type === 'token') text += p.text;
      else if (p.type === 'error') throw new Error(`${p.code}: ${p.message}`);
    } catch { /* keepalive noise */ }
  }
  text = text.trim();
  allText.push(text);

  console.log(`\n— ${prompt}`);
  const misspelled = spellcheck(text);
  const droppedR = text.match(DROPPED_R) ?? [];
  const addedR = text.match(ADDED_R) ?? [];
  const voice = VOICE.flatMap(([re, name]) => (text.match(re) ?? []).map((m) => `${name}: "${m.trim()}"`));
  voiceTotal += voice.length;

  ok('no misspelled word', misspelled.length === 0, JSON.stringify([...new Set(misspelled)]));
  ok('no dropped r after a subject', droppedR.length === 0, JSON.stringify([...new Set(droppedR)]));
  ok('no added r after a modal', addedR.length === 0, JSON.stringify([...new Set(addedR)]));
  console.log(`          stemme: ${voice.length ? voice.slice(0, 4).join(', ') : 'ingen smuttere fundet'}`);
}

console.log(`\nVOICE across ${PROMPTS.length} answers: ${voiceTotal} surviving slips`);
if (!voiceTotal) console.log('  ⚠ NOT A FAILURE, BUT LOOK: the drafts may now read machine-written.');
console.log(`\n${failures ? `${failures} FAILED` : 'all checks passed'}`);
process.exit(failures ? 1 : 0);
