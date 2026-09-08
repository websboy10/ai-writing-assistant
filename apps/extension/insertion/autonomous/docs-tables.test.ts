import assert from 'node:assert/strict';
import test from 'node:test';
import type { AutonomousParagraph } from '@awa/shared';
import { answerCellFor, boxBelowFor, normalizeCellText, slotPlanFor } from './docs-tables.js';

/**
 * The cells arrive from docs-structure.ts, which walks Docs' copy html with
 * DOMParser. Node has no DOMParser and the repo carries no DOM library, so that
 * walk is checked where it runs — against a real document, by
 * scripts/verify-docs-structure.mjs. What is checked HERE is everything that
 * consumes its output: cell text normalisation and the two placement verdicts.
 */
// ---------------------------------------------------------------------------
// The measured document (2026-09-08): a 2x2 form, 1 table, 2 rows, 4 cells.
//
//   <table><tr><td><p>Hvad hedder du?</p></td><td><p>&nbsp;</p></td></tr>
//          <tr><td><p>Hvor bor du?</p></td><td><p>&nbsp;</p></td></tr></table>
// ---------------------------------------------------------------------------

const FORM_2X2 = ['Hvad hedder du?', '\u00A0', 'Hvor bor du?', '\u00A0'].map(normalizeCellText);

test('the measured 2x2 form reads back in document order, empty cells empty', () => {
  assert.deepEqual(FORM_2X2, ['Hvad hedder du?', '', 'Hvor bor du?', '']);
});

test('each question answers into the empty cell beside it', () => {
  const cells = FORM_2X2;
  assert.deepEqual(answerCellFor(cells, 'Hvad hedder du?'), { kind: 'empty-next-cell' });
  assert.deepEqual(answerCellFor(cells, 'Hvor bor du?'), { kind: 'empty-next-cell' });
});

// ---------------------------------------------------------------------------
// Nested markup. Docs' export never puts bare text in a cell — it is spans
// inside a paragraph, with the styling on the span:
//
//   <td><p class="c1"><span class="c0">Hvad </span><b>hedder</b><span> du?</span></p></td>
// ---------------------------------------------------------------------------

test('a cell of nested markup is one question, not three fragments', () => {
  const cells = ['Hvad hedder du?', ''];
  assert.deepEqual(cells, ['Hvad hedder du?', '']);
  assert.deepEqual(answerCellFor(cells, 'Hvad hedder du?'), { kind: 'empty-next-cell' });
});

test("line breaks inside a cell collapse — Docs' export wraps every paragraph", () => {
  assert.equal(normalizeCellText('  Beskriv dine tre\n  vigtigste resultater  '), 'Beskriv dine tre vigtigste resultater');
});

// ---------------------------------------------------------------------------
// An empty answer cell is never literally empty in the export. This is the
// distinction the whole feature rests on: get it wrong the safe way and no
// question is ever answered; get it wrong the unsafe way and the user's own
// text is overwritten.
// ---------------------------------------------------------------------------

test('a cell holding only &nbsp; is empty', () => {
  assert.equal(normalizeCellText('\u00A0'), '');
});

test("a cell holding only Docs' zero-width padding is empty", () => {
  assert.equal(normalizeCellText('\u200B\uFEFF'), '');
});

test('a cell with one real word is NOT empty, however much padding surrounds it', () => {
  assert.equal(normalizeCellText('  Ja \u00A0\u200B'), 'Ja');
});

test('an occupied answer cell refuses, and says what is standing in it', () => {
  const cells = ['Hvad hedder du?', 'Mette'];
  assert.deepEqual(answerCellFor(cells, 'Hvad hedder du?'), { kind: 'occupied-next-cell', text: 'Mette' });
});

test('a question in the last cell has nowhere to answer', () => {
  assert.deepEqual(answerCellFor(['Navn', 'Mette', 'Hvor bor du?'], 'Hvor bor du?'), { kind: 'last-cell' });
});

// ---------------------------------------------------------------------------
// A document with no tables must behave exactly as it did before this file
// existed — which means every question resolving to 'outside-table'.
// ---------------------------------------------------------------------------

test('every question in a table-less document is outside-table', () => {
  assert.deepEqual(answerCellFor([], 'Hvad hedder du?'), { kind: 'outside-table' });
});

