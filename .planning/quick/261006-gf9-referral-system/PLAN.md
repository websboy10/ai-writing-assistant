---
quick_id: 261006-gf9
slug: referral-system
date: 2026-10-06
---

# Invitationer: giv en ven en prøveperiode, få gratis dage når vennen betaler

## What it is, in plain words

Every user has a personal code and link. A friend who redeems it gets a free
trial (today the only free way in, because the hard paywall is on). When that
friend pays for the first time, the inviter gets free days. The operator sets
all four numbers from the dashboard.

## Decisions (sehit, 2026-10-06)

- Friend's reward: a longer free trial, not a discount.
- Cap: 12 rewards per inviter per rolling year.
- All of it manageable from the dashboard.

## Decisions made while building

- Reward fires on the first PAYMENT, never on signup. That is the fraud design.
- A subscribing inviter gets a Stripe balance credit, since free days do nothing
  for someone Stripe bills monthly. Everyone else gets days on `access_until`.
- Reward days do NOT go through `pass_purchases`: `admin_stats` counts those
  rows as passes sold.
- Friend trial is one per browser (`trial_devices` + a partial unique index).
- We never send the invitation ourselves (markedsføringsloven § 10); the user
  copies a message.
- Switching invitations off stops new redemptions, not rewards already promised.

## Tasks

1. `supabase/migrations/0017_referrals.sql`: settings columns, `referrals`,
   `billing.referral_code`, the functions.
2. Backend: `routes/referral.ts`, `rewardReferrer` in `billing.ts` called from
   both payment paths, admin config + stats.
3. Dashboard: settings form, cards, two tables.
4. Extension 0.2.4: Inviter tab, code field on the paywall, automatic pickup of
   the code from the landing page.
5. Landing: `?r=CODE` banner and hand-off, terms and privacy text.
6. Verify end to end with a test-mode payment, then deploy.
