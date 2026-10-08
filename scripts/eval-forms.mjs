/**
 * Does "Besvar alle" read a form it has never seen the like of?
 *
 * Every layout here is a way real worksheets ask for an answer, and each one
 * states what a person would do with it: how many things there are to answer,
 * and where each answer goes. The run is the real route with a real model, so
 * this measures the product and not the prompt in isolation. No browser: the
 * question is what the server PLANS, and the paragraphs are sent the way the
 * extension sends them.
 *
 * Prereqs: backend on 127.0.0.1:8787. COSTS REAL MODEL QUOTA (2 per form).
 *
 * Run: node scripts/eval-forms.mjs [name-filter] [--runs=3]
 */
const BACKEND = process.env.AWA_BACKEND ?? 'http://127.0.0.1:8787';
const EMAIL = process.env.AWA_TEST_EMAIL ?? 'modestlyeu+awatest@gmail.com';
const PASSWORD = process.env.AWA_TEST_PASSWORD ?? 'awa-test-2026-xK9';
const RUNS = Number(process.argv.find((a) => a.startsWith('--runs='))?.slice(7) ?? 1);
const FILTER = process.argv.slice(2).find((a) => !a.startsWith('--'));

const text = (lines) => lines.map((t, index) => ({ index, text: t }));
const cell = (table, row, col, t = '') => ({ text: t, kind: 'cell', cell: { table, row, col } });
const shaped = (items) => items.map((p, index) => (typeof p === 'string' ? { index, text: p } : { index, ...p }));

/**
 * `want` maps a paragraph index to what must land there: a mode, and
 * optionally a pattern the answer must match. Anything the run writes
 * anywhere else is a failure too, unless listed in `mayAlso`.
 */
const FORMS = [
  {
    name: 'plain questions',
    paragraphs: text(['Hvad er hovedstaden i Danmark?', '', 'Hvor mange dage har en uge?']),
    want: { 0: { mode: 'below', answer: /k[øo]benhavn/i }, 2: { mode: 'below', answer: /7|syv/i } },
  },
  {
    name: 'imperatives without question marks',
    paragraphs: text(['Opgave 1', 'Nævn tre nordiske lande.', '', 'Opgave 2', 'Forklar kort, hvad fotosyntese er.']),
    want: { 1: { mode: 'below' }, 4: { mode: 'below', answer: /lys|sol/i } },
  },
  {
    name: 'labels with a colon',
    paragraphs: text(['Stamoplysninger', 'Navn:', 'Dato:', 'Klasse:']),
    want: { 1: { mode: 'inline' }, 2: { mode: 'inline' }, 3: { mode: 'inline' } },
  },
  {
    name: 'blanks drawn with underscores',
    paragraphs: text(['Udfyld de tomme felter.', 'Danmarks hovedstad er __________.', 'En uge har ____ dage.', 'Vand koger ved ____ grader.']),
    want: {
      1: { mode: 'replace', answer: /k[øo]benhavn/i },
      2: { mode: 'replace', answer: /7|syv/i },
      3: { mode: 'replace', answer: /100|hundrede/i },
    },
  },
  {
    name: 'label followed by an underscore line',
    paragraphs: text(['Navn: ____________________', 'Hvad er din yndlingsbog, og hvorfor?', '________________________________________', '________________________________________']),
    want: { 0: { mode: 'replace' }, 2: { mode: 'replace' } },
    mayAlso: [3],
  },
  {
    name: 'multiple choice with letters',
    paragraphs: text(['1. Hvad er hovedstaden i Sverige?', 'a) Oslo', 'b) Stockholm', 'c) Helsinki', '', '2. Hvor mange minutter er der på en time?', 'a) 30', 'b) 60', 'c) 100']),
    want: { 2: { mode: 'inline', answer: /✓/ }, 7: { mode: 'inline', answer: /✓/ } },
  },
  {
    name: 'checkboxes',
    paragraphs: text(['Hvilke af disse er frugter? Sæt kryds.', '☐ Æble', '☐ Gulerod', '☐ Banan', '☐ Kartoffel']),
    want: { 1: { mode: 'replace', answer: /☒/ }, 3: { mode: 'replace', answer: /☒/ } },
  },
  {
    name: 'true or false',
    paragraphs: text(['Sandt eller falsk?', 'Solen er en stjerne. Sandt / Falsk', 'Hvaler er fisk. Sandt / Falsk']),
    want: { 1: { mode: 'replace', answer: /^sandt/i }, 2: { mode: 'replace', answer: /^falsk/i } },
  },
  {
    name: 'sub-questions under a shared text',
    paragraphs: text([
      'Læs teksten og svar på spørgsmålene.',
      'Mette cyklede til skole mandag morgen. Det regnede, så hun tog regnjakke på.',
      'a) Hvordan kom Mette i skole?',
      'b) Hvorfor tog hun regnjakke på?',
    ]),
    want: { 2: { mode: 'below', answer: /cykl/i }, 3: { mode: 'below', answer: /regn/i } },
  },
  {
    name: 'question and answer table',
    paragraphs: shaped([
      'Udfyld skemaet.',
      cell(0, 0, 0, 'Spørgsmål'), cell(0, 0, 1, 'Dit svar'),
      cell(0, 1, 0, 'Hvad er 6 gange 7?'), cell(0, 1, 1),
      cell(0, 2, 0, 'Hvad hedder Danmarks største ø?'), cell(0, 2, 1),
    ]),
    want: { 4: { mode: 'fill', answer: /42/ }, 6: { mode: 'fill', answer: /sj[æa]lland/i } },
  },
  {
    name: 'grid with side labels and column headers',
    paragraphs: shaped([
      'Beskriv hvert dyr.',
      cell(0, 0, 0), cell(0, 0, 1, 'Levested'), cell(0, 0, 2, 'Føde'),
      cell(0, 1, 0, 'Isbjørn'), cell(0, 1, 1), cell(0, 1, 2),
      cell(0, 2, 0, 'Giraf'), cell(0, 2, 1), cell(0, 2, 2),
    ]),
    want: { 5: { mode: 'fill', answer: /arkt|is|nord/i }, 6: { mode: 'fill' }, 8: { mode: 'fill', answer: /savann|afrika/i }, 9: { mode: 'fill' } },
  },
  {
    name: 'already answered and half answered',
    paragraphs: text(['Hvad er hovedstaden i Norge?', 'Hovedstaden i Norge er Oslo.', '', 'Hvad er hovedstaden i Finland?']),
    want: { 3: { mode: 'below', answer: /helsinki/i } },
  },
  {
    name: 'english headings with space beneath',
    paragraphs: shaped([
      { text: 'Self-evaluation', kind: 'heading', level: 1 },
      { text: 'Your three most important results this year', kind: 'heading', level: 2 },
      '',
      { text: 'Areas you want to develop', kind: 'heading', level: 2 },
      '',
    ]),
    want: { 1: { mode: 'below' }, 3: { mode: 'below' } },
  },
  {
    name: 'no questions at all',
    paragraphs: text(['Referat af mødet den 3. marts.', 'Vi gennemgik budgettet og vedtog det uden ændringer.', 'Næste møde er i april.']),
    want: {},
  },
];

