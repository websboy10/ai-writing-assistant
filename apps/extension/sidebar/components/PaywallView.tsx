import { useEffect, useState } from 'react';
import { PASS_DAYS, PRICE_DKK } from '@awa/shared';
import { call } from '../api';
import { useStore } from '../store';

const SERIF = { fontFamily: 'Charter, Georgia, Cambria, serif' };

/**
 * The hard paywall (BILL-01). Shown when the 7-day trial is over and no
 * subscription or month pass is running. The server enforces the gate — this
 * view is just the honest storefront in front of it.
 *
 * TWO WAYS TO PAY, and they are genuinely different products rather than two
 * buttons for one. The subscription renews and is paid by card. The month pass
 * is bought once, runs out, and is the only route that can take MobilePay:
 * Stripe lists MobilePay as not supporting recurring payments at all, so it
 * cannot appear on a subscription checkout however the account is configured.
 * Saying "MobilePay" on a button that then offers only cards would be the
 * worst version of this, so the difference is written on the buttons.
 */
export function PaywallView() {
  const s = useStore();
  const [busy, setBusy] = useState<'checkout' | 'pass' | 'portal' | null>(null);
  const [err, setErr] = useState<string | null>(null);

  // Auto-unlock: poll while visible, so completing payment in the Stripe tab
  // flips this view by itself — no manual refresh to explain to anyone.
  useEffect(() => {
    const t = setInterval(() => void useStore.getState().loadBilling(), 5_000);
    return () => clearInterval(t);
  }, []);

  async function open(kind: 'checkout' | 'pass' | 'portal') {
    setBusy(kind);
    setErr(null);
    const res = await call({ kind: 'api', path: `/api/billing/${kind}`, method: 'POST' });
    setBusy(null);
    const url = (res.data as { url?: string } | undefined)?.url;
    if (res.ok && url) window.open(url, '_blank');
    else setErr(res.error ?? 'Betalingssiden kunne ikke åbnes. Prøv igen.');
  }

  return (
    <div className="flex h-full flex-col items-center justify-center gap-4 overflow-y-auto px-6 py-8 text-center">
      <p className="awa-eyebrow">Prøveperioden er slut</p>
      <h2 className="text-title leading-snug" style={SERIF}>
        Skriv videre for {PRICE_DKK} kr. om måneden.
      </h2>
      <ul className="space-y-1.5 text-body text-graphite">
        <li>Ubegrænset skrivehjælp — hver dag</li>
        <li>Læser dine filer: PDF, Word, billeder, scanninger</li>
        <li>Indsætter direkte i dine dokumenter, også Google Docs</li>
      </ul>

      <div className="mt-1 flex w-full max-w-[280px] flex-col gap-2">
        <button
          onClick={() => void open('checkout')}
          disabled={busy !== null}
          className="rounded-full bg-ink px-6 py-2.5 text-lead font-medium text-paper hover:opacity-85 disabled:opacity-40"
        >
          {busy === 'checkout' ? 'Åbner…' : `Abonnement — ${PRICE_DKK} kr./md.`}
        </button>
        <button
          onClick={() => void open('pass')}
          disabled={busy !== null}
          className="rounded-full border border-ink px-6 py-2.5 text-lead font-medium text-ink hover:bg-ink hover:text-paper disabled:opacity-40"
        >
          {busy === 'pass' ? 'Åbner…' : `Månedspas med MobilePay — ${PRICE_DKK} kr.`}
        </button>
        <p className="text-aside leading-relaxed text-graphite">
          Abonnementet betales med kort og fornyes hver måned. Månedspasset betales én gang, giver adgang i{' '}
          {PASS_DAYS} dage og fornyes ikke af sig selv.
        </p>
      </div>

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
