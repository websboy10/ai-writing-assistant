# How to test the app — 10 minutes

Updated 2026-09-04. Plain language. Everything here was already walked through
in a real browser by automated tests before being handed to you — but your
walkthrough is the proof that counts.

**What changed on 2026-09-04.** The product now does one thing: you ask, you
get a draft, and it goes into your document — instantly, or typed out at a
speed you choose. "Besvar alle spørgsmål" and "Besvar markeringen" are gone,
and with them the Google Docs permission. New: a tempo slider, and a switch
called **Skriv som et menneske** that makes the typing slip and correct itself
the way a person does.

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
   - **Indsæt langsomt** — letter by letter, at the speed the slider is set to
   - Click into the **plain textarea** on the test page first, then try
     **Indsæt langsomt**: Pause, Fortsæt, and **Fortryd indsættelse** (the
     field returns to exactly how it was)
   - **Move the tempo slider** (just under the attachments row) and insert
     again. It runs from 10 to 200 words a minute; 30 is where it starts, and
     200 is roughly as fast as anyone types. It is remembered.
6. **The trap test**: click into the second field ("framework-controlled") and
   press **Indsæt straks**. The text must stay there. This field actively tries
   to reject inserted text the way LinkedIn and Gmail do.
7. **Type-interrupt test**: start a slow insert, then type a letter yourself
   mid-insertion. Insertion pauses itself and tells you why.
