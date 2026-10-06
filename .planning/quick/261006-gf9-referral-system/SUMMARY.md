---
quick_id: 261006-gf9
slug: referral-system
status: complete
date: 2026-10-06
---

# Invitationer — summary

Built, deployed and run end to end on 2026-10-06. Backend and landing page are
live. Extension 0.2.4 was uploaded to the Chrome Web Store by sehit on
2026-10-06 and is IN REVIEW. No real user sees the Inviter tab until Google
approves it and their Chrome updates.

## Observed (not claimed)

Run against a Vercel preview of the backend (Stripe TEST mode, real database),
four throwaway accounts, three real test-card checkouts:

- New account is paywalled; redeeming a code gives 14 days and lets them in.
- Wrong code, own code, second redemption and inviting each other back are refused.
- Second account in the inviter's own browser gets 0 free days.
- Nothing is paid out at signup. After the friend's payment the inviter had
  30 days of access and `referrals.status = rewarded / days`.
- Inviter with a subscription: next friend's payment ended `rewarded / credit`,
  which the code only writes after Stripe accepted the balance transaction.
- Cap lowered to 2 from the admin API: third paying friend ended `capped`.
- Dashboard page: settings load, "Gem" saves and survives a reload, cards and
  both tables render.

Run against PRODUCTION with the built extension in a real Chrome:

- Paywall shows the code field and the invite link; Inviter tab shows code,
  link and offer; the copy button puts the message on the clipboard.
- A friend opening `chatbotskriv.dk/?r=CODE` and signing in was unlocked with
  no typing; a friend typing the code was unlocked too; the inviter then saw
  "2 inviteret".
- Live landing page shows the banner, stores the code, opens the store in a
  new tab.

All test accounts, their rows and their device records were deleted afterwards.

## Unproven

- The Stripe credit was not read back from Stripe (no test key on this Mac).
- The install-time pickup (`chrome.runtime.onInstalled` reading the landing
  tab's address). Playwright loads the extension before any tab exists.
- The MobilePay pass as the triggering payment. Same function, different
  branch; the preview has no pass price.
- The live Stripe webhook path. The success-page path is what was exercised.

## Known gaps

- `admin_stats.pass_active` counts anyone with `access_until` in the future, so
  an inviter living on reward days shows under "Betaler · pas".
- A refund of the friend's payment does not take the reward back.
- Local dev cannot run this: `.env` has placeholder Stripe keys and no service
  role key. Use a preview deployment (`vercel --yes`), which has both.

## Where things are

- Database: `supabase/migrations/0017_referrals.sql` (applied live 2026-10-06).
- Backend: `apps/backend/src/routes/referral.ts`, `rewardReferrer` in
  `apps/backend/src/billing.ts`, admin parts in `routes/admin.ts` and
  `routes/dashboard-page.ts`. Production deploy `ai-skriveassistent-ldzifv5qy`.
- Extension: `sidebar/components/ReferralView.tsx`, code pickup in
  `entrypoints/content/index.tsx` and `entrypoints/background.ts`, redeeming in
  `sidebar/store.ts`.
- Landing: the first inline script in `apps/landing/index.html`.
- Settings: the dashboard, section "Invitationer". Defaults 14 / 30 / 12, on.

## After the store approves 0.2.4

1. Install from the store in a clean Chrome profile after opening an invite
   link, and confirm the code is redeemed without typing. This is the
   install-time pickup that is still unproven.
2. Watch the dashboard's "Invitationer" cards and the PostHog events
   `referral_link_copied`, `referral_claimed`, `referral_rewarded`.

## Open decisions for sehit

- The landing page still says "7 dage gratis" while the hard paywall gives an
  uninvited user no trial.
- Supabase's built-in mailer allows about 2 signup e-mails an hour. A custom
  SMTP sender lifts that; it matters the day an invitation spreads.

## Left behind by testing

- Three test subscriptions in the Stripe sandbox ("Chat sandbox").
- A deployment-protection bypass secret on the Vercel backend project, and the
  preview deployment `ai-skriveassistent-hfecovf2b`.
