import { useRef, useState } from 'react';
import {
  ACCEPTED_FILE_TYPES,
  MAX_CONTEXT_ITEMS,
  MAX_FILE_BYTES,
  type ContextItem,
  type ParsedFile,
} from '@awa/shared';
import { call, fileToBase64 } from '../api';
import { useStore } from '../store';

let ctxId = 0;
const newId = () => `ctx${Date.now()}-${ctxId++}`;

export function ContextPanel() {
  const s = useStore();
  const fileInput = useRef<HTMLInputElement>(null);
  const [pasteOpen, setPasteOpen] = useState(false);
  const [pasteText, setPasteText] = useState('');
  const [dragOver, setDragOver] = useState(false);

  function guardCount(): boolean {
    if (s.context.length >= MAX_CONTEXT_ITEMS) {
      s.set({ error: `You can attach up to ${MAX_CONTEXT_ITEMS} items. Remove one first.` });
      return false;
    }
    return true;
  }

  async function addFiles(files: FileList | File[]) {
    for (const file of Array.from(files)) {
      if (!guardCount()) return;
      // Client-side pre-checks give instant, specific feedback (CTX-10);
      // the server re-validates everything regardless.
      if (file.size > MAX_FILE_BYTES) {
        s.set({ error: `"${file.name}" is ${(file.size / 1024 / 1024).toFixed(1)} MB — the limit is ${MAX_FILE_BYTES / 1024 / 1024} MB.` });
        continue;
      }
      const known =
        file.type in ACCEPTED_FILE_TYPES || /\.(pdf|docx|txt|md|png|jpe?g)$/i.test(file.name);
      if (!known) {
        s.set({ error: `"${file.name}" (${file.type || 'unknown type'}) isn't supported. Use PDF, DOCX, TXT, Markdown, PNG or JPG.` });
        continue;
      }
      s.set({ contextBusy: `Processing ${file.name}…`, error: null });
      try {
        const base64 = await fileToBase64(file);
        const res = await call({ kind: 'upload', name: file.name, mime: file.type || 'application/octet-stream', base64 });
        if (!res.ok) {
          s.set({ error: res.error ?? `Processing "${file.name}" failed.` });
          continue;
        }
        const parsed = res.data as ParsedFile;
        const item: ContextItem = { id: newId(), ...parsed };
        s.addContext(item);
        if (parsed.truncated) {
          s.set({ notice: `"${file.name}" was long — the first ${parsed.chars.toLocaleString()} characters are attached.` });
        }
      } finally {
        s.set({ contextBusy: null });
      }
    }
  }

  async function screenshot() {
    if (!guardCount()) return;
    s.set({ contextBusy: 'Capturing screenshot…', error: null });
    try {
      const shot = await call({ kind: 'screenshot' });
      if (!shot.ok) {
        s.set({ error: shot.error ?? 'Screenshot failed.' });
        return;
      }
      const { dataUrl } = shot.data as { dataUrl: string };
      s.set({ contextBusy: 'Reading text from screenshot (OCR)…' });
      const base64 = dataUrl.slice(dataUrl.indexOf(',') + 1);
      const res = await call({ kind: 'upload', name: 'screenshot.png', mime: 'image/png', base64 });
      if (!res.ok) {
        s.set({ error: res.error ?? 'Could not read text from the screenshot.' });
        return;
      }
      const parsed = res.data as ParsedFile;
      s.addContext({ id: newId(), ...parsed, kind: 'screenshot', name: `Screenshot of ${location.host}` });
    } finally {
      s.set({ contextBusy: null });
    }
  }

  function addPaste() {
    if (!pasteText.trim() || !guardCount()) return;
    s.addContext({
      id: newId(),
      name: `Pasted text (${pasteText.length.toLocaleString()} chars)`,
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
        <div key={c.id} className="flex items-center gap-2 rounded-md bg-wash px-2.5 py-1.5 text-[12.5px]">
          <span className="text-[14px]">{iconFor(c)}</span>
          <span className="min-w-0 flex-1 truncate" title={c.name}>
            {c.name}
          </span>
          <span className="text-graphite">{c.chars.toLocaleString()} ch</span>
          <button onClick={() => s.removeContext(c.id)} className="font-bold text-graphite hover:text-ink" title="Remove">
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
        <button onClick={() => fileInput.current?.click()} className="rounded border border-hairline px-2 py-1 hover:border-ink">
          + File
        </button>
        <button onClick={() => void screenshot()} className="rounded border border-hairline px-2 py-1 hover:border-ink">
          + Screenshot
        </button>
        <button onClick={() => setPasteOpen((v) => !v)} className="rounded border border-hairline px-2 py-1 hover:border-ink">
          + Paste text
        </button>
        <span className="self-center text-[11px] text-graphite">or drag files here</span>
      </div>

      {pasteOpen && (
        <div className="space-y-1.5">
          <textarea
            value={pasteText}
            onChange={(e) => setPasteText(e.target.value)}
            rows={4}
            placeholder="Paste text to use as context…"
            className="w-full rounded-md border border-hairline bg-paper px-2.5 py-1.5 text-[12.5px] outline-none placeholder:text-graphite focus:border-ink"
          />
          <button onClick={addPaste} disabled={!pasteText.trim()} className="rounded bg-ink px-2.5 py-1 text-[12px] text-paper hover:opacity-85 disabled:opacity-40">
            Attach
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
