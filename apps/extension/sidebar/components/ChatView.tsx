import { memo, useEffect, useRef, useState } from 'react';
import { OPERATION_LABELS, type PromptOperation } from '@awa/shared';
import { autonomous } from '../autonomous';
import { sendChat, stopGeneration } from '../chat';
import { newContextId } from '../ingest';
import { inserter } from '../inserter';
import { useStore, type UiMessage } from '../store';
import { Banner } from './AuthView';
import { ContextChips } from './ContextPanel';

// System serif: web fonts don't load reliably inside a shadow DOM, and an
// overlay must render instantly. The serif is the assistant's voice (see
// style.css — "Galley" design system).
const SERIF = { fontFamily: 'Charter, Georgia, Cambria, serif' };

/** In flight — as opposed to finished, stopped or failed, which are all states
 *  the user is free to start a new run from. */
const isRunActive = (state?: string) => state === 'writing' || state === 'paused';

/**
 * What the user is asking for when they pick a verb and type nothing.
 *
 * The operations are the product's stated purpose — "ask it to draft, rewrite,
 * summarize, translate or explain" (PROJECT.md) — and the backend has
 * implemented all eight from the beginning. Nothing could reach them: the store
 * pinned `operation` to 'chat' and `subject` was never sent, so seven of the
 * eight were dead code and the marked text could only ever be answered or
 * attached, never worked on.
 *
 * These sentences become the user's own message when they press send without
 * typing, so the conversation and the saved history still read like something
 * a person said, rather than showing an empty bubble.
 */
const DEFAULT_ASK: Record<PromptOperation, string> = {
  chat: '',
  rewrite: 'Omskriv den markerede tekst.',
  summarize: 'Opsummer den markerede tekst.',
  expand: 'Uddyb den markerede tekst.',
  simplify: 'Forenkl den markerede tekst.',
  explain: 'Forklar den markerede tekst.',
  translate: 'Oversæt den markerede tekst.',
  continue: 'Skriv videre fra den markerede tekst.',
};

/** What the composer invites you to type, given the verb you picked. */
const OPERATION_HINT: Record<PromptOperation, string> = {
  chat: 'Skriv til assistenten…',
  rewrite: 'Hvordan skal den omskrives? (valgfrit)',
  summarize: 'Hvor kort, og til hvem? (valgfrit)',
  expand: 'Hvad skal uddybes? (valgfrit)',
  simplify: 'Hvem skal kunne forstå den? (valgfrit)',
  explain: 'Hvad er du i tvivl om? (valgfrit)',
  translate: 'Til hvilket sprog?',
  continue: 'Hvad skal der ske videre? (valgfrit)',
};

const TONES: [NonNullable<import('@awa/shared').OutputPrefs['tone']>, string][] = [
  ['neutral', 'Neutral'],
  ['formal', 'Formel'],
  ['friendly', 'Venlig'],
  ['confident', 'Bestemt'],
  ['casual', 'Afslappet'],
];

