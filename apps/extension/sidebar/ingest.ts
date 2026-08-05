import { ACCEPTED_FILE_TYPES, MAX_CONTEXT_ITEMS, MAX_FILE_BYTES, type ContextItem, type ParsedFile } from '@awa/shared';
import { call, fileToBase64 } from './api';
import { useStore } from './store';

let ctxId = 0;
export const newContextId = (): string => `ctx${Date.now()}-${ctxId++}`;

/**
 * Shared file → context pipeline, used by both the ContextPanel and the
 * edge-button drop target. Returns how many files made it in; every failure
 * sets a specific store error (CTX-10/11).
 */
export async function addFilesToContext(files: FileList | File[]): Promise<number> {
  const s = useStore.getState();
  let added = 0;
  for (const file of Array.from(files)) {
    if (useStore.getState().context.length >= MAX_CONTEXT_ITEMS) {
      s.set({ error: `Du kan vedhæfte op til ${MAX_CONTEXT_ITEMS} elementer. Fjern ét først.` });
      break;
    }
    // Client-side pre-checks give instant, specific feedback (CTX-10);
    // the server re-validates everything regardless.
    if (file.size > MAX_FILE_BYTES) {
      s.set({ error: `"${file.name}" er ${(file.size / 1024 / 1024).toFixed(1)} MB — grænsen er ${MAX_FILE_BYTES / 1024 / 1024} MB.` });
      continue;
    }
    const known = file.type in ACCEPTED_FILE_TYPES || /\.(pdf|docx|txt|md|png|jpe?g)$/i.test(file.name);
    if (!known) {
      s.set({ error: `"${file.name}" (${file.type || 'ukendt type'}) understøttes ikke. Brug PDF, DOCX, TXT, Markdown, PNG eller JPG.` });
      continue;
    }
    s.set({ contextBusy: `Behandler ${file.name}…`, error: null });
    try {
      const base64 = await fileToBase64(file);
      const res = await call({ kind: 'upload', name: file.name, mime: file.type || 'application/octet-stream', base64 });
      if (!res.ok) {
        s.set({ error: res.error ?? `Behandlingen af "${file.name}" fejlede.` });
        continue;
      }
      const parsed = res.data as ParsedFile;
      const item: ContextItem = { id: newContextId(), ...parsed };
      useStore.getState().addContext(item);
      added++;
      if (parsed.truncated) {
        s.set({ notice: `"${file.name}" var lang — de første ${parsed.chars.toLocaleString()} tegn er vedhæftet.` });
      }
    } finally {
      s.set({ contextBusy: null });
    }
  }
  return added;
}
