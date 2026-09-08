/**
 * What actually reaches the user's document — both kinds of destination.
 *
 * The contract changed on 2026-09-08. It used to be "no markdown, ever",
 * because every insertion path wrote text/plain and `**vigtigt**` arrived as
 * asterisks. Now "Indsæt straks" pastes text/html into editors that can hold
 * structure, and Google Docs turns it into real headings, bold and lists.
 *
 * So there are two destinations and they are graded differently:
 *
 *   RICH  (soft)  A document that can hold structure. We WANT headings, bold
 *                 and lists here. Reported, never asserted: a prompt is a
 *                 request, and no wording makes a model comply every time.
 *   PLAIN (hard)  A <textarea>, which can hold nothing but characters.
 *                 stripMarkdown() is the guarantee, so THIS is the pass/fail
 *                 line — exactly as it was before.
 *
 * The hard line is unchanged on purpose. Loosening the prompt is only safe
 * BECAUSE the strip still holds, and this is what proves it still does.
 *
 * Exit 0 only when the text a plain field would receive is clean.
 */
import { stripMarkdown } from '../apps/extension/insertion/plaintext.ts';
import { markdownToHtml } from '../apps/extension/insertion/richtext.ts';

const BACKEND = process.env.AWA_BACKEND ?? 'http://127.0.0.1:8787';
const EMAIL = process.env.AWA_EMAIL ?? 'modestlyeu+awatest@gmail.com';
const PASSWORD = process.env.AWA_PASSWORD ?? 'awa-test-2026-xK9';

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
      prefs: { length: 'medium' },
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

// Prompts chosen because a helpful assistant NATURALLY reaches for structure on
// each: a structured plan, a list, an emphasis-heavy instruction.
const PROMPTS = [
  'Skriv en kort medarbejderudviklingsplan med tre fokusområder for en sælger.',
  'Opsummer fordelene ved hjemmearbejde i punktform.',
  'Skriv et kort afsnit om kvartalets resultater, og fremhæv det vigtigste.',
];

/** Structure we now WANT, because the rich path renders it. */
const WANTED = [
  ['heading #', /^#{1,6}\s+\S/m],
  ['bold **', /\*\*(?=\S)[\s\S]*?\S\*\*/],
  ['bullet -', /^\s*-\s+\S/m],
  ['numbered 1.', /^\s*\d+[.)]\s+\S/m],
];

/**
 * Decoration that is still banned outright, and the artefacts a plain field
 * must never receive. A leading "- " is deliberately absent: it is a real
 * bullet in a rich editor and reads correctly as a hyphen in a plain one.
 */
const TELLS = [
  ['emphasis single * _', /(?<!\*)\*(?!\*)(?=\S)[^\n*]*?\S\*(?!\*)|(?<![\w\\*])(_{1,3})(?=\S)[^\n]*?\S\1(?!\w)/],
  ['heading #', /^#{1,6}\s+\S/m],
  ['bold **', /\*\*(?=\S)[\s\S]*?\S\*\*/],
  ['star bullet', /^\s*[*+]\s+\S/m],
  ['code fence', /```|~~~/],
  ['inline code `', /`[^`\n]+`/],
  ['table |', /^\s*\|.*\|/m],
  ['link []()', /\[[^\]]+\]\([^)]*\)/],
  ['trailing space', /[ \t]+$/m],
];

const hits = (list, s) => list.filter(([, re]) => re.test(s)).map(([n]) => n);

const token = await login();
const install = `probe-${Date.now()}`;
console.log(`account: ${EMAIL}\nbackend: ${BACKEND}\n`);

let structured = 0;
let dirty = 0;

for (const p of PROMPTS) {
  const { text, model } = await ask(token, install, p);
  const clean = stripMarkdown(text);
  const html = markdownToHtml(text);
  const wanted = hits(WANTED, text);
  const after = hits(TELLS, clean);
  if (wanted.length) structured++;
  if (after.length) dirty++;

  console.log(`--- ${p}`);
  console.log(`    model:            ${model}`);
  console.log(`    structure given:  ${wanted.length ? wanted.join(', ') : 'NONE — arrived as flat prose'}`);
  console.log(`    rich destination: ${/<(h[1-6]|strong|ul|ol)[\s>]/.test(html) ? 'real formatting' : 'plain paragraphs only'}`);
  console.log(`    plain destination:${after.length ? ` STILL DIRTY -> ${after.join(', ')}` : ' clean'}`);
  console.log(
    clean
      .split('\n')
      .slice(0, 6)
      .map((l) => `    | ${l}`)
      .join('\n'),
  );
  console.log();
}

console.log(`rich layer:  ${structured}/${PROMPTS.length} replies carried real structure`);
console.log(`plain layer: ${PROMPTS.length - dirty}/${PROMPTS.length} reach a plain field clean`);
if (dirty) {
  console.log('\nFAIL — markdown reaches a plain text field.');
  process.exit(1);
}
console.log('\nPASS — a plain field still receives nothing but plain text.');
