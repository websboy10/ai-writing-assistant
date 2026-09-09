import { test } from 'node:test';
import assert from 'node:assert/strict';
import { richPieces, type RichPiece } from './richsteps.js';
import { InsertionSession } from './engine.js';
import type { FormatKey, InsertionAdapter, InsertResult, InsertionState } from './types.js';

type WindowLike = { setTimeout: typeof setTimeout; clearTimeout: typeof clearTimeout };
(globalThis as unknown as { window?: WindowLike }).window ??= {
  setTimeout: setTimeout.bind(globalThis),
  clearTimeout: clearTimeout.bind(globalThis),
};

/**
 * A model of what Docs does with the keys, precise enough to replay a run
 * into the document it produces. The point is the same as human.test.ts's
 * byte-for-byte replay: not "the right keys were pressed", but "the document
 * ends up exactly as the markdown says", slips and all.
 *
 *   - text is appended to the current line, wrapped in the current marks
 *   - enter ends the line; inside a list it starts a new item
 *   - enter on an EMPTY item leaves the list (Docs' own behaviour, measured)
 *   - a block key sets the current line's kind; `normal` resets it
 *   - a toggle flips a mark; Backspace removes the last character
 */
type Char = { c: string; i: boolean };

class DocModel {
  lines: { kind: string; text: Char[] }[] = [{ kind: 'p', text: [] }];
  italic = false;
  private inList: 'ul' | 'ol' | null = null;

  private cur() {
    return this.lines[this.lines.length - 1];
  }
  type(t: string) {
    for (const c of t) this.cur().text.push({ c, i: this.italic });
  }
  press(key: FormatKey) {
    switch (key) {
      case 'italic':
        this.italic = !this.italic;
        return;
      case 'space':
        return this.type(' ');
      case 'enter': {
        if (this.inList && this.cur().text.length === 0) {
          this.cur().kind = 'p';
          this.inList = null;
          return;
        }
        this.lines.push({ kind: this.inList ?? 'p', text: [] });
        return;
      }
      case 'bullets':
        this.inList = 'ul';
        this.cur().kind = 'ul';
        return;
      case 'numbered':
        this.inList = 'ol';
        this.cur().kind = 'ol';
        return;
      case 'normal':
        this.cur().kind = 'p';
        return;
      default:
        this.cur().kind = key; // h1 h2 h3
    }
  }
  backspace(n: number) {
    for (let i = 0; i < n; i++) this.cur().text.pop();
  }
  /** Runs of one mark state are wrapped once, the way Docs' own html reads. */
  render(): string {
    return this.lines
      .map((l) => {
        let out = '';
        let it = false;
        for (const ch of l.text) {
          if (ch.i !== it) {
            out += ch.i ? '<i>' : '</i>';
            it = ch.i;
          }
          out += ch.c;
        }
        if (it) out += '</i>';
        return `${l.kind}:${out}`;
      })
      .join('\n');
  }
}

class DocsLikeAdapter implements InsertionAdapter {
  readonly kind = 'gdocs' as const;
  readonly echoesAsync = true;
  readonly doc = new DocModel();
  prepare(): InsertResult {
    return { ok: true, verified: false };
  }
  insert(chunk: string): InsertResult {
    this.doc.type(chunk);
    return { ok: true, verified: false };
  }
  pressKey(key: FormatKey): InsertResult {
    this.doc.press(key);
    return { ok: true, verified: false };
  }
  deleteBack(count: number): InsertResult {
    this.doc.backspace(count);
    return { ok: true, verified: false };
  }
  undoAll(): InsertResult {
    return { ok: true, verified: false };
  }
  eventTarget(): EventTarget | null {
    return null;
  }
  // Docs' own edge rule, so a chunk never begins or ends with a space.
  chunkText(text: string): string[] {
    const out: string[] = [];
    let cur = '';
    for (let i = 0; i < text.length; i++) {
      cur += text[i];
      if (cur.length >= 2 && text[i] !== ' ' && text[i + 1] !== ' ') {
        out.push(cur);
        cur = '';
      }
    }
    if (cur) out.push(cur);
    return out;
  }
}

function seeded(seed: number): () => number {
  let s = seed;
  return () => {
    s = (s * 1664525 + 1013904223) % 4294967296;
    return s / 4294967296;
  };
}

function replay(markdown: string, opts: { human?: boolean; seed?: number } = {}): Promise<string> {
  const adapter = new DocsLikeAdapter();
  return new Promise((resolve) => {
    const session = new InsertionSession(
      adapter,
      markdown, // the plain text only feeds progress here
      { wpm: 20_000, human: !!opts.human },
      {
        onState: (s: InsertionState) => {
          if (s === 'done') resolve(adapter.doc.render());
          if (s === 'error') resolve(`ERROR`);
        },
        onProgress: () => {},
      },
      { markdown, rng: seeded(opts.seed ?? 7), pauseScale: 0 },
    );
    session.start();
  });
}

const keys = (md: string) => richPieces(md).filter((p): p is Extract<RichPiece, { kind: 'key' }> => p.kind === 'key').map((p) => p.key);

// ---------------------------------------------------------------------------
// The keys, as a person would press them.
// ---------------------------------------------------------------------------

test('bold is never pressed: the markers vanish and the words are typed plain, in one run', () => {
  assert.deepEqual(keys('Det er **vigtigt** her.'), []);
  assert.deepEqual(keys('Det er __vigtigt__ her.'), []);
  const typed = richPieces('Det er **vigtigt** her.')
    .filter((p): p is Extract<RichPiece, { kind: 'type' }> => p.kind === 'type')
    .map((p) => p.text);
  assert.deepEqual(typed, ['Det er vigtigt her.']);
});

