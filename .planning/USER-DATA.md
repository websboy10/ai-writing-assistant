# ChatBot Skriv User Data
**Last Updated:** 2026-09-20  
**Project:** AI Skriveassistent (renamed ChatBot Skriv on 2026-09-04)  
**Database:** gkqpyqmuopqxumugszoa.supabase.co

---

## Overview

ChatBot Skriv is a Chrome extension AI writing assistant launched on 2026-09-04. The product is live with real users, submitted to the Chrome Web Store as version 0.2.2.

### Product Details
- **Name:** ChatBot Skriv (formerly AI Skriveassistent)
- **Platform:** Chrome Extension (Manifest V3)
- **Pricing:** 100 DKK/month subscription OR 100 DKK/30-day month pass (MobilePay compatible)
- **Backend:** https://ai-skriveassistent-api.vercel.app
- **Landing:** https://ai-skriveassistent.vercel.app
- **Store Version:** 0.2.2 (uploaded 2026-09-09)
- **Store ID:** Different from local dev ID `foidkbeinmfolejjjfjcokmmknimohof`

---

## User Metrics

### Database Schema
User data tracked across multiple tables:
- **auth.users** - Supabase authentication (email/password + Google OAuth)
- **public.users** - Extended user profiles
- **billing** - Subscription and trial status
- **conversations** - Chat history
- **messages** - Individual chat messages
- **usage_counters** - Daily request quotas
- **pass_purchases** - Month pass transactions
- **internal_accounts** - Test/admin account exclusions

### Admin Functions
Two key functions track real user metrics:

1. **`admin_stats()`** - Returns:
   - Total accounts
   - Accounts created (7d, 30d)
   - Confirmed email addresses
   - Trial status (active, expired)
   - Subscribed users
   - Active month passes
   - Passes sold (total, 30d)
   - Conversations count
   - Messages count
   - Templates count
   - Requests today
   - Requests (30d)
   - Daily request volume (last 30 days)

2. **`admin_internal()`** - Returns:
   - Real user IDs (excluding internal accounts)
   - Real Stripe customer IDs
   - Internal user IDs
   - Internal account emails

### Internal Accounts (Excluded from Metrics)
Per migration 0015_internal_accounts.sql and 0016_admin_real_users.sql:
- Test accounts tracked in `public.internal_accounts`
- Dashboard counts exclude these from all metrics
- Reviewer account: `chrome-review@degirmenci.dk` (permanent access, must not be deleted)
- Test account: `modestlyeu+awatest@gmail.com` (1000 requests/day quota)

---

## User Behavior Tracking

### Analytics (PostHog)
- **Project ID:** 265506
- **Implementation:** Server-side only (no client-side tracking for privacy)
- **Events Tracked:**
  - Generation requests
  - Model failures
  - Token counts
  - Error codes
  - Response times
- **No PII:** Never sends prompts, replies, filenames, or email addresses
- **User ID:** Supabase UUID only

### Usage Patterns
From `usage_counters` table:
- Daily request counts per user
- Quota enforcement: hard paywall at 402 after trial expires
- Trial period: 7 days server-side
- One trial per extension install (tracked via `x-awa-install` header)

---

## User Lifecycle

### Onboarding
1. **Sign up:** Email/password OR Google OAuth
2. **Trial:** 7-day trial (status: 'trialing')
3. **Anti-abuse:** One trial per device (via `trial_devices` table)
4. **Paywall:** Hard 402 error after trial expires

### Conversion Path
**Subscription (recurring):**
- Stripe product: `prod_V1SRACC78tS4Gm`
- Price: `price_1U1PWyGYgFaIZrpIrPedJujG` (50 DKK/month)
- Live webhook: `we_1U1PWyGYgFaIZrpIsGIM1atH`
- Automatic tax enabled
- MobilePay NOT available (recurring not supported)

**Month Pass (one-time):**
- 100 DKK for 30 days access
- MobilePay enabled
- Grant logic: duplicate webhooks handled, multiple purchases extend access
- Proven live on real database

### User States
1. **trialing** - First 7 days
2. **expired** - Trial ended, no payment
3. **active** - Paid subscription active
4. **past_due** - Subscription payment failed
5. **pass_active** - Month pass valid (access_until > now)

---

## Known User Segments

### By Use Case
**Primary:** HR teams writing performance review summaries in Google Docs (validated demand signal from prospective user interviews)

**Supported Editors:**
- Google Docs (primary, most complex)
- Gmail
- LinkedIn
- Slack
- Notion
- Any contenteditable field
- Plain textareas

### By Feature Usage
**Core Features:**
- "Skriv for mig" - Ask question, get draft (instant or progressive typing)
- "Besvar alle spørgsmål" - Answer every question in a document (added 0.2.2)
- "Besvar markeringen" - Answer marked text only (added 0.2.2)
- Tempo slider: 10-200 words/minute
- "Skriv som et menneske" - Humanized typing with deliberate mistakes (off by default)

**Context Features:**
- PDF upload + text extraction
- DOCX upload + text extraction
- Image upload + OCR (Danish + English)
- Screenshot capture
- "+ Denne side" - Copy page content (no Google login required)

---

## User Data Points

### Collected Data
- User ID (UUID)
- Email address
- Email confirmation status
- Account creation date
- Last sign-in date
- Trial device fingerprint
- Billing status
- Stripe customer ID
- Subscription/pass status
- Daily request counts
- Conversation history
- Message content (stored, but never logged to analytics)
- Template usage

### NOT Collected
- Prompts sent to AI (logged server-side for debugging, never to PostHog)
- AI responses
- Document content
- Filenames
- Page URLs user is working on
- Which websites extension is active on

---

## Privacy & Security

