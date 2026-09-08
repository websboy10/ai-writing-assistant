/** What does a real Google Doc's editor DOM look like right now? The canvas
 *  rewrite moved these class names once already; guessing them is how a whole
 *  session got lost to a stale selector. */
import { launch, newDoc } from './docs-harness.mjs';

const ctx = await launch();
const page = ctx.pages()[0] ?? (await ctx.newPage());
try {
  const id = await newDoc(page);
  console.log(`doc: ${id}\n`);

  const info = await page.evaluate(() => {
    const candidates = [
      '.kix-page',
      '.kix-page-paginated',
      '.kix-appview-editor',
      '.kix-appview-editor-container',
      'canvas',
      '.docs-texteventtarget-iframe',
      '[contenteditable="true"]',
    ];
    const counts = Object.fromEntries(candidates.map((s) => [s, document.querySelectorAll(s).length]));

    // Anything that looks like a page/canvas surface, with its box.
    const boxes = [];
    for (const el of document.querySelectorAll('canvas, .kix-appview-editor, [class*="kix-page"]')) {
      const r = el.getBoundingClientRect();
      if (r.width > 100 && r.height > 100) {
        boxes.push({ tag: el.tagName.toLowerCase(), cls: el.className?.toString().slice(0, 90), x: Math.round(r.x), y: Math.round(r.y), w: Math.round(r.width), h: Math.round(r.height) });
      }
    }
    return { counts, boxes: boxes.slice(0, 10) };
  });

  console.log('selector counts:');
  for (const [k, v] of Object.entries(info.counts)) console.log(`  ${v.toString().padStart(3)}  ${k}`);
  console.log('\nlarge surfaces:');
  for (const b of info.boxes) console.log(`  <${b.tag} class="${b.cls}"> ${b.w}x${b.h} at ${b.x},${b.y}`);
} finally {
  await ctx.close();
}