export function ChatView() {
  const s = useStore();
  const [input, setInput] = useState('');
  const [liveSelection, setLiveSelection] = useState('');
  // Reveals the Straks/Langsomt choice for "Besvar markeringen" (D-04a) — the
  // same two-chip pattern AutonomousBar uses for the whole document, just
  // scoped to the marked text. No draft, no Insert press on this path.
  const [selExpanded, setSelExpanded] = useState(false);
  const scrollRef = useRef<HTMLDivElement>(null);
  const stickBottom = useRef(true);
  const composerRef = useRef<HTMLTextAreaElement>(null);

  // Grow to fit what has been typed, up to a quarter of the panel.
  //
  // A fixed two-row box with a drag handle asks the user to resize a text field
  // by hand every time they write more than a sentence — in a panel where a
  // paragraph-long instruction ("omskriv det her, men behold tallene og gør det
  // kortere") is the normal case, not the long tail.
  useEffect(() => {
    const el = composerRef.current;
    if (!el) return;
    el.style.height = 'auto'; // shrink first, or it can only ever grow
    el.style.height = `${Math.min(el.scrollHeight, 168)}px`;
  }, [input]);

  useEffect(() => {
    const el = scrollRef.current;
    if (el && stickBottom.current) el.scrollTo({ top: el.scrollHeight });
  }, [s.messages, s.streaming]);

  // Watch what's marked on the page so the two selection actions can offer
  // themselves the moment there is something to act on.
  //
  // Paused while text is being written. On Google Docs this read is not free:
  // it asks Docs for the selection through the same hidden input frame that
  // receives our writes, and doing that once a second DURING a run corrupted
  // the document — an answer went missing and the frame's own placeholder
  // characters landed in the text instead (measured 2026-08-18). Nothing is
  // lost by pausing: the selection bar is hidden during a run anyway.
  const writing =
    s.autoRun?.state === 'writing' ||
    s.autoRun?.state === 'paused' ||
    s.insertStatus?.state === 'running' ||
    s.insertStatus?.state === 'paused';
  useEffect(() => {
    if (writing) return;
    const t = setInterval(() => {
      const text = inserter.selectionText();
      setLiveSelection((prev) => (prev === text ? prev : text));
    }, 1000);
    return () => clearInterval(t);
  }, [writing]);

  // An operation acts on the text marked on the page; chat acts on what you
  // type. That is the whole difference, and it is why picking a verb without
  // marking anything has to say so rather than quietly answering about nothing.
  const op = s.operation;
  const subject = op === 'chat' ? '' : liveSelection;
  const canSend = op === 'chat' ? !!input.trim() : !!subject;

  // A notice reports something that already went fine ("filen var lang, de
  // første 40.000 tegn er vedhæftet"). It has no action attached, so leaving it
  // on screen until the user swats it just costs them panel height. An error
  // stays: it may still be unread, and sending again clears it anyway.
  useEffect(() => {
    if (!s.notice) return;
    const t = setTimeout(() => useStore.getState().set({ notice: null }), 8000);
    return () => clearTimeout(t);
  }, [s.notice]);

  function send() {
    if (s.streaming) return;
    const text = input.trim();
    if (op === 'chat') {
      if (!text) return;
      sendChat(text);
      setInput('');
      return;
    }
    const marked = liveSelection || inserter.selectionText();
    if (!marked) {
      s.set({ error: `Markér den tekst på siden, "${OPERATION_LABELS[op]}" skal bruges på, og prøv igen.` });
      return;
    }
    sendChat(text || DEFAULT_ASK[op], marked);
    setInput('');
  }

  function useSelectionAsContext() {
    const text = liveSelection || inserter.selectionText();
    if (!text) return;
    s.addContext({
      id: newContextId(),
      name: `Markeret tekst (${text.length.toLocaleString('da-DK')} tegn)`,
      kind: 'selection',
      text,
      chars: text.length,
      truncated: false,
    });
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
        {s.messages.length === 0 && <EmptyState />}
        {s.messages.map((m) => (
          <MessageBubble key={m.id} m={m} />
        ))}
        {s.error && <Banner kind="error" text={s.error} onDismiss={() => s.set({ error: null })} />}
        {s.notice && <Banner kind="info" text={s.notice} onDismiss={() => s.set({ notice: null })} />}
        {s.insertStatus && <InsertBar />}
        {s.autoRun && <AutoRunBar />}
      </div>

      {/* composer */}
      <div className="space-y-2 border-t border-hairline p-3">
        {/* Marked text on the page: its two jobs, clearly stated (PROM-02).
            "Besvar markeringen" now asks Straks/Langsomt and writes the
            answers directly into the marked text (D-04a) — the old
            generate-into-the-panel-then-Insert two-step is gone on this
            path. "Brug som kontekst" is untouched (D-04b). Hidden while a
            run is active so a second run can't be started on top of it. */}
        {liveSelection && !isRunActive(s.autoRun?.state) && (
          <div className="space-y-1.5 rounded-xl border border-hairline p-2.5">
            {/* A sentence about the user's own text, not a machine readout, so
                it stays sentence case throughout — only the figure is tabular,
                so it doesn't jitter the words as the selection grows. */}
            <p className="awa-note !text-ink">
              Du har markeret tekst · <span className="awa-num">{liveSelection.length.toLocaleString('da-DK')}</span> tegn
            </p>
            <div className="flex flex-wrap gap-1.5 text-ui">
              {!selExpanded ? (
                <>
                  <button
                    onClick={() => setSelExpanded(true)}
                    className="rounded-full bg-ink px-3 py-1 text-paper hover:opacity-85"
                    title="Spørger Straks eller Langsomt, og skriver svarene direkte ind i den markerede tekst"
                  >
                    Besvar markeringen
                  </button>
                  <button
                    onClick={useSelectionAsContext}
                    className="rounded-full border border-hairline px-3 py-1 hover:border-ink"
                    title="Teksten vedhæftes som baggrundsviden, assistenten kan trække på"
                  >
                    Brug som kontekst
                  </button>
                </>
              ) : (
                <>
                  <button
                    onClick={() => {
                      setSelExpanded(false);
                      void autonomous.run('selection', 'instant');
                    }}
                    className="rounded-full bg-ink px-3 py-1 text-paper hover:opacity-85"
                    title="Skriver alle svar på én gang"
                  >
                    Straks
                  </button>
                  <button
                    onClick={() => {
                      setSelExpanded(false);
                      void autonomous.run('selection', 'progressive');
                    }}
                    className="rounded-full border border-hairline px-3 py-1 hover:border-ink"
                    title="Skriver bogstav for bogstav, ét spørgsmål ad gangen, fra toppen af markeringen"
                  >
                    Langsomt
                  </button>
                </>
              )}
            </div>
            <p className="awa-note">
              <b>Besvar:</b> svarene skrives direkte ind i markeringen, lige under hvert spørgsmål. <b>Kontekst:</b> teksten
              vedhæftes som baggrundsviden.
            </p>
          </div>
        )}

        <ContextChips />

        <AutonomousBar />

        {/* Output settings: what to do, in which voice, at what length. */}
        <div className="flex flex-wrap items-center gap-x-2 gap-y-1.5">
          <Picker
            label="Handling"
            value={op}
            onChange={(v) => s.set({ operation: v as PromptOperation })}
            title="Chat svarer på det, du skriver. De øvrige arbejder på den tekst, du har markeret på siden."
            options={Object.entries(OPERATION_LABELS) as [string, string][]}
          />
          <Picker
            label="Tone"
            value={s.prefs.tone ?? 'neutral'}
            onChange={(v) => s.set({ prefs: { ...s.prefs, tone: v as (typeof TONES)[number][0] } })}
            title="Tonefaldet i det, assistenten skriver"
            options={TONES}
          />
          <div className="flex items-center gap-1.5">
            <span className="awa-eyebrow">Længde</span>
            {(
              [
                ['shorter', 'Kortere'],
                ['same', 'Samme'],
                ['longer', 'Længere'],
              ] as const
            ).map(([k, label]) => (
              <button
                key={k}
                onClick={() => s.set({ prefs: { ...s.prefs, length: k } })}
                className={`rounded-full px-2.5 py-0.5 text-aside transition-colors ${
                  (s.prefs.length ?? 'same') === k ? 'bg-ink text-paper' : 'border border-hairline hover:border-ink'
                }`}
              >
                {label}
              </button>
            ))}
          </div>
        </div>

        {/* A verb needs something to act on, so say plainly whether it has it. */}
        {op !== 'chat' && (
          <p className="awa-note">
            {subject ? (
              <>
                <b>{OPERATION_LABELS[op]}</b> arbejder på de <span className="awa-num">{subject.length.toLocaleString('da-DK')}</span>{' '}
                tegn, du har markeret.
              </>
            ) : (
              <>
                <b>{OPERATION_LABELS[op]}</b> arbejder på markeret tekst. Markér et stykke på siden først.
              </>
            )}
          </p>
        )}

        <div className="flex items-end gap-2">
          <textarea
            ref={composerRef}
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault();
                send();
              }
            }}
            rows={1}
            placeholder={OPERATION_HINT[op]}
            className="max-h-[168px] min-h-[42px] flex-1 resize-none overflow-y-auto rounded-xl border border-hairline bg-paper px-3 py-2 outline-none placeholder:text-graphite focus:border-ink"
          />
          {s.streaming ? (
            <button
              onClick={stopGeneration}
              className="rounded-xl border border-ink px-3 py-2 font-medium text-ink hover:bg-ink hover:text-paper"
              title="Stop genereringen"
            >
              ■
            </button>
          ) : (
            <button
              onClick={send}
              disabled={!canSend}
              title={op === 'chat' ? 'Send' : `${OPERATION_LABELS[op]} den markerede tekst`}
              className="rounded-xl bg-ink px-3 py-2 font-medium text-paper hover:opacity-85 disabled:opacity-40"
            >
              ↑
            </button>
          )}
        </div>
        <div className="flex justify-between gap-2 text-aside text-graphite">
          <button onClick={() => s.newConversation()} className="shrink-0 underline-offset-2 hover:text-ink hover:underline">
            + Ny samtale
          </button>
          <TargetHint />
        </div>
      </div>
    </div>
  );
}

