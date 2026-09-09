import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  batchFills,
  collapseForOldClients,
  parseDetection,
  parseAnswers,
  stripBold,
  validateMarked,
  validateParagraphs,
  type DetectedFill,
} from './parse.js';

// ---- parseDetection: questions ----

test('Test 1: a question with no fills gets the one place that always exists — under itself', () => {
  const raw = JSON.stringify([
    { paragraphIndex: 0, questionText: 'Hvad er status?' },
    { paragraphIndex: 2, questionText: 'Beskriv dine resultater', fills: [] },
  ]);
  assert.deepEqual(parseDetection(raw, 5), [
    { id: 1, paragraphIndex: 0, questionText: 'Hvad er status?', at: 0, mode: 'below' },
    { id: 2, paragraphIndex: 2, questionText: 'Beskriv dine resultater', at: 2, mode: 'below' },
  ]);
});

test('Test 2: JSON wrapped in a code fence, or with prose around it, still parses', () => {
  const fenced = '```json\n[{"paragraphIndex":1,"questionText":"Hvad nu?"}]\n```';
  assert.equal(parseDetection(fenced, 3)[0]?.questionText, 'Hvad nu?');

  const withProse =
    'Here are the questions I found:\n[{"paragraphIndex":0,"questionText":"Hvorfor?"}]\nLet me know if you need more.';
  assert.equal(parseDetection(withProse, 3)[0]?.questionText, 'Hvorfor?');
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
  assert.deepEqual(
    out.map((f) => [f.paragraphIndex, f.questionText]),
    [
      [0, 'Valid — in range'],
      [2, 'Valid — last index'],
    ],
  );
});

test('Test 4: missing or empty questionText is dropped', () => {
  const raw = JSON.stringify([
    { paragraphIndex: 0, questionText: 'Kept' },
    { paragraphIndex: 1 },
    { paragraphIndex: 2, questionText: '' },
    { paragraphIndex: 3, questionText: '   ' },
  ]);
  assert.deepEqual(
    parseDetection(raw, 4).map((f) => f.questionText),
    ['Kept'],
  );
});

test('Test 5: input that is not JSON at all returns an empty array, never throws', () => {
  assert.deepEqual(parseDetection('not json at all, sorry!', 5), []);
  assert.deepEqual(parseDetection('', 5), []);
  assert.deepEqual(parseDetection('null', 5), []);
});

test('Test 6: more than MAX_AUTONOMOUS_ANSWERS fills is truncated to the cap, in order', () => {
  const items = Array.from({ length: 100 }, (_, i) => ({ paragraphIndex: i, questionText: `Q${i}` }));
  const out = parseDetection(JSON.stringify(items), 100);
  assert.equal(out.length, 80);
  assert.equal(out[0].paragraphIndex, 0);
  assert.equal(out[79].paragraphIndex, 79);
  assert.equal(out[79].id, 80);
});

// ---- parseDetection: the fills ----

// The operator's worksheet, reduced (2026-09-09): an answered question, a
// question over a table whose answer cells hold "fortsæt herunder…", a grid of
// verses × Manden?/Kvinden?, a label with a colon, an empty list.
const cell = (index: number, text: string, table: number, row: number, col: number, extra: Record<string, unknown> = {}) =>
  ({ index, text, kind: 'cell' as const, cell: { table, row, col }, ...extra });
const SHEET = [
  { index: 0, text: 'Forklar hvor stereotyper kommer fra.', kind: 'text' as const },
  { index: 1, text: 'De kommer fra Bibelen.', kind: 'text' as const },
  { index: 2, text: '1) Hvad kendetegner manden og kvinden?', kind: 'text' as const, bold: true },
  cell(3, 'Hvad kendetegner manden?', 0, 0, 0),
  cell(4, 'Hvad kendetegner kvinden?', 0, 0, 1),
  cell(5, 'Manden skal herske fortsæt herunder…', 0, 1, 0, { lastLine: 'fortsæt herunder…' }),
  cell(6, 'Kvinden skal begære fortsæt herunder…', 0, 1, 1, { lastLine: 'fortsæt herunder…' }),
  { index: 7, text: '2) Hvad fortæller versene om køn?', kind: 'text' as const },
  cell(8, 'Bibelvers', 1, 0, 0),
  cell(9, 'Manden?', 1, 0, 1),
  cell(10, 'Kvinden?', 1, 0, 2),
  cell(11, '1. Korintherbrev 11,3', 1, 1, 0),
  cell(12, '', 1, 1, 1),
  cell(13, '', 1, 1, 2),
  { index: 14, text: 'Navn:', kind: 'text' as const },
  { index: 15, text: 'Nævn tre byer', kind: 'text' as const },
  { index: 16, text: '', kind: 'numbered' as const, level: 1 },
  { index: 17, text: '', kind: 'numbered' as const, level: 1 },
];

