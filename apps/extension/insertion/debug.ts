/**
 * Opt-in diagnostics for the insertion path.
 *
 * The Google Docs adapter is the one part of this system that cannot verify
 * its own work — Docs paints to canvas, so there is nothing to read back
 * (see adapters/gdocs.ts). When it misbehaves on a real document, the only
 * evidence available is what the adapter itself saw at the moment it wrote.
 * Guessing from the symptom has already cost one wrong fix.
 *
 * Off unless the page's localStorage carries `awa-debug=1`, so nothing is
 * logged for real users. Turn it on from the DevTools console of the page
 * being written into:
 *
 *   localStorage.setItem('awa-debug', '1')
 */
export function debugEnabled(): boolean {
  try {
    return localStorage.getItem('awa-debug') === '1';
  } catch {
    return false; // storage can be blocked; diagnostics must never throw
  }
}

export function awaLog(event: string, data: Record<string, unknown> = {}): void {
  if (!debugEnabled()) return;
  // One line per event, prefixed, so the operator can copy the whole block.
  console.log(`[AWA] ${event}`, JSON.stringify(data));
}

/** Identifies a node well enough to tell "same node" from "Docs swapped it". */
export function describeNode(n: unknown): string {
  if (!n) return 'null';
  const el = n as Partial<Element> & { nodeName?: string };
  const tag = (el.tagName ?? el.nodeName ?? '?').toString().toLowerCase();
  const id = el.id ? `#${el.id}` : '';
  const cls = typeof el.className === 'string' && el.className ? `.${el.className.split(/\s+/).join('.')}` : '';
  const editable = (n as Partial<HTMLElement>).isContentEditable ? '[ce]' : '';
  return `${tag}${id}${cls}${editable}`;
}
