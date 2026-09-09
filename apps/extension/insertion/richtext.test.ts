import assert from 'node:assert/strict';
import test from 'node:test';
import { markdownToHtml } from './richtext';

// ---------------------------------------------------------------------------
// The whole point: what Docs receives must be REAL structure, not characters
// that look like structure. Measured against a live document 2026-09-08 — a
// text/html paste produced genuine <h1>, bold, <ul> and <ol> in the export.
// ---------------------------------------------------------------------------

test('a heading becomes a real heading element', () => {
  assert.match(markdownToHtml('## Medarbejdersamtale'), /<h2>Medarbejdersamtale<\/h2>/);
});

test('heading levels are kept, and clamped at six', () => {
  assert.match(markdownToHtml('# En'), /<h1>En<\/h1>/);
  assert.match(markdownToHtml('###### Seks'), /<h6>Seks<\/h6>/);
});

test('bold is never produced: the asterisks vanish and the words stay plain', () => {
  assert.equal(markdownToHtml('Der er **fed skrift** her.'), '<p>Der er fed skrift her.</p>');
  assert.equal(markdownToHtml('Der er __fed skrift__ her.'), '<p>Der er fed skrift her.</p>');
});

test('a bullet list becomes one <ul> with an item each', () => {
  const html = markdownToHtml('- Første\n- Anden');
  assert.match(html, /<ul><li>Første<\/li><li>Anden<\/li><\/ul>/);
});

test('a numbered list becomes <ol>, and the numbers are not written out', () => {
  const html = markdownToHtml('1. Første\n2. Anden');
  assert.match(html, /<ol><li>Første<\/li><li>Anden<\/li><\/ol>/);
  assert.doesNotMatch(html, /1\./);
});

test('two lists of different kinds do not merge into one', () => {
  const html = markdownToHtml('- Punkt\n\n1. Nummer');
  assert.match(html, /<ul>.*<\/ul>.*<ol>.*<\/ol>/s);
});

test('ordinary lines become paragraphs, so spacing survives', () => {
  const html = markdownToHtml('Første afsnit.\n\nAndet afsnit.');
  assert.match(html, /<p>Første afsnit\.<\/p>/);
  assert.match(html, /<p>Andet afsnit\.<\/p>/);
});

// ---------------------------------------------------------------------------
// Safety. The text being converted is model output about the user's own
// content, and it is pasted straight into their document — so anything that
// looks like markup must arrive as characters, never as markup.
// ---------------------------------------------------------------------------

test('angle brackets in the text cannot become markup', () => {
  const html = markdownToHtml('Brug <script>alert(1)</script> i teksten.');
  assert.doesNotMatch(html, /<script>/);
  assert.match(html, /&lt;script&gt;/);
});

test('an ampersand is escaped', () => {
  assert.match(markdownToHtml('Ryel & Co.'), /Ryel &amp; Co\./);
});

test('escaping happens before the markers are read, so markup cannot be smuggled in', () => {
  assert.equal(markdownToHtml('**<b>ikke fed</b>**'), '<p>&lt;b&gt;ikke fed&lt;/b&gt;</p>');
});

// ---------------------------------------------------------------------------
// Danish prose is full of characters that look like markdown. stripMarkdown is
// deliberately conservative about exactly this, and the converter must be too:
// mangling a correct sentence is worse than leaving one stray asterisk.
// ---------------------------------------------------------------------------

test('a lone asterisk used as a footnote mark is left alone', () => {
  const html = markdownToHtml('Se note * nederst.');
  assert.match(html, /Se note \* nederst\./);
});

test('snake_case survives', () => {
  assert.match(markdownToHtml('Feltet hedder file_name_2 i systemet.'), /file_name_2/);
});

test('a hyphen used as a dash does not become a list', () => {
  const html = markdownToHtml('Det er godt - og billigt.');
  assert.doesNotMatch(html, /<ul>/);
});

test('empty input produces empty output', () => {
  assert.equal(markdownToHtml(''), '');
});

test('plain prose with no markdown at all still becomes valid paragraphs', () => {
  assert.equal(markdownToHtml('Bare en sætning.'), '<p>Bare en sætning.</p>');
});

// ---------------------------------------------------------------------------
// Links. This path had no link handling at all until 2026-09-08, so a markdown
// link arrived in the document with its brackets and address showing. Web
// search is what would have hit it first, but the hole was there regardless.
// ---------------------------------------------------------------------------

test('a markdown link becomes a real hyperlink, not brackets in the document', () => {
  const html = markdownToHtml('Læs mere hos [Nationalbanken](https://nationalbanken.dk/renter).');
  assert.match(html, /<a href="https:\/\/nationalbanken\.dk\/renter">Nationalbanken<\/a>/);
  assert.doesNotMatch(html, /\[|\]/);
});

test('a link with a title attribute keeps only the address', () => {
  const html = markdownToHtml('Se [DST](https://dst.dk "Danmarks Statistik") her.');
  assert.match(html, /<a href="https:\/\/dst\.dk">DST<\/a>/);
});

test('a non-http scheme never becomes clickable', () => {
  const html = markdownToHtml('Klik [her](javascript:alert(1)) nu.');
  assert.doesNotMatch(html, /<a /);
  assert.match(html, /javascript/);
});

test('a bracket that is not a link is left alone', () => {
  assert.match(markdownToHtml('Han sagde [sic] noget.'), /\[sic\]/);
});

test('bold markers inside a link label go too, and the link survives', () => {
  const html = markdownToHtml('[**Vigtigt**](https://example.com)');
  assert.match(html, /<a href="https:\/\/example\.com">Vigtigt<\/a>/);
});