test('fills: a grid gives one fill per empty cell, each with its own id and task', () => {
  const raw = JSON.stringify([
    {
      paragraphIndex: 7,
      questionText: '2) Hvad fortæller versene om køn?',
      fills: [
        { at: 12, mode: 'fill', task: 'Manden? for 1. Korintherbrev 11,3' },
        { at: 13, mode: 'fill', task: 'Kvinden? for 1. Korintherbrev 11,3' },
      ],
    },
  ]);
  assert.deepEqual(parseDetection(raw, SHEET.length, SHEET), [
    { id: 1, paragraphIndex: 7, questionText: '2) Hvad fortæller versene om køn?', at: 12, mode: 'fill', task: 'Manden? for 1. Korintherbrev 11,3' },
    { id: 2, paragraphIndex: 7, questionText: '2) Hvad fortæller versene om køn?', at: 13, mode: 'fill', task: 'Kvinden? for 1. Korintherbrev 11,3' },
  ]);
});

test('fills: "below" continues under a cell that holds text; "inline" goes after a label', () => {
  const raw = JSON.stringify([
    { paragraphIndex: 2, questionText: '1) Hvad kendetegner manden og kvinden?', fills: [{ at: 5, mode: 'below' }, { at: 6, mode: 'below' }] },
    { paragraphIndex: 14, questionText: 'Navn:', fills: [{ at: 14, mode: 'inline' }] },
  ]);
  assert.deepEqual(
    parseDetection(raw, SHEET.length, SHEET).map((f) => [f.id, f.at, f.mode]),
    [
      [1, 5, 'below'],
      [2, 6, 'below'],
      [3, 14, 'inline'],
    ],
  );
});

test('fills: a missing mode is read off the place — empty means fill, text means below', () => {
  const raw = JSON.stringify([{ paragraphIndex: 7, questionText: 'Q', fills: [{ at: 12 }, { at: 11 }] }]);
  assert.deepEqual(
    parseDetection(raw, SHEET.length, SHEET).map((f) => [f.at, f.mode]),
    [
      [12, 'fill'],
      [11, 'below'],
    ],
  );
});

test('fills: a "fill" at a filled cell, a text line, a place before the question, an unknown mode on an empty place, or an out-of-range index is dropped', () => {
  const raw = JSON.stringify([
    { paragraphIndex: 7, questionText: 'A', fills: [{ at: 11, mode: 'fill' }] },
    { paragraphIndex: 7, questionText: 'B', fills: [{ at: 14, mode: 'fill' }] },
    { paragraphIndex: 7, questionText: 'C', fills: [{ at: 5, mode: 'below' }] },
    { paragraphIndex: 7, questionText: 'D', fills: [{ at: 12, mode: 'below' }] },
    { paragraphIndex: 7, questionText: 'E', fills: [{ at: 99, mode: 'fill' }] },
    { paragraphIndex: 7, questionText: 'F', fills: [{ at: '12', mode: 'fill' }] },
  ]);
  const out = parseDetection(raw, SHEET.length, SHEET);
  // Every question fell back to the one place under itself — and only the
  // first of them got it, since one fill per paragraph.
  assert.deepEqual(
    out.map((f) => [f.questionText, f.at, f.mode]),
    [['A', 7, 'below']],
  );
});

test('fills: one place is claimed once — the second question naming it gets nothing there', () => {
  const raw = JSON.stringify([
    { paragraphIndex: 7, questionText: 'A', fills: [{ at: 12, mode: 'fill' }] },
    { paragraphIndex: 8, questionText: 'B', fills: [{ at: 12, mode: 'fill' }] },
  ]);
  assert.deepEqual(
    parseDetection(raw, SHEET.length, SHEET).map((f) => [f.questionText, f.at, f.mode]),
    [
      ['A', 12, 'fill'],
      ['B', 8, 'below'],
    ],
  );
});

