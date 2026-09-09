import assert from 'node:assert/strict';
import test from 'node:test';
import type { AutonomousParagraph } from '@awa/shared';
import { boxBelowFor, findLine, normalizeCellText, slotPlanFor } from './docs-tables.js';

/**
 * The paragraphs arrive from docs-structure.ts, which walks Docs' copy html
 * with DOMParser. Node has no DOMParser and the repo carries no DOM library,
 * so that walk is checked where it runs — against a real document, by the
 * verify scripts. What is checked HERE is everything that consumes its output:
 * cell text normalisation, the model's plan turned into keystrokes, and the
 * box-below fallback.
 */

// ---------------------------------------------------------------------------
// An empty answer cell is never literally empty in the export. This is the
// distinction the whole feature rests on: get it wrong the safe way and no
// question is ever answered; get it wrong the unsafe way and the user's own
// text is overwritten.
// ---------------------------------------------------------------------------

test('the measured 2x2 form reads back in document order, empty cells empty', () => {
  assert.deepEqual(['Hvad hedder du?', ' ', 'Hvor bor du?', ' '].map(normalizeCellText), ['Hvad hedder du?', '', 'Hvor bor du?', '']);
});

test("line breaks inside a cell collapse — Docs' export wraps every paragraph", () => {
  assert.equal(normalizeCellText('  Beskriv dine tre\n  vigtigste resultater  '), 'Beskriv dine tre vigtigste resultater');
});

test('a cell holding only &nbsp; is empty', () => {
  assert.equal(normalizeCellText(' '), '');
});

test("a cell holding only Docs' zero-width padding is empty", () => {
  assert.equal(normalizeCellText('​﻿'), '');
});

test('a cell with one real word is NOT empty, however much padding surrounds it', () => {
  assert.equal(normalizeCellText('  Ja  ​'), 'Ja');
});

test('the line Find is given is the last line of a many-line cell, else the text', () => {
  assert.equal(findLine({ index: 0, text: 'Manden skal herske fortsæt herunder…', lastLine: 'fortsæt herunder…' }), 'fortsæt herunder…');
  assert.equal(findLine({ index: 0, text: 'Navn' }), 'Navn');
});

// ---------------------------------------------------------------------------
// The worksheet shape: a question as ordinary text, a box drawn under it.
// Built exactly as docs-structure.ts emits it from Docs' copy html.
// ---------------------------------------------------------------------------

const P = (index: number, p: Omit<AutonomousParagraph, 'index'>): AutonomousParagraph => ({ index, ...p });
const cell = (index: number, text: string, table: number, row: number, col: number, extra: Partial<AutonomousParagraph> = {}) =>
  P(index, { text, kind: 'cell', cell: { table, row, col }, ...extra });

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
    anchor: 'Hvad er hovedstaden i Danmark?',
    anchorIndex: 1,
  });
});

test('a box below that the user already filled in is no box — the answer goes under the question, over nothing', () => {
  assert.deepEqual(boxBelowFor(WORKSHEET, { paragraphIndex: 3, questionText: 'Hvad er hovedstaden i Sverige?' }), { kind: 'none' });
});

test('a question followed by anything but a table has no box below', () => {
  assert.deepEqual(boxBelowFor(WORKSHEET, { paragraphIndex: 5, questionText: 'Nævn tre farver.' }), { kind: 'none' });
  assert.deepEqual(boxBelowFor(WORKSHEET, { paragraphIndex: 0, questionText: 'Opgaver' }), { kind: 'none' });
});

test('a question that is itself in a cell is never a box-below case — the plan places cells', () => {
  const inTable = [cell(0, 'Hvad hedder du?', 0, 0, 0), cell(1, '', 0, 1, 0)];
  assert.deepEqual(boxBelowFor(inTable, { paragraphIndex: 0, questionText: 'Hvad hedder du?' }), { kind: 'none' });
});

test('a wrong index is not trusted: the text decides which paragraph is the question', () => {
  assert.deepEqual(boxBelowFor(WORKSHEET, { paragraphIndex: 4, questionText: 'Hvad er hovedstaden i Danmark?' }), {
    kind: 'empty-box-below',
    anchor: 'Hvad er hovedstaden i Danmark?',
    anchorIndex: 1,
  });
});

