import { useEffect, useState } from 'react';
import { call } from '../api';
import { useStore } from '../store';

const SERIF = { fontFamily: 'Charter, Georgia, Cambria, serif' };

/**
 * The hard paywall (BILL-01). Shown when the 7-day trial is over and no
 * subscription is active. The server enforces the gate — this view is just
 * the honest storefront in front of it.
 */
export function PaywallView() {
  const s = useStore();
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  // Auto-unlock: poll while visible, so completing payment in the Stripe tab
  // flips this view by itself — no manual refresh to explain to anyone.
  useEffect(() => {
    const t = setInterval(() => void useStore.getState().loadBilling(), 5_000);
    return () => clearInterval(t);
  }, []);

  async function open(kind: 'checkout' | 'portal') {
    setBusy(true);
    setErr(null);
    const res = await call({ kind: 'api', path: `/api/billing/${kind}`, method: 'POST' });
    setBusy(false);
    const url = (res.data as { url?: string } | undefined)?.url;
    if (res.ok && url) window.open(url, '_blank');
    else setErr(res.error ?? 'Betalingssiden kunne ikke åbnes. Prøv igen.');
  }

  return (
    <div className="flex h-full flex-col items-center justify-center gap-4 overflow-y-auto px-6 py-8 text-center">
      <p className="awa-eyebrow">Prøveperioden er slut</p>
      <h2 className="text-title leading-snug" style={SERIF}>
        Skriv videre for 50 kr. om måneden.
      </h2>
      <ul className="space-y-1.5 text-body text-graphite">
        <li>Ubegrænset skrivehjælp — hver dag</li>
        <li>Læser dine filer: PDF, Word, billeder, scanninger</li>
        <li>Indsætter direkte i dine dokumenter, også Google Docs</li>
      </ul>
      <button
        onClick={() => void open('checkout')}
        disabled={busy}
        className="mt-1 rounded-full bg-ink px-6 py-2.5 text-lead font-medium text-paper hover:opacity-85 disabled:opacity-40"
      >
        {busy ? 'Åbner…' : 'Opgrader — 50 kr./md.'}
      </button>
      {s.billing?.subscribed && (
        <button onClick={() => void open('portal')} className="text-ui underline underline-offset-2 hover:text-ink">
          Administrér abonnement
        </button>
      )}
      {err && <p className="text-ui font-medium text-ink">{err}</p>}
      <p className="max-w-[260px] text-aside leading-relaxed text-graphite">
        Betalingen håndteres sikkert af Stripe. Ingen binding — opsig når som helst. Når betalingen er gennemført,
        låser panelet op af sig selv.
      </p>
    </div>
  );
}
