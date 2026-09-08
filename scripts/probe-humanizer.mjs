/**
 * What the voice actually sounds like, and whether it still says true things.
 *
 * Two separate questions, and they are graded differently because they are not
 * the same kind of claim:
 *
 *   DENSITY (taste)  How often a slip or a self-correction lands. The operator
 *                    asked for roughly every third word on 2026-09-08. Reported
 *                    as a number, never asserted — how human it reads is his
 *                    call, not a test's.
 *   TRUTH   (hard)   A self-correction may fix the WORDING. It may never
 *                    contradict the fact. Measured 2026-09-08, the model was
 *                    writing "giver groen faktisk nej det giver groen" — calling
 *                    its own right answer wrong and then repeating it. That is
 *                    the defect this file exists to catch, so THIS is the
 *                    pass/fail line.
 *
 * Run: node --import tsx scripts/probe-humanizer.mjs   (from apps/extension)
 */
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
  if (!res.ok) throw new Error(`HTTP ${res.status}: ${(await res.text()).slice(0, 200)}`);
  let out = '';
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
        if (ev.type === 'error') throw new Error(ev.message);
      } catch {
        /* keepalive */
      }
    }
  }
  return out;
}

/**
 * Questions with ONE checkable right answer, so a self-correction that
 * contradicts the fact is visible rather than a matter of opinion.
 */
const PROMPTS = [
  { q: 'Hvilken farve får man hvis man blander blå og gul maling? Svar kort.', truth: /gr[øo]n/i },
  { q: 'Hvad er hovedstaden i Danmark, og hvorfor ligger den der? Svar kort.', truth: /k[øo]benhavn/i },
  { q: 'Forklar kort hvorfor det er en fordel at arbejde hjemmefra.', truth: null },
];

/** Marks of a self-correction, as the prompt asks it to be written. */
const CORRECTION = /\b(n[æa]h vent|nej vent|vent|alts[åa]|eller rettere|jeg mener|undskyld)\b/gi;

/** The defect: the model denying its own answer. */
const CONTRADICTION = [
  /\ber forkert\b/i,
  /\bikke (?:er )?(?:rigtigt|korrekt|sandt)\b/i,
  /\bdet passer ikke\b/i,
  /\bnej,? det (?:er|giver|bliver) ikke\b/i,
];

const token = await login();
const install = `hum-${Date.now()}`;
console.log(`backend: ${BACKEND}\n`);

let failures = 0;

for (const { q, truth } of PROMPTS) {
  const text = await ask(token, install, q);
  const words = text.trim().split(/\s+/).filter(Boolean);
  const corrections = (text.match(CORRECTION) ?? []).length;
  const contradictions = CONTRADICTION.filter((re) => re.test(text));

  console.log(`--- ${q}`);
  console.log(text.split('\n').map((l) => `    | ${l}`).join('\n'));
  console.log(`    words: ${words.length}   self-corrections: ${corrections}`);
  if (truth) {
    const ok = truth.test(text);
    console.log(`    still says the true thing: ${ok ? 'yes' : 'NO'}`);
    if (!ok) failures++;
  }
  if (contradictions.length) {
    console.log(`    CONTRADICTS ITSELF -> ${contradictions.map((r) => String(r)).join(', ')}`);
    failures++;
  }
  console.log();
}

if (failures) {
  console.log(`FAIL — ${failures} reply/replies argue with their own answer or lose the fact.`);
  process.exit(1);
}
console.log('PASS — the voice is loose, the facts are not.');
