import type { DocsParagraph, OneShotRequest, OneShotResponse } from '@/utils/protocol';

/**
 * 07-01 spike (D-16a): four probes against a REAL Google Doc, run from a
 * page reachable only at chrome-extension://<id>/spike.html — not part of
 * the sidebar UI, not linked from it. Exists to produce the evidence behind
 * 07-SPIKE.md's GO/NO-GO verdict, not to ship as a feature.
 */

const BATCH_MARKER = '⟪AWA-BATCH⟫';
const SPIKE_MARKER = '⟪AWA-SPIKE⟫';

const urlInput = document.getElementById('doc-url') as HTMLInputElement;
const runButton = document.getElementById('run') as HTMLButtonElement;
const runFullTestButton = document.getElementById('run-full-test') as HTMLButtonElement;
const copyButton = document.getElementById('copy') as HTMLButtonElement;
const reportEl = document.getElementById('report') as HTMLPreElement;

let reportLines: string[] = [];

function log(line: string): void {
  reportLines.push(line);
  reportEl.textContent = reportLines.join('\n');
  reportEl.scrollTop = reportEl.scrollHeight;
}

function oneShot(req: OneShotRequest): Promise<OneShotResponse> {
  return chrome.runtime.sendMessage(req);
}

function parseDocId(url: string): string | null {
  const m = url.match(/\/document\/d\/([a-zA-Z0-9_-]+)/);
  return m ? m[1] : null;
}

/** Longest pure-ASCII prefix — used to build a Find query guaranteed free of æ/ø/å. */
function asciiPrefix(text: string): string {
  const m = text.match(/^[\x00-\x7F]+/);
  return m ? m[0].trim() : '';
}

function hasDanishDiacritic(text: string): boolean {
  return /[æøåÆØÅ]/.test(text);
}

function firstLineOf(text: string): string {
  const idx = text.indexOf('\n');
  return (idx === -1 ? text : text.slice(0, idx)).trim();
}

function findMarkerIndex(paragraphs: DocsParagraph[], marker: string): number | null {
  for (const p of paragraphs) {
    const i = p.text.indexOf(marker);
    if (i !== -1) return p.startIndex + i;
  }
  return null;
}

function markerRange(paragraphs: DocsParagraph[], marker: string): { startIndex: number; endIndex: number } | null {
  for (const p of paragraphs) {
    const i = p.text.indexOf(marker);
    if (i !== -1) return { startIndex: p.startIndex + i, endIndex: p.startIndex + i + marker.length };
  }
  return null;
}

async function findDocsTab(documentId: string): Promise<number | null> {
  const tabs = await chrome.tabs.query({ url: '*://docs.google.com/document/*' });
  const match = tabs.find((t) => t.url?.includes(documentId));
  return (match ?? tabs[0])?.id ?? null;
}

/** P3: message the live Docs tab to Find + type, then re-read to measure placement accuracy. */
async function runP3(documentId: string, paragraph: DocsParagraph): Promise<number | null> {
  log(`Spørgsmål: "${paragraph.text.trim()}" (endIndex=${paragraph.endIndex})`);
  const tabId = await findDocsTab(documentId);
  if (!tabId) {
    log('FEJL: fandt ingen åben fane med dette dokument. Åbn dokumentet i en fane og prøv igen.');
    return null;
  }
  let probeRes: { ok: boolean; stage?: string; reason?: string } | undefined;
  try {
    probeRes = await chrome.tabs.sendMessage(tabId, { type: 'awa-docs-spike', questionText: paragraph.text });
  } catch (e) {
    log(
      `FEJL: kunne ikke sende besked til dokument-fanen (${e instanceof Error ? e.message : 'ukendt fejl'}). Genindlæs fanen (content-scriptet skal være til stede) og prøv igen.`,
    );
    return null;
  }
  if (!probeRes?.ok) {
    log(`Resultat: FEJL i trin "${probeRes?.stage ?? 'ukendt'}" — ${probeRes?.reason ?? 'intet svar fra fanen'}`);
    return null;
  }
  log(`Markøren "${SPIKE_MARKER}" indsat — genlæser dokumentet for at måle placeringen...`);
  const reread = await oneShot({ kind: 'docs-get', documentId });
  if (!reread.ok) {
    log(`FEJL ved genlæsning: ${reread.error}`);
    return null;
  }
  const { paragraphs } = reread.data as { title: string; paragraphs: DocsParagraph[] };
  const markerIndex = findMarkerIndex(paragraphs, SPIKE_MARKER);
  if (markerIndex === null) {
    log(`FEJL: markøren "${SPIKE_MARKER}" blev ikke fundet ved genlæsning.`);
    return null;
  }
  const distance = markerIndex - paragraph.endIndex;
  log(`Resultat: markør ved index ${markerIndex}, spørgsmålets endIndex ${paragraph.endIndex} — afstand ${distance} tegn`);
  return distance;
}