test('a question that is in the document but not in any cell is outside-table', () => {
  const cells = ['Hvad hedder du?', ''];
  assert.deepEqual(answerCellFor(cells, 'Beskriv dit år'), { kind: 'outside-table' });
});

test('an empty question never matches the empty cells', () => {
  assert.deepEqual(answerCellFor(['Navn', ''], '   '), { kind: 'outside-table' });
});

// ---------------------------------------------------------------------------
// Two identical questions in one table must not both answer into the first
// empty cell — the same rule the Find path already follows.
// ---------------------------------------------------------------------------

test('the second ask for a repeated question resolves to the second cell', () => {
  const cells = ['Kommentar', '', 'Kommentar', ''];
  assert.deepEqual(answerCellFor(cells, 'Kommentar', 1), { kind: 'empty-next-cell' });
  assert.deepEqual(answerCellFor(cells, 'Kommentar', 2), { kind: 'empty-next-cell' });
  // Asked for a third time there is no third cell to be sure about, so the run
  // falls back to placing the answer the way it did before.
  assert.deepEqual(answerCellFor(cells, 'Kommentar', 3), { kind: 'outside-table' });
});

test('the second occurrence sees its own neighbour, not the first one', () => {
  const cells = ['Kommentar', '', 'Kommentar', 'Allerede besvaret'];
  assert.deepEqual(answerCellFor(cells, 'Kommentar', 2), {
    kind: 'occupied-next-cell',
    text: 'Allerede besvaret',
  });
});

// ---------------------------------------------------------------------------
// The worksheet shape: a question as ordinary text, a box drawn under it.
// Built exactly as docs-structure.ts emits it from Docs' copy html.
// ---------------------------------------------------------------------------

const P = (index: number, p: Omit<AutonomousParagraph, 'index'>): AutonomousParagraph => ({ index, ...p });
const cell = (index: number, text: string, table: number, row: number, col: number) =>
  P(index, { text, kind: 'cell', cell: { table, row, col } });

const WORKSHEET: AutonomousParagraph[] = [
  P(0, { text: 'Opgaver', kind: 'heading', level: 1 }),
  P(1, { text: 'Hvad er hovedstaden i Danmark?', kind: 'text' }),
  cell(2, '', 0, 0, 0),
  P(3, { text: 'Hvad er hovedstaden i Sverige?', kind: 'text' }),
  cell(4, 'Stockholm', 1, 0, 0),
  P(5, { text: 'Nævn tre farver.', kind: 'text' }),
  P(6, { text: 'Rød', kind: 'bullet', level: 1 }),
];

test('a question as plain text with an empty one-cell table under it answers into that box', () => {
  assert.deepEqual(boxBelowFor(WORKSHEET, { paragraphIndex: 1, questionText: 'Hvad er hovedstaden i Danmark?' }), {
    kind: 'empty-box-below',
  });
});

test('a box below that the user already filled in is refused, and says what is in it', () => {
  assert.deepEqual(boxBelowFor(WORKSHEET, { paragraphIndex: 3, questionText: 'Hvad er hovedstaden i Sverige?' }), {
    kind: 'occupied-box-below',
    text: 'Stockholm',
  });
});

test('a question followed by anything but a table has no box below', () => {
  assert.deepEqual(boxBelowFor(WORKSHEET, { paragraphIndex: 5, questionText: 'Nævn tre farver.' }), { kind: 'none' });
  assert.deepEqual(boxBelowFor(WORKSHEET, { paragraphIndex: 0, questionText: 'Opgaver' }), { kind: 'none' });
});

test('a question that is itself in a cell is never a box-below case — that is answerCellFor\'s job', () => {
  const inTable = [cell(0, 'Hvad hedder du?', 0, 0, 0), cell(1, '', 0, 1, 0)];
  assert.deepEqual(boxBelowFor(inTable, { paragraphIndex: 0, questionText: 'Hvad hedder du?' }), { kind: 'none' });
});

test('a wrong index is not trusted: the text decides which paragraph is the question', () => {
  assert.deepEqual(boxBelowFor(WORKSHEET, { paragraphIndex: 4, questionText: 'Hvad er hovedstaden i Danmark?' }), {
    kind: 'empty-box-below',
  });
});

