/**
 * Does an attached file actually reach the answers?
 *
 * The questionnaire a person points this at is usually EMPTY — that is what a
 * form is — and the answers live in whatever they attached. If the model
 * answers "the document does not mention this" while holding a file that says
 * exactly this, the feature is decoration.
 *
 * It happened, on 2026-08-25. Telling the model it may reply "the document does
 * not cover this" (added to stop it returning empty strings) turned that escape
 * hatch into the easy road, and it stopped opening the attachment at all.
 *
 * Same shape as the acceptance section of verify-autonomous.mjs, but straight
 * at the API: seconds instead of a quarter of an hour, so the prompt can be
 * tuned against evidence rather than hope. The facts exist ONLY in the
 * attachment, so an answer can only contain one by having read it.
 */
const BACKEND = process.env.AWA_BACKEND ?? 'http://127.0.0.1:8787';
const EMAIL = process.env.AWA_EMAIL ?? 'tester@example.com';
const PASSWORD = process.env.AWA_PASSWORD ?? 'awa-test-2026';
const RUNS = Number(process.env.RUNS ?? 3);

const FACT_A = 'Havfrue';
const FACT_B = '0,4 %';

const PARAGRAPHS = [
  'Medarbejdersamtale 2026',
  'Hvad er status på projektet?',
  '',
  'Beskriv dine tre vigtigste resultater i år',
  '',
  '2. Hvilke områder vil du gerne udvikle?',
  '',
  // The deliberate grounded:false case, copied from verify-autonomous.mjs.
  // Its presence is the whole point: one question the material cannot answer
  // must not teach the model that the material answers nothing.
  'Hvad var din kollegas vurdering af leveringen i marts?',
  '',
  'Denne formular tager cirka fem minutter at udfylde.',
].map((text, index) => ({ index, text }));

const ATTACHMENT = [
  `Projektet ${FACT_A} er 87 % færdigt og leverer til tiden.`,
  `Årets tre vigtigste resultater: lanceringen af ${FACT_A}-portalen, en fejlrate ned på ${FACT_B}, og 12 nye kunder.`,
  // Deliberately NOT covering the "udvikle" question, so HALF the questions
  // here have nothing behind them — exactly the ratio verify-autonomous.mjs's
  // acceptance file creates. That ratio is the thing under test: a model that
  // gives up on the attachment because half of it came up empty is a model
  // that will give up on a real user's half-relevant notes.
].join('\n');

const token = await (async () => {
  const res = await fetch(`${BACKEND}/api/auth/login`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ email: EMAIL, password: PASSWORD }),
  });
  const b = await res.json();
  if (!b.access_token) throw new Error(JSON.stringify(b).slice(0, 200));
  return b.access_token;
})();

console.log(`backend: ${BACKEND}\nfacts that exist ONLY in the attachment: "${FACT_A}", "${FACT_B}"\n`);

let grounded = 0;
for (let run = 1; run <= RUNS; run++) {
  const res = await fetch(`${BACKEND}/api/autonomous/answer`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', authorization: `Bearer ${token}`, 'x-awa-install': 'probe-grounding' },
    body: JSON.stringify({
      scope: 'document',
      paragraphs: PARAGRAPHS,
      documentTitle: 'Medarbejdersamtale 2026',
      context: [
        {
          id: 'c1',
          name: 'Min forberedelse.txt',
          kind: 'text',
          text: ATTACHMENT,
          chars: ATTACHMENT.length,
          truncated: false,
        },
      ],
    }),
  });
  if (!res.ok) {
    console.log(`run ${run}: HTTP ${res.status} ${(await res.text()).slice(0, 200)}`);
    continue;
  }
  const data = await res.json();
  const answers = data.answers ?? [];
  const all = answers.map((a) => a.answer).join(' ');
  const hit = all.includes(FACT_A) || all.includes(FACT_B);
  if (hit) grounded++;
  console.log(`run ${run}: detected=${data.detected} answered=${answers.length} usedAttachment=${hit ? 'YES' : 'NO'}`);
  for (const a of answers) console.log(`    [${a.paragraphIndex}] grounded=${a.grounded} ${a.answer.slice(0, 110)}`);
  console.log();
}

console.log(`${grounded}/${RUNS} runs answered from the attached file`);
process.exit(grounded === RUNS ? 0 : 1);
