import { useRef } from 'react';
import { MAX_CONTEXT_ITEMS, type ParsedFile } from '@awa/shared';
import { call } from '../api';
import { addFilesToContext, newContextId as newId } from '../ingest';
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
      const { item, error } = await readPageAsContext();
      if (error || !item) {
        s.set({ error: error ?? 'Siden kunne ikke læses.' });
        return;
      }
      s.addContext(item);
      if (item.truncated) {
        s.set({ notice: `Siden var lang — de første ${item.chars.toLocaleString('da-DK')} tegn er vedhæftet.` });
      }
    } finally {
      s.set({ contextBusy: null });
    }
  }

  return (
    <div className="space-y-1.5">
      {s.context.length > 0 && (
        <div className="flex flex-wrap gap-2 pt-1.5">
          {s.context.map((c) => (
            <div
              key={c.id}
              title={`${c.name} · ${c.chars.toLocaleString('da-DK')} tegn`}
              className="relative flex max-w-[124px] items-center gap-1.5 rounded-lg border border-hairline bg-wash py-1.5 pl-2 pr-2.5"
            >
              <span className="text-body leading-none">{iconFor(c)}</span>
              <span className="min-w-0 flex-1 truncate text-aside leading-tight">{c.name}</span>
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
