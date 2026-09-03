import { MAX_CONTEXT_CHARS_PER_ITEM, type ContextItem } from '@awa/shared';
import type { OneShotRequest, OneShotResponse } from '@/utils/protocol';
import { isGoogleDocs, parseDocumentId } from '@/insertion';
import { newContextId } from './ingest';

/**
 * "Use what is on this page" as one click.
 *
 * Two different reads, because the two kinds of page are genuinely different:
 *
 *   Google Docs   Docs paints to canvas, so there is nothing on the page to
 *                 read. Docs' own text export answers with the whole document
 *                 for anyone whose browser is signed in, and the background
 *                 worker fetches it with those cookies. No Google permission
 *                 is asked for, none is needed.
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
  const res = await oneShot({ kind: 'docs-export', documentId });
  if (!res.ok) return { error: res.error ?? 'Dokumentet kunne ikke læses.' };
  const { text } = res.data as { text: string };
  const trimmed = text.replace(/\n{3,}/g, '\n\n').trim();
  if (!trimmed) return { error: 'Dokumentet er tomt — der er ingen tekst at vedhæfte.' };
  // The tab is titled "<document> - Google Docs"; the document's own name is
  // the half worth keeping.
  const title = document.title.replace(/\s*[-–]\s*Google Docs\s*$/, '').trim();
  return { item: toItem(title || 'Google Docs-dokument', trimmed) };
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
