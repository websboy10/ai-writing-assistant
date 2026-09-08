/**
 * Web search: the model decides, and no address ever reaches the document.
 *
 * Two independent things have to hold, and the feature is worthless if either
 * fails:
 *
 *   ROUTING  A question the model can answer from memory must not pay for a
 *            search. A question that turns on a real fact must. The operator's
 *            own line for it: "a mathematics problem, it knows, easy. But
 *            analyzing a specific novel — do a web search there."
 *   CLEAN    A searched answer must arrive with no markdown link, no web
 *            address and no bare domain, in BOTH destinations: the plain text
 *            a textarea receives and the HTML "Indsæt straks" pastes into
 *            Google Docs. OpenRouter's stock search prompt asks for markdown
 *            citations; ours forbids them, and this is what proves it.
 *
 * Nothing in the request says whether to search — that is the point. The
 * client no longer has a switch, so the only evidence a search happened is
 * whether sources came back.
 *
 * Prereqs: backend on 127.0.0.1:8787. COSTS REAL MONEY (searches + tokens).
 *
 * Run: node scripts/verify-web-search.mjs
 */
import { stripMarkdown } from '../apps/extension/insertion/plaintext.ts';
import { markdownToHtml } from '../apps/extension/insertion/richtext.ts';

const BACKEND = process.env.AWA_BACKEND ?? 'http://127.0.0.1:8787';
const EMAIL = process.env.AWA_EMAIL ?? 'modestlyeu+awatest@gmail.com';
const PASSWORD = process.env.AWA_PASSWORD ?? 'awa-test-2026-xK9';

/** [prompt, should it search, operation, extras] */
const CASES = [
  ['Hvad er 17 gange 24? Svar kort.', false, 'chat', {}],
  ['Skriv en email til min chef om at jeg er syg i dag.', false, 'chat', {}],
  ['Forklar hvad inflation er.', false, 'chat', {}],
  ['Analyser temaerne i Karen Blixens "Babettes gæstebud".', true, 'chat', {}],
  ['Hvad er der sket med elpriserne i Danmark for nylig?', true, 'chat', {}],
  ['Hvem er den nuværende borgmester i Aarhus?', true, 'chat', {}],
  // An operation that works on the user's own text never searches, and never
  // pays the decider either — it is refused before any call is made.
  ['Gør den kortere.', false, 'summarize', { subject: 'Vi vil gerne invitere dig til vores årlige sommerfest den 12. juni i haven bag kontoret.' }],
];

let failures = 0;
const ok = (name, cond, detail = '') => {
  console.log(`    ${cond ? 'OK  ' : 'FAIL'}  ${name}${cond || !detail ? '' : `  — ${detail}`}`);
  if (!cond) failures++;
};

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

async function ask(token, install, prompt, operation, extras) {
  const t0 = Date.now();
  const res = await fetch(`${BACKEND}/api/chat`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', authorization: `Bearer ${token}`, 'x-awa-install': install },
    body: JSON.stringify({
      messages: [{ role: 'user', content: prompt }],
      operation,
      contentClass: 'real',
      prefs: { length: 'medium' },
      ...extras,
    }),
  });
  const raw = await res.text();
  let text = '';
  let sources = null;
  // Order matters as much as presence: a status that arrives after the first
  // word is worse than none, because it would overwrite the answer.
  const order = [];
  for (const line of raw.split('\n')) {
    if (!line.startsWith('data: ')) continue;
    const d = line.slice(6);
    if (d === '[DONE]') break;
    let p;
    try { p = JSON.parse(d); } catch { continue; }
    if (p.type === 'token') {
      if (!text) order.push('token');
      text += p.text;
    } else if (p.type === 'status') order.push(`status:${p.state}`);
    else if (p.type === 'sources') { sources = p.sources; order.push('sources'); }
    else if (p.type === 'error') throw new Error(`${p.code}: ${p.message}`);
  }
  return { text: text.trim(), sources, order, ms: Date.now() - t0 };
}

/** Everything that would arrive in a document as a visible web address. */
function linkiness(s) {
  return {
    markdown: s.match(/\[[^\]]*\]\([^)]*\)/g) ?? [],
    urls: s.match(/https?:\/\/\S+/g) ?? [],
    domains: s.match(/\b(?:www\.)?[a-z0-9][a-z0-9-]*\.(?:dk|com|org|net|eu|io|se|no|de)\b/gi) ?? [],
  };
}

const token = await login();
const install = `verify-web-${Date.now()}`;

for (const [prompt, wantSearch, operation, extras] of CASES) {
  console.log(`\n— ${prompt}`);
  const { text, sources, order, ms } = await ask(token, install, prompt, operation, extras);
  const searched = Array.isArray(sources) && sources.length > 0;

  // The panel must say what it is doing during the wait, and must stop saying
  // it the moment there are words to show instead.
  const firstToken = order.indexOf('token');
  const statuses = order.filter((o) => o.startsWith('status:'));
  ok('said "Tænker" before any word arrived', order[0] === 'status:thinking', JSON.stringify(order.slice(0, 3)));
  ok(
    'said "Søger på internettet" only when it searched',
    statuses.includes('status:searching') === wantSearch,
    JSON.stringify(statuses),
  );
  ok(
    'no status arrived after the first word',
    statuses.every((s) => order.indexOf(s) < firstToken),
    JSON.stringify(order.slice(0, 6)),
  );

  ok(
    wantSearch ? 'searched the web, as it should have' : 'answered from memory, no search paid for',
    searched === wantSearch,
    searched ? `searched: ${sources.map((s) => s.title).join(' · ')}` : 'did not search',
  );
  ok('an answer came back', text.length > 20, `${text.length} chars`);

  // Both destinations, on every answer — a stray address is just as wrong in
  // an answer that was NOT searched.
  const plain = linkiness(stripMarkdown(text));
  const rich = linkiness(markdownToHtml(text).replace(/<[^>]+>/g, ' '));
  ok('no markdown link in the text', plain.markdown.length === 0, JSON.stringify(plain.markdown.slice(0, 2)));
  ok('no web address in the plain text', plain.urls.length === 0, JSON.stringify(plain.urls.slice(0, 2)));
  ok('no bare domain in the plain text', plain.domains.length === 0, JSON.stringify(plain.domains.slice(0, 3)));
  ok('no web address in what Indsæt straks pastes', rich.urls.length === 0, JSON.stringify(rich.urls.slice(0, 2)));

  if (searched) console.log(`          kilder: ${sources.map((s) => s.title).join(' · ')}`);
  console.log(`          ${ms} ms · ${text.slice(0, 120).replace(/\n/g, ' ')}…`);
}

console.log(`\n${failures ? `${failures} FAILED` : 'all checks passed'}`);
process.exit(failures ? 1 : 0);
