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
      <h2 className="text-lg font-semibold">
        {mode === 'signin' ? 'Sign in' : mode === 'signup' ? 'Create your account' : 'Reset password'}
      </h2>

      {error && <Banner kind="error" text={error} />}
      {info && <Banner kind="info" text={info} />}

      <input
        type="email"
        placeholder="Email"
        value={email}
        onChange={(e) => setEmail(e.target.value)}
        className="rounded-lg border border-zinc-300 bg-white px-3 py-2 outline-none focus:border-indigo-500 dark:border-zinc-600 dark:bg-zinc-800"
      />
      {mode !== 'reset' && (
        <input
          type="password"
          placeholder="Password (min 6 characters)"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && void submit()}
          className="rounded-lg border border-zinc-300 bg-white px-3 py-2 outline-none focus:border-indigo-500 dark:border-zinc-600 dark:bg-zinc-800"
        />
      )}

      <button
        onClick={() => void submit()}
        disabled={busy || !email || (mode !== 'reset' && password.length < 6)}
        className="rounded-lg bg-indigo-600 py-2 font-medium text-white hover:bg-indigo-500 disabled:opacity-50"
      >
        {busy ? 'Working…' : mode === 'signin' ? 'Sign in' : mode === 'signup' ? 'Create account' : 'Send reset email'}
      </button>

      {mode !== 'reset' && (
        <button
          onClick={() => void google()}
          disabled={busy}
          className="rounded-lg border border-zinc-300 py-2 font-medium hover:bg-zinc-50 disabled:opacity-50 dark:border-zinc-600 dark:hover:bg-zinc-800"
        >
          Continue with Google
        </button>
      )}

      <div className="flex justify-between text-[12px] text-zinc-500">
        {mode === 'signin' ? (
          <>
            <button className="hover:underline" onClick={() => setMode('signup')}>
              Create account
            </button>
            <button className="hover:underline" onClick={() => setMode('reset')}>
              Forgot password?
            </button>
          </>
        ) : (
          <button className="hover:underline" onClick={() => setMode('signin')}>
            ← Back to sign in
          </button>
        )}
      </div>
    </div>
  );
}

export function Banner({ kind, text }: { kind: 'error' | 'info'; text: string }) {
  return (
    <div
      className={`rounded-lg px-3 py-2 text-[12.5px] ${
        kind === 'error'
          ? 'bg-red-50 text-red-700 dark:bg-red-950/60 dark:text-red-300'
          : 'bg-sky-50 text-sky-700 dark:bg-sky-950/60 dark:text-sky-300'
      }`}
    >
      {text}
    </div>
  );
}
