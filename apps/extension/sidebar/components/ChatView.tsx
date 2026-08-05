import { memo, useEffect, useRef, useState } from 'react';
import { OPERATION_LABELS, type PromptOperation } from '@awa/shared';
import { sendChat, stopGeneration } from '../chat';
import { inserter } from '../inserter';
import { useStore, type UiMessage } from '../store';
import { Banner } from './AuthView';
import { ContextPanel } from './ContextPanel';

// System serif: web fonts don't load reliably inside a shadow DOM, and an
// overlay must render instantly. The serif is the assistant's voice (see
// style.css — "Galley" design system).
const SERIF = { fontFamily: 'Charter, Georgia, Cambria, serif' };
const MONO = { fontFamily: "ui-monospace, 'SF Mono', Menlo, Consolas, monospace" };

export function ChatView() {
  const s = useStore();
  const [input, setInput] = useState('');
  const [selectionSnapshot, setSelectionSnapshot] = useState('');
  const [showContext, setShowContext] = useState(false);
  const scrollRef = useRef<HTMLDivElement>(null);
  const stickBottom = useRef(true);

  useEffect(() => {
    const el = scrollRef.current;
    if (el && stickBottom.current) el.scrollTo({ top: el.scrollHeight });
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
        onScroll={(e) => {
          const el = e.currentTarget;
          stickBottom.current = el.scrollHeight - el.scrollTop - el.clientHeight < 60;
        }}
        className="min-h-0 flex-1 space-y-4 overflow-y-auto px-4 py-4"
      >
        {s.messages.length === 0 && (
          <div className="mt-10 space-y-2 text-center">
            <p className="text-[17px] text-graphite" style={SERIF}>
              A blank page, ready when you are.
            </p>
            <p className="text-[12px] text-graphite">
              Ask anything — or pick an operation below and point it at selected page text or attached files.
            </p>
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
      <div className="border-t border-hairline">
        <button
          onClick={() => setShowContext((v) => !v)}
          className="awa-eyebrow flex w-full items-center justify-between px-4 py-2 hover:bg-wash"
        >
          <span>
            Context{s.context.length > 0 && <b className="text-ink"> · {s.context.length}</b>}
          </span>
          <span>{showContext ? '−' : '+'}</span>
        </button>
        {showContext && <ContextPanel />}
      </div>

      {/* composer */}
      <div className="space-y-2 border-t border-hairline p-3">
        <div className="flex flex-wrap items-center gap-1.5">
          <MachineSelect
            value={s.operation}
            onChange={(v) => s.set({ operation: v as PromptOperation })}
            options={Object.entries(OPERATION_LABELS).map(([k, label]) => [k, label] as [string, string])}
          />
          <MachineSelect
            value={s.prefs.tone ?? 'neutral'}
            onChange={(v) => s.set({ prefs: { ...s.prefs, tone: v as never } })}
            options={['neutral', 'formal', 'friendly', 'confident', 'casual'].map((t) => [t, t] as [string, string])}
            title="Tone"
          />
          <MachineSelect
            value={s.prefs.length ?? 'same'}
            onChange={(v) => s.set({ prefs: { ...s.prefs, length: v as never } })}
            options={[
              ['shorter', 'shorter'],
              ['same', 'same length'],
              ['longer', 'longer'],
            ]}
            title="Length"
          />
          {s.operation === 'translate' && (
            <input
              value={s.prefs.language ?? ''}
              onChange={(e) => s.set({ prefs: { ...s.prefs, language: e.target.value } })}
              placeholder="Target language"
              className="w-28 rounded border border-hairline bg-paper px-1.5 py-1 text-[12px] outline-none placeholder:text-graphite focus:border-ink"
            />
          )}
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <button
            onClick={captureSelection}
            className="rounded border border-dashed border-graphite px-2 py-1 text-[12px] text-graphite hover:border-ink hover:text-ink"
          >
            Use page selection
          </button>
          {selectionSnapshot && (
            <span className="flex items-center gap-1.5 rounded bg-ink px-2 py-1 text-[12px] text-paper">
              {selectionSnapshot.length} chars
              <button onClick={() => setSelectionSnapshot('')} className="font-bold">
                ×
              </button>
            </span>
          )}
          <label
            className="ml-auto flex items-center gap-1.5 text-[11.5px] text-graphite"
            title="Real personal data only runs on paid no-training models (enforced server-side)"
          >
            <input
              type="checkbox"
              checked={s.containsRealData}
              onChange={(e) => s.set({ containsRealData: e.target.checked })}
              className="accent-current"
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
            className="min-h-[42px] flex-1 resize-y rounded-md border border-hairline bg-paper px-3 py-2 outline-none placeholder:text-graphite focus:border-ink"
          />
          {s.streaming ? (
            <button
              onClick={stopGeneration}
              className="rounded-md border border-ink px-3 py-2 font-medium text-ink hover:bg-ink hover:text-paper"
              title="Stop generating"
            >
              ■
            </button>
          ) : (
            <button
              onClick={send}
              disabled={!input.trim() && !selectionSnapshot}
              className="rounded-md bg-ink px-3 py-2 font-medium text-paper hover:opacity-85 disabled:opacity-40"
            >
              ↑
            </button>
          )}
        </div>
        <div className="flex justify-between gap-2 text-[11px] text-graphite">
          <button onClick={() => s.newConversation()} className="shrink-0 underline-offset-2 hover:text-ink hover:underline">
            + New conversation
          </button>
          <TargetHint />
        </div>
      </div>
    </div>
  );
}

function MachineSelect({
  value,
  onChange,
  options,
  title,
}: {
  value: string;
  onChange: (v: string) => void;
  options: [string, string][];
  title?: string;
}) {
  return (
    <select
      value={value}
      onChange={(e) => onChange(e.target.value)}
      title={title}
      className="rounded border border-hairline bg-paper px-1.5 py-1 text-[11px] text-ink outline-none focus:border-ink"
      style={MONO}
    >
      {options.map(([k, label]) => (
        <option key={k} value={k}>
          {label}
        </option>
      ))}
    </select>
  );
}

function TargetHint() {
  const [status, setStatus] = useState<{ label: string; ok: boolean } | null>(null);
  useEffect(() => {
    const t = setInterval(() => setStatus(inserter.targetStatus()), 1500);
    return () => clearInterval(t);
  }, []);
  if (!status) return <span className="truncate">No insertion target yet — click into a text field on the page</span>;
  return (
    <span className={`truncate ${status.ok ? '' : 'font-medium text-ink'}`}>
      Insert target: {status.label}
      {!status.ok && ' (unavailable — will offer Copy)'}
    </span>
  );
}

// Memoized so that per-token store updates only re-render the one streaming
// bubble — the spread in the token handler preserves every other message's
// identity. Do NOT subscribe to the store in here; that would re-render every
// bubble on every token and defeat the memo (WR-14).
//
// Two typographic voices encode the speakers: the user's words are compact
// sans in a wash block; the assistant's draft is manuscript serif set directly
// on the paper behind a hairline rule.
const MessageBubble = memo(function MessageBubble({ m }: { m: UiMessage }) {
  const [editing, setEditing] = useState(false);
  // Seeded when Edit is clicked, not at mount — streamed messages mount with
  // empty content, so a mount-time seed would make Save erase the response.
  const [draft, setDraft] = useState('');
  const [copied, setCopied] = useState(false);

  if (m.role === 'user') {
    return <div className="ml-10 whitespace-pre-wrap rounded-md bg-wash px-3 py-2 text-[13px]">{m.content}</div>;
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
    <div className="space-y-1.5">
      <p className="awa-eyebrow">Draft</p>
      {editing ? (
        <div className="space-y-1.5">
          <textarea
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            rows={Math.min(14, Math.max(4, draft.split('\n').length + 1))}
            className="awa-edit w-full rounded-md border border-ink bg-paper px-3 py-2 text-[14.5px] leading-relaxed outline-none"
            style={SERIF}
          />
          <div className="flex gap-1.5 text-[12px]">
            <button onClick={saveEdit} className="rounded bg-ink px-2.5 py-1 text-paper hover:opacity-85">
              Save
            </button>
            <button onClick={() => setEditing(false)} className="rounded border border-hairline px-2.5 py-1 hover:border-ink">
              Cancel
            </button>
          </div>
        </div>
      ) : (
        <div className="whitespace-pre-wrap border-l-2 border-hairline pl-3 text-[14.5px] leading-relaxed" style={SERIF}>
          {m.content}
          {m.streaming && <span className="awa-caret ml-0.5" />}
        </div>
      )}
      {!m.streaming && m.content && !editing && (
        <div className="flex flex-wrap gap-1.5 pl-3 text-[12px]">
          <button
            onClick={() => inserter.start(m.content, 'progressive')}
            className="rounded bg-ink px-2.5 py-1 text-paper hover:opacity-85"
            title="Insert into the page at a readable pace — pause or stop any time"
          >
            Insert
          </button>
          <button
            onClick={() => inserter.start(m.content, 'instant')}
            className="rounded border border-hairline px-2.5 py-1 hover:border-ink"
            title="Insert everything at once"
          >
            Instant
          </button>
          <button onClick={() => void copy()} className="rounded border border-hairline px-2.5 py-1 hover:border-ink">
            {copied ? 'Copied ✓' : 'Copy'}
          </button>
          <button
            onClick={() => {
              setDraft(m.content);
              setEditing(true);
            }}
            className="rounded border border-hairline px-2.5 py-1 hover:border-ink"
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
    <div className="sticky bottom-0 space-y-2 border border-hairline bg-paper p-3 shadow-lg">
      <div className="flex items-baseline justify-between">
        <span className="awa-eyebrow !text-ink">
          {st.state === 'running' && 'Inserting'}
          {st.state === 'paused' && 'Paused'}
          {st.state === 'done' && (st.unverified ? 'Sent (unverified)' : 'Inserted ✓')}
          {st.state === 'stopped' && 'Stopped — partial text kept'}
          {st.state === 'idle' && 'Undone'}
        </span>
        <span className="awa-eyebrow">{pct}%</span>
      </div>
      {st.detail && <div className="text-[12px] text-graphite">{st.detail}</div>}
      {/* The galley line: ink advancing across paper. */}
      <div className="relative h-[3px] w-full bg-wash">
        <div className="absolute left-0 top-0 h-full bg-ink transition-all duration-200" style={{ width: `${pct}%` }} />
      </div>
      <div className="flex items-center gap-1.5 text-[11px]" style={MONO}>
        {st.state === 'running' && (
          <button onClick={() => inserter.pause()} className="rounded border border-hairline px-2 py-1 hover:border-ink">
            ⏸ Pause
          </button>
        )}
        {st.state === 'paused' && (
          <button onClick={() => inserter.resume()} className="rounded border border-hairline px-2 py-1 hover:border-ink">
            ▶ Resume
          </button>
        )}
        {(st.state === 'running' || st.state === 'paused') && (
          <button onClick={() => inserter.stop()} className="rounded border border-hairline px-2 py-1 hover:border-ink">
            ■ Stop
          </button>
        )}
        {(st.state === 'done' || st.state === 'stopped' || st.state === 'paused') && (
          <button onClick={() => inserter.undo()} className="rounded border border-hairline px-2 py-1 hover:border-ink">
            ↩ Undo insertion
          </button>
        )}
        <button onClick={() => inserter.dismiss()} className="ml-auto px-2 py-1 text-graphite hover:text-ink">
          Dismiss
        </button>
      </div>
      <div className="truncate text-[11px] text-graphite">{st.targetLabel}</div>
    </div>
  );
}
