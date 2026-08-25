import test from 'node:test';
import assert from 'node:assert/strict';
import { validateParagraphs } from './autonomous.js';

/**
 * The request body is untrusted (T-07-08), and `images` is the field a caller
 * could use to hand the server something enormous, something that is not an
 * image, or a `javascript:` URL wearing an image's name. Every case below is a
 * thing a malformed or hostile client can actually send.
 *
 * The rule throughout: a bad image is dropped, never fatal. One unreadable
 * picture must not 400 a document whose other twenty tasks are fine.
 */

const png = (payload = 'iVBORw0KGgo=') => `data:image/png;base64,${payload}`;

test('a plain paragraph still validates, with no images key invented', () => {
  const out = validateParagraphs([{ index: 0, text: 'Hvad er status?' }]);
  assert.equal(out?.length, 1);
  assert.equal(out?.[0].text, 'Hvad er status?');
  assert.equal('images' in out![0], false);
});

test('a paragraph with no text but a picture is valid — that is the whole feature', () => {
  const out = validateParagraphs([{ index: 0, text: '', images: [png()] }]);
  assert.equal(out?.length, 1);
  assert.equal(out?.[0].images?.length, 1);
});

test('non-image data URLs are dropped, the paragraph survives', () => {
  const out = validateParagraphs([
    { index: 0, text: 'Opgave', images: ['data:text/html;base64,PHNjcmlwdD4=', 'javascript:alert(1)', png()] },
  ]);
  assert.equal(out?.[0].images?.length, 1);
  assert.equal(out?.[0].images?.[0], png());
});

test('a data URL whose payload is not base64 is dropped', () => {
  const out = validateParagraphs([{ index: 0, text: '', images: ['data:image/png;base64,not base64!!'] }]);
  assert.equal(out?.[0].images, undefined);
});

test('an oversized image is dropped rather than forwarded to the vision model', () => {
  const huge = png('A'.repeat(2_900_000));
  const out = validateParagraphs([{ index: 0, text: 'Opgave', images: [huge, png()] }]);
  assert.equal(out?.[0].images?.length, 1);
  assert.equal(out?.[0].images?.[0], png());
});

test('the image budget is per request, not per paragraph', () => {
  // One paragraph holding twenty pictures must not starve the rest of the doc.
  const paragraphs = Array.from({ length: 20 }, (_, i) => ({ index: i, text: '', images: [png()] }));
  const out = validateParagraphs(paragraphs);
  const total = out!.reduce((n, p) => n + (p.images?.length ?? 0), 0);
  assert.equal(total, 12);
  assert.equal(out?.length, 20); // every paragraph still present
});

test('a non-array images field is ignored, not a rejection', () => {
  const out = validateParagraphs([{ index: 0, text: 'Opgave', images: 'nope' }]);
  assert.equal(out?.length, 1);
  assert.equal(out?.[0].images, undefined);
});

test('the existing contract is unchanged: a bad index or text still rejects the whole request', () => {
  assert.equal(validateParagraphs([{ index: 'x', text: 'a' }]), null);
  assert.equal(validateParagraphs([{ index: 0, text: 42 }]), null);
  assert.equal(validateParagraphs([]), null);
  assert.equal(validateParagraphs('nope'), null);
});
