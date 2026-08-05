# Setup — what you do, what I do

Written 2026-08-05, before Phase 1. Plain language first.

## The short version

You have **three jobs** before I can build without stopping to ask you things,
and they take about 15 minutes total. Two more jobs come later, at the point
they're actually needed. Everything else on the list is mine.

| # | Your job | When | Time |
|---|----------|------|------|
| 1 | Get an OpenRouter API key | Now | 5 min |
| 2 | Install Google Chrome | Now | 5 min |
| 3 | Answer one question about the GitHub repo | Now | 10 sec |
| 4 | Create a Google sign-in credential | Phase 2 | 10 min |
| 5 | Pay $5 for a Chrome Web Store account | Before beta users | 5 min |

---

## Job 1 — OpenRouter API key

**Why:** This is the account that actually talks to the AI models. Without it the
extension has nothing to ask. OpenRouter gives you one key that reaches dozens of
models, including free ones, so we can start at zero cost and change models later
by editing a setting rather than rewriting code.

**Steps:**

1. Go to <https://openrouter.ai> and sign in (Google sign-in is fine).
2. Click your avatar, top right → **Keys**.
3. Click **Create Key**. Name it `ai-writing-assistant-dev`.
4. Leave the credit limit blank for now. Copy the key — it starts with `sk-or-v1-`.
   OpenRouter shows it once.
5. Come back here and paste this into the Claude Code prompt, including the
   leading `!`:

   ```
   ! read -rs "k?Paste OpenRouter key: " && echo "export OPENROUTER_API_KEY=$k" >> ~/.claude/.env.secrets && echo saved
   ```

   It will prompt you, hide what you type, and save the key to
   `~/.claude/.env.secrets` — the same file your other keys live in. The key
   never appears in the chat, in the repo, or in your shell history.

**Cost:** Free. Free models stay free. If you later want better models, you top
up credits and set a hard spending cap on that same Keys page — I'd suggest $10
with a limit, so a bug can never cost more than $10.

---

## Job 2 — Install Google Chrome

**Why:** You don't have Chrome on this Mac, only Brave and Safari. Brave *can*
run the extension for testing, but the product ships to Chrome, and "works in
Brave" is not evidence it works in Chrome. I need to be able to show you the real
thing in the real browser.

**Steps:**

1. Go to <https://www.google.com/chrome/> and download.
2. Open the `.dmg`, drag Chrome to Applications.
3. Open it once so macOS clears the security prompt. You don't need to sign in or
   make it your default browser.

**Cost:** Free.

---

## Job 3 — GitHub repo

**Why:** Your standing rule is that planning state which isn't committed and
pushed does not exist. Right now this repo is local only. I'll create the GitHub
repo and push it under your `websboy10` account — I just need one decision.

**The question:** Private or public?

Recommendation: **private**. It's a commercial product, and the repo will hold
configuration details you don't want indexed. Costs nothing either way.

Just say "private" or "public" and I'll do the rest.

---

## Job 4 — Google sign-in credential (Phase 2, not now)

**Why:** So beta users can click "Sign in with Google" instead of inventing
another password. Email/password works without this, which is why it waits.

I'll walk you through it when we get there. Roughly: Google Cloud Console → new
project → OAuth consent screen → Credentials → create an OAuth client ID, then
paste two values into the Supabase dashboard. I'll give you the exact redirect
URL to paste when the backend exists, because the URL doesn't exist yet.

**Cost:** Free.

---

## Job 5 — Chrome Web Store developer account (before beta users)

**Why:** Your ship bar is "10–50 real beta users." Those users need a way to
install the extension. There are two routes:

- **Free route:** I give you a `.zip`, each user unzips it and loads it manually
  in Chrome's developer mode. Fine for 3 friends, hopeless for 30 strangers — it
  takes six steps and Chrome nags them about it on every launch.
- **$5 route:** A one-time, lifetime Chrome Web Store developer fee. You publish
  the extension as **unlisted** — it doesn't appear in search, but anyone with
  the link installs it in one click, and it auto-updates when I ship fixes.

Recommendation: pay the $5 when we reach Phase 5. Not before — there's nothing to
upload yet, and store review adds a few days you don't want to spend twice.

**Cost:** $5, once, ever.

---

## What I handle — you do nothing here

- **Database and file storage.** I'll create a new Supabase project via the
  connected integration. Confirmed cost: **$0/month**. This gives us PostgreSQL,
  file storage for uploads, and the login system in one, which removes several
  weeks of building account handling, password resets and session security by
  hand. This is a change from your original spec, which listed a hand-built auth
  system and separate S3 storage — I'm proposing the simpler equivalent, and it
  keeps PostgreSQL and Prisma exactly as specified.
- **Hosting.** Vercel is already installed and connected. Free tier covers beta.
- **Every developer tool.** pnpm, packages, build config — I install what's
  missing without asking.
- **All code, database design, tests and deployment.**

---

## How you'll actually see the thing working

This is the part that matters most, because of your standing rule: a passing
build is not a working feature. Here's the loop we'll use every phase.

**First time only** — installing the extension into Chrome:

1. Open Chrome and go to `chrome://extensions`
2. Turn on **Developer mode** (toggle, top right)
3. Click **Load unpacked**
4. Choose the folder I tell you — it'll be
   `~/PROJEKTER/ai-writing-assistant/apps/extension/dist`
5. The extension appears in your toolbar. Pin it.

**Every time after that:** I make changes, you press the ↻ refresh icon on the
extension card, then reload the webpage you're testing on. That's it.

**What I'll ask of you at the end of each phase:** I'll give you a short numbered
list — "go to LinkedIn, click the button, type this, tell me what you see." Your
answers are the only real proof the thing works. If something looks wrong,
describing it in plain words ("the text went in backwards", "nothing happened")
is genuinely enough; I don't need technical detail.

---

## How to let me run autonomously

Once Jobs 1–3 are done, this is what unblocks long stretches of unattended work.

**Say this to start a work session:**

> `/gsd:progress`

That's the one command that always works. It reads where the project is and does
the next right thing — planning if the next phase needs planning, building if it
needs building.

**The three things that will interrupt me anyway, and are worth pre-answering:**

1. **Permission prompts.** Claude Code asks before running many commands. If you
   want fewer interruptions, run `/permissions` and allow `Bash(pnpm:*)`,
   `Bash(git:*)` and `Bash(node:*)` for this project. You can also just approve
   things as they come up.
2. **Design taste.** I'll ask you to react to the sidebar's look once, in
   Phase 1. One decision, then I stop asking.
3. **Anything that costs money or is hard to undo.** I'll always ask first.
   Deploying, publishing, deleting.

**What you should not do:** don't edit files in `.planning/` by hand. That's the
project's memory — if you want something changed there, say so and I'll change it
properly so the rest of the system stays in sync.

**If you want to walk away mid-build:** just say so. I'll finish what's in flight,
commit and push it, and leave a note in `.planning/STATE.md` about where things
stand so the next session picks up cleanly, even if it's a week later.