test('the box must be the FIRST cell of the table below, not a later one', () => {
  const twoCol = [
    P(0, { text: 'Spørgsmål?', kind: 'text' }),
    cell(1, 'Navn', 0, 0, 0),
    cell(2, '', 0, 0, 1),
  ];
  assert.deepEqual(boxBelowFor(twoCol, { paragraphIndex: 0, questionText: 'Spørgsmål?' }), {
    kind: 'occupied-box-below',
    text: 'Navn',
  });
});

test('a paragraph list with no cells at all yields none for everything', () => {
  const plain = [P(0, { text: 'Hvad hedder du?', kind: 'text' }), P(1, { text: 'Hvor bor du?', kind: 'text' })];
  assert.deepEqual(boxBelowFor(plain, { paragraphIndex: 0, questionText: 'Hvad hedder du?' }), { kind: 'none' });
});

test('an empty numbered item under the question is an answer slot that continues the list', () => {
  const sheet = [
    P(0, { text: 'Nævn tre byer.', kind: 'text' }),
    P(1, { text: '', kind: 'numbered', level: 1 }),
  ];
  assert.deepEqual(boxBelowFor(sheet, { paragraphIndex: 0, questionText: 'Nævn tre byer.' }), {
    kind: 'empty-list-item-below',
    list: 'numbered',
  });
});

test('a FILLED list item under the question is guidance, not a slot', () => {
  const sheet = [P(0, { text: 'Nævn tre byer.', kind: 'text' }), P(1, { text: 'fx i Jylland', kind: 'bullet', level: 1 })];
  assert.deepEqual(boxBelowFor(sheet, { paragraphIndex: 0, questionText: 'Nævn tre byer.' }), { kind: 'none' });
});

test('guidance bullets between the question and its box are skipped, and the box is reached from the last hint', () => {
  const form = [
    P(0, { text: '1. Hvad er du mest stolt af i år?', kind: 'text' }),
    P(1, { text: 'Tænk på både faglige og personlige resultater', kind: 'bullet', level: 1 }),
    P(2, { text: 'Nævn gerne et konkret eksempel', kind: 'bullet', level: 1 }),
    cell(3, '', 0, 0, 0),
  ];
  assert.deepEqual(boxBelowFor(form, { paragraphIndex: 0, questionText: '1. Hvad er du mest stolt af i år?' }), {
    kind: 'empty-box-below',
    via: 'Nævn gerne et konkret eksempel',
  });
});

test('guidance bullets, then an empty numbered item: the slot is the item, reached from the last hint', () => {
  const form = [
    P(0, { text: 'Nævn tre mål:', kind: 'text' }),
    P(1, { text: 'Gerne målbare', kind: 'bullet', level: 1 }),
    P(2, { text: '', kind: 'numbered', level: 1 }),
  ];
  assert.deepEqual(boxBelowFor(form, { paragraphIndex: 0, questionText: 'Nævn tre mål:' }), {
    kind: 'empty-list-item-below',
    list: 'numbered',
    via: 'Gerne målbare',
  });
});

test('guidance bullets followed by ordinary text is not a box — the hints were the whole of it', () => {
  const form = [
    P(0, { text: 'Spørgsmål?', kind: 'text' }),
    P(1, { text: 'et hint', kind: 'bullet', level: 1 }),
    P(2, { text: 'Næste spørgsmål?', kind: 'text' }),
  ];
  assert.deepEqual(boxBelowFor(form, { paragraphIndex: 0, questionText: 'Spørgsmål?' }), { kind: 'none' });
});

// ---------------------------------------------------------------------------
// The model's plan (answerAt) → keystrokes. The operator's own form
// (2026-09-08): a question, a blank line the html cannot show, a box.
// ---------------------------------------------------------------------------

const para = (index: number, text: string, kind?: AutonomousParagraph['kind'], extra: Partial<AutonomousParagraph> = {}): AutonomousParagraph =>
  ({ index, text, ...(kind ? { kind } : {}), ...extra });

