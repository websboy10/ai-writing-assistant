/**
 * What actually reaches the user's document?
 *
 * Every insertion path writes text/plain. Google Docs, a contenteditable and a
 * <textarea> all take `**vigtigt**` literally, so markdown in a reply becomes
 * asterisks in the user's document — the product's core promise failing with
 * no error anywhere.
 *
 * Two layers are under test, and they are graded differently:
 *
 *   PROMPT (soft)  apps/backend/src/prompt.ts asks the model not to format.
 *                  Reported, never asserted: a prompt is a request, and no
 *                  wording makes a model obey every time.
 *   STRIP  (hard)  apps/extension/insertion/plaintext.ts removes what survives.
 *                  This is the guarantee, so THIS is the pass/fail line.
 *
 * Exit 0 only when the text the user would receive is clean.
 */
import { stripMarkdown } from '../apps/extension/insertion/plaintext.ts';

const BACKEND = process.env.AWA_BACKEND ?? 'https://ai-skriveassistent-api.vercel.app';
const EMAIL = process.env.AWA_EMAIL ?? 'tester@example.com';
const PASSWORD = process.env.AWA_PASSWORD ?? 'awa-test-2026';

async function login() {
  const res = await fetch(`${BACKEND}/api/auth/login`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ email: EMAIL, password: PASSWORD }),
  });
  const l = await res.json();
  if (!l.access_token) throw new Error(`no token: ${JSON.stringify(l)}`);
  return l.access_token;
}

async function ask(token, install, prompt) {
  const res = await fetch(`${BACKEND}/api/chat`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', authorization: `Bearer ${token}`, 'x-awa-install': install },
    body: JSON.stringify({
      messages: [{ role: 'user', content: prompt }],
      operation: 'chat',
      contentClass: 'real',
      prefs: { tone: 'neutral', length: 'same' },
    }),
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}: ${(await res.text()).slice(0, 300)}`);
  let out = '';
  let model = '?';
  let err = null;
  const reader = res.body.getReader();
  const dec = new TextDecoder();
  let buf = '';
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    buf += dec.decode(value, { stream: true });
    let i;
    while ((i = buf.indexOf('\n')) !== -1) {
      const line = buf.slice(0, i).trim();
      buf = buf.slice(i + 1);
      if (!line.startsWith('data: ')) continue;
      try {
        const ev = JSON.parse(line.slice(6));
        if (ev.type === 'token') out += ev.text;
        if (ev.type === 'meta' && ev.model && ev.model !== 'pending') model = ev.model;
        if (ev.type === 'error') err = ev.message;
      } catch {
        /* keepalive */
      }
    }
  }
  if (err) throw new Error(err);
  return { text: out, model };
}

// Prompts chosen because a helpful assistant NATURALLY reaches for markdown on
// each: a structured plan, a list, an emphasis-heavy instruction.
const PROMPTS = [
  'Skriv en kort medarbejderudviklingsplan med tre fokusområder for en sælger.',
  'Opsummer fordelene ved hjemmearbejde i punktform.',
  'Skriv et kort afsnit om kvartalets resultater, og fremhæv det vigtigste.',
];

// A leading "- " is NOT a defect: a hyphen bullet is what a person types and
// reads correctly as plain text, so the prompt allows it and the strip keeps
// it. Only syntax that renders as a literal artefact counts here.
const TELLS = [
  ['emphasis * _', /(\*{1,3})(?=\S)[\s\S]*?\S\1|(?<![\w\\])(_{1,3})(?=\S)[^\n]*?\S\2(?!\w)/],
  ['heading #', /^#{1,6}\s+\S/m],
  ['star bullet', /^\s*[*+]\s+\S/m],
  ['code fence', /```|~~~/],
  ['inline code `', /`[^`\n]+`/],
  ['table |', /^\s*\|.*\|/m],
  ['link []()', /\[[^\]]+\]\([^)]*\)/],
  ['trailing space', /[ \t]+$/m],
];

const tells = (s) => TELLS.filter(([, re]) => re.test(s)).map(([n]) => n);

const token = await login();
const install = `probe-${Date.now()}`;
console.log(`account: ${EMAIL}\nbackend: ${BACKEND}\n`);

let rawHits = 0;
let cleanHits = 0;

for (const p of PROMPTS) {
  const { text, model } = await ask(token, install, p);
  const clean = stripMarkdown(text);
  const before = tells(text);
  const after = tells(clean);
  if (before.length) rawHits++;
  if (after.length) cleanHits++;
  console.log(`--- ${p}`);
  console.log(`    model:        ${model}`);
  console.log(`    from model:   ${before.length ? before.join(', ') : 'clean'}`);
  console.log(`    to document:  ${after.length ? `STILL DIRTY -> ${after.join(', ')}` : 'clean'}`);
  console.log(
    clean
      .split('\n')
      .slice(0, 6)
      .map((l) => `    | ${l}`)
      .join('\n'),
  );
  console.log();
}

console.log(`prompt layer: ${PROMPTS.length - rawHits}/${PROMPTS.length} replies arrived already clean`);
console.log(`strip layer:  ${PROMPTS.length - cleanHits}/${PROMPTS.length} reach the document clean`);
if (cleanHits) {
  console.log('\nFAIL — markdown reaches the user document.');
  process.exit(1);
}
console.log('\nPASS — nothing but plain text reaches the document.');