test('the box must be the FIRST cell of the table below, not a later one', () => {
  const twoCol = [P(0, { text: 'Spørgsmål?', kind: 'text' }), cell(1, 'Navn', 0, 0, 0), cell(2, '', 0, 0, 1)];
  assert.deepEqual(boxBelowFor(twoCol, { paragraphIndex: 0, questionText: 'Spørgsmål?' }), { kind: 'none' });
});

test('a paragraph list with no cells at all yields none for everything', () => {
  const plain = [P(0, { text: 'Hvad hedder du?', kind: 'text' }), P(1, { text: 'Hvor bor du?', kind: 'text' })];
  assert.deepEqual(boxBelowFor(plain, { paragraphIndex: 0, questionText: 'Hvad hedder du?' }), { kind: 'none' });
});

test('an empty numbered item under the question is an answer slot that continues the list', () => {
  const sheet = [P(0, { text: 'Nævn tre byer.', kind: 'text' }), P(1, { text: '', kind: 'numbered', level: 1 })];
  assert.deepEqual(boxBelowFor(sheet, { paragraphIndex: 0, questionText: 'Nævn tre byer.' }), {
    kind: 'empty-list-item-below',
    list: 'numbered',
    anchor: 'Nævn tre byer.',
    anchorIndex: 0,
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
    anchor: 'Nævn gerne et konkret eksempel',
    anchorIndex: 2,
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
    anchor: 'Gerne målbare',
    anchorIndex: 1,
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
// The model's plan (a fill at `at`) → keystrokes. The operator's own form
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
  assert.deepEqual(slotPlanFor(FORM, { paragraphIndex: 0, at: 1 }), { kind: 'walk', anchor: 'Hvad betyder ligestilling?', anchorIndex: 0, into: 'table', tabs: 0 });
});

test('plan: a box below guidance is a walk from the LAST guidance line', () => {
  assert.deepEqual(slotPlanFor(FORM, { paragraphIndex: 2, at: 4 }), { kind: 'walk', anchor: 'Tænk på begge sider', anchorIndex: 3, into: 'table', tabs: 0 });
});

test('plan: the cell after a label cell is one Tab from that label', () => {
  assert.deepEqual(slotPlanFor(FORM, { paragraphIndex: 2, at: 6 }), { kind: 'tab', anchor: 'Navn', anchorIndex: 5, times: 1 });
});

test('plan: an empty numbered item under a text question is a walk into the list', () => {
  assert.deepEqual(slotPlanFor(FORM, { paragraphIndex: 7, at: 8 }), { kind: 'walk', anchor: 'Nævn tre ting', anchorIndex: 7, into: 'list', list: 'numbered' });
});

test('plan: an empty item after a filled item in the same list is one ArrowDown', () => {
  assert.deepEqual(slotPlanFor(FORM, { paragraphIndex: 7, at: 10 }), { kind: 'down', anchor: 'Husk eksempler', anchorIndex: 9, list: 'bullet' });
});

test('plan: a filled place is reported occupied, never written into', () => {
  assert.deepEqual(slotPlanFor(FORM, { paragraphIndex: 7, at: 11 }), { kind: 'occupied', text: 'Udfyldt' });
});

test('plan: a place before the question, a text line, or a cell whose table cannot be entered → none', () => {
  assert.deepEqual(slotPlanFor(FORM, { paragraphIndex: 2, at: 1 }), { kind: 'none' });
  assert.deepEqual(slotPlanFor(FORM, { paragraphIndex: 0, at: 7 }), { kind: 'none' });
  // The table holds no text before the place, and the line above it is a cell of another table.
  assert.deepEqual(slotPlanFor(FORM, { paragraphIndex: 7, at: 12 }), { kind: 'none' });
});

test('plan: an empty box between the anchor and the chosen one would catch the walk — no plan', () => {
  const twoBoxes: AutonomousParagraph[] = [
    para(0, 'Spørgsmål'),
    para(1, '', 'cell', { cell: { table: 0, row: 0, col: 0 } }),
    para(2, '', 'cell', { cell: { table: 1, row: 0, col: 0 } }),
  ];
  assert.deepEqual(slotPlanFor(twoBoxes, { paragraphIndex: 0, at: 2 }), { kind: 'none' });
  assert.equal(slotPlanFor(twoBoxes, { paragraphIndex: 0, at: 1 }).kind, 'walk');
});

test('plan: the anchor carries its paragraph index, so a repeated line can be counted by the caller', () => {
  const twice: AutonomousParagraph[] = [
    para(0, 'Kommentar'),
    para(1, '', 'cell', { cell: { table: 0, row: 0, col: 0 } }),
    para(2, 'Kommentar'),
    para(3, '', 'cell', { cell: { table: 1, row: 0, col: 0 } }),
  ];
  assert.deepEqual(slotPlanFor(twice, { paragraphIndex: 2, at: 3 }), { kind: 'walk', anchor: 'Kommentar', anchorIndex: 2, into: 'table', tabs: 0 });
});

// ---------------------------------------------------------------------------
// The operator's worksheet (2026-09-09): a grid of verses × Manden?/Kvinden?,
// and a five-column table with a header, an example row and empty rows. Any
// empty cell is reached from the last ORIGINAL text cell before it in the
// same table, by as many Tabs as cells lie between — the cells this run has
// already filled included, since Tab crosses filled cells (measured).
// ---------------------------------------------------------------------------

const GRID: AutonomousParagraph[] = [
  para(0, '2) Hvad fortæller versene om køn?', 'text'),
  cell(1, 'Bibelvers', 0, 0, 0),
  cell(2, 'Manden?', 0, 0, 1),
  cell(3, 'Kvinden?', 0, 0, 2),
  cell(4, '1. Korintherbrev 11,3', 0, 1, 0),
  cell(5, '', 0, 1, 1),
  cell(6, '', 0, 1, 2),
  cell(7, 'Efeserbrevet 5,22-24', 0, 2, 0),
  cell(8, '', 0, 2, 1),
  cell(9, '', 0, 2, 2),
  para(10, '3) Udfyld skemaet.', 'text'),
  cell(11, 'Bibelcitat', 1, 0, 0),
  cell(12, 'Mand', 1, 0, 1),
  cell(13, 'negativt', 1, 1, 0),
  cell(14, 'Manden hersker', 1, 1, 1),
  cell(15, '', 1, 2, 0),
  cell(16, '', 1, 2, 1),
  cell(17, '', 1, 3, 0),
  cell(18, '', 1, 3, 1),
];

test('plan: a grid cell is Tab ×N from the last text cell before it in the same table', () => {
  assert.deepEqual(slotPlanFor(GRID, { paragraphIndex: 0, at: 5 }), { kind: 'tab', anchor: '1. Korintherbrev 11,3', anchorIndex: 4, times: 1 });
  assert.deepEqual(slotPlanFor(GRID, { paragraphIndex: 0, at: 6 }), { kind: 'tab', anchor: '1. Korintherbrev 11,3', anchorIndex: 4, times: 2 });
  assert.deepEqual(slotPlanFor(GRID, { paragraphIndex: 0, at: 9 }), { kind: 'tab', anchor: 'Efeserbrevet 5,22-24', anchorIndex: 7, times: 2 });
});

test('plan: every empty row of a table is reached from the example row above, across the cells filled on the way', () => {
  assert.deepEqual(slotPlanFor(GRID, { paragraphIndex: 10, at: 15 }), { kind: 'tab', anchor: 'Manden hersker', anchorIndex: 14, times: 1 });
  assert.deepEqual(slotPlanFor(GRID, { paragraphIndex: 10, at: 18 }), { kind: 'tab', anchor: 'Manden hersker', anchorIndex: 14, times: 4 });
});

test('plan: a table with no text before the place is entered by the walk and tabbed from its first cell', () => {
  const empty: AutonomousParagraph[] = [
    para(0, 'Udfyld skemaet.', 'text'),
    cell(1, '', 0, 0, 0),
    cell(2, '', 0, 0, 1),
    cell(3, '', 0, 1, 0),
  ];
  assert.deepEqual(slotPlanFor(empty, { paragraphIndex: 0, at: 3 }), { kind: 'walk', anchor: 'Udfyld skemaet.', anchorIndex: 0, into: 'table', tabs: 2 });
});

test('plan: a many-line cell anchors on its last line — the one Find can match', () => {
  const sheet: AutonomousParagraph[] = [
    para(0, 'Udfyld.', 'text'),
    cell(1, 'Manden skal herske fortsæt herunder…', 0, 0, 0, { lastLine: 'fortsæt herunder…' }),
    cell(2, '', 0, 0, 1),
  ];
  assert.deepEqual(slotPlanFor(sheet, { paragraphIndex: 0, at: 2 }), { kind: 'tab', anchor: 'fortsæt herunder…', anchorIndex: 1, times: 1 });
});
