import { setPacing, setTheme, useStore } from '../store';

export function SettingsView() {
  const s = useStore();

  return (
    <div className="h-full space-y-5 overflow-y-auto px-4 py-4">
      <section className="space-y-1.5">
        <h3 className="awa-eyebrow">Konto</h3>
        <div className="flex items-center justify-between">
          <span>{s.email}</span>
          <button
            onClick={() => void s.signOut()}
            className="rounded-full border border-hairline px-3 py-1 text-[12.5px] hover:border-ink"
          >
            Log ud
          </button>
        </div>
        {s.usage && (
          <p className="text-[12.5px] text-graphite">
            {s.usage.used} af {s.usage.limit} forespørgsler brugt i dag · nulstilles{' '}
            {new Date(s.usage.resetsAt).toLocaleTimeString('da-DK')}
          </p>
        )}
      </section>

      <section className="space-y-1.5">
        <h3 className="awa-eyebrow">Udseende</h3>
        <div className="flex gap-2">
          {([['light', 'Lys'], ['dark', 'Mørk']] as const).map(([t, label]) => (
            <button
              key={t}
              onClick={() => setTheme(t)}
              className={`rounded-full px-3 py-1.5 text-[12.5px] ${
                s.theme === t
                  ? 'bg-ink text-paper'
                  : 'border border-hairline hover:border-ink'
              }`}
            >
              {label}
            </button>
          ))}
        </div>
      </section>

      <section className="space-y-2">
        <h3 className="awa-eyebrow">Indsættelsestempo</h3>
        <p className="text-[12px] text-graphite">
          Gradvis indsættelse findes, så du kan læse med og stoppe dårligt output — tempoet bestemmer du.
        </p>
        <label className="flex items-center justify-between text-[13px]">
          Hastighedsenhed
          <select
            value={s.pacing.mode}
            onChange={(e) => setPacing({ ...s.pacing, mode: e.target.value as 'cps' | 'wps' })}
            className="rounded border border-hairline bg-paper px-2 py-1 text-[12.5px] outline-none focus:border-ink"
          >
            <option value="cps">tegn / sekund</option>
            <option value="wps">ord / sekund</option>
          </select>
        </label>
        <label className="flex items-center justify-between text-[13px]">
          Hastighed: <b>{s.pacing.rate}</b>
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
          Sætningspause: <b>{s.pacing.sentencePauseMs} ms</b>
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
          Afsnitspause: <b>{s.pacing.paragraphPauseMs} ms</b>
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
        <h3 className="awa-eyebrow">Privatliv</h3>
        <p className="text-[12px] leading-relaxed text-graphite">
          Sideindhold læses kun, når du selv indfanger en markering eller et skærmbillede. Vedhæftede filer behandles
          på projektets backend og gemmes kun som udtrukket tekst i dine egne samtaler. Indhold markeret med
          "indeholder rigtige data" sendes udelukkende til betalte AI-modeller med træning slået fra — håndhævet på
          serveren, ikke i denne brugerflade.
        </p>
      </section>
    </div>
  );
}
