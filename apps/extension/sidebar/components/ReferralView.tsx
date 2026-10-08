import { useEffect, useState } from 'react';
import { referralLink } from '@awa/shared';
import { call } from '../api';
import { useStore } from '../store';

const SERIF = { fontFamily: 'Charter, Georgia, Cambria, serif' };


/**
 * "Inviter": the user's own link, what it has earned, and a place to redeem
 * somebody else's code.
 *
 * WE NEVER SEND THE INVITATION. The user copies a message and sends it
 * themselves, wherever they already talk to the friend. A "tip a friend" form
 * that mails an address the user typed in is unsolicited marketing sent by us
 * (markedsføringsloven § 10), and a copied sentence in a group chat also
 * simply works better than an e-mail from a company.
 */
export function ReferralView() {
  const { referral, loadReferral } = useStore();
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    void loadReferral();
  }, [loadReferral]);

  if (!referral) {
    return <p className="px-6 py-8 text-center text-body text-graphite">Henter din invitation…</p>;
  }
  if (!referral.enabled) {
    return (
      <p className="px-6 py-8 text-center text-body text-graphite">
        Invitationer er slået fra lige nu. Kig forbi igen senere.
      </p>
    );
  }

  const link = referralLink(referral.code);

  async function copy() {
    await navigator.clipboard.writeText(
      `Få ${referral!.discountPercent} % på din første måned med ChatBot Skriv. Den skriver direkte i dine dokumenter: ${link}`,
    );
    setCopied(true);
    setTimeout(() => setCopied(false), 2500);
    void call({ kind: 'api', path: '/api/referral/shared', method: 'POST' });
  }

  return (
    <div className="flex h-full flex-col items-center gap-4 overflow-y-auto px-6 py-8 text-center">
      <p className="awa-eyebrow">Inviter en ven</p>
      <h2 className="text-title leading-snug" style={SERIF}>
        Giv {referral.discountPercent} %. Få {referral.discountPercent} % selv.
      </h2>
      <p className="max-w-[300px] text-body text-graphite">
        Din ven får {referral.discountPercent} % på sin første måned. Når din ven har betalt, får du{' '}
        {referral.discountPercent} % på din næste.
      </p>
      {referral.myDiscount && (
        <p className="max-w-[300px] rounded-2xl border border-hairline px-4 py-2 text-ui text-ink">
          Du har {referral.discountPercent} % rabat til gode. Den trækkes fra, næste gang du betaler.
        </p>
      )}

      <div className="flex w-full max-w-[280px] flex-col gap-2">
        <button
          onClick={() => void copy()}
          className="rounded-full bg-ink px-6 py-2.5 text-lead font-medium text-paper hover:opacity-85"
        >
          {copied ? 'Kopieret. Sæt den ind i en besked' : 'Kopiér invitation'}
        </button>
        <p className="select-all break-all text-aside text-graphite">{link}</p>
        <p className="text-aside text-graphite">
          Din kode: <span className="select-all font-medium tracking-widest text-ink">{referral.code}</span>
        </p>
      </div>

      <p className="text-ui text-graphite">
        {referral.invited === 0
          ? 'Ingen har brugt din invitation endnu.'
          : `${referral.invited} inviteret · ${referral.paid} har købt · ${referral.rewards} ${referral.rewards === 1 ? 'rabat' : 'rabatter'} optjent`}
      </p>
      {referral.capReached && (
        <p className="max-w-[280px] text-aside leading-relaxed text-graphite">
          Du har nået årets loft for belønninger. Dine venner får stadig deres rabat.
        </p>
      )}

      {referral.canClaim && <RedeemCode />}
    </div>
  );
}

/**
 * Typing a friend's code by hand.
 *
 * The link normally carries the code all the way into the panel on its own,
 * but the Chrome Web Store sits in the middle of that journey and drops
 * everything, so the code always has to be something a person can also type.
 */
export function RedeemCode() {
  const { loadBilling, loadReferral, set } = useStore();
  const [code, setCode] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  async function redeem() {
    setBusy(true);
    setErr(null);
    const res = await call({ kind: 'api', path: '/api/referral/claim', method: 'POST', body: { code } });
    setBusy(false);
    if (!res.ok) {
      setErr(res.error ?? 'Koden kunne ikke bruges.');
      return;
    }
    // Loaded again first, so the paywall behind this notice already shows the
    // lower price the notice promises.
    await loadReferral();
    const percent = useStore.getState().referral?.discountPercent;
    set({ view: 'chat', notice: percent ? `Koden er godkendt. Du får ${percent} % på din første måned.` : 'Koden er godkendt.' });
    void loadBilling();
  }

  return (
    <form
      className="flex w-full max-w-[280px] flex-col gap-1.5"
      onSubmit={(e) => {
        e.preventDefault();
        void redeem();
      }}
    >
      <p className="text-aside text-graphite">Har du selv fået en kode af en ven?</p>
      <div className="flex gap-2">
        <input
          value={code}
          onChange={(e) => setCode(e.target.value.toUpperCase())}
          placeholder="Invitationskode"
          maxLength={12}
          className="min-w-0 flex-1 rounded-full border border-hairline bg-paper px-4 py-2 text-ui tracking-widest text-ink"
        />
        <button
          type="submit"
          disabled={busy || code.trim().length < 4}
          className="rounded-full border border-ink px-4 py-2 text-ui font-medium text-ink hover:bg-ink hover:text-paper disabled:opacity-40"
        >
          {busy ? 'Tjekker…' : 'Brug kode'}
        </button>
      </div>
      {err && <p className="text-ui font-medium text-ink">{err}</p>}
    </form>
  );
}
