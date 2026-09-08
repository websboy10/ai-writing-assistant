/**
 * What a Google Doc actually holds, cell by cell and list by list — read
 * through Docs' export with the harness profile's cookies, and shown as a
 * screenshot of the page too.
 *
 * Run: node scripts/readback-doc.mjs <docId> [boldWord]
 */
import { resolve } from 'node:path';
import { launch, shotsDir } from './docs-harness.mjs';

const docId = process.argv[2];
if (!docId) throw new Error('usage: node scripts/readback-doc.mjs <docId> [boldWord]');
// The bold word whose right edge is checked for a real space (the demo's was 'lagerstyringssystem').
const WORD = process.argv[3] ?? 'lagerstyringssystem';

const ENTITIES = { oslash: 'ø', Oslash: 'Ø', aring: 'å', Aring: 'Å', aelig: 'æ', AElig: 'Æ', amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ' };
const decode = (t) => t.replace(/&#(\d+);/g, (_m, n) => String.fromCharCode(Number(n))).replace(/&([a-zA-Z]+);/g, (m, n) => ENTITIES[n] ?? m);
const strip = (t) => decode(t.replace(/<[^>]+>/g, '')).replace(/ /g, ' ').replace(/\s+/g, ' ').trim();

const ctx = await launch({ headless: true });
try {
  const res = await ctx.request.get(`https://docs.google.com/document/d/${docId}/export?format=html`, { timeout: 20_000 });
  if (!res.ok()) throw new Error(`export HTTP ${res.status()}`);
  const html = await res.text();
  const body = html.slice(html.indexOf('<body'));
  const boldClasses = [...html.matchAll(/\.(c\d+)\{[^}]*font-weight:\s*(?:700|bold)/g)].map((m) => m[1]);
  const isBold = (cls) => cls.split(/\s+/).some((c) => boldClasses.includes(c));

  // Walk blocks in order, rendering bold as **…** so it is visible in a terminal.
  const blocks = [...body.matchAll(/<(h[1-6]|p|li|td|ol|ul)\b([^>]*)>/gi)];
  console.log('');
  let listKind = '';
  for (const m of blocks) {
    const tag = m[1].toLowerCase();
    if (tag === 'ol' || tag === 'ul') {
      listKind = tag;
      continue;
    }
    const close = body.indexOf(`</${tag}>`, m.index);
    m[3] = body.slice(m.index + m[0].length, close);
    const inner = m[3].replace(/<span class="([^"]*)"[^>]*>([\s\S]*?)<\/span>/gi, (_s, cls, t) => (isBold(cls) && strip(t) ? `**${strip(t)}**` : strip(t)));
    const text = strip(inner.replace(/\*\*/g, '')).replace(//g, '**');
    if (tag === 'td' && !text) {
      console.log('  [td]  (tom)');
      continue;
    }
    if (!text) continue;
    const label = tag === 'li' ? (listKind === 'ol' ? ' 1. ' : ' • ') : tag === 'td' ? '[td] ' : tag.startsWith('h') ? `${tag.toUpperCase()} ` : '    ';
    console.log(`  ${label}${text}`);
  }

  const zw = (body.match(/[\u200B\uFEFF]|&#8203;|&#65279;/g) ?? []).length;
  const q5 = html.indexOf(WORD);
  console.log(`\n  zero-width characters in the document: ${zw}`);
  console.log(`  raw around the bold word: ${html.slice(q5 - 120, q5 + 160).replace(/\s+/g, ' ')}`);

  const page = await ctx.newPage();
  await page.goto(`https://docs.google.com/document/d/${docId}/edit`, { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(4000);
  await page.screenshot({ path: resolve(shotsDir, 'demo-result.png'), fullPage: false });
  // The copy flavour is what the product reads and what a paste elsewhere
  // carries; the export may write a plain space as &nbsp; at a span edge.
  const copy = await page.evaluate(() => {
    const iframe = document.querySelector('iframe.docs-texteventtarget-iframe');
    const d = iframe?.contentDocument;
    if (!d) return '';
    const el = d.querySelector('[contenteditable="true"], [contenteditable=""]') ?? d.body;
    iframe.contentWindow?.focus();
    const mac = navigator.platform.toLowerCase().includes('mac');
    el.dispatchEvent(new KeyboardEvent('keydown', { key: 'a', code: 'KeyA', keyCode: 65, which: 65, bubbles: true, cancelable: true, ...(mac ? { metaKey: true } : { ctrlKey: true }) }));
    const dt = new DataTransfer();
    dt.setData('text/plain', '');
    el.dispatchEvent(new ClipboardEvent('copy', { clipboardData: dt, bubbles: true, cancelable: true }));
    const t = dt.getData('text/plain');
    el.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight', code: 'ArrowRight', keyCode: 39, which: 39, bubbles: true, cancelable: true }));
    return t;
  });
  const nbsp = (copy.match(/\u00a0/g) ?? []).length;
  const at = copy.indexOf(WORD);
  console.log(`  copy flavour: ${nbsp} non-breaking spaces in the whole document; after the bold word: ${JSON.stringify(copy.slice(at + WORD.length, at + WORD.length + 5))}`);
  console.log(`\n  screenshot: test-results/demo-result.png`);
} finally {
  await ctx.close();
}
