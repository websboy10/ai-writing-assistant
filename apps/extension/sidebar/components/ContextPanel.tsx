import { useRef, useState } from 'react';
import { MAX_CONTEXT_ITEMS, type ParsedFile } from '@awa/shared';
import { call } from '../api';
import { addFilesToContext, newContextId as newId } from '../ingest';
import { useStore } from '../store';

export function ContextPanel() {
  const s = useStore();
  const fileInput = useRef<HTMLInputElement>(null);
  const [pasteOpen, setPasteOpen] = useState(false);
  const [pasteText, setPasteText] = useState('');
  const [dragOver, setDragOver] = useState(false);

  function guardCount(): boolean {
    if (s.context.length >= MAX_CONTEXT_ITEMS) {
      s.set({ error: `Du kan vedhæfte op til ${MAX_CONTEXT_ITEMS} elementer. Fjern ét først.` });
      return false;
    }
    return true;
  }

  async function addFiles(files: FileList | File[]) {
    await addFilesToContext(files);
  }

  async function screenshot() {
    if (!guardCount()) return;
    s.set({ contextBusy: 'Tager skærmbillede…', error: null });
    try {
      const shot = await call({ kind: 'screenshot' });
      if (!shot.ok) {
        s.set({ error: shot.error ?? 'Skærmbilledet fejlede.' });
        return;
      }
      const { dataUrl } = shot.data as { dataUrl: string };
      s.set({ contextBusy: 'Læser tekst fra skærmbilledet (OCR)…' });
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

  function addPaste() {
    if (!pasteText.trim() || !guardCount()) return;
    s.addContext({
      id: newId(),
      name: `Indsat tekst (${pasteText.length.toLocaleString()} tegn)`,
      kind: 'paste',
      text: pasteText,
      chars: pasteText.length,
      truncated: false,
    });
    setPasteText('');
    setPasteOpen(false);
  }

  return (
    <div
      onDragOver={(e) => {
        e.preventDefault();
        setDragOver(true);
      }}
      onDragLeave={() => setDragOver(false)}
      onDrop={(e) => {
        e.preventDefault();
        setDragOver(false);
        if (e.dataTransfer.files.length) void addFiles(e.dataTransfer.files);
      }}
      className={`space-y-2 px-3 pb-3 ${dragOver ? 'outline-2 outline-dashed outline-ink' : ''}`}
    >
      {/* attached items (CTX-08) */}
      {s.context.map((c) => (
        <div key={c.id} className="flex items-center gap-2 rounded-xl bg-wash px-2.5 py-1.5 text-[12.5px]">
          <span className="text-[14px]">{iconFor(c)}</span>
          <span className="min-w-0 flex-1 truncate" title={c.name}>
            {c.name}
          </span>
          <span className="text-graphite">{c.chars.toLocaleString()} tegn</span>
          <button onClick={() => s.removeContext(c.id)} className="font-bold text-graphite hover:text-ink" title="Fjern">
            ×
          </button>
        </div>
      ))}

      {s.contextBusy && (
        <div className="flex items-center gap-2 text-[12px] text-graphite">
          <span className="h-3 w-3 animate-spin rounded-full border-2 border-ink border-t-transparent" />
          {s.contextBusy}
        </div>
      )}

      <div className="flex flex-wrap gap-1.5 text-[12px]">
        <button onClick={() => fileInput.current?.click()} className="rounded-full border border-hairline px-2.5 py-1 hover:border-ink">
          + Fil
        </button>
        <button onClick={() => void screenshot()} className="rounded-full border border-hairline px-2.5 py-1 hover:border-ink">
          + Skærmbillede
        </button>
        <button onClick={() => setPasteOpen((v) => !v)} className="rounded-full border border-hairline px-2.5 py-1 hover:border-ink">
          + Indsæt tekst
        </button>
        <span className="self-center text-[11px] text-graphite">eller træk filer hertil</span>
      </div>

      {pasteOpen && (
        <div className="space-y-1.5">
          <textarea
            value={pasteText}
            onChange={(e) => setPasteText(e.target.value)}
            rows={4}
            placeholder="Indsæt tekst som kontekst…"
            className="w-full rounded-xl border border-hairline bg-paper px-2.5 py-1.5 text-[12.5px] outline-none placeholder:text-graphite focus:border-ink"
          />
          <button onClick={addPaste} disabled={!pasteText.trim()} className="rounded-full bg-ink px-3 py-1 text-[12px] text-paper hover:opacity-85 disabled:opacity-40">
            Vedhæft
          </button>
        </div>
      )}

      <input
        ref={fileInput}
        type="file"
        multiple
        accept=".pdf,.docx,.txt,.md,.png,.jpg,.jpeg"
        className="hidden"
        onChange={(e) => {
          if (e.target.files?.length) void addFiles(e.target.files);
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
      return '📋';
    default:
      return '📃';
  }
}
