import { memo, useEffect, useRef, useState } from 'react';
import { CHAT_STATUS_LABELS, LENGTH_HINTS, LENGTH_LABELS, type ChatStatus, type OutputLength, type PromptTemplate, type WebSource } from '@awa/shared';
import { call } from '../api';
import { sendChat, stopGeneration } from '../chat';
import { MAX_WPM, MIN_WPM, type RunState } from '@/insertion';
import { autonomous } from '../autonomous';
import { inserter } from '../inserter';
import { useStore, type UiMessage } from '../store';
import { newContextId } from '../ingest';
import { awaLog } from '@/insertion/debug';
import { Banner } from './AuthView';
import { ContextChips } from './ContextPanel';

// System serif: web fonts don't load reliably inside a shadow DOM, and an
// overlay must render instantly. The serif is the assistant's voice (see
// style.css — "Galley" design system).
const SERIF = { fontFamily: 'Charter, Georgia, Cambria, serif' };

const LENGTHS: [OutputLength, string][] = (['short', 'medium', 'long'] as const).map((k) => [k, LENGTH_LABELS[k]]);

export function ChatView() {
  const s = useStore();
  // Lives in the store, not here: this component unmounts when the panel
  // collapses, and an unsent instruction should survive that.
  const input = s.draft;
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
    if (!text) return;
    sendChat(text);
    s.set({ draft: '' });
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
        {/* Not while the transport bar is up: it is `sticky bottom-0` in this
            same scroller, and a finished run's bar floating over "En blank
            side" reads as two panels arguing. */}
        {s.messages.length === 0 && !s.insertStatus && !s.autoRun && <EmptyState />}
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
        <ContextChips />
        <SelectionBar />

        <AutonomousBar />

        <TemplateBar />

        {/*
          One picker now, where there were two.
          Tone went with the five adjectives it offered: the voice is set by the
          system prompt, and a "Formel" switch argued with it on every request.
          Length stayed, and became three fixed sizes with real word counts
          behind them — the tooltip states them, so the row is a promise rather
          than a hint.
        */}
        <div className="flex flex-wrap items-center gap-1.5">
          <Picker
            value={s.prefs.length ?? 'medium'}
            onChange={(v) => s.setPrefs({ length: v as OutputLength })}
            title={`Svarets længde. ${LENGTH_HINTS[s.prefs.length ?? 'medium']}`}
            options={LENGTHS}
          />
        </div>

        <PacingRow />

        <div className="flex items-end gap-2">
          <textarea
            ref={composerRef}
            value={input}
            onChange={(e) => s.set({ draft: e.target.value })}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault();
                send();
              }
            }}
            rows={1}
            placeholder="Skriv til assistenten…"
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
              disabled={!input.trim()}
              title="Send"
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

/**
 * How "Indsæt langsomt" types, set once and remembered.
 *
 * A slider rather than three named presets: the point of slow mode is that a
 * person reads along, and how fast that is comfortable differs by person and
 * by document. The figure beside it is in words per minute because that is
 * the unit people already have a feel for (a typist does 40 to 60).
 *
 * The switch beside it is the one an HR team asked for: with it on, the run
 * makes the small mistakes a person makes and corrects them, so the document
 * looks like a colleague working in it. Off by default — a first-time user
 * who sees a typo appear should have chosen that.
 */
function PacingRow() {
  const pacing = useStore((st) => st.pacing);
  const setPacing = useStore((st) => st.setPacing);
  return (
    <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5 text-aside text-graphite">
      <label
        className="flex min-w-[200px] flex-1 items-center gap-2"
        title="Tempoet for Indsæt langsomt, i ord i minuttet. En person skriver typisk 30 til 60."
      >
        <span className="awa-eyebrow shrink-0">Tempo</span>
        <input
          type="range"
          min={MIN_WPM}
          max={MAX_WPM}
          step={5}
          value={pacing.wpm}
          onChange={(e) => setPacing({ wpm: Number(e.target.value) })}
          className="h-1 min-w-0 flex-1 accent-ink"
        />
        <span className="awa-num w-[76px] shrink-0 text-right">{pacing.wpm} ord/min</span>
      </label>
      <label
        className="flex shrink-0 cursor-pointer items-center gap-1.5"
        title="Laver små tastefejl og retter dem, og sletter og skriver et ord om igen en gang imellem, så det ligner en kollega, der skriver. Teksten ender altid præcis som udkastet."
      >
        <input
          type="checkbox"
          checked={pacing.human}
          onChange={(e) => setPacing({ human: e.target.checked })}
          className="h-3.5 w-3.5 accent-ink"
        />
        <span className={pacing.human ? 'text-ink' : ''}>Skriv som et menneske</span>
      </label>
    </div>
  );
}

