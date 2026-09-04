/**
 * The script for "Skriv som et menneske".
 *
 * Slow mode already types at a human tempo with uneven strokes. What still
 * gives it away is that it never gets anything wrong. A person hits the key
 * next to the one they meant, notices a letter or two later, backspaces and
 * goes on; now and then they delete the last word or two, sit for a moment,
 * and type them again. An HR team asked for exactly that, so the text reads
 * as a colleague working in the document rather than a machine pasting into
 * it.
 *
 * This turns the finished answer into a list of pieces for the engine: text
 * to type (either the real text or a slip), characters to delete, and pauses.
 * Two promises the engine and the adapters rely on:
 *
 *   1. Replaying the pieces yields the answer byte for byte. Every slip is
 *      deleted in full before the real text resumes, so the document ends up
 *      exactly as the draft, and undo removes exactly what was inserted.
 *   2. Wherever the real text is cut, both sides of the cut are non-space
 *      characters. Google Docs drops a space that sits at either edge of a
 *      paste (adapters/gdocs.ts measured it), so a slip is only ever made
 *      inside a word and a rewrite always starts at the start of a word.
 *      Pauses do not cut anything: the engine attaches them to the chunk they
 *      fall in.
 *
 * Deterministic under an injected rng, which is what the tests use.
 */

export type Piece =
  | { kind: 'type'; text: string; intended: boolean }
  | { kind: 'delete'; count: number }
  | { kind: 'pause'; ms: number };

export interface HumanOptions {
  rng?: () => number;
  /** Chance, per word of four or more letters, of a slip that gets corrected. */
  typoRate?: number;
  /** Chance, per finished word, of deleting the last word or two and typing them again. */
  rewriteRate?: number;
  /** Chance, per space between words, of stopping to think. */
  pauseRate?: number;
}

const DEFAULT_RATES = { typoRate: 0.045, rewriteRate: 0.03, pauseRate: 0.06 };

/** Danish QWERTY: what a finger lands on when it misses. */
const NEIGHBOURS: Record<string, string> = {
  q: 'wa', w: 'qes', e: 'wrd', r: 'etf', t: 'ryg', y: 'tuh', u: 'yij', i: 'uok', o: 'ipl', p: 'olæ', æ: 'pø', ø: 'æ',
  a: 'qsz', s: 'awdx', d: 'sefc', f: 'drgv', g: 'fthb', h: 'gyjn', j: 'hukm', k: 'jil', l: 'koæ', å: 'pø',
  z: 'asx', x: 'zsc', c: 'xdv', v: 'cfb', b: 'vgn', n: 'bhm', m: 'njk',
};

/** Only whole words of letters get a slip: a number, a date or a URL typed wrong reads as an error, not as a person. */
const SLIP_WORD = /^[A-Za-zÆØÅæøå]{4,}$/;

/** A rewrite longer than this reads as a machine erasing, not a person changing their mind. */
const MAX_REWRITE_CHARS = 24;

