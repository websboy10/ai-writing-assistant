import { useState } from 'react';
import { call } from '../api';
import { useStore } from '../store';

type Mode = 'signin' | 'signup' | 'reset';

export function AuthView() {
  const { set, loadUsage, loadBilling } = useStore();
  const [mode, setMode] = useState<Mode>('signin');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [info, setInfo] = useState<string | null>(null);

  async function submit() {
    setBusy(true);
    setError(null);
    setInfo(null);
    try {
      if (mode === 'reset') {
        const res = await call({ kind: 'reset', email });
        if (res.ok) setInfo('Nulstillingsmail sendt — åbn den og følg linket, og log derefter ind her.');
        else setError(res.error ?? 'Nulstilling fejlede');
        return;
      }
      const res = await call({ kind: mode === 'signin' ? 'login' : 'signup', email, password });
      if (!res.ok) {
        setError(res.error ?? 'Noget gik galt');
        return;
      }
      const data = res.data as { email?: string; needsConfirmation?: boolean };
      if (data.needsConfirmation) {
        setInfo('Konto oprettet. Tjek din e-mail for bekræftelseslinket, og log derefter ind.');
        setMode('signin');
        return;
      }
      set({ email: data.email ?? email, view: 'chat' });
      void loadUsage();
      void loadBilling();
    } finally {
      setBusy(false);
    }
  }

  async function google() {
    setBusy(true);
    setError(null);
    const res = await call({ kind: 'google-auth' });
    setBusy(false);
    if (!res.ok) {
      setError(res.error ?? 'Google-login fejlede');
      return;
    }
    const data = res.data as { email?: string };
    set({ email: data.email || 'Google account', view: 'chat' });
    void loadUsage();
    void loadBilling();
  }

  return (
    <div className="flex h-full flex-col justify-center gap-3 px-6">
      <p className="awa-eyebrow">
        {mode === 'signin' ? 'Log ind' : mode === 'signup' ? 'Ny konto' : 'Nulstil adgangskode'}
      </p>
      <h2 className="font-draft text-title leading-snug" style={{ fontFamily: 'Charter, Georgia, serif' }}>
        {mode === 'signin'
          ? 'Fortsæt, hvor du slap.'
          : mode === 'signup'
            ? 'Skriv udkast hvor som helst.'
            : 'Kom ind på din konto igen.'}
      </h2>

      {error && <Banner kind="error" text={error} />}
      {info && <Banner kind="info" text={info} />}

      <input
        type="email"
        placeholder="E-mail"
        value={email}
        onChange={(e) => setEmail(e.target.value)}
        className="rounded-xl border border-hairline bg-paper px-3 py-2 outline-none placeholder:text-graphite focus:border-ink"
      />
      {mode !== 'reset' && (
        <input
          type="password"
          placeholder="Adgangskode (mindst 6 tegn)"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && void submit()}
          className="rounded-xl border border-hairline bg-paper px-3 py-2 outline-none placeholder:text-graphite focus:border-ink"
        />
      )}

      <button
        onClick={() => void submit()}
        disabled={busy || !email || (mode !== 'reset' && password.length < 6)}
        className="rounded-xl bg-ink py-2 font-medium text-paper transition-opacity hover:opacity-85 disabled:opacity-40"
      >
        {busy ? 'Arbejder…' : mode === 'signin' ? 'Log ind' : mode === 'signup' ? 'Opret konto' : 'Send nulstillingsmail'}
      </button>

      {mode !== 'reset' && (
        <button
          onClick={() => void google()}
          disabled={busy}
          className="rounded-xl border border-hairline py-2 font-medium hover:border-ink disabled:opacity-40"
        >
          Fortsæt med Google
        </button>
      )}

      <div className="flex justify-between text-ui text-graphite">
        {mode === 'signin' ? (
          <>
            <button className="underline-offset-2 hover:text-ink hover:underline" onClick={() => setMode('signup')}>
              Opret konto
            </button>
            <button className="underline-offset-2 hover:text-ink hover:underline" onClick={() => setMode('reset')}>
              Glemt adgangskode?
            </button>
          </>
        ) : (
          <button className="underline-offset-2 hover:text-ink hover:underline" onClick={() => setMode('signin')}>
            ← Tilbage til log ind
          </button>
        )}
      </div>
    </div>
  );
}

export function Banner({ kind, text }: { kind: 'error' | 'info'; text: string }) {
  // Monochrome severity: errors get a solid left rule and full-strength ink;
  // notices stay quiet in graphite. No hue anywhere.
  return (
    <div
      className={`rounded-xl px-3 py-2 text-ui ${
        kind === 'error'
          ? 'border-l-2 border-ink bg-wash font-medium text-ink'
          : 'border-l-2 border-hairline bg-wash text-graphite'
      }`}
    >
      {text}
    </div>
  );
}