const login = await fetch(`${BACKEND}/api/auth/login`, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ email: EMAIL, password: PASSWORD }),
}).then((r) => r.json());
if (!login.access_token) throw new Error(`login failed: ${JSON.stringify(login).slice(0, 200)}`);

async function run(form) {
  const res = await fetch(`${BACKEND}/api/autonomous/answer`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${login.access_token}`, 'x-awa-install': 'eval-forms-script' },
    body: JSON.stringify({ scope: 'document', paragraphs: form.paragraphs, fills: true, replace: !process.argv.includes('--old-client') }),
  });
  const data = await res.json();
  if (!res.ok) return { problems: [`HTTP ${res.status}: ${data.error}`], answers: [] };

  const problems = [];
  const answers = data.answers ?? [];
  for (const [at, w] of Object.entries(form.want)) {
    const got = answers.filter((a) => a.at === Number(at));
    if (got.length === 0) problems.push(`[${at}] nothing written (wanted ${w.mode})`);
    if (got.length > 1) problems.push(`[${at}] written ${got.length} times`);
    for (const a of got) {
      if (a.mode !== w.mode) problems.push(`[${at}] mode ${a.mode}, wanted ${w.mode}`);
      if (w.answer && !w.answer.test(a.answer)) problems.push(`[${at}] answer ${JSON.stringify(a.answer.slice(0, 60))}`);
    }
  }
  const allowed = new Set([...Object.keys(form.want).map(Number), ...(form.mayAlso ?? [])]);
  for (const a of answers) {
    if (!allowed.has(a.at)) problems.push(`[${a.at}] unwanted ${a.mode}: ${JSON.stringify(a.answer.slice(0, 50))}`);
  }
  return { problems, answers };
}

let passed = 0;
let total = 0;
for (const form of FORMS) {
  if (FILTER && !form.name.includes(FILTER)) continue;
  for (let i = 0; i < RUNS; i++) {
    total += 1;
    const started = Date.now();
    const { problems, answers } = await run(form);
    const secs = ((Date.now() - started) / 1000).toFixed(1);
    if (problems.length === 0) passed += 1;
    console.log(`${problems.length ? '✗' : '✓'} ${form.name} (${secs}s)`);
    for (const p of problems) console.log(`    ${p}`);
    if (problems.length) console.log(`    plan: ${answers.map((a) => `${a.mode}@${a.at}`).join(' ') || 'nothing'}`);
  }
}
console.log(`\n${passed} of ${total} forms read the way a person would`);
process.exit(passed === total ? 0 : 1);