### Data Handling
- **Server-side only analytics:** Extension never phones home to PostHog
- **Content routing:** All real user content → paid, no-training OpenRouter models
- **Synthetic content:** Internal/test → free models with training allowed
- **OCR:** Server-side only (vision-model: google/gemini-3.5-flash, data_collection: deny)

### Compliance Notes
- GDPR boundary enforced: whole-document sends use `contentClass: 'real'`
- Privacy policy: /privatliv
- Terms: /handelsbetingelser
- Deliberately imperfect Danish voice (grammar slips in system prompt)

---

## Store & Distribution

### Chrome Web Store
- **Status:** Submitted, version 0.2.2
- **Package:** Built with `pnpm zip:store` (removes `key` field)
- **Permissions:** No sensitive scopes (Google Docs API removed 2026-09-04)
- **OAuth:** Google sign-in requires store ID added to redirect allow-list

### Developer Account
- Paid Chrome Web Store developer account
- Listing ready in `docs/STORE-LISTING.md`
- Screenshots deliberately not taken yet (would go stale with UI changes)

---

## Infrastructure

### Services
- **Database:** Supabase PostgreSQL (eu-north-1)
- **Backend:** Vercel Fastify serverless
- **AI:** OpenRouter (cheapest/free models initially)
- **Payments:** Stripe (live mode, automatic tax enabled)
- **Analytics:** PostHog project 265506
- **Email:** (not configured yet)

### Environment
- **Production Backend:** https://ai-skriveassistent-api.vercel.app
- **Vercel Project:** ai-skriveassistent-api (no GitHub link, CLI deploys only)
- **Deploy Command:**
  ```bash
  VERCEL_ORG_ID=team_p1rF17AClZ3lYE1MDZiSvzgf \
  VERCEL_PROJECT_ID=prj_2LcxQhYnQPKyAcdixxrPJmc43w4d \
  vercel --prod --yes
  ```

---

## Verification Status

### Automated Tests
- **scripts/verify.mjs:** 44/44 passing (2026-09-04)
- **Unit tests:** 45 passing
- **E2E flow:** Proven with real Chrome against deployed backend

### Manual Testing Required
- Google Docs insertion (needs operator with Google session)
- Real-site contenteditable (Gmail/LinkedIn/Slack/Notion spot checks)
- Google OAuth flow (when enabled)

### Known Defects
From 07-FINDINGS-docs.md:
- F-5: Instruction line answered, placement above hints, dropped Backspaces (FIXED)
- F-6/F-7: Answers under questions instead of in boxes (FIXED)
- F-8: Marked question box not in view (FIXED)
- F-9: Web search plugin 500 on long documents (FIXED)
- F-10/F-11/F-12: Find navigation issues (FIXED)
- F-13: Humanizer marking visible (FIXED)

---

## Business Metrics

### Revenue Model
- **Trial:** 7 days free
- **Subscription:** 50 DKK/month recurring (Stripe)
- **Month Pass:** 100 DKK for 30 days (MobilePay compatible)
- **Operator:** Requires ~$5-10 OpenRouter credit for beta usage

### Cost Structure
- **OpenRouter:** Usage-based (free models during beta, paid for real content)
- **Supabase:** Free tier
- **Vercel:** Free tier (Fastify serverless)
- **Stripe:** Per-transaction fees
- **PostHog:** Free tier

### Launch Status
- **Beta:** Live with real users
- **Store:** Submitted, pending review
- **Marketing:** Landing page live, no active acquisition yet
- **Target:** 10-50 beta users for feedback

---

## Data Access

### Admin Dashboard
- **URL:** https://ai-skriveassistent-api.vercel.app/dashboard
- **Auth:** Gated by `ADMIN_EMAILS` environment variable
- **Access:** Returns 404 for non-admins
- **Functions:** Calls `admin_stats()` and `admin_internal()`

### Database Access
- **Direct:** Use SUPABASE_SERVICE_ROLE_KEY with PostgREST
- **MCP:** Read-only via `mcp__supabase__*` tools (project: gkqpyqmuopqxumugszoa)
- **Migrations:** 16 applied (0001-0016)

---

## Next Steps for User Growth

### Pre-Launch Checklist
- [x] Backend deployed and verified
- [x] Billing flow proven E2E
- [x] Store submission
- [ ] Google OAuth credential (when operator wants Google sign-in)
- [ ] OpenRouter credit top-up ($5-10)
- [ ] Stripe business name update (shows "Chat sandbox")
- [ ] Store approval
- [ ] First 10 beta users

### Growth Opportunities
1. Target HR teams specifically (validated demand)
2. Google Workspace integration deeper
3. Template library expansion
4. Team/enterprise plans
5. API for custom integrations

---

## Data Queries

To access current user data, run:

```bash
# Via admin dashboard
curl https://ai-skriveassistent-api.vercel.app/dashboard \
  -H "Authorization: Bearer <admin-token>"

# Via Supabase RPC
curl https://gkqpyqmuopqxumugszoa.supabase.co/rest/v1/rpc/admin_stats \
  -H "apikey: $SUPABASE_ANON_KEY" \
  -H "Authorization: Bearer $SUPABASE_SERVICE_ROLE_KEY"

# Via MCP (from Claude)
# (Requires proper authentication setup)
```

---

## Notes

- **Voice:** Deliberately imperfect Danish (grammar slips, missing commas) for human feel
- **No bold ever:** Operator rule enforced in prompts, server strip, compiler, paste path
- **Docs mechanism:** Canvas/hidden-iframe paste (no API, no permission needed)
- **Deployment:** CLI only, no GitHub auto-deploy
- **Store package:** Different ID from dev builds (manifest key removed)

