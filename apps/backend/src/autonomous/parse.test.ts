import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseDetection, parseAnswers, stripBold, validateMarked, validateParagraphs, type DetectedQuestion } from './parse.js';

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

// The prompt no longer asks for `grounded`, so it is absent from every real
// reply now. It used to default to false, which fed the panel's "answered
// without anything to build on" list; that list is gone and every answer is a
// draft to edit, so a missing flag must not mark an answer as unsourced.
test('Test 8: grounded missing or not a boolean defaults to true', () => {
  const raw = JSON.stringify([
    { paragraphIndex: 0, answer: 'Svar uden grounded felt' },
    { paragraphIndex: 2, answer: 'Svar med streng grounded', grounded: 'yes' },
  ]);
  const out = parseAnswers(raw, asked);
  assert.equal(out.length, 2);
  assert.equal(out.find((a) => a.paragraphIndex === 0)?.grounded, true);
  assert.equal(out.find((a) => a.paragraphIndex === 2)?.grounded, true);
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

// ── The whole-run rescue (measured against the live model 2026-08-25) ────────
// The model answered all five questions with paragraphIndex -1, meaning "no
// grounding". Every answer was dropped as unaskable and the run reported that
// nothing could be answered — after the user had waited half a minute.

test('Test 10: every index unusable and one answer per question — matched by position', () => {
  const raw = JSON.stringify([
    { paragraphIndex: -1, answer: 'Status er god', grounded: true },
    { paragraphIndex: -1, answer: 'Ikke oplyst', grounded: false },
  ]);
  const out = parseAnswers(raw, asked);
  assert.equal(out.length, 2);
  assert.deepEqual(
    out.map((a) => [a.paragraphIndex, a.questionText, a.answer]),
    [
      [0, 'Hvad er status?', 'Status er god'],
      [2, 'Beskriv dine resultater', 'Ikke oplyst'],
    ],
  );
});

test('Test 11: a MIXED reply is never re-ordered by position — the good answer is kept, the bad one dropped', () => {
  // One item names a real question, so the model was using indices after all.
  // Position proves nothing here, and guessing would put an answer under the
  // wrong question in the user's document.
  const raw = JSON.stringify([
    { paragraphIndex: -1, answer: 'Hører ingen steder hjemme', grounded: false },
    { paragraphIndex: 2, answer: 'Rigtigt placeret svar', grounded: true },
  ]);
  const out = parseAnswers(raw, asked);
  assert.equal(out.length, 1);
  assert.equal(out[0].paragraphIndex, 2);
  assert.equal(out[0].answer, 'Rigtigt placeret svar');
});

test('Test 12: a wrong-length reply with unusable indices is dropped, not guessed', () => {
  const raw = JSON.stringify([{ paragraphIndex: -1, answer: 'Kun ét svar til to spørgsmål', grounded: false }]);
  assert.deepEqual(parseAnswers(raw, asked), []);
});

test('Test 13: the positional rescue applies the same grounded default as the main path', () => {
  const raw = JSON.stringify([
    { paragraphIndex: -1, answer: 'Et', grounded: 'yes' },
    { paragraphIndex: -1, answer: 'To' },
  ]);
  const out = parseAnswers(raw, asked);
  assert.equal(out.length, 2);
  assert.ok(out.every((a) => a.grounded === true));
});

test('Test 14: an empty answer is dropped — never written as a blank line under the question', () => {
  const raw = JSON.stringify([
    { paragraphIndex: 0, answer: '   ', grounded: false },
    { paragraphIndex: 2, answer: 'Et rigtigt svar', grounded: true },
  ]);
  const out = parseAnswers(raw, asked);
  assert.equal(out.length, 1);
  assert.equal(out[0].paragraphIndex, 2);
});

test('Test 15: the positional rescue drops empty answers too', () => {
  const raw = JSON.stringify([
    { paragraphIndex: -1, answer: '', grounded: false },
    { paragraphIndex: -1, answer: 'Svar', grounded: true },
  ]);
  const out = parseAnswers(raw, asked);
  assert.equal(out.length, 1);
  assert.equal(out[0].paragraphIndex, 2);
  assert.equal(out[0].answer, 'Svar');
});

// ---- answerAt: the model's plan for where an answer goes ----

const PARAGRAPHS = [
  { index: 0, text: 'Hvad er status?', kind: 'text' as const },
  { index: 1, text: '', kind: 'cell' as const, cell: { table: 0, row: 0, col: 0 } },
  { index: 2, text: 'Beskriv dine resultater', kind: 'text' as const },
  { index: 3, text: 'Tænk på hele året', kind: 'bullet' as const, level: 1 },
  { index: 4, text: '', kind: 'numbered' as const, level: 1 },
  { index: 5, text: 'Allerede udfyldt', kind: 'cell' as const, cell: { table: 1, row: 0, col: 0 } },
  { index: 6, text: '', kind: 'text' as const },
];

test('answerAt: an empty cell or empty list item after the question is kept, past guidance too', () => {
  const raw = JSON.stringify([
    { paragraphIndex: 0, questionText: 'Hvad er status?', answerAt: 1 },
    { paragraphIndex: 2, questionText: 'Beskriv dine resultater', answerAt: 4 },
  ]);
  assert.deepEqual(parseDetection(raw, PARAGRAPHS.length, PARAGRAPHS), [
    { paragraphIndex: 0, questionText: 'Hvad er status?', answerAt: 1 },
    { paragraphIndex: 2, questionText: 'Beskriv dine resultater', answerAt: 4 },
  ]);
});

test('answerAt: null, a filled cell, a text line, a place before the question, or an out-of-range index all mean "no plan"', () => {
  const raw = JSON.stringify([
    { paragraphIndex: 0, questionText: 'A', answerAt: null },
    { paragraphIndex: 0, questionText: 'B', answerAt: 5 },
    { paragraphIndex: 0, questionText: 'C', answerAt: 6 },
    { paragraphIndex: 2, questionText: 'D', answerAt: 1 },
    { paragraphIndex: 0, questionText: 'E', answerAt: 99 },
    { paragraphIndex: 0, questionText: 'F', answerAt: '1' },
  ]);
  for (const q of parseDetection(raw, PARAGRAPHS.length, PARAGRAPHS)) {
    assert.equal('answerAt' in q, false, `${q.questionText} should carry no plan`);
  }
});

test('answerAt: one place is claimed once — the second question naming it gets no plan', () => {
  const raw = JSON.stringify([
    { paragraphIndex: 0, questionText: 'A', answerAt: 1 },
    { paragraphIndex: 2, questionText: 'B', answerAt: 1 },
  ]);
  const out = parseDetection(raw, PARAGRAPHS.length, PARAGRAPHS);
  assert.equal(out[0].answerAt, 1);
  assert.equal('answerAt' in out[1], false);
});

test('answerAt: without the paragraph list (old callers) it is ignored', () => {
  const raw = JSON.stringify([{ paragraphIndex: 0, questionText: 'A', answerAt: 1 }]);
  assert.deepEqual(parseDetection(raw, 3), [{ paragraphIndex: 0, questionText: 'A' }]);
});

test('answerAt travels from the detected question onto its answer', () => {
  const asked: DetectedQuestion[] = [{ paragraphIndex: 0, questionText: 'Hvad er status?', answerAt: 1 }];
  const out = parseAnswers(JSON.stringify([{ paragraphIndex: 0, answer: 'Alt går fint.' }]), asked);
  assert.equal(out[0].answerAt, 1);
  const positional = parseAnswers(JSON.stringify([{ paragraphIndex: -1, answer: 'Alt går fint.' }]), asked);
  assert.equal(positional[0].answerAt, 1);
});

// ---- validateParagraphs: the structure the extension read off Docs must reach the model ----

test('validateParagraphs keeps kind, level, bold and cell when well-formed', () => {
  const out = validateParagraphs([
    { index: 0, text: 'Overskrift', kind: 'heading', level: 2 },
    { index: 1, text: 'Udfyld skemaet', kind: 'text', bold: true },
    { index: 2, text: '', kind: 'cell', cell: { table: 0, row: 0, col: 1 } },
    { index: 3, text: '', kind: 'numbered', level: 1 },
  ]);
  assert.deepEqual(out, [
    { index: 0, text: 'Overskrift', kind: 'heading', level: 2 },
    { index: 1, text: 'Udfyld skemaet', kind: 'text', bold: true },
    { index: 2, text: '', kind: 'cell', cell: { table: 0, row: 0, col: 1 } },
    { index: 3, text: '', kind: 'numbered', level: 1 },
  ]);
});

test('validateParagraphs drops malformed structure fields but keeps the paragraph; a malformed paragraph rejects the request', () => {
  const out = validateParagraphs([
    { index: 0, text: 'x', kind: 'sidebar', level: 'two', bold: 'yes', cell: { table: -1, row: 0, col: 0 }, invented: 1 },
  ]);
  assert.deepEqual(out, [{ index: 0, text: 'x' }]);
  assert.equal(validateParagraphs([{ index: 'a', text: 'x' }]), null);
  assert.equal(validateParagraphs([]), null);
});

test('answerAt survives end to end: the extension paragraphs, validated, let the plan through', () => {
  const paragraphs = validateParagraphs([
    { index: 0, text: 'Hvad er hovedstaden i Danmark?', kind: 'text' },
    { index: 1, text: '', kind: 'cell', cell: { table: 0, row: 0, col: 0 } },
  ]);
  const out = parseDetection('[{"paragraphIndex": 0, "questionText": "Hvad er hovedstaden i Danmark?", "answerAt": 1}]', 2, paragraphs ?? undefined);
  assert.equal(out[0].answerAt, 1);
});

// ---- no bold, ever (the operator's rule, 2026-09-09) ----

test('stripBold: ** and __ markers go, the words stay; a lone asterisk and snake_case survive', () => {
  assert.equal(stripBold('Det er **vigtigt** og __også dette__.'), 'Det er vigtigt og også dette.');
  assert.equal(stripBold('Se note * nederst, i file_name_2.'), 'Se note * nederst, i file_name_2.');
  assert.equal(stripBold('- **Punkt et**\n- *kursiv*'), '- Punkt et\n- *kursiv*');
});

test('an answer with bold in it leaves the server without it, on both parse paths', () => {
  const asked: DetectedQuestion[] = [{ paragraphIndex: 0, questionText: 'Hvad?' }];
  const main = parseAnswers(JSON.stringify([{ paragraphIndex: 0, answer: '**Vigtigt** i dag.' }]), asked);
  assert.equal(main[0].answer, 'Vigtigt i dag.');
  const positional = parseAnswers(JSON.stringify([{ paragraphIndex: -1, answer: '__Vigtigt__ i dag.' }]), asked);
  assert.equal(positional[0].answer, 'Vigtigt i dag.');
});

// ---- "Besvar markeringen": the marked range ----

test('validateMarked accepts an in-range ordered pair and rejects everything else', () => {
  assert.deepEqual(validateMarked({ from: 1, to: 3 }, 5), { from: 1, to: 3 });
  assert.deepEqual(validateMarked({ from: 2, to: 2 }, 5), { from: 2, to: 2 });
  for (const bad of [undefined, null, 'x', {}, { from: 3, to: 1 }, { from: -1, to: 1 }, { from: 0, to: 5 }, { from: 0.5, to: 1 }]) {
    assert.equal(validateMarked(bad, 5), undefined, JSON.stringify(bad));
  }
});

test('with a marked range, a question outside it is dropped even when the model found it; a place outside the range is still allowed', () => {
  const raw = JSON.stringify([
    { paragraphIndex: 0, questionText: 'Hvad er status?', answerAt: 1 },
    { paragraphIndex: 2, questionText: 'Beskriv dine resultater', answerAt: 4 },
  ]);
  assert.deepEqual(parseDetection(raw, PARAGRAPHS.length, PARAGRAPHS, { from: 2, to: 3 }), [
    { paragraphIndex: 2, questionText: 'Beskriv dine resultater', answerAt: 4 },
  ]);
});
