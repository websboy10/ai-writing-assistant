import { humanScript, type HumanOptions, type Piece } from './human';
import type { FormatKey } from './types';

/**
 * Markdown → the pieces of a paced run that types it WITH its formatting.
 *
 * "Indsæt langsomt" has always typed plain characters, and "Indsæt straks" has
 * always pasted HTML: slow or formatted, never both. This is the both. It does
 * what a person does at the keyboard — press the shortcut, type, press it
 * again — and hands the engine an ordinary piece list with key presses in it.
 *
 * The subset is deliberately the one the engine can type and the answer prompt
 * is allowed to produce: paragraphs, *italic*, "- " bullets and "1. "
 * numbers, headings # to ###. Anything else is typed as its characters,
 * which is what plain mode always did with it.
 *
 * Bold is NOT in it, on the operator's rule (2026-09-09): nothing this
 * product writes is ever bold. `**` and `__` markers are dropped and the words
 * between them typed plain — a backstop, since the prompt forbids them and
 * the server strips them first.
 *
 * Three rules the output keeps, and the tests hold it to:
 *
 *   1. A slip never crosses a toggle. `humanScript` runs INSIDE each text run,
 *      so a typo and its correction happen in one formatting state and the
 *      finished text is exactly the draft, italic in the right places.
 *   2. A space next to a toggle is a `space` key, never the edge of a paste
 *      (Docs trims those — adapters/gdocs.ts). Interior spaces stay in the
 *      text, where the adapter's chunker already protects them.
 *   3. A list is entered once and left once: the first item presses the list
 *      key, following items are plain Enter (Docs continues the list), and
 *      leaving is Enter on an empty item — measured 2026-09-08, 8 of 8.
 */

export type RichPiece = Piece | { kind: 'key'; key: FormatKey };

interface Run {
  text: string;
  italic: boolean;
}

type BlockKind = 'text' | 'heading' | 'bullet' | 'numbered' | 'blank';

interface Block {
  kind: BlockKind;
  level: number;
  runs: Run[];
}

const HEADING = /^\s*(#{1,6})[ \t]+(.*?)[ \t]*#*[ \t]*$/;
const BULLET = /^\s*[-*+][ \t]+(.*)$/;
const NUMBERED = /^\s*\d+[.)][ \t]+(.*)$/;
/** The same shapes plaintext.ts and richtext.ts require, so all three agree on what is emphasis. */
const BOLD_STAR = /(\*{2})(?=\S)([\s\S]*?\S)\1/g;
const BOLD_UNDERSCORE = /(?<![\w\\])(_{2})(?=\S)([^\n]*?\S)\1(?!\w)/g;
const ITALIC = /(?<![\w*\\])\*(?=\S)([^*\n]*?\S)\*(?![\w*])/;

/** Bold markers off, words kept. Never a bold key: see the header. */
function unbold(text: string): string {
  return text.replace(BOLD_STAR, '$2').replace(BOLD_UNDERSCORE, '$2');
}

function inlineRuns(text: string): Run[] {
  const runs: Run[] = [];
  const emit = (t: string, italic: boolean) => {
    if (!t) return;
    const last = runs[runs.length - 1];
    if (last && last.italic === italic) last.text += t;
    else runs.push({ text: t, italic });
  };
  const walk = (s: string) => {
    const m = ITALIC.exec(s);
    if (!m) return emit(s, false);
    emit(s.slice(0, m.index), false);
    emit(m[1], true);
    walk(s.slice(m.index + m[0].length));
  };
  walk(unbold(text));
  return runs;
}

function parseBlocks(markdown: string): Block[] {
  const blocks: Block[] = [];
  for (const raw of markdown.replace(/\r\n?/g, '\n').split('\n')) {
    const line = raw.replace(/[ \t]+$/, '');
    if (!line.trim()) {
      blocks.push({ kind: 'blank', level: 0, runs: [] });
      continue;
    }
    let m: RegExpMatchArray | null;
    if ((m = line.match(HEADING))) blocks.push({ kind: 'heading', level: Math.min(3, m[1].length), runs: inlineRuns(m[2]) });
    else if ((m = line.match(BULLET))) blocks.push({ kind: 'bullet', level: 1, runs: inlineRuns(m[1]) });
    else if ((m = line.match(NUMBERED))) blocks.push({ kind: 'numbered', level: 1, runs: inlineRuns(m[1]) });
    else blocks.push({ kind: 'text', level: 0, runs: inlineRuns(line.trim()) });
  }
  // Trailing blank lines type nothing.
  while (blocks.length && blocks[blocks.length - 1].kind === 'blank') blocks.pop();
  return blocks;
}

