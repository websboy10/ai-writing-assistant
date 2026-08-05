import { setPacing, setTheme, useStore } from '../store';

export function SettingsView() {
  const s = useStore();

  return (
    <div className="h-full space-y-5 overflow-y-auto px-4 py-4">
      <section className="space-y-1.5">
        <h3 className="text-[12px] font-semibold uppercase tracking-wide text-zinc-400">Account</h3>
        <div className="flex items-center justify-between">
          <span>{s.email}</span>
          <button
            onClick={() => void s.signOut()}
            className="rounded-md border border-zinc-300 px-2.5 py-1 text-[12.5px] hover:bg-zinc-50 dark:border-zinc-600 dark:hover:bg-zinc-800"
          >
            Sign out
          </button>
        </div>
        {s.usage && (
          <p className="text-[12.5px] text-zinc-500">
            {s.usage.used} of {s.usage.limit} requests used today · resets{' '}
            {new Date(s.usage.resetsAt).toLocaleTimeString()}
          </p>
        )}
      </section>

      <section className="space-y-1.5">
        <h3 className="text-[12px] font-semibold uppercase tracking-wide text-zinc-400">Appearance</h3>
        <div className="flex gap-2">
          {(['light', 'dark'] as const).map((t) => (
            <button
              key={t}
              onClick={() => setTheme(t)}
              className={`rounded-md px-3 py-1.5 text-[12.5px] capitalize ${
                s.theme === t
                  ? 'bg-indigo-600 text-white'
                  : 'border border-zinc-300 hover:bg-zinc-50 dark:border-zinc-600 dark:hover:bg-zinc-800'
              }`}
            >
              {t}
            </button>
          ))}
        </div>
      </section>

      <section className="space-y-2">
        <h3 className="text-[12px] font-semibold uppercase tracking-wide text-zinc-400">Insertion pacing</h3>
        <p className="text-[12px] text-zinc-500">
          Progressive insertion exists so you can read along and stop bad output — the pace is yours to set.
        </p>
        <label className="flex items-center justify-between text-[13px]">
          Speed unit
          <select
            value={s.pacing.mode}
            onChange={(e) => setPacing({ ...s.pacing, mode: e.target.value as 'cps' | 'wps' })}
            className="rounded-md border border-zinc-300 bg-white px-2 py-1 text-[12.5px] dark:border-zinc-600 dark:bg-zinc-800"
          >
            <option value="cps">characters / second</option>
            <option value="wps">words / second</option>
          </select>
        </label>
        <label className="flex items-center justify-between text-[13px]">
          Rate: <b>{s.pacing.rate}</b>
          <input
            type="range"
            min={s.pacing.mode === 'cps' ? 5 : 1}
            max={s.pacing.mode === 'cps' ? 200 : 30}
            value={s.pacing.rate}
            onChange={(e) => setPacing({ ...s.pacing, rate: Number(e.target.value) })}
            className="w-40"
          />
        </label>
        <label className="flex items-center justify-between text-[13px]">
          Sentence pause: <b>{s.pacing.sentencePauseMs} ms</b>
          <input
            type="range"
            min={0}
            max={2000}
            step={50}
            value={s.pacing.sentencePauseMs}
            onChange={(e) => setPacing({ ...s.pacing, sentencePauseMs: Number(e.target.value) })}
            className="w-40"
          />
        </label>
        <label className="flex items-center justify-between text-[13px]">
          Paragraph pause: <b>{s.pacing.paragraphPauseMs} ms</b>
          <input
            type="range"
            min={0}
            max={4000}
            step={100}
            value={s.pacing.paragraphPauseMs}
            onChange={(e) => setPacing({ ...s.pacing, paragraphPauseMs: Number(e.target.value) })}
            className="w-40"
          />
        </label>
      </section>

      <section className="space-y-1.5">
        <h3 className="text-[12px] font-semibold uppercase tracking-wide text-zinc-400">Privacy</h3>
        <p className="text-[12px] leading-relaxed text-zinc-500">
          Page content is only read when you explicitly capture a selection or screenshot. Attached files are processed
          on the project backend and stored only as extracted text inside your own conversations. Content marked
          "contains real data" is routed exclusively to paid AI endpoints with training disabled — enforced on the
          server, not in this UI.
        </p>
      </section>
    </div>
  );
}
