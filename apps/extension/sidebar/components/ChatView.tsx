import { memo, useEffect, useRef, useState } from 'react';
import { OPERATION_LABELS, type PromptOperation } from '@awa/shared';
import { sendChat, stopGeneration } from '../chat';
import { inserter } from '../inserter';
import { useStore, type UiMessage } from '../store';
import { Banner } from './AuthView';
import { ContextPanel } from './ContextPanel';

export function ChatView() {
  const s = useStore();
  const [input, setInput] = useState('');
  const [selectionSnapshot, setSelectionSnapshot] = useState('');
  const [showContext, setShowContext] = useState(false);
  const scrollRef = useRef<HTMLDivElement>(null);
  // Only follow the stream while the user is at the bottom — scrolling up to
  // re-read mid-stream must not be fought (IN-17).
  const stickToBottom = useRef(true);

  useEffect(() => {
    const el = scrollRef.current;
    if (el && stickToBottom.current) el.scrollTo({ top: el.scrollHeight });
  }, [s.messages, s.streaming]);

  function send() {
    const text = input.trim();
    if (!text && !selectionSnapshot) return;
    sendChat(text || `Apply "${OPERATION_LABELS[s.operation]}" to the subject text.`, selectionSnapshot || undefined);
    setInput('');
  }

  function captureSelection() {
    const text = inserter.selectionText();
    if (text) {
      setSelectionSnapshot(text);
    } else {
      s.set({
        notice: 'Nothing is selected on the page. Select the text first, then press "Use page selection".',
      });
    }
  }

  return (
    <div className="flex h-full flex-col">
      {/* messages */}
      <div
        ref={scrollRef}
        onScroll={() => {
          const el = scrollRef.current;
          if (el) stickToBottom.current = el.scrollHeight - el.scrollTop - el.clientHeight < 40;
        }}
        className="min-h-0 flex-1 space-y-3 overflow-y-auto px-3 py-3"
      >
        {s.messages.length === 0 && (
          <div className="mt-8 space-y-2 text-center text-[13px] text-zinc-400">
            <p>Ask anything, or pick an operation below and point it at selected page text or attached files.</p>
          </div>
        )}
        {s.messages.map((m) => (
          <MessageBubble key={m.id} m={m} />
        ))}
        {s.error && <Banner kind="error" text={s.error} />}
        {s.notice && <Banner kind="info" text={s.notice} />}
        {s.insertStatus && <InsertBar />}
      </div>

      {/* context */}
      <div className="border-t border-zinc-200 dark:border-zinc-700">
        <button
          onClick={() => setShowContext((v) => !v)}
          className="flex w-full items-center justify-between px-3 py-1.5 text-[12px] text-zinc-500 hover:bg-zinc-50 dark:hover:bg-zinc-800/60"
        >
          <span>
            Context {s.context.length > 0 && <b>({s.context.length} attached)</b>}
          </span>
          <span>{showContext ? '▾' : '▸'}</span>
        </button>
        {showContext && <ContextPanel />}
      </div>

      {/* composer */}
      <div className="space-y-2 border-t border-zinc-200 p-3 dark:border-zinc-700">
        <div className="flex flex-wrap items-center gap-1.5">
          <select
            value={s.operation}
            onChange={(e) => s.set({ operation: e.target.value as PromptOperation })}
            className="rounded-md border border-zinc-300 bg-white px-1.5 py-1 text-[12px] dark:border-zinc-600 dark:bg-zinc-800"
          >
            {Object.entries(OPERATION_LABELS).map(([k, label]) => (
              <option key={k} value={k}>
                {label}
              </option>
            ))}
          </select>
          <select
            value={s.prefs.tone}
            onChange={(e) => s.set({ prefs: { ...s.prefs, tone: e.target.value as never } })}
            className="rounded-md border border-zinc-300 bg-white px-1.5 py-1 text-[12px] dark:border-zinc-600 dark:bg-zinc-800"
            title="Tone"
          >
            {['neutral', 'formal', 'friendly', 'confident', 'casual'].map((t) => (
              <option key={t} value={t}>
                {t}
              </option>
            ))}
          </select>
          <select
            value={s.prefs.length}
            onChange={(e) => s.set({ prefs: { ...s.prefs, length: e.target.value as never } })}
            className="rounded-md border border-zinc-300 bg-white px-1.5 py-1 text-[12px] dark:border-zinc-600 dark:bg-zinc-800"
            title="Length"
          >
            <option value="shorter">shorter</option>
            <option value="same">same length</option>
            <option value="longer">longer</option>
          </select>
          {s.operation === 'translate' && (
            <input
              value={s.prefs.language ?? ''}
              onChange={(e) => s.set({ prefs: { ...s.prefs, language: e.target.value } })}
              placeholder="Target language"
              className="w-28 rounded-md border border-zinc-300 bg-white px-1.5 py-1 text-[12px] dark:border-zinc-600 dark:bg-zinc-800"
            />
          )}
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <button
            onClick={captureSelection}
            className="rounded-md border border-dashed border-zinc-400 px-2 py-1 text-[12px] text-zinc-600 hover:border-indigo-500 hover:text-indigo-600 dark:text-zinc-300"
          >
            Use page selection
          </button>
          {selectionSnapshot && (
            <span className="flex items-center gap-1 rounded-md bg-indigo-50 px-2 py-1 text-[12px] text-indigo-700 dark:bg-indigo-950/60 dark:text-indigo-300">
              {selectionSnapshot.length} chars selected
              <button onClick={() => setSelectionSnapshot('')} className="font-bold">
                ×
              </button>
            </span>
          )}
          <label className="ml-auto flex items-center gap-1 text-[11.5px] text-zinc-500" title="Real personal data only runs on paid no-training models (enforced server-side)">
            <input
              type="checkbox"
              checked={s.containsRealData}
              onChange={(e) => s.set({ containsRealData: e.target.checked })}
            />
            contains real data
          </label>
        </div>

        <div className="flex items-end gap-2">
          <textarea
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault();
                send();
              }
            }}
            rows={2}
            placeholder={s.operation === 'chat' ? 'Message the assistant…' : `Optional instructions for "${OPERATION_LABELS[s.operation]}"…`}
            className="min-h-[42px] flex-1 resize-y rounded-lg border border-zinc-300 bg-white px-3 py-2 outline-none focus:border-indigo-500 dark:border-zinc-600 dark:bg-zinc-800"
          />
          {s.streaming ? (
            <button
              onClick={stopGeneration}
              className="rounded-lg bg-red-600 px-3 py-2 font-medium text-white hover:bg-red-500"
              title="Stop generating"
            >
              ■
            </button>
          ) : (
            <button
              onClick={send}
              disabled={!input.trim() && !selectionSnapshot}
              className="rounded-lg bg-indigo-600 px-3 py-2 font-medium text-white hover:bg-indigo-500 disabled:opacity-40"
            >
              ↑
            </button>
          )}
        </div>
        <div className="flex justify-between text-[11px] text-zinc-400">
          <button onClick={() => s.newConversation()} className="hover:text-zinc-600 hover:underline dark:hover:text-zinc-200">
            + New conversation
          </button>
          <TargetHint />
        </div>
      </div>
    </div>
  );
}

