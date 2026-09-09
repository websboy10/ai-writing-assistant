import type { AutonomousParagraph } from '@awa/shared';
import { normalizeCellText } from './docs-tables';

/**
 * Docs' copy html → the document's structure, as the model and the placement
 * logic need it.
 *
 * Walks the markup in document order and emits one paragraph per block:
 * headings, ordinary paragraphs, list items (bullet or numbered, with depth),
 * and every table cell — INCLUDING the empty ones. An empty cell is the single
 * most important thing in a questionnaire, because it is where the answer
 * goes, and it is the one thing the old plain-text read could not see. A cell
 * of several lines is one paragraph whose `lastLine` is kept, so an answer
 * can be put under the cell's text with Find, which sees one line at a time.
 *
 * Empty paragraphs outside tables are still dropped, as the text read always
 * dropped them: a blank line between two questions is spacing, not a place.
 *
 * `DOMParser`, not a regex. The markup is real — nested spans, inline styles,
 * entities — and a pattern would read the document it was written against
 * and quietly mis-read the next one (docs-tables.ts made the same call).
 *
 * There is no unit test of the parser under node:test, which has no DOM and
 * the repo carries none. It is exercised where it actually runs, against real
 * Docs output: scripts/probe-docs-html.mjs shows the input it gets, and every
 * placement in scripts/verify-formatted-answers.mjs and verify-box-below.mjs
 * depends on its output being right. The pure logic that consumes that output
 * (docs-tables.ts, and markedRange below) is unit-tested.
 */

/** Bold as Docs writes it: every text-bearing span carries font-weight 700, or a <b> that is not its wrapper. */
function isWholeBold(el: Element): boolean {
  const spans = Array.from(el.querySelectorAll('span')).filter((s) => (s.textContent ?? '').trim());
  if (!spans.length) return false;
  return spans.every((s) => /font-weight:\s*(700|bold)/i.test(s.getAttribute('style') ?? ''));
}

const BLOCK_SELECTOR = 'p, li, h1, h2, h3, h4, h5, h6';

/**
 * The lines of a block, as Docs draws them. Reading a block's textContent
 * glued its lines together: the operator's worksheet (2026-09-09) read
 * "Manden skal herskefortsæt herunder…" for a cell of two lines, and Find,
 * which sees one line at a time, then found nothing. Docs writes a soft line
 * break (Shift+Enter) as <br> inside the paragraph; parseDocsHtml turns every
 * <br> into a newline first, so both a second <p> and a <br> are a line here.
 */
function linesOf(el: Element): string[] {
  return (el.textContent ?? '').split('\n').map(normalizeCellText).filter(Boolean);
}

/** A cell's lines: those of every block inside it, or of the cell itself when Docs wrapped nothing. */
function cellLines(td: Element): string[] {
  const blocks = Array.from(td.querySelectorAll(BLOCK_SELECTOR));
  return (blocks.length ? blocks : [td]).flatMap(linesOf);
}

/** One paragraph from its lines: the text joined, and the last line kept when there are several — the line Find is given to write below it. */
function fromLines(lines: string[], p: Omit<AutonomousParagraph, 'index' | 'text' | 'lastLine'>): Omit<AutonomousParagraph, 'index'> {
  return { text: lines.join(' '), ...p, ...(lines.length > 1 ? { lastLine: lines[lines.length - 1] } : {}) };
}