// One capability, two entry points to the same machine — the whole open
// document here, "Besvar markeringen" on the selection bar above (scope:
// 'selection'). No review step, no approval gate, no third mode — pressing
// Straks or Langsomt writes directly (D-04). While a run is active the full
// transport lives in AutoRunBar below; this button hides so a second run
// can't be started on top of the first.
function AutonomousBar() {
  const s = useStore();
  const [expanded, setExpanded] = useState(false);

  // Hidden only while a run is genuinely in flight, so a second run cannot be
  // started on top of the first. Once it has finished it must come back:
  // hiding it until "Skjul" is pressed meant the panel's primary action simply
  // vanished after every successful run, with nothing on screen saying why or
  // how to get it back.
  if (isRunActive(s.autoRun?.state)) return null;

  return (
    <div className="flex flex-wrap items-center gap-1.5">
      <button
        onClick={() => setExpanded((e) => !e)}
        className="rounded-full border border-hairline px-3 py-1 text-ui hover:border-ink"
        title="Finder hvert spørgsmål i det felt eller dokument, du sidst klikkede i, og skriver et svar under hvert af dem"
      >
        Besvar alle spørgsmål
      </button>
      {expanded && (
        <>
          <button
            onClick={() => {
              setExpanded(false);
              void autonomous.run('document', 'instant');
            }}
            className="rounded-full bg-ink px-3 py-1 text-ui text-paper hover:opacity-85"
            title="Skriver alle svar på én gang"
          >
            Straks
          </button>
          <button
            onClick={() => {
              setExpanded(false);
              void autonomous.run('document', 'progressive');
            }}
            className="rounded-full border border-hairline px-3 py-1 text-ui hover:border-ink"
            title="Skriver bogstav for bogstav, ét spørgsmål ad gangen, fra toppen af dokumentet"
          >
            Langsomt
          </button>
        </>
      )}
    </div>
  );
}

