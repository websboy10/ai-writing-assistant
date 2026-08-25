/**
 * How long does the thinking half actually take? Times POST
 * /api/autonomous/answer for 5 and 10 questions so the answer stops being a
 * guess — 10 questions is a detection call plus two answer batches
 * (ANSWER_BATCH_SIZE = 5), i.e. three sequential model round trips.
 */
const BACKEND = process.env.BACKEND_URL ?? 'http://127.0.0.1:8787';
const RUNS = Number(process.env.RUNS ?? 3);

const TEN = [
  '1. Hvad hedder du?',
  '2. Hvor arbejder du?',
  '3. Hvad er din stilling?',
  '4. Hvor længe har du arbejdet der?',
  '5. Hvad er dine vigtigste opgaver?',
  '6. Hvilke værktøjer bruger du dagligt?',
  '7. Hvad er din største udfordring lige nu?',
  '8. Hvordan samarbejder du med dit team?',
  '9. Hvad vil du gerne blive bedre til?',
  '10. Hvad er dine mål for næste kvartal?',
];

const login = await fetch(`${BACKEND}/api/auth/login`, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ email: 'tester@example.com', password: 'awa-test-2026' }),
});
const { access_token } = await login.json();

async function timeIt(questions, label) {
  const paragraphs = questions.map((text, index) => ({ index, text }));
  const samples = [];
  for (let i = 0; i < RUNS; i++) {
    const t0 = Date.now();
    const res = await fetch(`${BACKEND}/api/autonomous/answer`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${access_token}`,
        'x-awa-install': 'measure-autonomous-script-0001',
      },
      body: JSON.stringify({ scope: 'selection', paragraphs }),
    });
    const ms = Date.now() - t0;
    const body = await res.json().catch(() => ({}));
    const answers = Array.isArray(body.answers) ? body.answers : [];
    const empty = answers.filter((a) => !a.answer?.trim()).length;
    samples.push(ms);
    console.log(
      `  ${label} run ${i + 1}: ${(ms / 1000).toFixed(1)}s  HTTP ${res.status}  detected=${body.detected ?? '?'}  answers=${answers.length}  empty=${empty}`,
    );
  }
  const avg = samples.reduce((a, b) => a + b, 0) / samples.length;
  console.log(`  → ${label}: avg ${(avg / 1000).toFixed(1)}s, max ${(Math.max(...samples) / 1000).toFixed(1)}s\n`);
  return Math.max(...samples);
}

console.log(`\nTiming /api/autonomous/answer against ${BACKEND} (${RUNS} runs each)\n`);
const five = await timeIt(TEN.slice(0, 5), '5 questions (1 batch) ');
const ten = await timeIt(TEN, '10 questions (2 batches)');
console.log(`worst observed: 5q ${(five / 1000).toFixed(1)}s · 10q ${(ten / 1000).toFixed(1)}s`);