export function humanScript(text: string, opts: HumanOptions = {}): Piece[] {
  const rng = opts.rng ?? Math.random;
  const typoRate = opts.typoRate ?? DEFAULT_RATES.typoRate;
  const rewriteRate = opts.rewriteRate ?? DEFAULT_RATES.rewriteRate;
  const pauseRate = opts.pauseRate ?? DEFAULT_RATES.pauseRate;
  const between = (lo: number, hi: number) => Math.round(lo + rng() * (hi - lo));

  const out: Piece[] = [];
  // The real text not yet handed to the engine. Cut only where both
  // neighbours are non-space (promise 2 above).
  let buf = '';
  const flush = () => {
    if (buf) out.push({ kind: 'type', text: buf, intended: true });
    buf = '';
  };
  // Words typed since the last line break or the last cut, so a rewrite can
  // find "the last word or two" inside buf and know it is on one line.
  let lineWords: { word: string; wsBefore: string }[] = [];
  let pendingWs = '';

  const tokens = text.match(/\s+|\S+/g) ?? [];
  for (const tok of tokens) {
    if (/\s/.test(tok)) {
      if (tok.includes('\n')) {
        lineWords = [];
        pendingWs = '';
      } else {
        pendingWs = tok;
        if (rng() < pauseRate) {
          flush();
          out.push({ kind: 'pause', ms: between(600, 1800) });
        }
      }
      buf += tok;
      continue;
    }

    // A slip inside this word, noticed a letter or two later.
    if (SLIP_WORD.test(tok) && rng() < typoRate) {
      const slip = makeSlip(tok, rng);
      if (slip) {
        buf += tok.slice(0, slip.at);
        flush();
        out.push({ kind: 'type', text: slip.typed, intended: false });
        out.push({ kind: 'pause', ms: between(180, 420) });
        out.push({ kind: 'delete', count: slip.typed.length });
        buf = tok.slice(slip.resumeAt);
        // The cut inside this word means a rewrite can no longer find the
        // whole word in buf; lineWords restarts here.
        lineWords = [];
        pendingWs = '';
        continue;
      }
    }

    buf += tok;
    lineWords.push({ word: tok, wsBefore: pendingWs });
    pendingWs = '';

    // Second thoughts: the last word or two go, then come back.
    if (rng() < rewriteRate) {
      const two = lineWords.length >= 2 && rng() < 0.5;
      const span = two
        ? lineWords[lineWords.length - 2].word + lineWords[lineWords.length - 1].wsBefore + tok
        : tok;
      if (span.length <= MAX_REWRITE_CHARS && buf.endsWith(span)) {
        flush();
        out.push({ kind: 'pause', ms: between(300, 700) });
        out.push({ kind: 'delete', count: span.length });
        out.push({ kind: 'pause', ms: between(200, 500) });
        buf = span;
      }
    }
  }
  flush();
  return out;
}

interface Slip {
  /** Where in the word the real text stops before the slip. */
  at: number;
  /** What gets typed instead: the wrong letter(s), plus a few right ones before noticing. */
  typed: string;
  /** Where in the word the real text resumes after the slip is deleted. */
  resumeAt: number;
}

function makeSlip(word: string, rng: () => number): Slip | null {
  const len = word.length;
  // Never the first letter (a person sees that one), never the last (nothing to notice it by).
  const k = 1 + Math.floor(rng() * (len - 2));
  // How many correct letters get typed before the slip is noticed.
  const extra = (from: number) => Math.min(Math.floor(rng() * 3), len - from);
  const roll = rng();
  if (roll < 0.5) {
    const wrong = neighbour(word[k], rng);
    if (wrong) {
      const more = extra(k + 1);
      return { at: k, typed: wrong + word.slice(k + 1, k + 1 + more), resumeAt: k };
    }
  }
  if (roll < 0.7 && k + 1 < len) {
    // Two letters swapped: "teh".
    const more = extra(k + 2);
    return { at: k, typed: word[k + 1] + word[k] + word.slice(k + 2, k + 2 + more), resumeAt: k };
  }
  if (roll < 0.85) {
    // A letter doubled: "lettter". The first copy is right, so it stays.
    const more = extra(k + 1);
    return { at: k + 1, typed: word[k] + word.slice(k + 1, k + 1 + more), resumeAt: k + 1 };
  }
  if (k + 1 < len) {
    // A letter skipped: "lettr".
    const more = extra(k + 2);
    return { at: k, typed: word[k + 1] + word.slice(k + 2, k + 2 + more), resumeAt: k };
  }
  return null;
}

function neighbour(ch: string, rng: () => number): string | null {
  const lower = ch.toLowerCase();
  const options = NEIGHBOURS[lower];
  if (!options) return null;
  const pick = options[Math.floor(rng() * options.length)];
  return ch === lower ? pick : pick.toUpperCase();
}
