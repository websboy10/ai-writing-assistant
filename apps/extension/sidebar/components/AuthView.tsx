import { useState } from 'react';
import { call } from '../api';
import { useStore } from '../store';

type Mode = 'signin' | 'signup' | 'reset';

export function AuthView() {
  const { set, loadUsage } = useStore();
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
        if (res.ok) setInfo('Reset email sent — open it and follow the link, then sign in here.');
        else setError(res.error ?? 'Reset failed');
        return;
      }
      const res = await call({ kind: mode === 'signin' ? 'login' : 'signup', email, password });
      if (!res.ok) {
        setError(res.error ?? 'Something went wrong');
        return;
      }
      const data = res.data as { email?: string; needsConfirmation?: boolean };
      if (data.needsConfirmation) {
        setInfo('Account created. Check your email for the confirmation link, then sign in.');
        setMode('signin');
        return;
      }
      set({ email: data.email ?? email, view: 'chat' });
      void loadUsage();
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
      setError(res.error ?? 'Google sign-in failed');
      return;
    }
    const data = res.data as { email?: string };
    set({ email: data.email || 'Google account', view: 'chat' });
    void loadUsage();
  }

  return (
    <div className="flex h-full flex-col justify-center gap-3 px-6">
      <p className="awa-eyebrow">
        {mode === 'signin' ? 'Sign in' : mode === 'signup' ? 'New account' : 'Reset password'}
      </p>
      <h2 className="font-draft text-[22px] leading-snug" style={{ fontFamily: 'Charter, Georgia, serif' }}>
        {mode === 'signin'
          ? 'Pick up where you left off.'
          : mode === 'signup'
            ? 'Start drafting anywhere.'
            : 'Get back into your account.'}
      </h2>

      {error && <Banner kind="error" text={error} />}
      {info && <Banner kind="info" text={info} />}

      <input
        type="email"
        placeholder="Email"
        value={email}
        onChange={(e) => setEmail(e.target.value)}
        className="rounded-md border border-hairline bg-paper px-3 py-2 outline-none placeholder:text-graphite focus:border-ink"
      />
      {mode !== 'reset' && (
        <input
          type="password"
          placeholder="Password (min 6 characters)"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && void submit()}
          className="rounded-md border border-hairline bg-paper px-3 py-2 outline-none placeholder:text-graphite focus:border-ink"
        />
      )}

      <button
        onClick={() => void submit()}
        disabled={busy || !email || (mode !== 'reset' && password.length < 6)}
        className="rounded-md bg-ink py-2 font-medium text-paper transition-opacity hover:opacity-85 disabled:opacity-40"
      >
        {busy ? 'Working…' : mode === 'signin' ? 'Sign in' : mode === 'signup' ? 'Create account' : 'Send reset email'}
      </button>

      {mode !== 'reset' && (
        <button
          onClick={() => void google()}
          disabled={busy}
          className="rounded-md border border-hairline py-2 font-medium hover:border-ink disabled:opacity-40"
        >
          Continue with Google
        </button>
      )}

      <div className="flex justify-between text-[12px] text-graphite">
        {mode === 'signin' ? (
          <>
            <button className="underline-offset-2 hover:text-ink hover:underline" onClick={() => setMode('signup')}>
              Create account
            </button>
            <button className="underline-offset-2 hover:text-ink hover:underline" onClick={() => setMode('reset')}>
              Forgot password?
            </button>
          </>
        ) : (
          <button className="underline-offset-2 hover:text-ink hover:underline" onClick={() => setMode('signin')}>
            ← Back to sign in
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
      className={`rounded-r-md px-3 py-2 text-[12.5px] ${
        kind === 'error'
          ? 'border-l-2 border-ink bg-wash font-medium text-ink'
          : 'border-l-2 border-hairline bg-wash text-graphite'
      }`}
    >
      {text}
    </div>
  );
}
