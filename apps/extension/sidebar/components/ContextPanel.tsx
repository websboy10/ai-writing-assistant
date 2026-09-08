import { useRef, useState } from 'react';
import { MAX_CONTEXT_ITEMS, type ParsedFile } from '@awa/shared';
import { pacedDurationText } from '@/insertion';
import { call } from '../api';
import { addFilesToContext, newContextId as newId } from '../ingest';
import { inserter } from '../inserter';
import { readPageAsContext } from '../page-context';
import { useStore } from '../store';

/**
 * Attached files as small previews: icon + name, removable via the ✕ on the
 * card's top-right corner. No panel, no toggles — the chips just sit above
 * the composer whenever something is attached (CTX-08).
 */
export function ContextChips() {
  const s = useStore();
  const fileInput = useRef<HTMLInputElement>(null);
  // Which attachment is open for reading. Attaching a file was previously an
  // act of faith: the chip said "Rapport.pdf · 12.480 tegn" and nothing could
  // show you WHICH 12.480 characters. That matters most exactly where it is
  // least visible — a screenshot or a scanned PDF goes through OCR, and a
  // misread column of figures looks identical to a correct one from outside.
  const [reading, setReading] = useState<string | null>(null);
  const open = s.context.find((c) => c.id === reading) ?? null;

  async function screenshot() {
    if (s.context.length >= MAX_CONTEXT_ITEMS) {
      s.set({ error: `Du kan vedhæfte op til ${MAX_CONTEXT_ITEMS} elementer. Fjern ét først.` });
      return;
    }
    s.set({ contextBusy: 'Tager skærmbillede…', error: null });
    try {
      const shot = await call({ kind: 'screenshot' });
      if (!shot.ok) {
        s.set({ error: shot.error ?? 'Skærmbilledet fejlede.' });
        return;
      }
      const { dataUrl } = shot.data as { dataUrl: string };
      s.set({ contextBusy: 'Læser tekst fra skærmbilledet…' });
      const base64 = dataUrl.slice(dataUrl.indexOf(',') + 1);
      const res = await call({ kind: 'upload', name: 'screenshot.png', mime: 'image/png', base64 });
      if (!res.ok) {
        s.set({ error: res.error ?? 'Der kunne ikke læses tekst fra skærmbilledet.' });
        return;
      }
      const parsed = res.data as ParsedFile;
      s.addContext({ id: newId(), ...parsed, kind: 'screenshot', name: `Skærmbillede af ${location.host}` });
    } finally {
      s.set({ contextBusy: null });
    }
  }

  async function thisPage() {
    if (s.context.length >= MAX_CONTEXT_ITEMS) {
      s.set({ error: `Du kan vedhæfte op til ${MAX_CONTEXT_ITEMS} elementer. Fjern ét først.` });
      return;
    }
    s.set({ contextBusy: 'Læser siden…', error: null });
    try {
      const { item, error, notice } = readPageAsContext();
      if (error || !item) {
        s.set({ error: error ?? 'Siden kunne ikke læses.' });
        return;
      }
      s.addContext(item);
      // Truncation is the more urgent of the two: it says the assistant is
      // working from part of the page, which changes what its answer is worth.
      if (item.truncated) {
        s.set({ notice: `Siden var lang — de første ${item.chars.toLocaleString('da-DK')} tegn er vedhæftet.` });
      } else if (notice) {
        s.set({ notice });
      }
    } finally {
      s.set({ contextBusy: null });
    }
  }

  if (open) {
    return (
      <div className="space-y-1.5 rounded-xl border border-hairline p-2.5">
        <div className="flex items-baseline gap-2">
          <p className="min-w-0 flex-1 truncate text-ui font-medium text-ink">{open.name}</p>
          <button onClick={() => setReading(null)} className="shrink-0 text-ui text-graphite hover:text-ink">
            Luk
          </button>
        </div>
        <p className="awa-note">
          <span className="awa-num">{open.chars.toLocaleString('da-DK')}</span> tegn blev hentet ud
          {open.truncated ? ' (filen var længere og blev forkortet)' : ''}. Det er præcis denne tekst, assistenten får.
        </p>
        <pre className="max-h-[180px] overflow-auto whitespace-pre-wrap break-words rounded-lg bg-wash p-2 text-aside leading-relaxed">
          {open.text}
        </pre>
        <WriteFileIn text={open.text} chars={open.chars} />
      </div>
    );
  }

  return (
    <div className="space-y-1.5">
      {s.context.length > 0 && (
        <div className="flex flex-wrap gap-2 pt-1.5">
          {s.context.map((c) => (
            <div
              key={c.id}
              // 176px, not 124: the panel is 400px wide and the composer's own
              // padding leaves 376px, so two chips plus the 8px gap and the ✕
              // badges that hang 6px off each right edge still sit on one row.
              // At 124 the cap was throwing away 100px of that row and cutting
              // "Medarbejdersamtale 2026" down to "Medarbejders…", which is the
              // half that tells two attachments apart. It now fits whole.
              className="relative flex max-w-[176px] items-center gap-1.5 rounded-lg border border-hairline bg-wash py-1.5 pl-2 pr-2.5"
            >
              <button
                onClick={() => setReading(c.id)}
                title={`${c.name} · ${c.chars.toLocaleString('da-DK')} tegn — klik for at læse hvad der blev hentet ud`}
                className="flex min-w-0 flex-1 items-center gap-1.5 text-left hover:text-ink"
              >
                <span className="text-body leading-none">{iconFor(c)}</span>
                <span className="min-w-0 flex-1 truncate text-aside leading-tight">{c.name}</span>
              </button>
              <button
                onClick={() => s.removeContext(c.id)}
                title={`Fjern ${c.name}`}
                className="absolute -right-1.5 -top-1.5 flex h-4 w-4 items-center justify-center rounded-full border border-paper bg-ink text-[10px] font-bold leading-none text-paper hover:opacity-80"
              >
                ×
              </button>
            </div>
          ))}
        </div>
      )}

      {s.contextBusy && (
        <div className="flex items-center gap-2 text-ui text-graphite">
          <span className="h-3 w-3 animate-spin rounded-full border-2 border-ink border-t-transparent" />
          {s.contextBusy}
        </div>
      )}

      <div className="flex flex-wrap items-center gap-1.5 text-ui">
        <button
          onClick={() => fileInput.current?.click()}
          className="rounded-full border border-hairline px-2.5 py-1 hover:border-ink"
          title="Vedhæft en fil — PDF, Word, tekst, Markdown eller billede"
        >
          + Fil
        </button>
        <button
          onClick={() => void thisPage()}
          className="rounded-full border border-hairline px-2.5 py-1 hover:border-ink"
          title="Vedhæft teksten fra siden eller dokumentet, du står i"
        >
          + Denne side
        </button>
        <button
          onClick={() => void screenshot()}
          className="rounded-full border border-hairline px-2.5 py-1 hover:border-ink"
          title="Tag et skærmbillede af siden og læs teksten i det"
        >
          + Skærmbillede
        </button>
      </div>

      <input
        ref={fileInput}
        type="file"
        multiple
        accept=".pdf,.docx,.txt,.md,.png,.jpg,.jpeg"
        className="hidden"
        onChange={(e) => {
          if (e.target.files?.length) void addFilesToContext(e.target.files);
          e.target.value = '';
        }}
      />
    </div>
  );
}

