# Google setup — sign-in and the Docs API, in one sitting

Written 2026-08-06. This replaces the sketch in `SETUP.md` Job 4, which was
written before the backend existed and couldn't give you real values.

**Two things get unlocked here, from one setup:**

1. **"Log ind med Google"** — the button that's already built but has no credential.
2. **Phase 7's Google Docs path** — reading a document's real structure and
   writing answers at exact positions, instead of the fragile paste trick.

**Time:** ~20 minutes. **Cost:** free.
**You do steps 1–6 — every click is written out below. I do step 7.** Nothing here can break the live product —
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

## Step 3 — The consent screen, click by click (5 min)

> **Google renamed this area.** New name: **Google Auth Platform**. If your
> screen still says **OAuth consent screen**, you're on the older layout — the
> same fields appear, just on one long page instead of tabs. Both are covered.

1. In the left menu, click **APIs & Services**.
2. Click **OAuth consent screen**.
3. **If you land on a page headed "Google Auth Platform" with a blue
   "Get started" button** → click **Get started**, then follow 4–11 below.
   **If you instead see a page asking "User Type: Internal / External"** →
   select **External**, click **Create**, and follow the same fields.

**"App Information"**

4. **App name** — type exactly:
   ```
   AI Skriveassistent
   ```
5. **User support email** — pick `sehit@degirmenci.dk` from the dropdown.
6. Click **Next**.

**"Audience"**

7. Choose **External**.
8. Click **Next**.

**"Contact Information"**

9. **Email addresses** — type:
   ```
   sehit@degirmenci.dk
   ```
10. Click **Next**.

**"Finish"**

11. Tick the box agreeing to the User Data Policy, then click
    **Create** (or **Continue**).

You should now see a left-hand menu with: **Overview, Branding, Audience,
Clients, Data Access**. Those five are the rest of this job.

**Now fill in Branding** (the older layout asks for these on the same page):

12. Click **Branding** in the left menu.
13. **Application home page** — paste:
    ```
    https://ai-skriveassistent.vercel.app
    ```
14. **Application privacy policy link** — paste:
    ```
    https://ai-skriveassistent.vercel.app/privatliv.html
    ```
15. **Application terms of service link** — paste:
    ```
    https://ai-skriveassistent.vercel.app/handelsbetingelser.html
    ```