/**
 * What is happening during the silence before the first word.
 *
 * That silence grew on 2026-09-08 and the user was told nothing about it:
 * deciding whether to look something up takes about 0.8s, and a search adds
 * two to four more. Five seconds of a blank panel reads as broken.
 *
 * It says WHICH wait it is rather than showing a spinner, because the two are
 * genuinely different — "Søger på internettet" also explains why this answer
 * will carry sources when the last one did not. Sans, not the draft serif: this
 * is the panel talking, not the draft, and it must never be mistaken for text
 * that is about to be inserted.
 */
function Waiting({ status }: { status: ChatStatus }) {
  return (
    <span className="inline-flex items-center gap-1.5 font-sans text-ui text-graphite" style={{ fontStyle: 'normal' }}>
      <span className="awa-pulse h-1.5 w-1.5 shrink-0 rounded-full bg-graphite" />
      {/* Label and dots in ONE child: as two, the flex gap opened a space
          between them and it read as "Søger på internettet  ..." */}
      <span className="awa-ellipsis">{CHAT_STATUS_LABELS[status]}</span>
    </span>
  );
}

/**
 * Where a searched answer came from, under the answer and never in it.
 *
 * There is no "search the web" switch to go with this, deliberately. The
 * decision is the server's, because a person cannot tell which of their own
 * questions the model is unsure about — that is the reason they asked it. So
 * this line is also the only signal that a search happened at all.
 *
 * Titles only, not addresses: this sits in a 360px panel and a full URL wraps
 * over three lines and tells the reader less than the page's own name does.
 */
function Sources({ sources }: { sources: WebSource[] }) {
  return (
    <div className="mt-1.5 flex flex-wrap items-baseline gap-x-1.5 gap-y-0.5 text-aside text-graphite">
      <span className="awa-eyebrow shrink-0">Kilder</span>
      {sources.map((s, i) => (
        <span key={s.url}>
          <a href={s.url} target="_blank" rel="noreferrer noopener" className="underline hover:text-ink" title={s.url}>
            {s.title || s.url}
          </a>
          {i < sources.length - 1 ? ' ·' : ''}
        </span>
      ))}
    </div>
  );
}

/**
 * Saved instructions — the last feature that existed entirely on the server.
 *
 * A table, an RLS policy, a migration and three endpoints, all written in
 * Danish and all finished, with nothing in the extension that ever called
 * them. For the users this product was built for — an HR team writing forty
 * performance reviews to the same house rules — retyping "hold det under 150
 * ord, tredjeperson, ingen superlativer" forty times is the actual work.
 *
 * Hidden until it can do something: someone who has never saved a template and
 * has not typed anything sees nothing here at all. The panel earns its rows.
 */