/**
 * The first thing a new user ever sees inside the panel.
 *
 * It used to be one encouraging line and an instruction to drag files at a
 * button the open panel is covering. Nothing said that the product answers a
 * whole questionnaire in place, or works inside Google Docs at all — the two
 * things it is actually for, and the reason the first users wanted it.
 *
 * So this states the three capabilities in the order a person meets them, and
 * names the one they are standing in right now. No tour, no dismissable
 * coach-marks, nothing to click through: it is simply what fills the panel
 * until the first message, and it leaves the moment there is a conversation.
 */
function EmptyState() {
  const onDocs = typeof location !== 'undefined' && location.host === 'docs.google.com';
  return (
    <div className="mt-8 space-y-4">
      <p className="text-center text-display text-graphite" style={SERIF}>
        En blank side — klar når du er.
      </p>
      <ul className="mx-auto max-w-[300px] space-y-2.5">
        {[
          ['Spørg om hvad som helst', 'Skriv nedenfor. Svaret kan sættes direkte ind, hvor du står.'],
          [
            'Markér tekst, vælg en handling',
            'Omskriv, forenkl, oversæt eller uddyb det, du har markeret på siden.',
          ],
          [
            'Besvar alle spørgsmål',
            onDocs
              ? 'Du står i et Google Docs-dokument. Knappen finder hvert spørgsmål og skriver svaret under det.'
              : 'Finder hvert spørgsmål i det felt, du sidst klikkede i, og skriver et svar under hvert af dem.',
          ],
        ].map(([title, body]) => (
          <li key={title} className="border-l-2 border-hairline pl-2.5">
            <p className="text-ui font-medium text-ink">{title}</p>
            <p className="awa-note">{body}</p>
          </li>
        ))}
      </ul>
      <p className="text-center awa-note">
        Vedhæft baggrund med <b>+ Denne side</b> eller <b>+ Fil</b> — eller slip filer direkte i panelet.
      </p>
    </div>
  );
}

