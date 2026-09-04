import { MAX_CONTEXT_CHARS_PER_ITEM, type ContextItem } from '@awa/shared';
import { gdocsWholeDocumentText, isGoogleDocs } from '@/insertion';
import { newContextId } from './ingest';

/**
 * "Use what is on this page" as one click.
 *
 * Two different reads, because the two kinds of page are genuinely different:
 *
 *   Google Docs   Docs paints to canvas, so there is nothing on the page to
 *                 read. It is asked for its own text the way a person asks:
 *                 select all, copy. No Google account, no permission, no
 *                 network call — see gdocsWholeDocumentText.
 *   anything else `innerText` of the body, which is what the reader sees —
 *                 not `textContent`, which would drag in script and style
 *                 bodies and every hidden menu on the page.
 */

export interface PageContextResult {
  item?: ContextItem;
  error?: string;
  /** Something that went fine but the user still has to know about. */
  notice?: string;
}

export function readPageAsContext(): PageContextResult {
  if (isGoogleDocs()) return readDocs();
  return readOrdinaryPage();
}

function readDocs(): PageContextResult {
  const text = gdocsWholeDocumentText().replace(/\n{3,}/g, '\n\n').trim();
  if (!text) {
    // Never "the document is empty": we cannot tell an empty document from a
    // read that failed, and guessing wrong attaches nothing while claiming
    // there was nothing to attach.
    return {
      error:
        'Teksten i dokumentet kunne ikke læses. Klik ind i dokumentet, så markøren står i det, og prøv igen — eller markér teksten selv og brug Brug som kontekst.',
    };
  }
  // The tab is titled "<document> - Google Docs"; the document's own name is
  // the half worth keeping.
  const title = document.title.replace(/\s*[-–]\s*Google Docs\s*$/, '').trim();
  return {
    item: toItem(title || 'Google Docs-dokument', text),
    // Reading the document means selecting it, and a selection has to be
    // collapsed somewhere. Saying so beats letting the user find out when
    // their next insertion lands at the bottom of the page.
    notice:
      'Dokumentet er vedhæftet. Markøren står nu sidst i dokumentet — klik der, hvor teksten skal ind, før du indsætter.',
  };
}

function readOrdinaryPage(): PageContextResult {
  // The panel cannot contaminate this, and it took a measurement to be sure of
  // it rather than a reading of the spec. Probed in a real browser 2026-08-25:
  // `awa-sidebar` is mounted as a child of <html>, not <body>, and its contents
  // live in a shadow root that `innerText` does not descend into — so the panel
  // appears nowhere in the result. An earlier version of this hid the host
  // around the read, which bought nothing and cost two forced reflows and a
  // visible flicker on a long page.
  //
  // `innerText` and not `textContent`: the latter drags in <script> and <style>
  // bodies and every collapsed menu on the page, none of which the reader sees.
  const text = (document.body?.innerText ?? '').replace(/\n{3,}/g, '\n\n').trim();
  if (!text) return { error: 'Der er ingen læsbar tekst på denne side.' };
  return { item: toItem(document.title || location.host, text) };
}

function toItem(name: string, raw: string): ContextItem {
  const truncated = raw.length > MAX_CONTEXT_CHARS_PER_ITEM;
  const text = truncated ? raw.slice(0, MAX_CONTEXT_CHARS_PER_ITEM) : raw;
  return {
    id: newContextId(),
    name: name.length > 60 ? `${name.slice(0, 57)}…` : name,
    kind: 'text',
    text,
    chars: text.length,
    truncated,
  };
}
