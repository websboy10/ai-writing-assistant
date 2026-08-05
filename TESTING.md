# How to test the app — 10 minutes

Updated 2026-08-06. Plain language. Everything here was already walked through
in a real browser by automated tests before being handed to you — but your
walkthrough is the proof that counts.

## What's already running

- **Backend**: running locally on your Mac (port 8787), detached — it keeps
  running on its own. If it ever stops: `bash scripts/backend.sh start`
  (also: `stop` / `status`)
- **Database & accounts**: hosted on Supabase (free tier, Stockholm region)
- **AI**: your OpenRouter key, free models for everything not marked as real data

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

## What deliberately doesn't work yet

| Thing | Why | When |
|---|---|---|
| "Continue with Google" button | Needs the Google credential from `docs/SETUP.md` Job 4 (10 min, your Google account) | Whenever you want it |
| Real personal data on paid no-training models | Works now via OpenRouter's trial allowance; needs ~$5 OpenRouter credit before beta users. The checkbox was removed from the UI — before real users, the backend flips to paid-only via config | Before first real user content |
| Rich-editor insertion on Gmail/LinkedIn/Slack/Notion | Built and passing on an equivalent test editor; needs sign-ins to verify on the real sites — same as the Docs test above | Your walkthrough |

## One infrastructure note

Your Supabase free plan allows 2 active projects. To create this one, I
**paused** (not deleted) `mariams-guide` — it had zero users and no sign-ins
ever. All its data is intact. To bring it back at any time:
Supabase dashboard → mariams-guide → Restore. (If you then need this project
too, one of them moves to a $10/month paid org — your call, later.)
