import assert from 'node:assert/strict';
import test from 'node:test';
import { stripMarkdown } from './plaintext';

// ---------------------------------------------------------------------------
// The defect this exists for. Both strings are verbatim from the production
// backend on 2026-08-25 (scripts/probe-markdown.mjs), not invented.
// ---------------------------------------------------------------------------

test('the measured production reply: **bold** never reaches the document', () => {
  const real = '1. **Salgsteknikker** – Deltag i kursus i afslutning af handler.';
  assert.equal(stripMarkdown(real), '1. Salgsteknikker – Deltag i kursus i afslutning af handler.');
});

test("the measured production reply: markdown's trailing hard break is removed", () => {
  const real = '- Øget fleksibilitet i arbejdstiden  \n- Sparer tid og penge på transport  ';
  assert.equal(stripMarkdown(real), '- Øget fleksibilitet i arbejdstiden\n- Sparer tid og penge på transport');
});

// ---------------------------------------------------------------------------
// Ordinary Danish prose must come through untouched. A wrongly-eaten character
// is worse than a stray asterisk: the user never sees the edit, and the
// sentence is simply wrong in their document.
// ---------------------------------------------------------------------------

test('plain Danish prose is returned byte-for-byte', () => {
  const prose =
    'Kvartalets resultater viser en solid fremgang. Nettooverskuddet oversteg forventningerne, ' +
    'drevet af effektiv omkostningsstyring.';
  assert.equal(stripMarkdown(prose), prose);
});

test('a lone asterisk as a footnote mark survives', () => {
  assert.equal(stripMarkdown('Prisen er 50 kr.* Se vilkår.'), 'Prisen er 50 kr.* Se vilkår.');
});

test('underscores inside words survive — snake_case is not italics', () => {
  assert.equal(stripMarkdown('Feltet hedder user_id i user_profile_v2.'), 'Feltet hedder user_id i user_profile_v2.');
});

test('a hyphen used as a dash is not treated as a bullet', () => {
  assert.equal(stripMarkdown('Vi mødtes - som aftalt - om tirsdagen.'), 'Vi mødtes - som aftalt - om tirsdagen.');
});

test('a number sign before a figure is not a heading', () => {
  assert.equal(stripMarkdown('Ordre #4021 er afsendt.'), 'Ordre #4021 er afsendt.');
});

test('unbalanced markers are left alone — mid-stream text is not mangled', () => {
  assert.equal(stripMarkdown('**Salgstekni'), '**Salgstekni');
  assert.equal(stripMarkdown('Se **her'), 'Se **her');
});

test('empty and whitespace-only input is handled', () => {
  assert.equal(stripMarkdown(''), '');
  assert.equal(stripMarkdown('\n\n'), '\n\n');
});

// ---------------------------------------------------------------------------
// The rest of the markdown surface a chat model reaches for.
// ---------------------------------------------------------------------------

test('headings lose their hashes, in both the open and closed form', () => {
  assert.equal(stripMarkdown('## Resultater'), 'Resultater');
  assert.equal(stripMarkdown('### Q3 ###'), 'Q3');
  assert.equal(stripMarkdown('#Ikkeenoverskrift'), '#Ikkeenoverskrift'); // no space → not a heading
});

test('bullets normalise to a hyphen, which reads correctly as plain text', () => {
  assert.equal(stripMarkdown('* Et punkt\n+ Et til'), '- Et punkt\n- Et til');
  assert.equal(stripMarkdown('  * Indrykket'), '  - Indrykket');
});

test('a numbered list keeps its numbers', () => {
  assert.equal(stripMarkdown('1. Først\n2. Dernæst'), '1. Først\n2. Dernæst');
});

test('emphasis of every width is removed', () => {
  assert.equal(stripMarkdown('***meget***'), 'meget');
  assert.equal(stripMarkdown('**fed**'), 'fed');
  assert.equal(stripMarkdown('*kursiv*'), 'kursiv');
  assert.equal(stripMarkdown('__fed__'), 'fed');
  assert.equal(stripMarkdown('_kursiv_'), 'kursiv');
  assert.equal(stripMarkdown('~~slettet~~'), 'slettet');
});

test('inline code loses its backticks but keeps the code', () => {
  assert.equal(stripMarkdown('Kør `pnpm test` først.'), 'Kør pnpm test først.');
});

test('a code fence is dropped and the code inside it kept', () => {
  assert.equal(stripMarkdown('```js\nconst a = 1;\n```'), 'const a = 1;');
});

test('a link keeps both its words and its address', () => {
  assert.equal(stripMarkdown('Se [vilkårene](https://x.dk/v) her.'), 'Se vilkårene (https://x.dk/v) her.');
});

test('an image cannot survive a plain-text paste, so only its alt text remains', () => {
  assert.equal(stripMarkdown('![Graf over salg](https://x.dk/g.png)'), 'Graf over salg');
});

test('a blockquote loses its marker', () => {
  assert.equal(stripMarkdown('> Citat fra rapporten'), 'Citat fra rapporten');
});

test('a horizontal rule is left intact — it is a separator, not emphasis', () => {
  assert.equal(stripMarkdown('---'), '---');
  assert.equal(stripMarkdown('***'), '***');
});

test('a realistic mixed reply comes out clean and keeps its shape', () => {
  const reply = [
    '## Medarbejderudviklingsplan',
    '',
    '1. **Salgsteknikker** – kursus i afslutning af handler  ',
    '2. **Kunderelationer** – fast opfølgning efter salg',
    '',
    '* Se `vejledningen`',
    '> Husk kvartalsmålet',
  ].join('\n');
  assert.equal(
    stripMarkdown(reply),
    [
      'Medarbejderudviklingsplan',
      '',
      '1. Salgsteknikker – kursus i afslutning af handler',
      '2. Kunderelationer – fast opfølgning efter salg',
      '',
      '- Se vejledningen',
      'Husk kvartalsmålet',
    ].join('\n'),
  );
});

test('running it twice changes nothing the second time', () => {
  const once = stripMarkdown('## Titel\n\n**fed** og *kursiv*  ');
  assert.equal(stripMarkdown(once), once);
});