/**
 * Write an attachment's own text into the document — no model, no answer.
 *
 * The other route through this product asks a question and inserts the reply.
 * This one inserts the file: you attached a document because you want *it* in
 * the page you are standing in. It reuses the insertion engine untouched, so
 * the tempo slider, Pause, Stop and Fortryd all apply exactly as they do to a
 * draft, and nothing here talks to the backend — the text was extracted when
 * the file was attached, so this costs nothing and counts against no quota.
 *
 * Both honesty lines below are load-bearing rather than decorative:
 *
 *   Time   The slow path is a real commitment. A full 60.000-tegn attachment
 *          at the default 30 ord/min runs for 6 timer og 40 minutter. Nobody
 *          derives that from "ord i minuttet", and a button that starts it
 *          without saying so is a trap.
 *   Format Insertion writes text/plain. The user is visibly handing over a
 *          FORMATTED document — a Word file with headings and bold — so
 *          silence here would be read as a promise the product cannot keep.
 */
function WriteFileIn({ text, chars }: { text: string; chars: number }) {
  const canInsert = useStore((st) => st.hasInsertTarget);
  const wpm = useStore((st) => st.pacing.wpm);

  return (
    <div className="space-y-1 border-t border-hairline pt-2">
      {/* Same rule as the draft's own buttons (ChatView): nothing is disabled,
          and the button that can actually work right now wears the filled
          style. With no target chosen, pressing either one lands on a banner
          telling you to click a field first — which is a worse way to learn it
          than the title text is. */}
      <div className="flex flex-wrap gap-1.5 text-ui">
        <button
          onClick={() => inserter.start(text, 'progressive')}
          className={`rounded-full px-3 py-1 ${canInsert ? 'bg-ink text-paper hover:opacity-85' : 'border border-hairline hover:border-ink'}`}
          title={
            canInsert
              ? `Skriver hele filen ind bogstav for bogstav, ${wpm} ord i minuttet — kan sættes på pause eller stoppes når som helst`
              : 'Klik først i det felt eller dokument, teksten skal ind i'
          }
        >
          Skriv ind i dokumentet
        </button>
        <button
          onClick={() => inserter.start(text, 'instant')}
          className="rounded-full border border-hairline px-3 py-1 hover:border-ink"
          title="Sætter hele filens tekst ind på én gang"
        >
          Skriv ind straks
        </button>
      </div>
      <p className="awa-note">
        Langsomt tager <span className="awa-num">{pacedDurationText(chars, wpm)}</span> ved {wpm} ord i minuttet.
        Formatering følger ikke med — overskrifter, fed skrift og tabeller bliver til almindelig tekst.
      </p>
    </div>
  );
}

function iconFor(c: { kind: string }): string {
  switch (c.kind) {
    case 'pdf':
      return '📄';
    case 'docx':
      return '📝';
    case 'image':
    case 'screenshot':
      return '🖼️';
    case 'paste':
    case 'selection':
      return '📋';
    default:
      return '📃';
  }
}
