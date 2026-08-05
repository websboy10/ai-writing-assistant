import { useEffect, useRef, useState } from 'react';
import type { ChatMessage } from '@awa/shared';
import { call } from '../api';
import { stopGeneration } from '../chat';
import { nextId, useStore } from '../store';
import { Banner } from './AuthView';

type StoredMessage = ChatMessage & { created_at: string };

export function HistoryView() {
  const s = useStore();
  const [busy, setBusy] = useState<string | null>(null);
  const [query, setQuery] = useState('');
  const debounce = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Debounced server-side search across titles and message bodies (PROD-02).
  useEffect(() => {
    if (debounce.current) clearTimeout(debounce.current);
    debounce.current = setTimeout(() => void s.loadHistory(query), 300);
    return () => {
      if (debounce.current) clearTimeout(debounce.current);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [query]);

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
    const msgs = (res.data as StoredMessage[]).map((m) => ({
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

  // Export as Markdown (PROD-03) — built client-side from the same endpoint
  // the open flow uses; a blob download keeps the backend out of it.
  async function exportMd(id: string, title: string) {
    setBusy(id);
    const res = await call({ kind: 'api', path: `/api/conversations/${id}` });
    setBusy(null);
    if (!res.ok) {
      s.set({ error: res.error ?? 'Could not load the conversation to export it.' });
      return;
    }
    const msgs = res.data as StoredMessage[];
    const md = [
      `# ${title || 'Conversation'}`,
      '',
      ...msgs.flatMap((m) => [
        `## ${m.role === 'user' ? 'You' : 'Assistant'} — ${new Date(m.created_at).toLocaleString()}`,
        '',
        m.content,
        '',
      ]),
    ].join('\n');
    const url = URL.createObjectURL(new Blob([md], { type: 'text/markdown' }));
    const a = document.createElement('a');
    a.href = url;
    a.download = `${(title || 'conversation').replace(/[^\p{L}\p{N} _-]/gu, '').slice(0, 60) || 'conversation'}.md`;
    a.click();
    URL.revokeObjectURL(url);
  }

  return (
    <div className="flex h-full flex-col">
      <div className="border-b border-hairline p-3">
        <input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Search titles and messages…"
          className="w-full rounded-xl border border-hairline bg-paper px-3 py-1.5 text-[13px] outline-none placeholder:text-graphite focus:border-ink"
        />
      </div>
      <div className="min-h-0 flex-1 space-y-2 overflow-y-auto px-3 py-3">
        {s.error && <Banner kind="error" text={s.error} />}
        {s.history.length === 0 && (
          <p className="mt-8 text-center text-[13px] text-graphite">
            {query ? `Nothing matches "${query}".` : "No conversations yet. They'll appear here once you chat."}
          </p>
        )}
        {s.history.map((h) => (
          <div key={h.id} className="group rounded-xl border border-hairline px-3 py-2 hover:border-ink">
            <button onClick={() => void open(h.id)} className="block w-full text-left" disabled={busy === h.id}>
              <div className="truncate font-medium">{h.title || 'Untitled'}</div>
              <div className="text-[11.5px] text-graphite">
                {new Date(h.updatedAt).toLocaleString()} · {h.messageCount} messages
              </div>
            </button>
            <div className="mt-1 flex gap-2 text-[12px] opacity-0 transition group-hover:opacity-100">
              <button
                onClick={() => void exportMd(h.id, h.title)}
                disabled={busy === h.id}
                className="text-graphite underline-offset-2 hover:text-ink hover:underline"
                title="Download as Markdown"
              >
                Export
              </button>
              <button
                onClick={() => void remove(h.id)}
                disabled={busy === h.id}
                className="text-graphite underline-offset-2 hover:text-ink hover:underline"
                title="Delete conversation (removes stored content)"
              >
                {busy === h.id ? '…' : 'Delete'}
              </button>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