/** P4: prove the batchUpdate write path independently of Find/local typing, then clean up. */
async function runP4(documentId: string): Promise<void> {
  const insertRes = await oneShot({
    kind: 'docs-batch-update',
    documentId,
    requests: [{ insertText: { location: { index: 1 }, text: BATCH_MARKER } }],
  });
  if (!insertRes.ok) {
    log(`Resultat: FEJL ved indsættelse — ${insertRes.error}`);
    return;
  }
  log(`Indsat "${BATCH_MARKER}" ved index 1 via batchUpdate. Genlæser for at finde begge markører til oprydning...`);

  const reread = await oneShot({ kind: 'docs-get', documentId });
  if (!reread.ok) {
    log(`FEJL ved genlæsning før oprydning: ${reread.error}. Markørerne er IKKE fjernet — ryd op manuelt i dokumentet.`);
    return;
  }
  const { paragraphs } = reread.data as { title: string; paragraphs: DocsParagraph[] };
  const ranges = [BATCH_MARKER, SPIKE_MARKER]
    .map((marker) => markerRange(paragraphs, marker))
    .filter((r): r is { startIndex: number; endIndex: number } => r !== null)
    // Bottom-up: highest index first, so deleting one range never shifts the
    // index of the next — Google's documented batchUpdate ordering rule,
    // the same one the D-16a fallback path uses for real answers.
    .sort((a, b) => b.startIndex - a.startIndex);

  if (ranges.length === 0) {
    log('Ingen markører fundet at rydde op — intet at slette.');
    return;
  }

  const deleteRes = await oneShot({
    kind: 'docs-batch-update',
    documentId,
    requests: ranges.map((r) => ({
      deleteContentRange: { range: { startIndex: r.startIndex, endIndex: r.endIndex } },
    })),
  });
  if (!deleteRes.ok) {
    log(`Resultat: skrivning OK, men oprydning FEJLEDE — ${deleteRes.error}. Fjern markørerne manuelt i dokumentet.`);
    return;
  }
  log(`Resultat: OK — ${ranges.length} markør(er) indsat og fjernet igen. Skrivevejen (fallback) virker.`);
}

async function runSpike(docUrl: string): Promise<void> {
  const documentId = parseDocId(docUrl);
  if (!documentId) {
    log(
      "FEJL: kunne ikke finde et dokument-id i URL'en. Forventet format: https://docs.google.com/document/d/<ID>/edit",
    );
    return;
  }
  log(`Dokument-id: ${documentId}`);
  log('');

  log('=== P1 — Token (docs-auth) ===');
  const authRes = await oneShot({ kind: 'docs-auth', interactive: true });
  if (authRes.ok) {
    log('Resultat: GIVET (token modtaget, dokument-adgang inkluderet)');
  } else if (authRes.status === 403) {
    log('Resultat: DELVIST GIVET — login gennemført, men dokumentadgang blev IKKE givet (feltet var afkrydset fra)');
    log(`Baggrundsbesked: ${authRes.error}`);
  } else {
    log(`Resultat: AFVIST (status ${authRes.status})`);
    log(`Baggrundsbesked: ${authRes.error}`);
  }
  log('');

  if (!authRes.ok) {
    log('P2–P4 sprunget over: uden et token kan Docs API hverken læses eller skrives til.');
    return;
  }

  log('=== P2 — Læsning (docs-get) ===');
  const getRes = await oneShot({ kind: 'docs-get', documentId });
  if (!getRes.ok) {
    log(`Resultat: FEJL (status ${getRes.status}) — ${getRes.error}`);
    log('P3–P4 sprunget over: uden en vellykket læsning er der intet at positionere ud fra.');
    return;
  }
  const { title, paragraphs } = getRes.data as { title: string; paragraphs: DocsParagraph[] };
  log(`Resultat: OK — "${title}", ${paragraphs.length} afsnit`);
  paragraphs.slice(0, 3).forEach((p, i) => {
    log(`  [${i}] start=${p.startIndex} end=${p.endIndex} "${p.text.slice(0, 80)}"`);
  });
  log('');

  log('=== P3 — Find + skriv (rent ASCII-spørgsmål) ===');
  const asciiParagraph = paragraphs.find((p) => asciiPrefix(p.text).length >= 4);
  if (asciiParagraph) {
    await runP3(documentId, { ...asciiParagraph, text: asciiPrefix(asciiParagraph.text) });
  } else {
    log('Sprunget over — intet afsnit med et rent ASCII-forspring på mindst 4 tegn blev fundet i dette dokument.');
  }
  log('');

  log('=== P3 — Find + skriv (spørgsmål med æ/ø/å) ===');
  const diacriticParagraph = paragraphs.find((p) => hasDanishDiacritic(p.text));
  if (diacriticParagraph) {
    await runP3(documentId, { ...diacriticParagraph, text: firstLineOf(diacriticParagraph.text) });
  } else {
    log('Sprunget over — intet afsnit med æ, ø eller å blev fundet i dette dokument.');
  }
  log('');

  log('=== P4 — Skrivning via API (docs-batch-update) ===');
  await runP4(documentId);
}

