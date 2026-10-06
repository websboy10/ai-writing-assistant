---
quick_id: 261006-gf9
slug: referral-system
status: complete
date: 2026-10-06
---

# Invitationer — summary

Built, deployed and run end to end on 2026-10-06. Backend and landing page are
live. Extension 0.2.4 is built (`apps/extension/.output/extension-0.2.4-chrome.zip`)
and NOT yet uploaded to the Chrome Web Store, so no real user can see the
Inviter tab until it is.

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