export function parseDocsHtml(html: string): AutonomousParagraph[] {
  const paragraphs: AutonomousParagraph[] = [];
  if (!html) return paragraphs;

  const doc = new DOMParser().parseFromString(html, 'text/html');
  doc.querySelectorAll('br').forEach((br) => br.replaceWith('\n'));
  let tableIndex = -1;

  const push = (p: Omit<AutonomousParagraph, 'index'>) => {
    paragraphs.push({ index: paragraphs.length, ...p });
  };

  const visitList = (list: Element, kind: 'bullet' | 'numbered', level: number) => {
    for (const li of Array.from(list.children)) {
      if (li.tagName !== 'LI') continue;
      // The item's own text, without any nested list's text folded into it.
      const own = Array.from(li.childNodes)
        .filter((n) => !(n instanceof Element && /^(UL|OL)$/.test(n.tagName)))
        .map((n) => n.textContent ?? '')
        .join('');
      const text = normalizeCellText(own);
      // An EMPTY item is kept, like an empty cell: a worksheet that draws
      // "1." under a question is saying "answer as a numbered list here",
      // and the model can only match that shape if it can see it. Measured
      // 2026-09-08: with empty items dropped, "nævn tre byer" above an empty
      // numbered list came back as bullets.
      push({ text, kind, level });
      for (const nested of Array.from(li.children)) {
        if (nested.tagName === 'UL') visitList(nested, 'bullet', level + 1);
        else if (nested.tagName === 'OL') visitList(nested, 'numbered', level + 1);
      }
    }
  };

  const visit = (node: Element) => {
    for (const child of Array.from(node.children)) {
      const tag = child.tagName;
      if (/^H[1-6]$/.test(tag)) {
        const lines = linesOf(child);
        if (lines.length) push(fromLines(lines, { kind: 'heading', level: Number(tag[1]) }));
      } else if (tag === 'P') {
        const lines = linesOf(child);
        if (lines.length) push(fromLines(lines, { kind: 'text', ...(isWholeBold(child) ? { bold: true } : {}) }));
      } else if (tag === 'UL' || tag === 'OL') {
        visitList(child, tag === 'UL' ? 'bullet' : 'numbered', 1);
      } else if (tag === 'TABLE') {
        tableIndex += 1;
        const rows = Array.from(child.querySelectorAll('tr'));
        rows.forEach((tr, row) => {
          Array.from(tr.children)
            .filter((c) => c.tagName === 'TD' || c.tagName === 'TH')
            .forEach((td, col) => push(fromLines(cellLines(td), { kind: 'cell', cell: { table: tableIndex, row, col } })));
        });
      } else {
        // Docs wraps the whole clip in a <b style="font-weight:normal"> — and
        // may nest further wrappers. Anything unrecognised is walked through,
        // so structure inside it is still seen.
        visit(child);
      }
    }
  };

  visit(doc.body);
  return paragraphs;
}

const collapse = (s: string) => s.replace(/\s+/g, ' ').trim();

/** A marked line is a whole paragraph, or the start or end of one when the marking begins or ends mid-line. */
function coversLine(paragraph: string, line: string): boolean {
  return paragraph === line || (line.length >= 2 && paragraph.includes(line));
}

/**
 * Where the user's marking sits in the whole document, as a range of
 * paragraph indices (both ends inclusive), or null when it cannot be told.
 *
 * "Besvar markeringen" used to send the model the marked lines alone, and a
 * question marked without its box was answered on the line beneath it: the
 * box was never in view (the operator, 2026-09-09). Now the whole document is
 * read exactly as "Besvar alle" reads it, and the marking is found in it by
 * its lines: the first marked line is matched to its first occurrence, then
 * every following marked line to the next paragraph that carries it, in
 * order. Empty marked lines (a marked empty box) say nothing about position
 * and are skipped; a line that cannot be matched in order means the read and
 * the marking disagree, and the caller falls back to the marked lines alone.
 */
export function markedRange(
  all: AutonomousParagraph[],
  marked: AutonomousParagraph[],
): { from: number; to: number } | null {
  const lines = marked.map((p) => collapse(p.text)).filter(Boolean);
  if (!lines.length) return null;
  const texts = all.map((p) => collapse(p.text));
  const from = texts.findIndex((t) => coversLine(t, lines[0]));
  if (from < 0) return null;
  let to = from;
  for (const line of lines.slice(1)) {
    let j = to + 1;
    while (j < texts.length && !coversLine(texts[j], line)) j++;
    if (j >= texts.length) return null;
    to = j;
  }
  return { from, to };
}