export interface RichOptions extends HumanOptions {
  /** "Skriv som et menneske": slips and rewrites inside every text run. */
  human?: boolean;
  /**
   * The caret is already inside an empty list item of this kind (the
   * worksheet drew "1." under the question and placement walked into it).
   * The first list block then presses no list key — Docs is already in the
   * list — and Enter continues it. A leading newline is dropped for the same
   * reason: the caret is on the line the answer starts on.
   */
  startInList?: 'bullet' | 'numbered';
}

export function richPieces(markdown: string, opts: RichOptions = {}): RichPiece[] {
  const out: RichPiece[] = [];
  const key = (k: FormatKey) => out.push({ kind: 'key', key: k });
  const typeText = (t: string) => {
    if (!t) return;
    if (opts.human) out.push(...humanScript(t, opts));
    else out.push({ kind: 'type', text: t, intended: true });
  };

  const blocks = parseBlocks(markdown);
  // Inside an empty list item the worksheet drew, plain lines ARE the items:
  // measured 2026-09-08, asked for three cities under an empty "1.", the
  // model answered "København\nAarhus\nOdense" with no markers — and the
  // compiler, seeing prose, left the list after the first one. So up to the
  // first blank line or heading, a plain line continues the list it is in.
  // The same goes for the model's own markers: the worksheet chose the list's
  // kind, so "- Aarhus" under an empty "1." is item one of the numbered list,
  // not the start of a bullet list beside it (measured 2026-09-08).
  if (opts.startInList) {
    for (const b of blocks) {
      if (b.kind === 'blank' || b.kind === 'heading') break;
      b.kind = opts.startInList;
    }
  }
  let italic = false;
  let inList: 'bullet' | 'numbered' | null = opts.startInList ?? null;

  const setItalic = (i: boolean) => {
    if (i !== italic) {
      key('italic');
      italic = i;
    }
  };

  // One line per block, so every block after the first begins with one Enter
  // — a blank block is a line too, it just types nothing on it. That single
  // rule is what makes "a\n\nb" come out as a, an empty line, b, and a
  // leading "\n" (the orchestrator's "below the question") come out as one
  // line down and no more. Two things need one extra key on top:
  //   - leaving a list is a second Enter, on the empty item Docs just made;
  //   - after a heading Docs keeps the heading style on the new line, so
  //     `normal` steps back to body text before anything else is typed.
  blocks.forEach((block, bi) => {
    const prev = blocks[bi - 1];
    const isList = block.kind === 'bullet' || block.kind === 'numbered';

    if (bi > 0) {
      key('enter');
      if (inList && block.kind !== inList) {
        key('enter');
        inList = null;
      }
      if (prev?.kind === 'heading') key('normal');
    }
    if (block.kind === 'blank') return;

    if (block.kind === 'heading') key(block.level === 1 ? 'h1' : block.level === 2 ? 'h2' : 'h3');
    else if (isList && !inList) {
      inList = block.kind === 'bullet' ? 'bullet' : 'numbered';
      key(inList === 'bullet' ? 'bullets' : 'numbered');
    }

    block.runs.forEach((run, ri) => {
      setItalic(run.italic);
      let text = run.text;
      // A space that would sit at a paste edge beside a toggle goes through
      // the key channel instead. Only at run edges that ARE toggles: the very
      // first and last run of a block have no neighbour to lose a space to.
      const leadSpace = ri > 0 && /^ /.test(text);
      const trailSpace = ri < block.runs.length - 1 && / $/.test(text);
      if (leadSpace) {
        key('space');
        text = text.replace(/^ +/, '');
      }
      const trail = trailSpace ? (text.match(/ +$/)?.[0].length ?? 0) : 0;
      if (trail) text = text.slice(0, -trail);
      typeText(text);
      for (let n = 0; n < trail; n++) key('space');
    });
    setItalic(false);
  });

  return out;
}
