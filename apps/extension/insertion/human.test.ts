import { test } from 'node:test';
import assert from 'node:assert/strict';
import { humanScript, type Piece } from './human.js';

/** A small deterministic generator, so a failing case can be re-run exactly. */
function seeded(seed: number): () => number {
  let s = seed >>> 0 || 1;
  return () => {
    s ^= s << 13;
    s ^= s >>> 17;
    s ^= s << 5;
    return ((s >>> 0) % 100_000) / 100_000;
  };
}

/** What a document holds after the pieces have been typed into it. */
function replay(pieces: Piece[]): string {
  let doc = '';
  for (const p of pieces) {
    if (p.kind === 'type') doc += p.text;
    else if (p.kind === 'delete') {
      assert.ok(p.count <= doc.length, `deleting ${p.count} with only ${doc.length} typed`);
      doc = doc.slice(0, doc.length - p.count);
    }
  }
  return doc;
}

const TEXT = [
  'Medarbejderen har i år vist tydelig fremgang inden for salg og kundekontakt.',
  'Hun lukkede 14 aftaler i Q3, hvilket er 8 procent over målet.',
  '',
  'Næste periode fokuserer på produktkendskab. Vi mødes igen den 12. marts 2027.',
].join('\n');

const HIGH = { typoRate: 1, rewriteRate: 0.6, pauseRate: 0.5 };

test('the document ends up as the draft, byte for byte, whatever happened on the way', () => {
  for (let seed = 1; seed <= 60; seed++) {
    const pieces = humanScript(TEXT, { rng: seeded(seed), ...HIGH });
    assert.equal(replay(pieces), TEXT, `seed ${seed}`);
  }
});

test('with the rates at zero the script is the plain text in one piece', () => {
  const pieces = humanScript(TEXT, { rng: seeded(7), typoRate: 0, rewriteRate: 0, pauseRate: 0 });
  assert.deepEqual(pieces, [{ kind: 'type', text: TEXT, intended: true }]);
});

test('slips and rewrites actually happen', () => {
  const pieces = humanScript(TEXT, { rng: seeded(3), ...HIGH });
  assert.ok(pieces.some((p) => p.kind === 'type' && !p.intended), 'no slip was typed');
  assert.ok(pieces.some((p) => p.kind === 'delete'), 'nothing was deleted');
  assert.ok(pieces.some((p) => p.kind === 'pause'), 'no pause');
});

test('a slip is never made in a number or a date', () => {
  for (let seed = 1; seed <= 30; seed++) {
    const pieces = humanScript(TEXT, { rng: seeded(seed), typoRate: 1, rewriteRate: 0, pauseRate: 0 });
    for (const p of pieces) {
      if (p.kind === 'type' && !p.intended) assert.match(p.text, /^[A-Za-zÆØÅæøå]+$/, `slip ${JSON.stringify(p.text)}`);
    }
  }
});

test('the real text is only ever cut between two non-space characters (Docs trims edge spaces)', () => {
  // A pause does NOT cut the text: the engine attaches it to the chunk it
  // falls inside and types straight through it (planSteps in engine.ts), so
  // the merge here is what the engine actually does, not a convenience. What
  // is left after merging are the cuts a slip or a rewrite makes, and those
  // are the ones that have to fall inside a word.
  for (let seed = 1; seed <= 60; seed++) {
    const runs = mergeRunsAcrossPauses(humanScript(TEXT, { rng: seeded(seed), ...HIGH }));
    for (let i = 0; i < runs.length; i++) {
      const t = runs[i];
      if (i > 0) assert.doesNotMatch(t[0], /[ \t]/, `seed ${seed}: run ${i} starts with a space: ${JSON.stringify(t)}`);
      if (i < runs.length - 1) assert.doesNotMatch(t[t.length - 1], /\s/, `seed ${seed}: run ${i} ends with whitespace: ${JSON.stringify(t)}`);
    }
  }
});

/** The text pieces as the engine sees them: consecutive typing merged, pauses ignored. */
function mergeRunsAcrossPauses(pieces: Piece[]): string[] {
  const runs: string[] = [];
  let run = '';
  for (const p of pieces) {
    if (p.kind === 'pause') continue;
    if (p.kind === 'type' && p.intended) {
      run += p.text;
      continue;
    }
    if (run) {
      runs.push(run);
      run = '';
    }
    if (p.kind === 'type') runs.push(p.text);
  }
  if (run) runs.push(run);
  return runs;
}

test('a rewrite never crosses a line break', () => {
  for (let seed = 1; seed <= 60; seed++) {
    const pieces = humanScript(TEXT, { rng: seeded(seed), typoRate: 0, rewriteRate: 1, pauseRate: 0 });
    let doc = '';
    for (const p of pieces) {
      if (p.kind === 'type') doc += p.text;
      else if (p.kind === 'delete') {
        assert.doesNotMatch(doc.slice(doc.length - p.count), /\n/, `seed ${seed}: deleted across a line break`);
        doc = doc.slice(0, doc.length - p.count);
      }
    }
  }
});
