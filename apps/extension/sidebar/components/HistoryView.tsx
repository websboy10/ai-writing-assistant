import { useState } from 'react';
import type { ChatMessage } from '@awa/shared';
import { call } from '../api';
import { stopGeneration } from '../chat';
import { nextId, useStore } from '../store';
import { Banner } from './AuthView';

export function HistoryView() {
  const s = useStore();
  const [busy, setBusy] = useState<string | null>(null);

  async function open(id: string) {
    // Opening another conversation must end any stream still attached to the
    // previous one (WR-16).
    stopGeneration();
    setBusy(id);
    const res = await call({ kind: 'api', path: `/api/conversations/${id}` });
    setBusy(null);
    if (!res.ok) {
      s.set({ error: res.error ?? 'Could not open that conversation.' });
      return;
    }
    const msgs = (res.data as (ChatMessage & { created_at: string })[]).map((m) => ({
      id: nextId(),
      role: m.role,
      content: m.content,
    }));
    s.set({ conversationId: id, messages: msgs, view: 'chat', error: null, notice: null });
  }

  async function remove(id: string) {
    setBusy(id);
    const res = await call({ kind: 'api', path: `/api/conversations/${id}`, method: 'DELETE' });
    setBusy(null);
    if (!res.ok) {
      s.set({ error: res.error ?? 'Delete failed.' });
      return;
    }
    s.set({ history: s.history.filter((h) => h.id !== id) });
    if (s.conversationId === id) s.newConversation();
  }

  return (
    <div className="h-full space-y-2 overflow-y-auto px-3 py-3">
      {s.error && <Banner kind="error" text={s.error} />}
      {s.history.length === 0 && (
        <p className="mt-8 text-center text-[13px] text-graphite">No conversations yet. They'll appear here once you chat.</p>
      )}
      {s.history.map((h) => (
        <div key={h.id} className="group flex items-center gap-2 rounded-md border border-hairline px-3 py-2 hover:border-ink">
          <button onClick={() => void open(h.id)} className="min-w-0 flex-1 text-left" disabled={busy === h.id}>
            <div className="truncate font-medium">{h.title || 'Untitled'}</div>
            <div className="text-[11.5px] text-graphite">
              {new Date(h.updatedAt).toLocaleString()} · {h.messageCount} messages
            </div>
          </button>
          <button
            onClick={() => void remove(h.id)}
            disabled={busy === h.id}
            className="rounded px-1.5 py-1 text-[12px] text-graphite underline-offset-2 opacity-0 transition group-hover:opacity-100 hover:text-ink hover:underline"
            title="Delete conversation (removes stored content)"
          >
            {busy === h.id ? '…' : 'Delete'}
          </button>
        </div>
      ))}
    </div>
  );
}
