# Google setup — sign-in and the Docs API, in one sitting

Written 2026-08-06. This replaces the sketch in `SETUP.md` Job 4, which was
written before the backend existed and couldn't give you real values.

**Two things get unlocked here, from one setup:**

1. **"Log ind med Google"** — the button that's already built but has no credential.
2. **Phase 7's Google Docs path** — reading a document's real structure and
   writing answers at exact positions, instead of the fragile paste trick.

**Time:** ~20 minutes. **Cost:** free.
**You do steps 1–6. I do step 7.** Nothing here can break the live product —
until the credential exists, Google sign-in simply reports that it isn't
configured, exactly as it does today.

---

## Values you'll need (copy these somewhere)

| What | Value |
|---|---|
| Supabase callback URL | `https://gkqpyqmuopqxumugszoa.supabase.co/auth/v1/callback` |
| Extension redirect URL | `https://foidkbeinmfolejjjfjcokmmknimohof.chromiumapp.org/` |
| Extension ID | `foidkbeinmfolejjjfjcokmmknimohof` |
| Privacy policy URL | `https://ai-skriveassistent.vercel.app/privatliv.html` |
| Homepage URL | `https://ai-skriveassistent.vercel.app` |

> The extension ID was pinned on 2026-08-06 (`wxt.config.ts`, the `key` field).
> Before that, Chrome invented a new ID on every install, which is why this job
> was impossible to finish. **Don't remove that field** — the ID would move and
> everything below would silently stop working.

---

## Step 1 — Create the Google Cloud project (3 min)

1. Go to https://console.cloud.google.com
2. Sign in with the Google account that should **own** this (use your business
   account, not a personal one you might lose access to)
3. Top bar, project dropdown → **New Project**
4. Name: `AI Skriveassistent`
5. **Create**, then make sure the project dropdown now shows it

---

## Step 2 — Turn on the Google Docs API (1 min)

1. Left menu → **APIs & Services** → **Library**
2. Search for **Google Docs API**
3. Click it → **Enable**

That's the API Phase 7 uses to read a document's structure and write answers
where they belong.

---

## Step 3 — The consent screen (5 min)

This is the "AI Skriveassistent wants access to your Google account" page users
will see.

1. **APIs & Services** → **OAuth consent screen**
2. User type: **External** → **Create**

**App information:**
- App name: `AI Skriveassistent`
- User support email: `sehit@degirmenci.dk`
- App logo: skip for now (uploading one triggers a brand review you don't need yet)

**App domain:**
- Application home page: `https://ai-skriveassistent.vercel.app`
- Privacy policy link: `https://ai-skriveassistent.vercel.app/privatliv.html`
- Terms of service link: `https://ai-skriveassistent.vercel.app/handelsbetingelser.html`

**Authorised domains:** add `vercel.app`

**Developer contact:** `sehit@degirmenci.dk` → **Save and continue**

---

## Step 4 — Scopes (3 min)

"Scopes" = what you're asking permission for.

1. **Add or remove scopes**
2. Tick the two basic ones: `.../auth/userinfo.email` and
   `.../auth/userinfo.profile`
3. In the **manually add scopes** box at the bottom, paste:
   ```
   https://www.googleapis.com/auth/documents
   ```
4. **Add to table** → **Update** → **Save and continue**

> Google labels `documents` a **sensitive scope**. That word looks alarming and
> isn't a problem yet — see Step 5.

---

## Step 5 — Test users (2 min) — the step that saves you weeks

1. On the **Test users** screen → **Add users**
2. Add your own Google address, and any beta tester's
3. **Save and continue**

**Leave the app in "Testing" — do not press "Publish app".**

In Testing mode you get **up to 100 users with no Google review at all**. Press
Publish and that sensitive scope drops you into Google's verification queue:
a demo video, a security questionnaire, and weeks of waiting. You'll do that
before public launch, not now.

The only visible cost: testers see a "Google hasn't verified this app" screen and
click **Advanced → Go to AI Skriveassistent**. Worth warning them, or they'll
think something's wrong.

---

## Step 6 — Create the credential and paste it into Supabase (6 min)

**6a. Create it**

1. **APIs & Services** → **Credentials** → **Create credentials** → **OAuth client ID**
2. Application type: **Web application** *(yes, "Web application" — not "Chrome
   extension". Sign-in runs through Supabase, which is a web service.)*
3. Name: `AI Skriveassistent – Supabase`
4. Under **Authorised redirect URIs** → **Add URI**:
   ```
   https://gkqpyqmuopqxumugszoa.supabase.co/auth/v1/callback
   ```
5. **Create**
6. A box appears with **Client ID** and **Client secret** — keep it open

**6b. Paste it into Supabase**

1. Go to https://supabase.com/dashboard/project/gkqpyqmuopqxumugszoa/auth/providers
2. Find **Google** → toggle **Enable Sign in with Google**
3. Paste the **Client ID** and **Client secret** from 6a
4. **Save**

**6c. Allow the extension to receive the login**

1. Same dashboard → **Authentication** → **URL Configuration**
2. Under **Redirect URLs** → **Add URL**:
   ```
   https://foidkbeinmfolejjjfjcokmmknimohof.chromiumapp.org/*
   ```
3. **Save**

Without 6c, sign-in completes at Google and then dies on the way back with an
unhelpful error — this line is the one people forget.

---

## Step 7 — Tell me it's done (my part)

Then I:
- Ask Supabase for the Docs permission at sign-in and hold on to the Google token
  (it's separate from the login session, and it expires hourly — I handle the refresh)
- Build the Docs API read/write path for Phase 7
- Keep today's paste mechanism as the fallback for anyone who declines
- Walk the whole flow in a real browser before calling any of it done

**You don't need to send me the client secret.** It lives in Supabase; I never
need to see it. If you ever paste a secret into a chat, rotate it afterwards.

---

## When you later publish to the Chrome Web Store

The store may assign its own extension ID at first upload. If it does, the
`chromiumapp.org` address changes and sign-in breaks for store installs.

The fix is one line, not a redo: add the new
`https://<new-id>.chromiumapp.org/*` to the Supabase Redirect URLs list from
6c. Supabase accepts several, so the pinned dev ID and the store ID can both
work at once. Flagged in `docs/STORE-LISTING.md` too.

---

## If something goes wrong

| What you see | What it means |
|---|---|
| "Google sign-in isn't configured yet for this project" | Step 6b didn't save, or the toggle is off |
| Sign-in works, then a blank page or "redirect not allowed" | Step 6c missing |
| `redirect_uri_mismatch` at Google | The URI in 6a doesn't match the Supabase callback exactly — check for a trailing slash |
| "Google hasn't verified this app" | Expected in Testing mode. Advanced → Go to AI Skriveassistent |
| "Access blocked: app not completed verification" | The signing-in address isn't in the Step 5 test-user list |
