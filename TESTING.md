# How to test the app — 10 minutes

Updated 2026-08-06. Plain language. Everything here was already walked through
in a real browser by automated tests before being handed to you — but your
walkthrough is the proof that counts.

## What's already running

- **Backend**: running locally on your Mac (port 8787), detached — it keeps
  running on its own. If it ever stops: `bash scripts/backend.sh start`
  (also: `stop` / `status`)
- **Database & accounts**: hosted on Supabase (free tier, Stockholm region)
- **AI**: your OpenRouter key. Everything you send now goes to paid,
  no-training models — that's the only setting, and it matches the privacy
  policy (fixed 2026-08-07). Free models are used only for our own test traffic.

## Test account (already created and confirmed)

- Email: `tester@example.com`
- Password: `awa-test-2026`

You can also create your own account with your real email — you'll get a real
confirmation email; click the link, then sign in.

## Step by step

1. **A Chrome window should already be open** with the extension loaded and a
   test page showing. If not, run: `bash scripts/launch-chrome.sh` in the project
   folder.
2. Find the **round logo button** on the right edge of the page (or press
   **Alt+Shift+A**). Click it — a rounded panel opens attached to the right
   edge. **Bonus:** drag any PDF/Word/text/Markdown/image file from Finder
   toward the circle — it grows as you approach, swallows the file on drop,
   and shows a count badge. The file appears as a small chip above the message
   box; remove it with the ✕ in its corner.
3. **Sign in** with the test account above.
4. **Chat**: type anything, press Enter. The reply appears word-by-word.
   Try the ■ button mid-reply to stop it.
5. **Insert — the main event**. Every reply has exactly two insert buttons:
   - **Indsæt straks** — everything lands at once
   - **Indsæt langsomt** — letter by letter at human typing tempo (~30 words
     per minute), so anyone watching the doc sees normal typing
   - Click into the **plain textarea** on the test page first, then try
     **Indsæt langsomt**: Pause, Fortsæt, and **Fortryd indsættelse** (the
     field returns to exactly how it was)
6. **The trap test**: click into the second field ("framework-controlled") and
   press **Indsæt straks**. The text must stay there. This field actively tries
   to reject inserted text the way LinkedIn and Gmail do.
7. **Type-interrupt test**: start a slow insert, then type a letter yourself
   mid-insertion. Insertion pauses itself and tells you why.