interface DocsFullTestResult {
  ok: boolean;
  stage?: string;
  reason?: string;
  mechanism?: string;
  degradedReason?: string;
  detected?: number;
  placed?: number;
  unplaced?: number;
  elapsedMs?: number;
}

/**
 * 07-05 task 3: the only automatable proof available for the Docs path —
 * Playwright has no Google login, so this drives the whole
 * resolveDocsSource → read → /api/autonomous/answer → AutonomousRun pipeline
 * for real, inside the live Docs tab (via the content script's
 * `awa-docs-full-test` listener), and reports what actually happened rather
 * than what was assumed.
 */
async function runFullDocsTest(docUrl: string): Promise<void> {
  const documentId = parseDocId(docUrl);
  if (!documentId) {
    log(
      "FEJL: kunne ikke finde et dokument-id i URL'en. Forventet format: https://docs.google.com/document/d/<ID>/edit",
    );
    return;
  }
  log(`Dokument-id: ${documentId}`);
  const tabId = await findDocsTab(documentId);
  if (!tabId) {
    log('FEJL: fandt ingen åben fane med dette dokument. Åbn dokumentet i en fane og prøv igen.');
    return;
  }
  log('Kører hele autonom-tilstand-flowet (Straks, hele dokumentet) mod fanen...');
  let result: DocsFullTestResult | undefined;
  try {
    result = await chrome.tabs.sendMessage(tabId, { type: 'awa-docs-full-test' });
  } catch (e) {
    log(
      `FEJL: kunne ikke sende besked til dokument-fanen (${e instanceof Error ? e.message : 'ukendt fejl'}). Genindlæs fanen og prøv igen.`,
    );
    return;
  }
  if (!result?.ok) {
    log(`Resultat: FEJL i trin "${result?.stage ?? 'ukendt'}" — ${result?.reason ?? 'intet svar fra fanen'}`);
    return;
  }
  log(`Kilde valgt: ${result.mechanism ?? 'ukendt'}`);
  if (result.degradedReason) log(`Degraderingsårsag: ${result.degradedReason}`);
  log(`Fundet: ${result.detected ?? 0}  Placeret: ${result.placed ?? 0}  Uplaceret: ${result.unplaced ?? 0}`);
  log(`Forløbet tid: ${result.elapsedMs ?? 0} ms`);
}

runFullTestButton.addEventListener('click', () => {
  void (async () => {
    reportLines = [];
    reportEl.textContent = '';
    runFullTestButton.disabled = true;
    runFullTestButton.textContent = 'Kører...';
    try {
      log('=== Kør fuld Docs-test (07-05) ===');
      await runFullDocsTest(urlInput.value.trim());
    } catch (e) {
      log(`UVENTET FEJL: ${e instanceof Error ? e.message : String(e)}`);
    } finally {
      runFullTestButton.disabled = false;
      runFullTestButton.textContent = 'Kør fuld Docs-test';
      log('');
      log('=== Færdig ===');
    }
  })();
});

runButton.addEventListener('click', () => {
  void (async () => {
    reportLines = [];
    reportEl.textContent = '';
    runButton.disabled = true;
    runButton.textContent = 'Kører...';
    try {
      await runSpike(urlInput.value.trim());
    } catch (e) {
      log(`UVENTET FEJL: ${e instanceof Error ? e.message : String(e)}`);
    } finally {
      runButton.disabled = false;
      runButton.textContent = 'Kør spike';
      log('');
      log('=== Færdig ===');
    }
  })();
});

copyButton.addEventListener('click', () => {
  void navigator.clipboard.writeText(reportLines.join('\n')).then(
    () => {
      copyButton.textContent = 'Kopieret!';
      setTimeout(() => (copyButton.textContent = 'Kopiér rapport'), 1500);
    },
    () => {
      copyButton.textContent = 'Kunne ikke kopiere — marker teksten manuelt';
    },
  );
});