/**
 * A native <select>, deliberately.
 *
 * A hand-built popover would have to solve keyboard navigation, focus
 * trapping, type-ahead and stacking order again, inside a shadow root sitting
 * on someone else's page — and it would still feel like a web widget. The
 * browser's own control gets all of that right, renders its list above every
 * possible z-index because it is not part of the page at all, and is the thing
 * the user's OS already taught them to use.
 */
function Picker({
  label,
  value,
  onChange,
  options,
  title,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  options: [string, string][];
  title?: string;
}) {
  return (
    <label className="flex items-center gap-1.5" title={title}>
      <span className="awa-eyebrow">{label}</span>
      <select
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="max-w-[116px] rounded-full border border-hairline bg-paper px-2 py-0.5 text-aside text-ink outline-none hover:border-ink focus:border-ink"
      >
        {options.map(([v, l]) => (
          <option key={v} value={v}>
            {l}
          </option>
        ))}
      </select>
    </label>
  );
}

function TargetHint() {
  const [status, setStatus] = useState<{ label: string; ok: boolean } | null>(null);
  useEffect(() => {
    const t = setInterval(() => setStatus(inserter.targetStatus()), 1500);
    return () => clearInterval(t);
  }, []);
  if (!status) return <span className="truncate">Intet indsættelsesmål endnu — klik i et tekstfelt på siden</span>;
  return (
    <span className={`truncate ${status.ok ? '' : 'font-medium text-ink'}`}>
      Indsættes i: {status.label}
      {!status.ok && ' (utilgængelig — Kopiér tilbydes)'}
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
    return <div className="ml-10 whitespace-pre-wrap rounded-xl bg-wash px-3 py-2 text-body">{m.content}</div>;
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
      <p className="awa-eyebrow">Udkast</p>
      {editing ? (
        <div className="space-y-1.5">
          <textarea
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            rows={Math.min(14, Math.max(4, draft.split('\n').length + 1))}
            className="awa-edit w-full rounded-xl border border-ink bg-paper px-3 py-2 text-draft leading-relaxed outline-none"
            style={SERIF}
          />
          <div className="flex gap-1.5 text-ui">
            <button onClick={saveEdit} className="rounded-full bg-ink px-3 py-1 text-paper hover:opacity-85">
              Gem
            </button>
            <button onClick={() => setEditing(false)} className="rounded-full border border-hairline px-3 py-1 hover:border-ink">
              Annullér
            </button>
          </div>
        </div>
      ) : (
        <div className="whitespace-pre-wrap border-l-2 border-hairline pl-3 text-draft leading-relaxed" style={SERIF}>
          {m.content}
          {m.streaming && <span className="awa-caret ml-0.5" />}
        </div>
      )}
      {!m.streaming && m.content && !editing && (
        <div className="flex flex-wrap gap-1.5 pl-3 text-ui">
          <button
            onClick={() => inserter.start(m.content, 'instant')}
            className="rounded-full bg-ink px-3 py-1 text-paper hover:opacity-85"
            title="Indsæt det hele på én gang"
          >
            Indsæt straks
          </button>
          <button
            onClick={() => inserter.start(m.content, 'progressive')}
            className="rounded-full border border-hairline px-3 py-1 hover:border-ink"
            title="Skriver bogstav for bogstav i menneskeligt tempo (ca. 30 ord i minuttet) — sæt på pause eller stop når som helst"
          >
            Indsæt langsomt
          </button>
          <button onClick={() => void copy()} className="rounded-full border border-hairline px-3 py-1 hover:border-ink">
            {copied ? 'Kopieret ✓' : 'Kopiér'}
          </button>
          <button
            onClick={() => {
              setDraft(m.content);
              setEditing(true);
            }}
            className="rounded-full border border-hairline px-3 py-1 hover:border-ink"
          >
            Redigér
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
    <div className="sticky bottom-0 space-y-2 rounded-2xl border border-hairline bg-paper p-3 shadow-lg">
      <div className="flex items-baseline justify-between">
        <span className="awa-eyebrow !text-ink">
          {st.state === 'running' && 'Indsætter'}
          {st.state === 'paused' && 'På pause'}
          {st.state === 'done' && (st.unverified ? 'Sendt (ubekræftet)' : 'Indsat ✓')}
          {st.state === 'stopped' && 'Stoppet — delvis tekst beholdt'}
          {st.state === 'idle' && 'Fortrudt'}
        </span>
        <span className="awa-eyebrow">{pct}%</span>
      </div>
      {st.detail && <div className="text-ui text-graphite">{st.detail}</div>}
      {/* The galley line: ink advancing across paper. */}
      <div className="relative h-[4px] w-full overflow-hidden rounded-full bg-wash">
        <div className="absolute left-0 top-0 h-full rounded-full bg-ink transition-all duration-200" style={{ width: `${pct}%` }} />
      </div>
      <div className="flex items-center gap-1.5 text-ui">
        {st.state === 'running' && (
          <button onClick={() => inserter.pause()} className="rounded-full border border-hairline px-2.5 py-1 hover:border-ink">
            ⏸ Pause
          </button>
        )}
        {st.state === 'paused' && (
          <button onClick={() => inserter.resume()} className="rounded-full border border-hairline px-2.5 py-1 hover:border-ink">
            ▶ Fortsæt
          </button>
        )}
        {(st.state === 'running' || st.state === 'paused') && (
          <button onClick={() => inserter.stop()} className="rounded-full border border-hairline px-2.5 py-1 hover:border-ink">
            ■ Stop
          </button>
        )}
        {(st.state === 'done' || st.state === 'stopped' || st.state === 'paused') && (
          <button onClick={() => inserter.undo()} className="rounded-full border border-hairline px-2.5 py-1 hover:border-ink">
            ↩ Fortryd indsættelse
          </button>
        )}
        <button onClick={() => inserter.dismiss()} className="ml-auto px-2 py-1 text-graphite hover:text-ink">
          Skjul
        </button>
      </div>
      <div className="truncate text-aside text-graphite">{st.targetLabel}</div>
    </div>
  );
}

// The whole-run transport for autonomous mode (07-04) — reachable from
// either entry point (document or selection scope), styled like InsertBar.
// Stop and undo act on the WHOLE run, one user-visible step (D-15); there is
// no per-answer control anywhere here. Collapsing the panel unmounts this
// component, but the run itself lives outside the React tree (D-14) and
// keeps going — see apps/extension/insertion/autonomous/orchestrator.ts.
function AutoRunBar() {
  const s = useStore();
  const st = s.autoRun;
  if (!st) return null;
  const pct = Math.round(st.progress * 100);
  return (
    <div className="sticky bottom-0 space-y-2 rounded-2xl border border-hairline bg-paper p-3 shadow-lg">
      <div className="flex items-baseline justify-between">
        <span className="awa-eyebrow !text-ink">
          {st.state === 'writing' && 'Skriver'}
          {st.state === 'paused' && 'På pause'}
          {/* Færdig keeps its checkmark: 07-03's regression suite already asserts on "Færdig ✓" verbatim. */}
          {st.state === 'done' && 'Færdig ✓'}
          {st.state === 'stopped' && 'Stoppet'}
          {st.state === 'idle' && 'Fortrudt'}
          {st.state === 'error' && 'Fejl'}
        </span>
        <span className="awa-eyebrow">
          {st.answersDone} / {st.answersTotal} · {pct}%
        </span>
      </div>
      {st.detail === 'user-typing' && (
        <div className="text-ui text-graphite">På pause — du begyndte at skrive. Fortsæt når du er klar.</div>
      )}
      {st.placement === 'block' && st.degradedReason && <div className="text-ui text-graphite">{st.degradedReason}</div>}
      {/* The galley line: ink advancing across paper. No countdown, no ETA — a
          backgrounded tab throttles Langsomt's timers, so any estimate here
          would just be a lie (D-14). */}
      <div className="relative h-[4px] w-full overflow-hidden rounded-full bg-wash">
        <div className="absolute left-0 top-0 h-full rounded-full bg-ink transition-all duration-200" style={{ width: `${pct}%` }} />
      </div>
      <div className="flex items-center gap-1.5 text-ui">
        {st.state === 'writing' && (
          <button onClick={() => autonomous.pause()} className="rounded-full border border-hairline px-2.5 py-1 hover:border-ink">
            ⏸ Pause
          </button>
        )}
        {st.state === 'paused' && (
          <button onClick={() => autonomous.resume()} className="rounded-full border border-hairline px-2.5 py-1 hover:border-ink">
            ▶ Fortsæt
          </button>
        )}
        {(st.state === 'writing' || st.state === 'paused') && (
          <button onClick={() => autonomous.stop()} className="rounded-full border border-hairline px-2.5 py-1 hover:border-ink">
            ■ Stop
          </button>
        )}
        {(st.state === 'done' || st.state === 'stopped' || st.state === 'paused' || st.state === 'error') && (
          <button onClick={() => autonomous.undo()} className="rounded-full border border-hairline px-2.5 py-1 hover:border-ink">
            ↩ Fortryd alle svar
          </button>
        )}
        <button onClick={() => autonomous.dismiss()} className="ml-auto px-2 py-1 text-graphite hover:text-ink">
          Skjul
        </button>
      </div>
      <div className="truncate text-aside text-graphite">{st.targetLabel}</div>
      {st.ungrounded.length > 0 && (
        <div className="space-y-1 border-t border-hairline pt-2 text-aside">
          <p className="awa-eyebrow !text-ink">Uden grundlag i dine kilder</p>
          <p className="text-graphite">
            {st.ungrounded.length} {st.ungrounded.length === 1 ? 'spørgsmål blev besvaret' : 'spørgsmål blev besvaret'} alligevel,
            uden noget i dine kilder at bygge på — intet er markeret i dokumentet.
          </p>
          <ul className="list-disc space-y-0.5 pl-4 text-graphite">
            {st.ungrounded.map((q, i) => (
              <li key={i}>{q}</li>
            ))}
          </ul>
        </div>
      )}
      {st.unplaced.length > 0 && (
        <div className="space-y-1 border-t border-hairline pt-2 text-aside">
          <p className="awa-eyebrow !text-ink">Kunne ikke placeres · {st.unplaced.length}</p>
          <ul className="list-disc space-y-0.5 pl-4 text-graphite">
            {st.unplaced.map((u, i) => (
              <li key={i}>
                {u.questionText} — {u.reason}
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}