function TemplateBar() {
  const s = useStore();
  const [items, setItems] = useState<PromptTemplate[]>([]);
  const [chosen, setChosen] = useState('');
  const [naming, setNaming] = useState(false);
  const [name, setName] = useState('');

  useEffect(() => {
    void (async () => {
      const res = await call({ kind: 'api', path: '/api/templates' });
      if (res.ok) setItems(res.data as PromptTemplate[]);
    })();
  }, []);

  async function save() {
    const trimmed = name.trim();
    const instructions = s.draft.trim();
    if (!trimmed || !instructions) return;
    const res = await call({
      kind: 'api',
      path: '/api/templates',
      method: 'POST',
      body: { name: trimmed, instructions },
    });
    if (!res.ok) {
      s.set({ error: res.error ?? 'Skabelonen kunne ikke gemmes.' });
      return;
    }
    setItems([res.data as PromptTemplate, ...items]);
    setNaming(false);
    setName('');
    s.set({ notice: `Skabelonen "${trimmed}" er gemt.` });
  }

  async function remove() {
    const t = items.find((i) => i.id === chosen);
    if (!t) return;
    const res = await call({ kind: 'api', path: `/api/templates/${t.id}`, method: 'DELETE' });
    if (!res.ok) {
      s.set({ error: res.error ?? 'Skabelonen kunne ikke slettes.' });
      return;
    }
    setItems(items.filter((i) => i.id !== t.id));
    setChosen('');
    s.set({ notice: `Skabelonen "${t.name}" er slettet.` });
  }

  if (!items.length && !s.draft.trim() && !naming) return null;

  if (naming) {
    return (
      <div className="flex items-center gap-1.5 text-ui">
        <input
          autoFocus
          value={name}
          onChange={(e) => setName(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') void save();
            if (e.key === 'Escape') setNaming(false);
          }}
          maxLength={60}
          placeholder="Navn på skabelonen…"
          className="min-w-0 flex-1 rounded-full border border-hairline bg-paper px-2.5 py-1 outline-none placeholder:text-graphite focus:border-ink"
        />
        <button onClick={() => void save()} disabled={!name.trim()} className="rounded-full bg-ink px-3 py-1 text-paper disabled:opacity-40">
          Gem
        </button>
        <button onClick={() => setNaming(false)} className="rounded-full border border-hairline px-2.5 py-1 hover:border-ink">
          Annullér
        </button>
      </div>
    );
  }

  return (
    <div className="flex flex-wrap items-center gap-1.5 text-ui">
      {items.length > 0 && (
        <select
          value={chosen}
          title="Hent en gemt instruktion ind i skrivefeltet"
          onChange={(e) => {
            setChosen(e.target.value);
            const t = items.find((i) => i.id === e.target.value);
            if (t) s.set({ draft: t.instructions });
          }}
          className="max-w-[180px] rounded-full border border-hairline bg-paper px-2 py-0.5 text-aside text-ink outline-none hover:border-ink focus:border-ink"
        >
          <option value="">Gemte instruktioner…</option>
          {items.map((t) => (
            <option key={t.id} value={t.id}>
              {t.name}
            </option>
          ))}
        </select>
      )}
      {chosen && (
        <button onClick={() => void remove()} title="Slet den valgte skabelon" className="px-1 text-graphite hover:text-ink">
          ✕
        </button>
      )}
      {s.draft.trim() && (
        <button
          onClick={() => setNaming(true)}
          title="Gem det, der står i skrivefeltet, så du kan hente det frem igen"
          className="rounded-full border border-hairline px-2.5 py-1 text-aside hover:border-ink"
        >
          Gem som skabelon
        </button>
      )}
    </div>
  );
}

/** A run that is genuinely in flight, so a second one cannot start on top of it. */
const isRunActive = (state?: RunState): boolean => state === 'writing' || state === 'paused';

/**
 * Whether "Besvar alle spørgsmål" is reachable at all. False in the store
 * build — see the comment on answerAllEnabled in wxt.config.ts for why the
 * feature is held back with a flag instead of being reverted.
 *
 * Gating the ENTRY POINT rather than the machinery is deliberate: with no way
 * to start a run, `autoRun` is never set, so AutoRunBar never renders either
 * and the whole path is unreachable through the UI.
 */
const ANSWER_ALL_ENABLED = __AWA_ANSWER_ALL__;

/**
 * Marked text on the page: its two jobs, offered the moment there is
 * something to act on.
 *
 * "Besvar markeringen" is "Besvar alle spørgsmål" scoped to the marking — the
 * same structure read, the same plan for where each answer goes, the same
 * formatted slow typing — so a person can mark two questions and their boxes
 * out of a long form and have only those answered. "Brug som kontekst"
 * attaches the marked text as background the assistant can draw on, and
 * never starts a run.
 *
 * Polled once a second through a free read (inserter.hasMarkedText): on Docs
 * that is the input frame's placeholder, not a copy dispatch — asking Docs
 * for the selection itself every second while it was being written to
 * corrupted a document (2026-08-18). The text is fetched once when a marking
 * appears, and again on a click. Paused, and hidden, while a run is writing.
 */