test('fills: a "below" at the question itself is dropped when the question has boxes', () => {
  const raw = JSON.stringify([
    { paragraphIndex: 7, questionText: 'Q', fills: [{ at: 7, mode: 'below' }, { at: 12, mode: 'fill' }] },
  ]);
  assert.deepEqual(
    parseDetection(raw, SHEET.length, SHEET).map((f) => [f.at, f.mode]),
    [[12, 'fill']],
  );
});

test('fills: an empty list is one fill at its first empty point', () => {
  const raw = JSON.stringify([{ paragraphIndex: 15, questionText: 'Nævn tre byer', fills: [{ at: 16, mode: 'fill' }] }]);
  assert.deepEqual(
    parseDetection(raw, SHEET.length, SHEET).map((f) => [f.at, f.mode]),
    [[16, 'fill']],
  );
});

test('fills: without the paragraph list (a client with no structure) every place is under its question', () => {
  const raw = JSON.stringify([{ paragraphIndex: 0, questionText: 'A', fills: [{ at: 1, mode: 'fill' }] }]);
  assert.deepEqual(parseDetection(raw, 3), [{ id: 1, paragraphIndex: 0, questionText: 'A', at: 0, mode: 'below' }]);
});

test('fills: the task is trimmed and capped, and absent when empty', () => {
  const raw = JSON.stringify([
    { paragraphIndex: 7, questionText: 'Q', fills: [{ at: 12, mode: 'fill', task: `  ${'x'.repeat(300)}  ` }, { at: 13, mode: 'fill', task: '   ' }] },
  ]);
  const out = parseDetection(raw, SHEET.length, SHEET);
  assert.equal(out[0].task?.length, 200);
  assert.equal('task' in out[1], false);
});

test('fills survive end to end: the extension paragraphs, validated, let the plan through', () => {
  const paragraphs = validateParagraphs([
    { index: 0, text: 'Hvad er hovedstaden i Danmark?', kind: 'text' },
    { index: 1, text: '', kind: 'cell', cell: { table: 0, row: 0, col: 0 } },
  ]);
  const out = parseDetection(
    '[{"paragraphIndex": 0, "questionText": "Hvad er hovedstaden i Danmark?", "fills": [{"at": 1, "mode": "fill"}]}]',
    2,
    paragraphs ?? undefined,
  );
  assert.deepEqual(out.map((f) => [f.at, f.mode]), [[1, 'fill']]);
});

// ---- batching ----

test('batchFills never splits a question, and a question larger than the batch is a batch by itself', () => {
  const fill = (id: number, q: number): DetectedFill => ({ id, paragraphIndex: q, questionText: `Q${q}`, at: 100 + id, mode: 'fill' });
  const fills = [fill(1, 0), fill(2, 0), fill(3, 1), ...Array.from({ length: 12 }, (_, i) => fill(4 + i, 2)), fill(16, 3)];
  const batches = batchFills(fills, 5);
  assert.deepEqual(
    batches.map((b) => b.map((f) => f.id)),
    [[1, 2, 3], [4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15], [16]],
  );
});

// ---- parseAnswers ----

const asked: DetectedFill[] = [
  { id: 1, paragraphIndex: 0, questionText: 'Hvad er status?', at: 0, mode: 'below' },
  { id: 2, paragraphIndex: 2, questionText: 'Beskriv dine resultater', at: 4, mode: 'fill', task: 'Kolonne to' },
];

test('Test 7: an answer for an id never asked about is dropped', () => {
  const raw = JSON.stringify([
    { id: 1, answer: 'Alt går godt', grounded: true },
    { id: 5, answer: 'Never asked', grounded: true },
  ]);
  const out = parseAnswers(raw, asked);
  assert.equal(out.length, 1);
  assert.equal(out[0].paragraphIndex, 0);
});

