/**
 * Markdown → the HTML that becomes REAL formatting in the document.
 *
 * The counterpart to plaintext.ts, and the reason both exist: an editor either
 * understands structure or it does not. A <textarea> can only ever hold
 * characters, so stripMarkdown() flattens for it. Google Docs and rich editors
 * accept a `text/html` paste and turn it into genuine headings, genuine bold
 * and genuine lists — measured against a live document 2026-09-08, where a
 * pasted <h1>/<b>/<ul>/<ol> came back out of Docs' own export as exactly that.
 *
 * Scope is deliberately narrow: headings, bold, bullet lists, numbered lists,
 * paragraphs. That is what carries MEANING. Italic, strikethrough, code spans
 * and horizontal rules are decoration, and every construct added here is one
 * more way something can land wrong in somebody's real document.
 *
 * Two rules this file must never break:
 *
 *   Escape first. The text is model output about the user's own material and
 *   goes straight into their document. `&`, `<` and `>` are turned into
 *   entities BEFORE any markdown is interpreted, so nothing in the content can
 *   become markup — and so `**<b>x</b>**` yields bold text reading "<b>x</b>",
 *   not nested markup.
 *
 *   Stay conservative. Danish prose is full of characters that look like
 *   markdown: `*` as a footnote mark, `_` inside identifiers, `-` as a dash.
 *   plaintext.ts refuses to touch those, and so does this — the two must agree
 *   about what counts as emphasis, or the same sentence would come out
 *   differently depending on which editor it landed in.
 */

const ESCAPES: Record<string, string> = { '&': '&amp;', '<': '&lt;', '>': '&gt;' };

function escapeHtml(s: string): string {
  return s.replace(/[&<>]/g, (c) => ESCAPES[c]);
}

/** A bullet item: `- x`, `* x` or `+ x`, with the space that keeps a dash a dash. */
const BULLET = /^\s*[-*+][ \t]+(.*)$/;
/** A numbered item: `1. x`. The number itself is dropped — <ol> supplies it. */
const NUMBERED = /^\s*\d+[.)][ \t]+(.*)$/;
const HEADING = /^\s*(#{1,6})[ \t]+(.*?)[ \t]*#*[ \t]*$/;

/**
 * Inline emphasis, on already-escaped text.
 *
 * Only bold. Both sides must hug a non-space and the run must be non-empty, so
 * a lone footnote asterisk survives; the underscore form additionally refuses
 * when a word character sits outside it, which is what keeps snake_case whole.
 * These are the same shapes plaintext.ts's stripInline() requires.
 */
function inline(escaped: string): string {
  return link(escaped)
    .replace(/(\*{2})(?=\S)([\s\S]*?\S)\1/g, '<strong>$2</strong>')
    .replace(/(?<![\w\\])(_{2})(?=\S)([^\n]*?\S)\1(?!\w)/g, '<strong>$2</strong>');
}

/**
 * `[tekst](url)` → a real hyperlink.
 *
 * Without this the brackets and the address arrived in the document verbatim,
 * because this path never touched links at all while plaintext.ts always has.
 * The two now agree: the address is kept (dropping it silently would lose
 * something the user asked for), it just stops being punctuation — plain text
 * gets `tekst (url)`, a document that can hold a link gets the link.
 *
 * Only http and https become anchors. Anything else — `javascript:` above all
 * — is left exactly as the model wrote it, as inert text: this HTML is built
 * from model output and pasted into a document the user is working in, so an
 * unrecognised scheme must never become something clickable.
 */
function link(escaped: string): string {
  return escaped.replace(/\[([^\]\n]+)\]\((\S+?)(?:\s+"[^"]*")?\)/g, (whole, label: string, url: string) => {
    if (!/^https?:\/\//i.test(url)) return whole;
    return `<a href="${url.replace(/"/g, '%22')}">${label}</a>`;
  });
}

export function markdownToHtml(text: string): string {
  if (!text) return '';

  const out: string[] = [];
  // Which kind of list is open, so consecutive items join one list and a
  // change of kind closes the old one rather than nesting them.
  let list: 'ul' | 'ol' | null = null;
  const closeList = () => {
    if (list) {
      out.push(`</${list}>`);
      list = null;
    }
  };
  const openList = (kind: 'ul' | 'ol') => {
    if (list !== kind) {
      closeList();
      out.push(`<${kind}>`);
      list = kind;
    }
  };

  for (const raw of text.split('\n')) {
    const line = raw.trimEnd();
    if (!line.trim()) {
      // A blank line ends a list. Without this, two lists separated by a gap
      // would run together into one.
      closeList();
      continue;
    }

    const heading = HEADING.exec(line);
    if (heading) {
      closeList();
      const level = heading[1].length;
      out.push(`<h${level}>${inline(escapeHtml(heading[2]))}</h${level}>`);
      continue;
    }

    const numbered = NUMBERED.exec(line);
    if (numbered) {
      openList('ol');
      out.push(`<li>${inline(escapeHtml(numbered[1]))}</li>`);
      continue;
    }

    const bullet = BULLET.exec(line);
    if (bullet) {
      openList('ul');
      out.push(`<li>${inline(escapeHtml(bullet[1]))}</li>`);
      continue;
    }

    closeList();
    out.push(`<p>${inline(escapeHtml(line.trim()))}</p>`);
  }
  closeList();

  return out.join('');
}
