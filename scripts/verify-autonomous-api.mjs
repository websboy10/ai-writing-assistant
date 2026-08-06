/**
 * Live-model proof for POST /api/autonomous/answer (AUTO-03/04/05, D-10):
 * the AI must find questions across all three real-world shapes — a literal
 * question mark, an imperative prompt with none, and a numbered field — while
 * ignoring a plain statement, and it must admit when a question had nothing
 * in the document to ground an answer in (D-12), rather than fabricating one
 * silently. This is a live-model test, so it asserts coverage of the three
 * shapes, not an exact question count — model output varies run to run.
 *
 * Prereq: a local backend running (`pnpm dev:backend`) and tester@example.com
 * with an active entitlement (verified by the paywall/E2E scripts already).
 */
const BACKEND = process.env.BACKEND_URL ?? 'http://127.0.0.1:8787';

const results = [];
const ok = (name, cond) => {
  results.push([name, cond]);
  console.log(`  ${cond ? '✓' : '✗'} ${name}`);
};

try {
  const loginRes = await fetch(`${BACKEND}/api/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: 'tester@example.com', password: 'awa-test-2026' }),
  });
  if (!loginRes.ok) throw new Error(`login failed: HTTP ${loginRes.status}`);
  const { access_token } = await loginRes.json();
  if (!access_token) throw new Error('login response had no access_token');

  // All three question shapes the AI must detect without a hand-written
  // question-mark rule (D-10), one statement that must NOT be answered, and
  // one real question the document gives no grounding for (D-12).
  const paragraphs = [
    { index: 0, text: 'Hvad er status på projektet?' },
    { index: 1, text: 'Beskriv dine tre vigtigste resultater i år' },
    { index: 2, text: '2. Hvilke områder vil du gerne udvikle?' },
    { index: 3, text: 'Projektet startede i januar og blev afsluttet i juni.' },
    { index: 4, text: 'Hvad var din kollegas vurdering af leveringen i marts?' },
  ];

  const res = await fetch(`${BACKEND}/api/autonomous/answer`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${access_token}`,
      'x-awa-install': 'verify-autonomous-api-script-000001',
    },
    body: JSON.stringify({ scope: 'document', paragraphs }),
  });

  ok('request succeeds (200)', res.status === 200);
  const body = await res.json();
  const answers = Array.isArray(body.answers) ? body.answers : [];
  const byIndex = new Map(answers.map((a) => [a.paragraphIndex, a]));

  ok('question-mark shape detected (paragraph 0)', byIndex.has(0));
  ok('imperative shape detected, no question mark (paragraph 1)', byIndex.has(1));
  ok('numbered-field shape detected (paragraph 2)', byIndex.has(2));
  ok('the plain statement is NOT among the answers (paragraph 3)', !byIndex.has(3));

  ok(
    'every answer produced is non-empty',
    answers.length > 0 && answers.every((a) => typeof a.answer === 'string' && a.answer.trim().length > 0),
  );

  ok(
    'the ungroundable question is detected and flagged grounded:false (paragraph 4)',
    byIndex.get(4)?.grounded === false,
  );

  ok('detected count covers at least the three question shapes', (body.detected ?? 0) >= 3);
} catch (err) {
  ok(`unexpected failure: ${String(err).slice(0, 200)}`, false);
}

const failed = results.filter(([, c]) => !c).length;
console.log(`\n${results.length - failed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