test('an answer carries its fill: question, task, place, mode, and answerAt for old clients when it is a fill', () => {
  const raw = JSON.stringify([
    { id: 1, answer: 'Alt går godt' },
    { id: 2, answer: 'Tre ting' },
  ]);
  const out = parseAnswers(raw, asked);
  assert.deepEqual(out[0], { paragraphIndex: 0, questionText: 'Hvad er status?', at: 0, mode: 'below', answer: 'Alt går godt', grounded: true });
  assert.deepEqual(out[1], {
    paragraphIndex: 2,
    questionText: 'Beskriv dine resultater',
    task: 'Kolonne to',
    at: 4,
    mode: 'fill',
    answerAt: 4,
    answer: 'Tre ting',
    grounded: true,
  });
});

// The prompt no longer asks for `grounded`, so it is absent from every real
// reply now. It used to default to false, which fed the panel's "answered
// without anything to build on" list; that list is gone and every answer is a
// draft to edit, so a missing flag must not mark an answer as unsourced.
test('Test 8: grounded missing or not a boolean defaults to true', () => {
  const raw = JSON.stringify([
    { id: 1, answer: 'Svar uden grounded felt' },
    { id: 2, answer: 'Svar med streng grounded', grounded: 'yes' },
  ]);
  const out = parseAnswers(raw, asked);
  assert.equal(out.length, 2);
  assert.ok(out.every((a) => a.grounded === true));
});

