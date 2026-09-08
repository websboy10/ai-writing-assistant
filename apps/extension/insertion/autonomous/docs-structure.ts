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
 * goes, and it is the one thing the old plain-text read could not see.
 *
 * Empty paragraphs outside tables are still dropped, as the text read always
 * dropped them: a blank line between two questions is spacing, not a place.
 *
 * `DOMParser`, not a regex. The markup is real — nested spans, inline styles,
 * entities — and a pattern would read the document it was written against
 * and quietly mis-read the next one (docs-tables.ts made the same call).
 *
 * There is no unit test of this file under node:test, which has no DOM and
 * the repo carries none. It is exercised where it actually runs, against real
 * Docs output: scripts/probe-docs-html.mjs shows the input it gets, and every
 * placement in scripts/verify-formatted-answers.mjs and verify-box-below.mjs
 * depends on its output being right. The pure logic that consumes that output
 * (docs-tables.ts) is unit-tested.
 */

export interface DocsStructure {
  paragraphs: AutonomousParagraph[];
  /** Every cell in document order — the same order a person tabs through. What docs-tables.ts places by. */
  cells: string[];
}

/** Bold as Docs writes it: every text-bearing span carries font-weight 700, or a <b> that is not its wrapper. */
function isWholeBold(el: Element): boolean {
  const spans = Array.from(el.querySelectorAll('span')).filter((s) => (s.textContent ?? '').trim());
  if (!spans.length) return false;
  return spans.every((s) => /font-weight:\s*(700|bold)/i.test(s.getAttribute('style') ?? ''));
}

export function parseDocsHtml(html: string): DocsStructure {
  const paragraphs: AutonomousParagraph[] = [];
  const cells: string[] = [];
  if (!html) return { paragraphs, cells };

  const doc = new DOMParser().parseFromString(html, 'text/html');
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
        const text = normalizeCellText(child.textContent ?? '');
        if (text) push({ text, kind: 'heading', level: Number(tag[1]) });
      } else if (tag === 'P') {
        const text = normalizeCellText(child.textContent ?? '');
        if (text) push({ text, kind: 'text', ...(isWholeBold(child) ? { bold: true } : {}) });
      } else if (tag === 'UL' || tag === 'OL') {
        visitList(child, tag === 'UL' ? 'bullet' : 'numbered', 1);
      } else if (tag === 'TABLE') {
        tableIndex += 1;
        const rows = Array.from(child.querySelectorAll('tr'));
        rows.forEach((tr, row) => {
          Array.from(tr.children)
            .filter((c) => c.tagName === 'TD' || c.tagName === 'TH')
            .forEach((td, col) => {
              const text = normalizeCellText(td.textContent ?? '');
              cells.push(text);
              push({ text, kind: 'cell', cell: { table: tableIndex, row, col } });
            });
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
  return { paragraphs, cells };
}