function TargetHint() {
  const [status, setStatus] = useState<{ label: string; ok: boolean } | null>(null);
  useEffect(() => {
    const t = setInterval(() => setStatus(inserter.targetStatus()), 1500);
    return () => clearInterval(t);
  }, []);
  if (!status) return <span>No insertion target yet — click into a text field on the page</span>;
  return (
    <span className={status.ok ? '' : 'text-amber-600'}>
      Insert target: {status.label}
      {!status.ok && ' (unavailable — will offer Copy)'}
    </span>
  );
}

// Memoized so that per-token store updates only re-render the one streaming
// bubble — the spread in the token handler preserves every other message's
// identity. Do NOT subscribe to the store in here; that would re-render every
// bubble on every token and defeat the memo (WR-14).
const MessageBubble = memo(function MessageBubble({ m }: { m: UiMessage }) {
  const [editing, setEditing] = useState(false);
  // Seeded when Edit is clicked, not at mount — streamed messages mount with
  // empty content, so a mount-time seed would make Save erase the response.
  const [draft, setDraft] = useState('');
  const [copied, setCopied] = useState(false);

  if (m.role === 'user') {
    return (
      <div className="ml-8 whitespace-pre-wrap rounded-xl rounded-br-sm bg-indigo-600 px-3 py-2 text-white">
        {m.content}
      </div>
    );
  }

  function saveEdit() {
    const st = useStore.getState();
    st.set({ messages: st.messages.map((x) => (x.id === m.id ? { ...x, content: draft } : x)) });
    setEditing(false);
  }

  async function copy() {
    await navigator.clipboard.writeText(m.content);
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  }

  return (
    <div className="mr-4 space-y-1">
      {editing ? (
        <div className="space-y-1">
          <textarea
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            rows={Math.min(14, Math.max(4, draft.split('\n').length + 1))}
            className="w-full rounded-lg border border-indigo-400 bg-white px-3 py-2 dark:bg-zinc-800"
          />
          <div className="flex gap-2 text-[12px]">
            <button onClick={saveEdit} className="rounded bg-indigo-600 px-2 py-1 text-white">
              Save
            </button>
            <button onClick={() => setEditing(false)} className="rounded border border-zinc-300 px-2 py-1 dark:border-zinc-600">
              Cancel
            </button>
          </div>
        </div>
      ) : (
        <div className="whitespace-pre-wrap rounded-xl rounded-bl-sm bg-zinc-100 px-3 py-2 dark:bg-zinc-800">
          {m.content}
          {m.streaming && <span className="ml-1 inline-block h-3 w-1.5 animate-pulse bg-indigo-500 align-middle" />}
        </div>
      )}
      {!m.streaming && m.content && !editing && (
        <div className="flex flex-wrap gap-1.5 text-[12px]">
          <button
            onClick={() => inserter.start(m.content, 'progressive')}
            className="rounded-md bg-indigo-600 px-2 py-1 text-white hover:bg-indigo-500"
            title="Insert into the page at a readable pace — pause or stop any time"
          >
            Insert
          </button>
          <button
            onClick={() => inserter.start(m.content, 'instant')}
            className="rounded-md border border-indigo-300 px-2 py-1 text-indigo-700 hover:bg-indigo-50 dark:border-indigo-700 dark:text-indigo-300"
            title="Insert everything at once"
          >
            Instant
          </button>
          <button onClick={() => void copy()} className="rounded-md border border-zinc-300 px-2 py-1 hover:bg-zinc-50 dark:border-zinc-600 dark:hover:bg-zinc-800">
            {copied ? 'Copied ✓' : 'Copy'}
          </button>
          <button
            onClick={() => {
              setDraft(m.content);
              setEditing(true);
            }}
            className="rounded-md border border-zinc-300 px-2 py-1 hover:bg-zinc-50 dark:border-zinc-600 dark:hover:bg-zinc-800"
          >
            Edit
          </button>
        </div>
      )}
    </div>
  );
});