test('italic is Cmd+I before the word and Cmd+I after it — and the spaces beside it go through the key channel', () => {
  assert.deepEqual(keys('Det er *vigtigt* her.'), ['space', 'italic', 'italic', 'space']);
});

test('a bullet list is entered once, continued with Enter, and left with an extra Enter', () => {
  assert.deepEqual(keys('- et\n- to\nslut'), ['bullets', 'enter', 'enter', 'enter']);
});

test('a list that ends the answer is never left — nothing follows it', () => {
  assert.deepEqual(keys('Se her:\n- et\n- to'), ['enter', 'bullets', 'enter']);
});

test('a heading steps back to normal text on the next line', () => {
  assert.deepEqual(keys('# Titel\nTekst'), ['h1', 'enter', 'normal']);
});

test('plain paragraphs press nothing but Enter', () => {
  assert.deepEqual(keys('Første.\n\nAndet.'), ['enter', 'enter']);
});

test('the leading newline the run uses for "below the question" is exactly one Enter', () => {
  assert.deepEqual(keys('\nSvaret.'), ['enter']);
});

// ---------------------------------------------------------------------------
// The document, replayed. This is the check that matters.
// ---------------------------------------------------------------------------

test('a bold request lands as plain words with the spaces around them intact; italic lands on exactly the right word', async () => {
  assert.equal(await replay('Normal tekst med **fede ord** og *kursiv*.'), 'p:Normal tekst med fede ord og <i>kursiv</i>.');
});

test('a numbered list of three, then a closing line', async () => {
  assert.equal(
    await replay('1. Mål et\n2. Mål to\n3. Mål tre\nDet var alle.'),
    'ol:Mål et\nol:Mål to\nol:Mål tre\np:Det var alle.',
  );
});

test('a blank line between paragraphs is one empty line, not two', async () => {
  assert.equal(await replay('Første afsnit.\n\nAndet afsnit.'), 'p:Første afsnit.\np:\np:Andet afsnit.');
});

test('a list followed by a blank line and a paragraph', async () => {
  assert.equal(await replay('- et\n- to\n\nBagefter.'), 'ul:et\nul:to\np:\np:Bagefter.');
});

test('a heading, a paragraph, a bullet list', async () => {
  assert.equal(await replay('## Del 1\nIntro.\n- a\n- b'), 'h2:Del 1\np:Intro.\nul:a\nul:b');
});

test('with "Skriv som et menneske" on, the finished document is still exactly the draft — slips never cross a toggle', async () => {
  const md = 'Vi har **arbejdet** rigtig meget med *kvaliteten* i år.\n- Første resultat\n- Andet resultat';
  const want = 'p:Vi har arbejdet rigtig meget med <i>kvaliteten</i> i år.\nul:Første resultat\nul:Andet resultat';
  for (let seed = 1; seed <= 25; seed++) {
    assert.equal(await replay(md, { human: true, seed }), want, `seed ${seed}`);
  }
});

test('an adapter without pressKey gets the plain text, formatting flattened by the caller', () => {
  // richPieces is only consulted when the adapter can press keys; the engine
  // falls back to the plain path otherwise. Covered by engine.test.ts's plain
  // adapters; here the compiler is simply shown to be pure.
  const a = richPieces('**x**');
  const b = richPieces('**x**');
  assert.deepEqual(a, b);
});

test('a lone asterisk and snake_case are not emphasis — the same shapes plaintext.ts refuses', () => {
  assert.deepEqual(keys('Se note * nederst, i file_name_2.'), []);
});

// ---------------------------------------------------------------------------
// The caret already stands in an empty list item the worksheet drew.
// ---------------------------------------------------------------------------

test('starting inside an empty numbered item: no list key, Enter continues the list, nothing is left', () => {
  const ks = richPieces('1. København\n2. Aarhus\n3. Odense', { startInList: 'numbered' })
    .filter((p): p is Extract<RichPiece, { kind: 'key' }> => p.kind === 'key')
    .map((p) => p.key);
  assert.deepEqual(ks, ['enter', 'enter']);
});

test('starting inside an empty bullet item, a plain line straight after the items continues the list', () => {
  // The worksheet drew the list; without a blank line, the model's next line
  // is one more item. Leaving the list needs the blank line (tested below).
  const ks = richPieces('- et\n- to\nOg så videre.', { startInList: 'bullet' })
    .filter((p): p is Extract<RichPiece, { kind: 'key' }> => p.kind === 'key')
    .map((p) => p.key);
  assert.deepEqual(ks, ['enter', 'enter']);
});

test('inside an empty numbered item, PLAIN lines from the model are the items — the list is not left after the first', () => {
  const ks = richPieces('København\nAarhus\nOdense', { startInList: 'numbered' })
    .filter((p): p is Extract<RichPiece, { kind: 'key' }> => p.kind === 'key')
    .map((p) => p.key);
  assert.deepEqual(ks, ['enter', 'enter']);
});

test('inside an empty item, a blank line ends the list and prose after it is prose', () => {
  const ks = richPieces('et\nto\n\nOg så prosa.', { startInList: 'bullet' })
    .filter((p): p is Extract<RichPiece, { kind: 'key' }> => p.kind === 'key')
    .map((p) => p.key);
  // et | Enter | to | Enter (blank: new empty item) + Enter (leave list) | Enter | prose
  assert.deepEqual(ks, ['enter', 'enter', 'enter', 'enter']);
});

test("inside an empty numbered item, the model's own bullet markers do not start a second list", () => {
  const ks = richPieces('- Aarhus\n- Odense\n- Aalborg', { startInList: 'numbered' })
    .filter((p): p is Extract<RichPiece, { kind: 'key' }> => p.kind === 'key')
    .map((p) => p.key);
  assert.deepEqual(ks, ['enter', 'enter']);
});
