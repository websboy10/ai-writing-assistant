import assert from 'node:assert/strict';
import test from 'node:test';
import {
  answerCellFor,
  documentIdFromPath,
  normalizeCellText,
  tableCellsFrom,
  type CellHost,
} from './docs-tables.js';

/**
 * These tests stop one line short of `tableCellsFromHtml`, and the reason is
 * worth writing down: Node has no `DOMParser` (checked on node v26.3.1 — the
 * global does not exist), and the only ways to get one are a new devDependency
 * or a hand-rolled HTML parser, both of which cost more than they prove.
 *
 * So the seam is `tableCellsFrom`, which takes whatever `querySelectorAll`
 * returns. Each host below is written from the HTML quoted above it, with the
 * cells holding exactly what a browser's `textContent` yields for that markup:
 * nested elements flattened to their text, `&nbsp;` decoded to U+00A0. The
 * remaining untested line is `new DOMParser().parseFromString(html,
 * 'text/html')` and the `td, th` selector — those need the live check.
 */
function host(...cellTexts: (string | null)[]): CellHost {
  return { querySelectorAll: () => cellTexts.map((textContent) => ({ textContent })) };
}

// ---------------------------------------------------------------------------
// The measured document (2026-09-08): a 2x2 form, 1 table, 2 rows, 4 cells.
//
//   <table><tr><td><p>Hvad hedder du?</p></td><td><p>&nbsp;</p></td></tr>
//          <tr><td><p>Hvor bor du?</p></td><td><p>&nbsp;</p></td></tr></table>
// ---------------------------------------------------------------------------

const FORM_2X2 = host('Hvad hedder du?', '\u00A0', 'Hvor bor du?', '\u00A0');

test('the measured 2x2 form reads back in document order, empty cells empty', () => {
  assert.deepEqual(tableCellsFrom(FORM_2X2), ['Hvad hedder du?', '', 'Hvor bor du?', '']);
});

test('each question answers into the empty cell beside it', () => {
  const cells = tableCellsFrom(FORM_2X2);
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
  const cells = tableCellsFrom(host('Hvad hedder du?', ''));
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
  const cells = tableCellsFrom(host('Hvad hedder du?', 'Mette'));
  assert.deepEqual(answerCellFor(cells, 'Hvad hedder du?'), { kind: 'occupied-next-cell', text: 'Mette' });
});

test('a question in the last cell has nowhere to answer', () => {
  assert.deepEqual(answerCellFor(['Navn', 'Mette', 'Hvor bor du?'], 'Hvor bor du?'), { kind: 'last-cell' });
});

// ---------------------------------------------------------------------------
// A document with no tables must behave exactly as it did before this file
// existed — which means every question resolving to 'outside-table'.
// ---------------------------------------------------------------------------

test('a document with no tables yields no cells', () => {
  assert.deepEqual(tableCellsFrom(host()), []);
});

test('every question in a table-less document is outside-table', () => {
  assert.deepEqual(answerCellFor([], 'Hvad hedder du?'), { kind: 'outside-table' });
});

test('a question that is in the document but not in any cell is outside-table', () => {
  const cells = tableCellsFrom(host('Hvad hedder du?', ''));
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
// Which document to export.
// ---------------------------------------------------------------------------

test('the document id comes out of the Docs URL', () => {
  assert.equal(documentIdFromPath('/document/d/1AbC-dEf_23/edit'), '1AbC-dEf_23');
  assert.equal(documentIdFromPath('/document/d/1AbC-dEf_23'), '1AbC-dEf_23');
});

test('a page that is not a document has no id, so nothing is exported', () => {
  assert.equal(documentIdFromPath('/spreadsheets/d/1AbC/edit'), null);
  assert.equal(documentIdFromPath('/'), null);
});
