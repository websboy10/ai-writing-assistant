-- The automated suites are quota-bound, and the quota is aimed at humans.
--
-- The daily limit exists to stop one beta user draining a shared,
-- operator-funded OpenRouter key (PROJECT.md: "Per-user quotas are a
-- correctness requirement, not a feature"). A full round of Google Docs
-- verification is ~9 requests and each reliability repeat is ~2, so a single
-- afternoon of proving the product works exhausted a real person's daily
-- allowance and then blocked the very tests that prove it.
--
-- Scoped to the @example.com test domain rather than to named ids, so it is
-- self-explanatory, idempotent, and a no-op in any environment where those
-- accounts do not exist. Real users are untouched and keep their 200.
update public.profiles
set daily_limit = 3000
where email like '%@example.com';
