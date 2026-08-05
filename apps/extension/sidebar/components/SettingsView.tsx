import { setPacing, setTheme, useStore } from '../store';

export function SettingsView() {
  const s = useStore();

  return (
    <div className="h-full space-y-5 overflow-y-auto px-4 py-4">
      <section className="space-y-1.5">
        <h3 className="awa-eyebrow">Account</h3>
        <div className="flex items-center justify-between">
          <span>{s.email}</span>
          <button
            onClick={() => void s.signOut()}
            className="rounded-full border border-hairline px-3 py-1 text-[12.5px] hover:border-ink"
          >
            Sign out
          </button>
        </div>
        {s.usage && (
          <p className="text-[12.5px] text-graphite">
            {s.usage.used} of {s.usage.limit} requests used today · resets{' '}
            {new Date(s.usage.resetsAt).toLocaleTimeString()}
          </p>
        )}
      </section>

      <section className="space-y-1.5">
        <h3 className="awa-eyebrow">Appearance</h3>
        <div className="flex gap-2">
          {(['light', 'dark'] as const).map((t) => (
            <button
              key={t}
              onClick={() => setTheme(t)}
              className={`rounded-full px-3 py-1.5 text-[12.5px] capitalize ${
                s.theme === t
                  ? 'bg-ink text-paper'
                  : 'border border-hairline hover:border-ink'
              }`}
            >
              {t}
            </button>
          ))}
        </div>
      </section>

      <section className="space-y-2">
        <h3 className="awa-eyebrow">Insertion pacing</h3>
        <p className="text-[12px] text-graphite">
          Progressive insertion exists so you can read along and stop bad output — the pace is yours to set.
        </p>
        <label className="flex items-center justify-between text-[13px]">
          Speed unit
          <select
            value={s.pacing.mode}
            onChange={(e) => setPacing({ ...s.pacing, mode: e.target.value as 'cps' | 'wps' })}
            className="rounded border border-hairline bg-paper px-2 py-1 text-[12.5px] outline-none focus:border-ink"
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
        <h3 className="awa-eyebrow">Privacy</h3>
        <p className="text-[12px] leading-relaxed text-graphite">
          Page content is only read when you explicitly capture a selection or screenshot. Attached files are processed
          on the project backend and stored only as extracted text inside your own conversations. Content marked
          "contains real data" is routed exclusively to paid AI endpoints with training disabled — enforced on the
          server, not in this UI.
        </p>
      </section>
    </div>
  );
}