16. **Authorised domains** — click **+ Add domain**, then type:
    ```
    ai-skriveassistent.vercel.app
    ```
    > **Not `vercel.app`.** Google rejects it with *"Invalid domain: must be a
    > top private domain"*, because `vercel.app` is on the public suffix list —
    > the same category as `.co.uk`. Nobody can own it, so it can't be your
    > authorised domain. The full subdomain is what you own.
    >
    > **If Google then demands Search Console verification:** try clearing the
    > field and saving. In Testing mode the list is usually optional — Google
    > infers it from the home page and privacy links above. If it insists, the
    > landing site needs a Search Console verification tag (a 5-minute job, and
    > one you'll want before public launch anyway).
17. Click **Save** at the bottom.

> Leave the logo empty. Uploading one triggers a Google brand review you don't
> need and can't hurry.

---

## Step 4 — Scopes, click by click (3 min)

"Scopes" = the list of permissions users are asked to grant.

1. Click **Data Access** in the left menu.
   *(Older layout: you'll hit this as step 2 of the consent-screen wizard,
   labelled **Scopes**.)*
2. Click **Add or remove scopes**. A panel slides in from the right.
3. In the filter box, type `userinfo.email`, then tick the row
   `.../auth/userinfo.email`.
4. Clear the filter, type `userinfo.profile`, then tick the row
   `.../auth/userinfo.profile`.
5. Scroll the panel to the very bottom, to the box headed
   **Manually add scopes**.
6. Paste this in, exactly:
   ```
   https://www.googleapis.com/auth/documents
   ```
7. Click **Add to table**.
8. Confirm the table now lists three scopes — the two userinfo ones and
   `.../auth/documents`.
9. Click **Update** (bottom of the panel).
10. Click **Save**.

> Google will mark `documents` as a **sensitive scope** and may show a warning.
> That is expected and is not a problem — Step 5 explains why.

---

## Step 5 — Test users, click by click (2 min)

**This is the step that saves you weeks. Read the warning at the end.**

1. Click **Audience** in the left menu.
   *(Older layout: step 3 of the wizard, labelled **Test users**.)*
2. Scroll to the **Test users** section.
3. Click **+ Add users**.
4. Type your own Google address:
   ```
   sehit@degirmenci.dk
   ```
5. Press **Enter**, then add any beta testers' Google addresses the same way.
6. Click **Save**.

**Now stop. Do NOT click "Publish app".**

On the Audience page you will see a **Publishing status: Testing** box with a
tempting **Publish app** button. Leave it alone.

- **Testing** = up to **100 users**, and **no Google review at all**. This is
  everything you need for the beta.
- **Publish app** with a sensitive scope = you enter Google's verification
  queue: a recorded demo video, a security questionnaire, and typically weeks
  of waiting.

You'll do that before public launch. Not today.

**The one visible cost:** your testers will see a grey screen saying *"Google
hasn't verified this app"*. They click **Advanced**, then
**Go to AI Skriveassistent (unsafe)**. Warn them in advance or they'll think
it's broken. It isn't — it's what every app in Testing mode looks like.

---

## Step 6 — The credential, click by click (6 min)

### 6a. Create it in Google

1. Click **Clients** in the left menu.
   *(Older layout: **APIs & Services** → **Credentials**.)*
2. Click **+ Create client** (older: **+ Create credentials** → **OAuth client ID**).
3. **Application type** — choose **Web application**.

   > Yes, "Web application" — **not** "Chrome extension", even though this is a
   > Chrome extension. The login runs through Supabase, which is a web service.
   > Choosing "Chrome extension" here is the single most common way to get this
   > wrong.

4. **Name** — type:
   ```
   AI Skriveassistent – Supabase
   ```
5. Scroll to **Authorised redirect URIs**.
6. Click **+ Add URI**.
7. Paste this, exactly, with nothing after it:
   ```
   https://gkqpyqmuopqxumugszoa.supabase.co/auth/v1/callback
   ```
8. Click **Create**.
9. A box appears titled **OAuth client created**, showing **Client ID** and
   **Client secret**. **Leave this box open** — you need both in 6b.

   > If you close it by accident: **Clients** → click the client's name → the
   > secret is under **Client secrets** (you can add a new one there).

### 6b. Paste it into Supabase

1. Open this in a new tab:
   ```
   https://supabase.com/dashboard/project/gkqpyqmuopqxumugszoa/auth/providers
   ```
2. Scroll the provider list to **Google**, click it to expand.
3. Turn **ON** the toggle **Enable Sign in with Google**.
4. **Client IDs** — paste the **Client ID** from 6a.
5. **Client Secret (for OAuth)** — paste the **Client secret** from 6a.
6. Click **Save**.

### 6c-0. Fix the Site URL while you're here (a real bug, not a nicety)

Supabase's **Site URL** ships as `http://localhost:3000`. Signup confirmation
emails have **no explicit redirect** (`apps/backend/src/routes/auth.ts:20` posts
to `/signup` without one), so they fall back to Site URL — meaning every real
person who signs up with email currently receives a confirmation link pointing
at their own machine. Dead link. `TESTING.md` even tells people to click it.

1. **Authentication** → **URL Configuration**
2. **Site URL** — replace `http://localhost:3000` with:
   ```
   https://ai-skriveassistent.vercel.app
   ```
3. **Save**

Password reset is unaffected — it passes its own redirect (`auth.ts:58`), built
from the backend's `PUBLIC_URL`. Confirm that env var is set to
`https://ai-skriveassistent-api.vercel.app` on Vercel production, or reset links
fall back to localhost too.

### 6c. Let the extension receive the login

**Do not skip this.** Without it, login succeeds at Google and then dies on the
way back with an unhelpful error.

1. In the same Supabase dashboard, left menu → **Authentication**.
2. Click **URL Configuration**.
3. Find **Redirect URLs**, click **Add URL**.
4. Paste this, exactly — including the `*` at the end:
   ```
   https://foidkbeinmfolejjjfjcokmmknimohof.chromiumapp.org/*
   ```
5. Click **Save**.

### 6d. Tell me, and I'll prove it worked

Say "done" and I'll run the same check I ran before you started. It currently
returns **400** (no provider). When your setup is correct it returns **302** to
`accounts.google.com`. No credential needed for me to test it — so you never
have to send me anything.

---

## Step 6.5 — A SECOND OAuth client, for Google Docs access (2 min)

Added 2026-08-06 after Phase 7 research. The client from Step 6 powers **sign-in**.
Reading and writing Google documents needs a *different* kind of client.

**Why two.** Supabase hands over a Google token at login but never refreshes it,
and Google's tokens expire hourly. Making that path work would mean putting your
Google **client secret** on our backend — exactly what Step 6 promised you'd
never have to do. A Chrome Extension client avoids it entirely: Chrome holds and
refreshes the token itself, and no secret exists to leak. It also lets us ask for
document access the first time someone uses the feature, instead of frightening
people at signup.

1. Google Cloud Console → confirm you're in the **AI Skriveassistent** project
2. **APIs & Services** → **Credentials** *(newer console: **Clients**)*
3. **+ Create credentials** → **OAuth client ID** *(newer: **+ Create client**)*
4. **Application type: Chrome Extension**
   > This time it genuinely is "Chrome Extension" — unlike Step 6a, which had to
   > be "Web application" because sign-in runs through Supabase.
5. **Name:**
   ```
   AI Skriveassistent – Extension
   ```
6. **Item ID** — paste:
   ```
   foidkbeinmfolejjjfjcokmmknimohof
   ```
7. **Create**

**This Client ID is NOT a secret — send it to me.** Chrome Extension clients have
no secret, and the ID ships inside the extension's manifest where anyone can read
it. That is by design and is safe. (The Step 6 client's *secret* is the one that
must never leave Supabase.)

**Two known traps, handled in code:**
- **Granular consent** — Google now lets a user approve sign-in while unticking
  document access. The code must check `grantedScopes`; a partial grant must
  never be treated as success.
- **Pre-publication** — whether `chrome.identity.getAuthToken` works before the
  extension is on the Web Store is unverified. It gets tested first, cheaply, in
  Phase 7's opening spike rather than discovered late.

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