function InsertBar() {
  const s = useStore();
  const st = s.insertStatus;
  if (!st) return null;
  const pct = Math.round(st.progress * 100);
  return (
    <div className="sticky bottom-0 space-y-1.5 rounded-xl border border-indigo-200 bg-indigo-50 p-2.5 dark:border-indigo-800 dark:bg-indigo-950/60">
      <div className="flex items-center justify-between text-[12px]">
        <span className="font-medium text-indigo-800 dark:text-indigo-200">
          {st.state === 'running' && `Inserting… ${pct}%`}
          {st.state === 'paused' && 'Paused'}
          {st.state === 'done' && (st.unverified ? 'Sent (unverified)' : 'Inserted ✓')}
          {st.state === 'stopped' && `Stopped at ${pct}% — partial text kept`}
          {st.state === 'idle' && 'Undone'}
        </span>
        <span className="text-indigo-600/70 dark:text-indigo-300/70">{st.targetLabel}</span>
      </div>
      {st.detail && <div className="text-[11.5px] text-indigo-700 dark:text-indigo-300">{st.detail}</div>}
      <div className="h-1.5 overflow-hidden rounded bg-indigo-200 dark:bg-indigo-900">
        <div className="h-full bg-indigo-600 transition-all" style={{ width: `${pct}%` }} />
      </div>
      <div className="flex gap-1.5 text-[12px]">
        {st.state === 'running' && (
          <button onClick={() => inserter.pause()} className="rounded bg-white px-2 py-1 shadow-sm dark:bg-zinc-800">
            ⏸ Pause
          </button>
        )}
        {st.state === 'paused' && (
          <button onClick={() => inserter.resume()} className="rounded bg-white px-2 py-1 shadow-sm dark:bg-zinc-800">
            ▶ Resume
          </button>
        )}
        {(st.state === 'running' || st.state === 'paused') && (
          <button onClick={() => inserter.stop()} className="rounded bg-white px-2 py-1 shadow-sm dark:bg-zinc-800">
            ■ Stop
          </button>
        )}
        {(st.state === 'done' || st.state === 'stopped' || st.state === 'paused') && (
          <button onClick={() => inserter.undo()} className="rounded bg-white px-2 py-1 shadow-sm dark:bg-zinc-800">
            ↩ Undo insertion
          </button>
        )}
        <button onClick={() => inserter.dismiss()} className="ml-auto rounded px-2 py-1 text-indigo-500">
          Dismiss
        </button>
      </div>
    </div>
  );
}
