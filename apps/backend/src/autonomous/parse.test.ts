import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseDetection, parseAnswers, type DetectedQuestion } from './parse.js';

// ---- parseDetection ----

test('Test 1: clean JSON array of questions is returned as-is', () => {
  const raw = JSON.stringify([
    { paragraphIndex: 0, questionText: 'Hvad er status?' },
    { paragraphIndex: 2, questionText: 'Beskriv dine resultater' },
  ]);
  const out = parseDetection(raw, 5);
  assert.deepEqual(out, [
    { paragraphIndex: 0, questionText: 'Hvad er status?' },
    { paragraphIndex: 2, questionText: 'Beskriv dine resultater' },
  ]);
});

test('Test 2: JSON wrapped in a code fence, or with prose around it, still parses', () => {
  const fenced = '```json\n[{"paragraphIndex":1,"questionText":"Hvad nu?"}]\n```';
  assert.deepEqual(parseDetection(fenced, 3), [{ paragraphIndex: 1, questionText: 'Hvad nu?' }]);

  const withProse =
    'Here are the questions I found:\n[{"paragraphIndex":0,"questionText":"Hvorfor?"}]\nLet me know if you need more.';
  assert.deepEqual(parseDetection(withProse, 3), [{ paragraphIndex: 0, questionText: 'Hvorfor?' }]);
});

test('Test 3: out-of-range, negative, or non-integer paragraphIndex is dropped; the rest are kept', () => {
  const raw = JSON.stringify([
    { paragraphIndex: 0, questionText: 'Valid — in range' },
    { paragraphIndex: -1, questionText: 'Negative — dropped' },
    { paragraphIndex: 3, questionText: 'Equal to count — dropped' },
    { paragraphIndex: 1.5, questionText: 'Not an integer — dropped' },
    { paragraphIndex: 2, questionText: 'Valid — last index' },
  ]);
  const out = parseDetection(raw, 3); // valid range: 0, 1, 2
  assert.deepEqual(out, [
    { paragraphIndex: 0, questionText: 'Valid — in range' },
    { paragraphIndex: 2, questionText: 'Valid — last index' },
  ]);
});

test('Test 4: missing or empty questionText is dropped', () => {
  const raw = JSON.stringify([
    { paragraphIndex: 0, questionText: 'Kept' },
    { paragraphIndex: 1 },
    { paragraphIndex: 2, questionText: '' },
    { paragraphIndex: 3, questionText: '   ' },
  ]);
  const out = parseDetection(raw, 4);
  assert.deepEqual(out, [{ paragraphIndex: 0, questionText: 'Kept' }]);
});

test('Test 5: input that is not JSON at all returns an empty array, never throws', () => {
  assert.deepEqual(parseDetection('not json at all, sorry!', 5), []);
  assert.deepEqual(parseDetection('', 5), []);
  assert.deepEqual(parseDetection('null', 5), []);
});

test('Test 6: more than MAX_AUTONOMOUS_QUESTIONS items is truncated to the cap, in order', () => {
  const items = Array.from({ length: 50 }, (_, i) => ({ paragraphIndex: i, questionText: `Q${i}` }));
  const out = parseDetection(JSON.stringify(items), 50);
  assert.equal(out.length, 40);
  assert.equal(out[0].paragraphIndex, 0);
  assert.equal(out[39].paragraphIndex, 39);
});

// ---- parseAnswers ----

const asked: DetectedQuestion[] = [
  { paragraphIndex: 0, questionText: 'Hvad er status?' },
  { paragraphIndex: 2, questionText: 'Beskriv dine resultater' },
];

test('Test 7: an answer for a paragraphIndex never asked about is dropped', () => {
  const raw = JSON.stringify([
    { paragraphIndex: 0, answer: 'Alt går godt', grounded: true },
    { paragraphIndex: 5, answer: 'Never asked', grounded: true },
  ]);
  const out = parseAnswers(raw, asked);
  assert.equal(out.length, 1);
  assert.equal(out[0].paragraphIndex, 0);
});

test('Test 8: grounded missing or not a boolean is coerced to false', () => {
  const raw = JSON.stringify([
    { paragraphIndex: 0, answer: 'Svar uden grounded felt' },
    { paragraphIndex: 2, answer: 'Svar med streng grounded', grounded: 'yes' },
  ]);
  const out = parseAnswers(raw, asked);
  assert.equal(out.length, 2);
  assert.equal(out.find((a) => a.paragraphIndex === 0)?.grounded, false);
  assert.equal(out.find((a) => a.paragraphIndex === 2)?.grounded, false);
});

test('Test 9: duplicate answers for the same paragraphIndex — first kept, rest dropped', () => {
  const raw = JSON.stringify([
    { paragraphIndex: 0, answer: 'Første svar', grounded: true },
    { paragraphIndex: 0, answer: 'Andet svar (skal droppes)', grounded: false },
  ]);
  const out = parseAnswers(raw, asked);
  assert.equal(out.length, 1);
  assert.equal(out[0].answer, 'Første svar');
  assert.equal(out[0].grounded, true);
});

test('parseAnswers never throws on non-JSON input', () => {
  assert.deepEqual(parseAnswers('nonsense response', asked), []);
});
