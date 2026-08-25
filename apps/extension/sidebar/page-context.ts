import { MAX_CONTEXT_CHARS_PER_ITEM, type ContextItem } from '@awa/shared';
import type { OneShotRequest, OneShotResponse } from '@/utils/protocol';
import { isGoogleDocs, parseDocumentId } from '@/insertion';
import { newContextId } from './ingest';

/**
 * "Use what is on this page" as one click.
 *
 * Until now the only way to give the assistant the document you were sitting
 * in was to mark the whole thing by hand and press "Brug som kontekst", or to
 * export it and drag the file back in. On Google Docs even that failed: Docs
 * paints to canvas, so selecting all and reading the mirror gives you whatever
 * fragment the hidden input frame happens to hold, not the document.
 *
 * Two different reads, because the two kinds of page are genuinely different:
 *
 *   Google Docs   the Docs REST API, via the background worker's `docs-get`
 *                 channel that autonomous mode already uses. Needs the Google
 *                 grant, and says so plainly when it does not have it rather
 *                 than attaching half a document.
 *   anything else `innerText` of the body, which is what the reader sees —
 *                 not `textContent`, which would drag in script and style
 *                 bodies and every hidden menu on the page.
 */

function oneShot(req: OneShotRequest): Promise<OneShotResponse> {
  return chrome.runtime.sendMessage(req);
}

export interface PageContextResult {
  item?: ContextItem;
  error?: string;
}

export async function readPageAsContext(): Promise<PageContextResult> {
  if (isGoogleDocs()) return readDocs();
  return readOrdinaryPage();
}

async function readDocs(): Promise<PageContextResult> {
  const documentId = parseDocumentId();
  if (!documentId) {
    return { error: 'Dette ser ud til at være Google Docs, men dokumentets id kunne ikke læses fra adressen.' };
  }
  const res = await oneShot({ kind: 'docs-get', documentId });
  if (!res.ok) {
    // The usual cause is simply that Google access has never been granted.
    // Autonomous mode asks for it on its own path; saying so here is better
    // than a bare failure the user cannot act on.
    return {
      error: `${res.error ?? 'Dokumentet kunne ikke læses.'} Prøv "Besvar alle spørgsmål" én gang for at give adgang til Google Docs.`,
    };
  }
  const { title, paragraphs } = res.data as { title: string; paragraphs: { text: string }[] };
  const text = paragraphs
    .map((p) => p.text.trim())
    .filter(Boolean)
    .join('\n');
  if (!text) return { error: 'Dokumentet er tomt — der er ingen tekst at vedhæfte.' };
  return { item: toItem(title || 'Google Docs-dokument', text) };
}

function readOrdinaryPage(): PageContextResult {
  // The sidebar is our own DOM inside the page. Attaching our own interface as
  // "the page" would be absurd, and worse, it would feed the assistant's own
  // previous drafts back to it as if they were the user's source material.
  const host = document.querySelector('awa-sidebar');
  const previous = host?.getAttribute('style') ?? null;
  host?.setAttribute('style', `${previous ?? ''};display:none`);
  const text = (document.body?.innerText ?? '').replace(/\n{3,}/g, '\n\n').trim();
  if (previous === null) host?.removeAttribute('style');
  else host?.setAttribute('style', previous);

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