const FORM: AutonomousParagraph[] = [
  para(0, 'Hvad betyder ligestilling?'),
  para(1, '', 'cell', { cell: { table: 0, row: 0, col: 0 } }),
  para(2, 'Hvilke argumenter kommer frem?'),
  para(3, 'Tænk på begge sider', 'bullet', { level: 1 }),
  para(4, '', 'cell', { cell: { table: 1, row: 0, col: 0 } }),
  para(5, 'Navn', 'cell', { cell: { table: 2, row: 0, col: 0 } }),
  para(6, '', 'cell', { cell: { table: 2, row: 0, col: 1 } }),
  para(7, 'Nævn tre ting', 'text'),
  para(8, '', 'numbered', { level: 1 }),
  para(9, 'Husk eksempler', 'bullet', { level: 1 }),
  para(10, '', 'bullet', { level: 1 }),
  para(11, 'Udfyldt', 'cell', { cell: { table: 3, row: 0, col: 0 } }),
  para(12, '', 'cell', { cell: { table: 4, row: 0, col: 1 } }),
];

test('plan: a box below the question is a walk from the question, whatever blank lines the html hid', () => {
  assert.deepEqual(slotPlanFor(FORM, { paragraphIndex: 0, answerAt: 1 }), { kind: 'walk', anchor: 'Hvad betyder ligestilling?', occurrence: 1, into: 'table' });
});

test('plan: a box below guidance is a walk from the LAST guidance line', () => {
  assert.deepEqual(slotPlanFor(FORM, { paragraphIndex: 2, answerAt: 4 }), { kind: 'walk', anchor: 'Tænk på begge sider', occurrence: 1, into: 'table' });
});

test('plan: the cell after a label cell is one Tab from that label', () => {
  assert.deepEqual(slotPlanFor(FORM, { paragraphIndex: 2, answerAt: 6 }), { kind: 'tab', anchor: 'Navn', occurrence: 1 });
});

test('plan: an empty numbered item under a text question is a walk into the list', () => {
  assert.deepEqual(slotPlanFor(FORM, { paragraphIndex: 7, answerAt: 8 }), { kind: 'walk', anchor: 'Nævn tre ting', occurrence: 1, into: 'list', list: 'numbered' });
});

test('plan: an empty item after a filled item in the same list is one ArrowDown', () => {
  assert.deepEqual(slotPlanFor(FORM, { paragraphIndex: 7, answerAt: 10 }), { kind: 'down', anchor: 'Husk eksempler', occurrence: 1, list: 'bullet' });
});

test('plan: a filled place is reported occupied, never written into', () => {
  assert.deepEqual(slotPlanFor(FORM, { paragraphIndex: 7, answerAt: 11 }), { kind: 'occupied', text: 'Udfyldt' });
});

test('plan: no plan, a place before the question, a text line, or a cell a walk cannot enter → none', () => {
  assert.deepEqual(slotPlanFor(FORM, { paragraphIndex: 0 }), { kind: 'none' });
  assert.deepEqual(slotPlanFor(FORM, { paragraphIndex: 2, answerAt: 1 }), { kind: 'none' });
  assert.deepEqual(slotPlanFor(FORM, { paragraphIndex: 0, answerAt: 7 }), { kind: 'none' });
  // Not the first cell of its table, and the anchor before it is a cell of another table.
  assert.deepEqual(slotPlanFor(FORM, { paragraphIndex: 7, answerAt: 12 }), { kind: 'none' });
});

test('plan: an empty box between the anchor and the chosen one would catch the walk — no plan', () => {
  const twoBoxes: AutonomousParagraph[] = [
    para(0, 'Spørgsmål'),
    para(1, '', 'cell', { cell: { table: 0, row: 0, col: 0 } }),
    para(2, '', 'cell', { cell: { table: 1, row: 0, col: 0 } }),
  ];
  assert.deepEqual(slotPlanFor(twoBoxes, { paragraphIndex: 0, answerAt: 2 }), { kind: 'none' });
  assert.equal(slotPlanFor(twoBoxes, { paragraphIndex: 0, answerAt: 1 }).kind, 'walk');
});

test('plan: a repeated anchor line is found by its occurrence', () => {
  const twice: AutonomousParagraph[] = [
    para(0, 'Kommentar'),
    para(1, '', 'cell', { cell: { table: 0, row: 0, col: 0 } }),
    para(2, 'Kommentar'),
    para(3, '', 'cell', { cell: { table: 1, row: 0, col: 0 } }),
  ];
  assert.deepEqual(slotPlanFor(twice, { paragraphIndex: 2, answerAt: 3 }), { kind: 'walk', anchor: 'Kommentar', occurrence: 2, into: 'table' });
});
