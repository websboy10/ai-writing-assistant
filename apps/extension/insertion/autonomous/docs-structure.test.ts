import assert from 'node:assert/strict';
import test from 'node:test';
import type { AutonomousParagraph } from '@awa/shared';
import { markedRange } from './docs-structure.js';

/**
 * Where a marking sits in the whole document — the pure half of
 * docs-structure.ts. The parser itself needs a DOM and is exercised against
 * live Docs by the verify scripts.
 */
const P = (index: number, text: string, kind: AutonomousParagraph['kind'] = 'text'): AutonomousParagraph => ({ index, text, kind });
const DOC: AutonomousParagraph[] = [
  P(0, 'Opgaver til i dag', 'heading'),
  P(1, 'Hvad er hovedstaden i Danmark?'),
  P(2, '', 'cell'),
  P(3, 'Hvad hedder Danmarks længste å?'),
  P(4, '', 'cell'),
  P(5, 'Kommentar'),
  P(6, 'Kommentar'),
];

test('a marked question alone is found where it stands, so the box after it is in view', () => {
  assert.deepEqual(markedRange(DOC, [P(0, 'Hvad er hovedstaden i Danmark?')]), { from: 1, to: 1 });
});

test('a marked question with its (empty) box: the empty line says nothing about position and is skipped', () => {
  assert.deepEqual(markedRange(DOC, [P(0, 'Hvad hedder Danmarks længste å?'), P(1, '', 'cell')]), { from: 3, to: 3 });
});

test('two marked questions span their range, in order', () => {
  assert.deepEqual(markedRange(DOC, [P(0, 'Hvad er hovedstaden i Danmark?'), P(1, '', 'cell'), P(2, 'Hvad hedder Danmarks længste å?')]), { from: 1, to: 3 });
});

test('a marking that starts or ends mid-line matches the line it is part of', () => {
  assert.deepEqual(markedRange(DOC, [P(0, 'hovedstaden i Danmark?'), P(1, 'Hvad hedder Danmarks')]), { from: 1, to: 3 });
});

test('repeated lines: the first occurrence starts the range, the next occurrence continues it', () => {
  assert.deepEqual(markedRange(DOC, [P(0, 'Kommentar'), P(1, 'Kommentar')]), { from: 5, to: 6 });
});

test('a marking whose lines are not in the document, in order, is null — the caller falls back to the marked lines alone', () => {
  assert.equal(markedRange(DOC, [P(0, 'Findes ikke')]), null);
  assert.equal(markedRange(DOC, [P(0, 'Hvad hedder Danmarks længste å?'), P(1, 'Hvad er hovedstaden i Danmark?')]), null);
  assert.equal(markedRange(DOC, [P(0, '', 'cell')]), null);
  assert.equal(markedRange(DOC, []), null);
});