function SelectionBar() {
  const s = useStore();
  const [marked, setMarked] = useState('');
  const [expanded, setExpanded] = useState(false);
  const writing =
    isRunActive(s.autoRun?.state) || s.insertStatus?.state === 'running' || s.insertStatus?.state === 'paused';

  useEffect(() => {
    if (writing) return;
    const t = setInterval(() => {
      const has = inserter.hasMarkedText();
      const text = has ? inserter.selectionText() : '';
      awaLog('selection.poll', { has, chars: text.length });
      setMarked((prev) => (has ? prev || text : ''));
    }, 1000);
    return () => clearInterval(t);
  }, [writing]);

  if (!marked || writing) return null;

  function useAsContext() {
    const text = inserter.selectionText() || marked;
    if (!text) return;
    s.addContext({
      id: newContextId(),
      name: `Markeret tekst (${text.length.toLocaleString('da-DK')} tegn)`,
      kind: 'selection',
      text,
      chars: text.length,
      truncated: false,
    });
    s.set({ notice: 'Den markerede tekst er vedhæftet som baggrundsviden.' });
  }

  return (
    <div className="space-y-1.5 rounded-xl border border-hairline p-2.5">
      <p className="awa-note !text-ink">
        Du har markeret tekst · <span className="awa-num">{marked.length.toLocaleString('da-DK')}</span> tegn
      </p>
      <div className="flex flex-wrap gap-1.5 text-ui">
        {ANSWER_ALL_ENABLED && !expanded && (
          <button
            onClick={() => setExpanded(true)}
            className="rounded-full bg-ink px-3 py-1 text-paper hover:opacity-85"
            title="Finder spørgsmålene i det markerede og skriver svarene ind i deres bokse — Straks eller Langsomt"
          >
            Besvar markeringen
          </button>
        )}
        {ANSWER_ALL_ENABLED && expanded && (
          <>
            <button
              onClick={() => {
                setExpanded(false);
                void autonomous.run('selection', 'instant');
              }}
              className="rounded-full bg-ink px-3 py-1 text-paper hover:opacity-85"
              title="Skriver alle svar på én gang"
            >
              Straks
            </button>
            <button
              onClick={() => {
                setExpanded(false);
                void autonomous.run('selection', 'progressive');
              }}
              className="rounded-full border border-hairline px-3 py-1 hover:border-ink"
              title="Skriver bogstav for bogstav, ét spørgsmål ad gangen, fra toppen af markeringen"
            >
              Langsomt
            </button>
          </>
        )}
        <button
          onClick={useAsContext}
          className="rounded-full border border-hairline px-3 py-1 hover:border-ink"
          title="Teksten vedhæftes som baggrundsviden, assistenten kan trække på"
        >
          Brug som kontekst
        </button>
      </div>
      <p className="awa-note">
        {ANSWER_ALL_ENABLED
          ? 'Svar skrives ind i markeringen, i dens bokse og punkter · kontekst vedhæftes som baggrundsviden.'
          : 'Kontekst vedhæftes som baggrundsviden.'}
      </p>
    </div>
  );
}

/**
 * "Besvar alle spørgsmål" — find every question in the document the user last
 * clicked in, and write an answer under each one, without stopping to ask.
 *
 * No review step and no approval gate: pressing Straks or Langsomt writes
 * directly (D-04). The transport in AutoRunBar is what a person stops it with.
 */