8. **Files**: press **+ Fil** → attach any PDF, Word, text, Markdown or image
   file → ask "opsummér den vedhæftede fil". Scanned PDFs and photos of text
   work too (they're read with Danish OCR). Also try **+ Skærmbillede**.
9. **Marked text — two jobs, both offered when you select text on a page**:
   - **Besvar markeringen** — the assistant answers the marked text, and the
     answer is inserted on a new line *below* the marked text, never over it
   - **Brug som kontekst** — the marked text is attached as background
     knowledge (a chip, like a file)
10. **History**: top of panel → Historik. Search, export, delete. **Log ud** is
    the only other button up there — there is no settings page anymore.

## Freemium & betaling (nyt)

- Every new account gets **7 days free** automatically — the header shows
  "Prøve: X dage". No card needed to start.
- When the trial ends: **hard paywall** — the chat is replaced by an upgrade
  screen (50 kr./md. via Stripe). Enforced on the server, not just in the UI.
- **Anti-abuse**: a browser that has already used a free week gives new
  accounts no new trial (verified automatically).
- **Stripe is LIVE on the deployed backend** (real cards, real money, moms
  booked automatically). The local dev backend keeps TEST keys — the 4242
  test card and scripts/verify-paywall.mjs only work against a locally built
  extension pointing at 127.0.0.1:8787 (build with
  VITE_BACKEND_URL=http://127.0.0.1:8787).
- Manage/cancel: the paywall's "Administrér abonnement" opens Stripe's
  self-service portal.
- Before real customers: switch the Stripe keys to live mode and set the
  webhook secret (documented in .planning/STATE.md).

## The Google Docs test — needs your eyes

This is the one thing automation couldn't verify, because it needs a signed-in
Google account. It matters most — your first users live in Docs.

1. In the test Chrome window, sign in to Google and open any Google Doc
2. Select a line in the document (e.g. a question someone wrote)
3. Open the panel → **Besvar markeringen** → send → press **Indsæt langsomt**
4. Tell me what you saw — "it typed under my selection" or "nothing happened"
   is exactly the level of detail I need

If Docs insertion isn't working, the extension will say so and offer Copy
instead — that's designed behavior, not a crash.

## Autonomous mode — the 20-minute walkthrough

This is the feature from Phase 7: a project leader sends a worker a document
full of questions, the worker presses one button, and the answers get written
in. Six checks. Say what you saw for each, including anything slow or ugly.

**Before you start:** reload the extension at `chrome://extensions` **and**
press Cmd+R on the document tab. Skipping the second gives "Extension context
invalidated" — a panel that renders but does nothing.

### 1. A plain text field (the easy case)

Test page → the first textarea, which already holds five questions. Click into
it → **Besvar alle spørgsmål** → **Straks**.

*Correct:* every question keeps its own text, and an answer appears on the line
directly beneath it. The one plain statement in the middle gets nothing. A
question nothing in your material could answer still gets a real answer, and is
named separately in the panel under "Uden grundlag i dine kilder" — never
flagged inside the document itself.

### 2. A rich-text editor

Same page, second field (the contenteditable). Same button, but pick
**Langsomt**.

*Correct:* the answers type themselves out, first question first, working
downward. **Pause** stops the whole run, not one answer; **Fortsæt** picks it
up; **Fortryd alle svar** takes every answer back out in one press. Close the
panel mid-run — the run must keep going without it.

### 3. A real Google Doc — the one that matters

Make a document with three questions in it, the kind you'd actually be sent.
Open it, open the panel, **Besvar alle spørgsmål** → **Langsomt**.

The first time, Google will ask for permission to access your documents. Say
yes here (check 5 is where you say no).

*Correct:* each answer typed under its own question, top down, your own
formatting untouched. **Fortryd alle svar** brings it all back out.

*Known open:* spaces may be missing inside slow-typed text on Docs
("detterikke"). That's the whitespace bug in the table above, not a new fault —
note whether you see it and move on.

### 4. Ten questions at once, from a marking

In the same document, mark a block of ten questions → **Besvar markeringen** →
either mode.

*Correct:* the panel asks Straks or Langsomt and then writes — no draft, no
second Insert press. All ten answered in place, none skipped.

### 5. Say no to Google

Remove the permission at
[myaccount.google.com/permissions](https://myaccount.google.com/permissions),
or use a fresh Chrome profile. Run autonomous mode on a Doc again and
**decline**.

*Correct:* you still get answers — collected in one block at the cursor, each
question repeated above its answer — and the panel states plainly why the
placement is different. **What must not happen: nothing, silently.**

### 6. The old behaviour still works

Mark some text → **Brug som kontekst**.

*Correct:* a chip appears above the message box and nothing is written into the
document. Exactly as before — this button was not supposed to change.

## What deliberately doesn't work yet

| Thing | Why | When |
|---|---|---|
| "Continue with Google" button | Needs the Google credential from `docs/SETUP.md` Job 4 (10 min, your Google account) | Whenever you want it |
| Letter-by-letter spacing inside Google Docs | Each letter is its own paste and Docs appears to drop the space that comes with it, so slow insertion lands as "detterikke". Open — needs one observation in a real Doc before it can be fixed honestly (see the whitespace probe in the spike panel) | Next Docs session |
| Google OAuth verification for autonomous mode | `auth/documents` is a sensitive scope. The app is in Testing mode: up to 100 users you add yourself, no verification. Public launch needs Google to verify the OAuth app | Before public launch |
| Rich-editor insertion on Gmail/LinkedIn/Slack/Notion | Built and passing on an equivalent test editor; needs sign-ins to verify on the real sites — same as the Docs test above | Your walkthrough |

## Two things only you can do

Both block a real launch. Neither is a code problem.

1. **Put money on OpenRouter.** The account currently has **0 kr. of purchased
   credit**. Every request falls through to the cheapest model in the chain,
   because the two good ones (Claude Sonnet 5 and Gemini 3.5 Flash) refuse a
   request they cannot afford. The product works — the Danish it writes is
   decent — but it is writing with its weakest hand, and the one remaining
   flaky behaviour in autonomous mode is that model giving up on questions the
   document does not answer. https://openrouter.ai/settings/credits

2. **Add `SUPABASE_SERVICE_ROLE_KEY` to Vercel.** Supabase dashboard →
   Project Settings → API → `service_role` (the secret one — it must never go
   anywhere near the extension). Without it the Stripe webhook and the receipt
   page cannot write, which is harmless — a paying customer is still unlocked
   within seconds by the on-demand check, and the payment walkthrough passes
   6/6 with those calls being refused — but it is the last loose end from the
   security fix on 2026-08-25.

## Checking it yourself, without clicking

Everything below drives a real Chrome with the real extension. They are the
proof behind any claim that something works.

| Command | What it proves | Costs AI quota |
|---|---|---|
| `pnpm typecheck && pnpm test` | 50 unit tests; nothing about the UI | no |
| `pnpm verify:rls` | The paywall and the daily limit cannot be picked open | no |
| `pnpm verify:drop` | Dragging a file onto the edge button attaches it | no |
| `pnpm verify:ui` | 34 points: the panel, all eight actions, marked text, page-as-context, long paste, templates, resize | 1 request |
| `pnpm verify:paywall` | The whole payment flow, with a Stripe test card, and puts the account back afterwards | no |
| `pnpm verify:docs` | Google Docs: insert, undo, slow insert, answer a marking, answer a whole document, undo all | ~9 requests |
| `pnpm verify:all` | Everything above except the paywall | ~10 requests |

`pnpm verify:docs --only=answer-selection` runs one section on its own.

The daily limit is 200 requests per account, resetting at 02.00 Danish time. A
full round of Docs testing uses about 5% of it.

## One infrastructure note

Your Supabase free plan allows 2 active projects. To create this one, I
**paused** (not deleted) `mariams-guide` — it had zero users and no sign-ins
ever. All its data is intact. To bring it back at any time:
Supabase dashboard → mariams-guide → Restore. (If you then need this project
too, one of them moves to a $10/month paid org — your call, later.)
