/**
 * Markdown → the plain text that actually reaches the document.
 *
 * Every insertion path writes `text/plain`: Google Docs takes a synthetic
 * paste, a contenteditable takes an insertText command, a <textarea> takes a
 * value splice. None of them interpret markdown. So when the model writes
 *
 *     1. **Salgsteknikker** – Deltag i kursus…
 *
 * the user's document gets the asterisks, literally. Measured against the
 * production backend 2026-08-25: two of three ordinary Danish prompts
 * ("skriv en medarbejderudviklingsplan", "opsummer i punktform") came back
 * with markdown in them. This is the product's core promise — the text lands
 * correctly in the editor you are already in — failing silently, with no error
 * anywhere, on the most ordinary requests there are.
 *
 * The prompt now forbids markdown (apps/backend/src/prompt.ts), which is the
 * real fix. This is the guarantee behind it: a prompt is a request, a function
 * is a promise, and the failure mode is the user's own document.
 *
 * Deliberately CONSERVATIVE. Danish prose is full of characters that look like
 * markdown — `_` inside identifiers, `*` as a footnote mark, `#` before a
 * number — and mangling a correct sentence is worse than leaving one stray
 * asterisk. Every rule below requires the full, balanced, non-empty shape.
 *
 * What it deliberately does NOT do: bullets stay bullets (`- ` reads correctly
 * in a document and is what a person would type), numbered lists stay
 * numbered, and horizontal rules are left alone.
 */

/** A markdown horizontal rule — three or more of the same mark, alone on a line. */
const HR = /^\s*([-*_])(?:\s*\1){2,}\s*$/;

/** ```lang … ``` fence delimiters. The code between them is kept. */
const FENCE = /^\s*(?:```|~~~)/;

export function stripMarkdown(text: string): string {
  if (!text) return text;
  // Fast path: the overwhelming majority of replies have no markdown at all,
  // and this runs on every streamed flush of a growing string.
  if (!/[*_`#>~[\]]|[ \t]$/m.test(text)) return text;

  const out: string[] = [];
  for (const raw of text.split('\n')) {
    let line = raw;

    if (FENCE.test(line)) continue; // drop the fence, keep the code inside it

    if (HR.test(line)) {
      out.push(line.trimEnd());
      continue; // a rule is not emphasis — never let the inline pass eat it
    }

    // ## Overskrift → Overskrift  (and the closed form: ## Overskrift ##)
    line = line.replace(/^(\s*)#{1,6}[ \t]+(.*?)[ \t]*#*[ \t]*$/, '$1$2');
    // > citat → citat
    line = line.replace(/^(\s*)>[ \t]?/, '$1');
    // * punkt / + punkt → - punkt. A hyphen is what a person types, and Docs
    // turns it into a real bullet on its own.
    line = line.replace(/^(\s*)[*+][ \t]+/, '$1- ');

    line = stripInline(line);

    // Markdown's hard line break is two trailing spaces. In a document that is
    // just invisible cruft at the end of every line.
    out.push(line.replace(/[ \t]+$/, ''));
  }
  return out.join('\n');
}

function stripInline(line: string): string {
  let s = line;
  // ![alt](url) → alt   — an image cannot survive a plain-text paste at all.
  s = s.replace(/!\[([^\]]*)\]\([^)\s]*(?:\s+"[^"]*")?\)/g, '$1');
  // [tekst](url) → tekst (url). The address is information the user asked for;
  // dropping it silently would lose it. Bare or self-linking URLs stay once.
  s = s.replace(/\[([^\]]+)\]\((\S*?)(?:\s+"[^"]*")?\)/g, (_m, label: string, url: string) =>
    !url || url === label ? label : `${label} (${url})`,
  );
  // `kode` → kode
  s = s.replace(/`+([^`\n]+?)`+/g, '$1');
  // ***x*** / **x** / *x*  and  ___x___ / __x__ / _x_  and  ~~x~~
  //
  // Both sides must hug a non-space, so a lone `*` used as a footnote mark and
  // a `-` used as a dash both survive. The underscore forms additionally
  // refuse to fire when a word character sits outside the marker, which is
  // what keeps snake_case and file_name_2 intact.
  s = s.replace(/(\*{1,3})(?=\S)([\s\S]*?\S)\1/g, '$2');
  s = s.replace(/(?<![\w\\])(_{1,3})(?=\S)([^\n]*?\S)\1(?!\w)/g, '$2');
  s = s.replace(/~~(?=\S)([\s\S]*?\S)~~/g, '$1');
  return s;
}