test('Test 9: duplicate answers for the same id — first kept, rest dropped', () => {
  const raw = JSON.stringify([
    { id: 1, answer: 'Første svar', grounded: true },
    { id: 1, answer: 'Andet svar (skal droppes)', grounded: false },
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

test('Test 10: every id unusable and one answer per fill — matched by position', () => {
  const raw = JSON.stringify([
    { id: -1, answer: 'Status er god', grounded: true },
    { id: -1, answer: 'Ikke oplyst', grounded: false },
  ]);
  const out = parseAnswers(raw, asked);
  assert.deepEqual(
    out.map((a) => [a.paragraphIndex, a.at, a.answer]),
    [
      [0, 0, 'Status er god'],
      [2, 4, 'Ikke oplyst'],
    ],
  );
});

test('Test 11: a MIXED reply is never re-ordered by position — the good answer is kept, the bad one dropped', () => {
  // One item names a real fill, so the model was using ids after all.
  // Position proves nothing here, and guessing would put an answer under the
  // wrong question in the user's document.
  const raw = JSON.stringify([
    { id: -1, answer: 'Hører ingen steder hjemme', grounded: false },
    { id: 2, answer: 'Rigtigt placeret svar', grounded: true },
  ]);
  const out = parseAnswers(raw, asked);
  assert.equal(out.length, 1);
  assert.equal(out[0].paragraphIndex, 2);
  assert.equal(out[0].answer, 'Rigtigt placeret svar');
});

test('Test 12: a wrong-length reply with unusable ids is dropped, not guessed', () => {
  const raw = JSON.stringify([{ id: -1, answer: 'Kun ét svar til to spørgsmål', grounded: false }]);
  assert.deepEqual(parseAnswers(raw, asked), []);
});

test('Test 14: an empty answer is dropped — never written as a blank line under the question', () => {
  const raw = JSON.stringify([
    { id: 1, answer: '   ', grounded: false },
    { id: 2, answer: 'Et rigtigt svar', grounded: true },
  ]);
  const out = parseAnswers(raw, asked);
  assert.equal(out.length, 1);
  assert.equal(out[0].paragraphIndex, 2);
});

test('Test 15: the positional rescue drops empty answers too', () => {
  const raw = JSON.stringify([
    { id: -1, answer: '', grounded: false },
    { id: -1, answer: 'Svar', grounded: true },
  ]);
  const out = parseAnswers(raw, asked);
  assert.equal(out.length, 1);
  assert.equal(out[0].paragraphIndex, 2);
  assert.equal(out[0].answer, 'Svar');
});

// ---- old clients ----

test('an extension without fills gets one answer per question, joined, placed where the first fill went', () => {
  const answers = parseAnswers(
    JSON.stringify([
      { id: 1, answer: 'Manden' },
      { id: 2, answer: 'Kvinden' },
      { id: 3, answer: 'Alene' },
    ]),
    [
      { id: 1, paragraphIndex: 7, questionText: 'Q', at: 12, mode: 'fill' },
      { id: 2, paragraphIndex: 7, questionText: 'Q', at: 13, mode: 'fill' },
      { id: 3, paragraphIndex: 9, questionText: 'R', at: 9, mode: 'below' },
    ],
  );
  const old = collapseForOldClients(answers);
  assert.deepEqual(
    old.map((a) => [a.paragraphIndex, a.answerAt, a.answer]),
    [
      [7, 12, 'Manden\n\nKvinden'],
      [9, undefined, 'Alene'],
    ],
  );
  // The new client's list is untouched.
  assert.equal(answers.length, 3);
  assert.equal(answers[0].answer, 'Manden');
});

// ---- validateParagraphs: the structure the extension read off Docs must reach the model ----

test('validateParagraphs keeps kind, level, bold, cell and lastLine when well-formed', () => {
  const out = validateParagraphs([
    { index: 0, text: 'Overskrift', kind: 'heading', level: 2 },
    { index: 1, text: 'Udfyld skemaet', kind: 'text', bold: true },
    { index: 2, text: '', kind: 'cell', cell: { table: 0, row: 0, col: 1 } },
    { index: 3, text: '', kind: 'numbered', level: 1 },
    { index: 4, text: 'Manden skal herske fortsæt herunder…', kind: 'cell', cell: { table: 0, row: 1, col: 0 }, lastLine: 'fortsæt herunder…' },
  ]);
  assert.deepEqual(out, [
    { index: 0, text: 'Overskrift', kind: 'heading', level: 2 },
    { index: 1, text: 'Udfyld skemaet', kind: 'text', bold: true },
    { index: 2, text: '', kind: 'cell', cell: { table: 0, row: 0, col: 1 } },
    { index: 3, text: '', kind: 'numbered', level: 1 },
    { index: 4, text: 'Manden skal herske fortsæt herunder…', kind: 'cell', cell: { table: 0, row: 1, col: 0 }, lastLine: 'fortsæt herunder…' },
  ]);
});

test('validateParagraphs drops malformed structure fields but keeps the paragraph; a malformed paragraph rejects the request', () => {
  const out = validateParagraphs([
    { index: 0, text: 'x', kind: 'sidebar', level: 'two', bold: 'yes', cell: { table: -1, row: 0, col: 0 }, lastLine: '  ', invented: 1 },
  ]);
  assert.deepEqual(out, [{ index: 0, text: 'x' }]);
  assert.equal(validateParagraphs([{ index: 'a', text: 'x' }]), null);
  assert.equal(validateParagraphs([]), null);
});

// ---- no bold, ever (the operator's rule, 2026-09-09) ----

test('stripBold: ** and __ markers go, the words stay; a lone asterisk and snake_case survive', () => {
  assert.equal(stripBold('Det er **vigtigt** og __også dette__.'), 'Det er vigtigt og også dette.');
  assert.equal(stripBold('Se note * nederst, i file_name_2.'), 'Se note * nederst, i file_name_2.');
  assert.equal(stripBold('- **Punkt et**\n- *kursiv*'), '- Punkt et\n- *kursiv*');
});

test('an answer with bold in it leaves the server without it, on both parse paths', () => {
  const one: DetectedFill[] = [{ id: 1, paragraphIndex: 0, questionText: 'Hvad?', at: 0, mode: 'below' }];
  const main = parseAnswers(JSON.stringify([{ id: 1, answer: '**Vigtigt** i dag.' }]), one);
  assert.equal(main[0].answer, 'Vigtigt i dag.');
  const positional = parseAnswers(JSON.stringify([{ id: -1, answer: '__Vigtigt__ i dag.' }]), one);
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
    { paragraphIndex: 2, questionText: '1) Hvad kendetegner manden og kvinden?', fills: [{ at: 5, mode: 'below' }] },
    { paragraphIndex: 7, questionText: '2) Hvad fortæller versene om køn?', fills: [{ at: 12, mode: 'fill' }] },
  ]);
  assert.deepEqual(
    parseDetection(raw, SHEET.length, SHEET, { from: 7, to: 7 }).map((f) => [f.paragraphIndex, f.at]),
    [[7, 12]],
  );
});
