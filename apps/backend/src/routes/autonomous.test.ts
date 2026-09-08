import test from 'node:test';
import assert from 'node:assert/strict';
import { validateParagraphs } from '../autonomous/parse.js';

/**
 * The request body is untrusted (T-07-08): the paragraph list arrives over the
 * wire and every item of it is checked before the model, the batcher or the
 * placement code ever sees it.
 *
 * This file used to be mostly about the `images` field — the one a caller
 * could use to hand the server something enormous or something that was not an
 * image at all. That field is gone with the Docs API (an inline image could
 * only ever be read through it), so what is left is the shape contract itself.
 */

test('a paragraph is rebuilt from index and text alone — invented fields do not ride along', () => {
  const out = validateParagraphs([{ index: 0, text: 'Hvad er status?', images: ['data:image/png;base64,iVBORw0KGgo='] }]);
  assert.equal(out?.length, 1);
  assert.deepEqual(out?.[0], { index: 0, text: 'Hvad er status?' });
});

test('an empty paragraph is valid — a blank line between two questions is normal', () => {
  const out = validateParagraphs([{ index: 0, text: '' }]);
  assert.deepEqual(out, [{ index: 0, text: '' }]);
});

test('a bad index or text rejects the whole request, rather than dropping data silently', () => {
  assert.equal(validateParagraphs([{ index: 'x', text: 'a' }]), null);
  assert.equal(validateParagraphs([{ index: 0, text: 42 }]), null);
  assert.equal(validateParagraphs([{ index: 1.5, text: 'a' }]), null);
  assert.equal(validateParagraphs([]), null);
  assert.equal(validateParagraphs('nope'), null);
});