function AutonomousBar() {
  const s = useStore();
  const [expanded, setExpanded] = useState(false);

  if (!ANSWER_ALL_ENABLED) return null;

  // Hidden only while a run is genuinely in flight. Once it has finished it
  // must come back: hiding it until "Skjul" is pressed made the panel's
  // primary action vanish after every successful run, with nothing on screen
  // saying why or how to get it back.
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
 * Stop and undo act on the WHOLE run, one user-visible step (D-15); there is no
 * per-answer control anywhere here. Collapsing the panel unmounts this
 * component, but the run lives outside the React tree (D-14) and keeps going.
 */
function AutoRunBar() {
  const s = useStore();
  const st = s.autoRun;
  if (!st) return null;
  const pct = Math.round(st.progress * 100);
  // Between pressing the button and the first character there is one network
  // call that finds the questions — measured against production 2026-08-25 at
  // 9.7s, 14.0s and 29.4s. For all of it the run said "Skriver · 0 / 0 · 0%":
  // claiming to write before it has anything to write, beside a counter that
  // reads as "nothing to do". Both are knowable from what is already here — a
  // run that is writing always has at least one answer to write.
  const finding = st.state === 'writing' && st.answersTotal === 0;
  return (
    <div className="sticky bottom-0 space-y-2 rounded-2xl border border-hairline bg-paper p-3 shadow-lg">
      <div className="flex items-baseline justify-between">
        <span className="awa-eyebrow !text-ink">
          {st.state === 'writing' && (finding ? 'Forbereder' : 'Skriver')}
          {st.state === 'paused' && 'På pause'}
          {st.state === 'done' && 'Færdig ✓'}
          {st.state === 'stopped' && 'Stoppet'}
          {st.state === 'idle' && 'Fortrudt'}
          {st.state === 'error' && 'Fejl'}
        </span>
        <span className="awa-eyebrow">
          {finding ? '' : `${st.answersDone} / ${st.answersTotal} · ${pct}%`}
        </span>
      </div>
      {/* The wait, said out loud. It used to be one line, "Finder spørgsmål",
          for up to a minute; a person cannot tell a minute of work from a
          hang, so every stage the run passes through is listed as it happens. */}
      {finding && (
        <ul className="space-y-0.5 text-ui">
          {st.steps.map((step, i) => {
            const current = i === st.steps.length - 1;
            return (
              <li key={i} className={current ? 'text-ink' : 'text-graphite'}>
                {current ? '…' : '✓'} {step}
              </li>
            );
          })}
        </ul>
      )}
      {st.detail === 'user-typing' && (
        <div className="text-ui text-graphite">På pause — du begyndte at skrive. Fortsæt når du er klar.</div>
      )}
      {st.detail === 'user-clicked' && (
        <div className="text-ui text-graphite">På pause — du klikkede i dokumentet. Sæt markøren tilbage efter det sidste bogstav, og fortsæt.</div>
      )}
      {st.placement === 'block' && st.degradedReason && <div className="text-ui text-graphite">{st.degradedReason}</div>}
      {/* The galley line: ink advancing across paper. No countdown, no ETA — a
          backgrounded tab throttles Langsomt's timers, so any estimate here
          would just be a lie (D-14). Before the questions are known there is no
          fraction to draw either, so it travels instead of filling. */}
      <div className="relative h-[4px] w-full overflow-hidden rounded-full bg-wash">
        {finding ? (
          <div className="awa-galley absolute left-0 top-0 h-full rounded-full bg-ink" />
        ) : (
          <div
            className="absolute left-0 top-0 h-full rounded-full bg-ink transition-all duration-200"
            style={{ width: `${pct}%` }}
          />
        )}
      </div>
      <div className="flex flex-wrap items-center gap-1.5 whitespace-nowrap text-ui">
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
          <button onClick={() => void autonomous.undo()} className="rounded-full border border-hairline px-2.5 py-1 hover:border-ink">
            ↩ Fortryd alle svar
          </button>
        )}
        <button onClick={() => autonomous.dismiss()} className="ml-auto px-2 py-1 text-graphite hover:text-ink">
          Skjul
        </button>
      </div>
      <div className="truncate text-aside text-graphite">{st.targetLabel}</div>
      {/* This list carries more weight than it used to. Placement had a
          fallback — when Docs' Find could not reach a question, the answer went
          in through the Google Docs API instead. That API is gone (it forced
          OAuth verification and blocked the store release), so a question Find
          cannot reach is simply not answered in the document. Saying so is the
          whole of the replacement: the alternative is guessing a position, and
          a wrong guess writes into the middle of somebody's real document. */}
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

/**
 * The first thing a new user ever sees inside the panel.
 *
 * It states what the product does in the order a person meets it, and names
 * the page they are standing in. No tour, no dismissable coach-marks, nothing
 * to click through: it is simply what fills the panel until the first
 * message, and it leaves the moment there is a conversation.
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
          ['Spørg om hvad som helst', 'Skriv nedenfor. Svaret kommer som et udkast, du kan rette i.'],
          [
            'Sæt svaret ind, hvor du står',
            onDocs
              ? 'Klik i dokumentet, og vælg Indsæt straks eller Indsæt langsomt. Langsomt skriver bogstav for bogstav i det tempo, du vælger.'
              : 'Klik i det felt, teksten skal ind i, og vælg Indsæt straks eller Indsæt langsomt. Langsomt skriver bogstav for bogstav i det tempo, du vælger.',
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
      className="rounded-full border border-hairline bg-paper px-2 py-0.5 text-aside text-ink outline-none hover:border-ink focus:border-ink"
    >
      {options.map(([v, l]) => (
        <option key={v} value={v}>
          {l}
        </option>
      ))}
    </select>
  );
}

function TargetHint() {
  const [status, setStatus] = useState<{ label: string; ok: boolean; reason?: string } | null>(null);
  useEffect(() => {
    const read = () => {
      const next = inserter.targetStatus();
      setStatus(next);
      // One poller for the whole panel: the draft buttons need the same answer
      // and should not each run an interval to get it.
      const can = !!next?.ok;
      if (useStore.getState().hasInsertTarget !== can) useStore.getState().set({ hasInsertTarget: can });
    };
    read();
    const t = setInterval(read, 1500);
    return () => clearInterval(t);
  }, []);
  // Both strings are set to fit the footer beside "+ Ny samtale" at 400px. The
  // longer versions were cut off mid-word, which turned the one line telling
  // the user WHERE their text would land into noise.
  if (!status) return <span className="truncate" title="Klik i det felt eller dokument, teksten skal ind i">Intet mål valgt endnu</span>;
  return (
    <span className={`truncate ${status.ok ? '' : 'font-medium text-ink'}`} title={status.reason ?? status.label}>
      Indsættes i: {status.label}
      {!status.ok && ' (utilgængelig)'}
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
  // Narrow selectors, not the whole store: this re-renders when the answer
  // changes and never on a streamed token.
  const canInsert = useStore((st) => st.hasInsertTarget);
  const wpm = useStore((st) => st.pacing.wpm);

  if (m.role === 'user') {
    return <div className="ml-10 whitespace-pre-wrap rounded-xl bg-wash px-3 py-2 text-body">{m.content}</div>;
  }

  // A stream that dies before its first token leaves an assistant message with
  // nothing in it. Rendering the shell anyway puts the word "Udkast" above an
  // empty space, directly over the banner explaining that it failed — labelling
  // a failure as a draft. Seen on a screenshot of the dead-stream check; no
  // assertion would have caught it, because every assertion was about the
  // banner and the banner was right.
  if (!m.content && !m.streaming) return null;

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
          {m.content || (m.status ? <Waiting status={m.status} /> : null)}
          {m.streaming && m.content && <span className="awa-caret ml-0.5" />}
        </div>
      )}
      {m.sources?.length && !editing ? <Sources sources={m.sources} /> : null}
      {!m.streaming && m.content && !editing && (
        <div className="flex flex-wrap gap-1.5 pl-3 text-ui">
          {/* Which of these is the primary action depends on whether there is
              anywhere to insert INTO. With no target, pressing "Indsæt straks"
              is a dead end: a banner saying to click a field first, which the
              user then dismisses, clicks, and presses again. Three steps to
              arrive back here. The footer already says "Intet mål valgt endnu",
              so the panel knows — it was just still leading with the button
              that could not work. Copy always works, so when insertion cannot,
              Copy is the one wearing the filled style. Nothing is disabled:
              clicking a field and pressing Insert is still the better path when
              it is available, and the button explains that itself. */}
          <button
            onClick={() => inserter.start(m.content, 'instant', m.markdown)}
            className={`rounded-full px-3 py-1 ${canInsert ? 'bg-ink text-paper hover:opacity-85' : 'border border-hairline hover:border-ink'}`}
            title={
              canInsert
                ? 'Indsæt det hele på én gang — overskrifter, fed skrift og punkttegn kommer med i Google Docs'
                : 'Klik først i det felt eller dokument, teksten skal ind i'
            }
          >
            Indsæt straks
          </button>
          <button
            onClick={() => inserter.start(m.content, 'progressive')}
            className="rounded-full border border-hairline px-3 py-1 hover:border-ink"
            title={`Skriver bogstav for bogstav, ${wpm} ord i minuttet (tempoet vælges nederst), og kan sættes på pause eller stoppes når som helst. Teksten kommer ind uden formatering — vælg Indsæt straks, hvis den skal beholde overskrifter og punkttegn`}
          >
            Indsæt langsomt
          </button>
          <button
            onClick={() => void copy()}
            className={`rounded-full px-3 py-1 ${canInsert ? 'border border-hairline hover:border-ink' : 'bg-ink text-paper hover:opacity-85'}`}
          >
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
      {/* The row wraps; the pills never do. Paused, this row carries Fortsæt,
          Stop, "Fortryd indsættelse" and Skjul — about 10px more than a 400px
          panel has room for. Without flex-wrap the overflow was taken out of
          the widest pill instead, so "Fortryd indsættelse" broke across two
          lines inside its own border and stood a head taller than the buttons
          beside it (07-typing-guard.png). white-space inherits, so setting it
          here keeps every label on one line and makes the ROW give way. */}
      <div className="flex flex-wrap items-center gap-1.5 whitespace-nowrap text-ui">
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