8. **Files**: press **+ Fil** → attach any PDF, Word, text, Markdown or image
   file → ask "opsummér den vedhæftede fil". Scanned PDFs and photos of text
   work too (they're read with Danish OCR). Also try **+ Skærmbillede**.
9. **Skriv som et menneske** — the switch beside the tempo slider. Turn it on,
   ask for a paragraph, and press **Indsæt langsomt** while watching the field.
   You should see the occasional wrong letter appear and get taken back, and
   now and then a word deleted and typed again. When it finishes, the text must
   be exactly the draft that was in the panel — check the end of it.
   It is off until you turn it on, and it stays on once you do.
10. **Insertion below a selection** — select some text in a field first, then
   press **Indsæt straks**. The answer lands on a new line *below* what you
   selected, never over it.
11. **History**: top of panel → Historik. Search, export, delete. **Log ud** is
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

This is the one thing automation cannot verify here, because it needs a
signed-in Google account and this machine has none. It matters most — your
first users live in Docs.

1. In the test Chrome window, sign in to Google and open any Google Doc
2. Click into the document so the cursor is in it
3. Open the panel, ask for a couple of sentences, and press **Indsæt straks**
4. Do it again with **Indsæt langsomt**, and once more with **Skriv som et
   menneske** switched on
5. Press **Fortryd indsættelse** after each and check the document goes back to
   how it was

*What to tell me:* "it typed into my document" or "nothing happened" is exactly
the level of detail I need. For the human-typing run, also say whether the
finished text was correct — a leftover wrong letter is the one failure that
would matter, and it is the thing the automated tests cover on every other kind
of editor but cannot cover here.

If Docs insertion is not working, the extension says so and offers Copy
instead — that is designed behaviour, not a crash.

### "+ Denne side" on a Google Doc — new, and unproven

Attaching the open document as background used to need a Google permission.
It now reads the document's own plain-text export using the cookies your
browser already has, the same thing that happens if you choose File → Download
→ Plain text yourself. **No permission is requested any more.**

Press **+ Denne side** in a Google Doc and click the chip to read back what was
attached. It should be the document's text.

This path has not been run against a real document on this machine: there is no
Google session here to run it with. What was measured (2026-09-04) is the
refusal: a document the browser cannot open answers with an HTML sign-in page,
not text, and the extension checks for exactly that rather than attaching the
sign-in page as if it were your document. If it fails for you, it should say so
in one Danish sentence — tell me if it says anything else, or attaches
something that is not your document.

## What deliberately doesn't work yet

| Thing | Why | When |
|---|---|---|
| "Continue with Google" button | Needs the Google credential from `docs/SETUP.md` Job 4 (10 min, your Google account) | Whenever you want it |
| "+ Denne side" inside Google Docs | Rewritten to need no Google permission; the refusal path is measured but the success path needs a signed-in browser | Your walkthrough |
| Rich-editor insertion on Gmail/LinkedIn/Slack/Notion | Built and passing on an equivalent test editor; needs sign-ins to verify on the real sites — same as the Docs test above | Your walkthrough |

## The Google approval is no longer a thing

This section used to explain which parts of the product were held up by
Google's verification of the OAuth app, because `auth/documents` is a sensitive
scope and that review is measured in weeks.

**There is nothing left to wait for.** The extension no longer asks for any
Google scope beyond sign-in: writing into a Doc goes through the document you
already have open, and "+ Denne side" reads the document's own text export with
the cookies the browser already holds. The manifest has no `oauth2` key at all.

So a **public** Chrome Web Store listing is now gated by the store review
alone, not by Google's OAuth verification on top of it.

## Things only you can do

Both of the items that stood here were **done on 2026-08-26**, and both were
checked from this side afterwards rather than taken on trust:

1. ~~**Put money on OpenRouter.**~~ **Done.** The next request to production
   came back served by `anthropic/claude-sonnet-5` instead of the deepseek
   fallback. Every model in the chain is now reachable, including the two
   image-capable ones — which matters more than it sounds, because a document
   whose tasks are pictures cannot be read at all without them.

2. ~~**Add `SUPABASE_SERVICE_ROLE_KEY` to Vercel.**~~ **Done.** Proved by the
   behaviour that key exists for: a run that produces no answer refunds the
   quota point it charged, net zero. That refund had never once worked — first
   because `rpc()` crashed on the empty 204 body a `void` function returns, then
   because the privileged call had no key to make it with.

**Still outstanding, and genuinely yours:** the Chrome Web Store submission
itself, and your walkthrough of Google Docs above. Google's OAuth verification
is no longer on this list — see the section above.

## Checking it yourself, without clicking

Everything below drives a real Chrome with the real extension. They are the
proof behind any claim that something works.

| Command | What it proves | Costs AI quota |
|---|---|---|
| `pnpm typecheck && pnpm test` | 45 unit tests, including that human typing always ends up as exactly the draft over 60 different random runs; nothing about the UI | no |
| `pnpm verify:rls` | The paywall and the daily limit cannot be picked open | no |
| `pnpm verify:drop` | Dragging a file onto the edge button attaches it | no |
| `pnpm verify:ui` | The panel itself: asking, page-as-context, long paste, templates, resize, banners, Danish sign-in errors, and a stream that dies before the first token | 1 request |
| `pnpm verify:paywall` | The whole payment flow, with a Stripe test card, and puts the account back afterwards | no |
| `pnpm verify` | 44 points in a real browser: sign-in, live streaming chat, both insert modes, pause/resume/stop/undo, the tempo slider, **Skriv som et menneske** (the field is sampled while it types, and some samples must NOT be a prefix of the draft), the framework-revert trap, rich text, the typing-race guard, history and export | ~2 requests |
| `pnpm verify:docs` | Google Docs: insert, undo, slow insert — needs a Google session in `.chrome-profile-cft` | ~3 requests |
| `pnpm verify:all` | Everything above except the paywall | ~4 requests |
| `pnpm verify:prod` | The same, but against the DEPLOYED backend, with the extension built exactly as a user installs it | ~10 requests |

`pnpm verify:docs --only=chat-progressive` runs one section on its own.

The daily limit is 200 requests per account, resetting at 02.00 Danish time. A
full round of Docs testing uses about 5% of it.

## One infrastructure note

Your Supabase free plan allows 2 active projects. To create this one, I
**paused** (not deleted) `mariams-guide` — it had zero users and no sign-ins
ever. All its data is intact. To bring it back at any time:
Supabase dashboard → mariams-guide → Restore. (If you then need this project
too, one of them moves to a $10/month paid org — your call, later.)
