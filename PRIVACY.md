# Privacy Policy — AI Writing Assistant

*Last updated: 2026-08-05. This policy covers the beta version.*

## What the extension can see, and when

- **Page content is never read in the background.** The extension only reads
  page text when you explicitly act: capturing a selection, taking a
  screenshot, or focusing a field you insert into.
- **The sidebar runs on every site** because inserting text anywhere is the
  product's single purpose. Being present is not the same as reading: no page
  content leaves your browser without an explicit action from you.

## What we store

- Your account (email) and your conversations, in our database (Supabase, EU
  region — Stockholm), scoped to your account and readable only by you.
- Extracted text from files you attach, inside those conversations.
- Daily usage counts (number of requests), for quota enforcement.
- We do not store your browsing history, the pages you visit, or any page
  content you didn't explicitly send.

## Where your text goes

- Requests are processed by AI models via OpenRouter.
- **Everything you write or send is routed exclusively to paid endpoints with
  model training and prompt publication disabled.** There is nothing to tick and
  nothing to remember — it is the only setting. The routing is enforced on our
  server and cannot be overridden from the extension.
- Free models, whose providers may train on inputs, are used only for our own
  synthetic test traffic — never for your content.

## Google Docs access (autonomous mode)

Autonomous mode — the button that answers every question in a document — asks
for one Google permission, and only when you first use it on a Google Doc.
Never at sign-up, and never if you don't use the feature.

- **The permission is `https://www.googleapis.com/auth/documents`, and nothing
  else.** It covers the document you have open. It does not include Drive.
- **What is read:** the text and paragraph structure of the document you are
  looking at, once per run, so the questions can be found and the answers
  placed under the right ones.
- **What is written:** only the answers, and only as plain text under the
  question each belongs to. Your own text is never edited, moved or deleted.
- **What is never touched:** sharing settings, permissions, comments, version
  history, other documents, and Drive itself — file listings included. We
  cannot see that a file exists unless you have it open and start a run.
- **Where the document text goes:** to our backend, and from there to the AI
  provider on the paid endpoints where training and prompt publication are
  disabled — the same route as everything else you send. It is not stored
  beyond the conversation the run belongs to.
- **You can say no.** Decline the permission and autonomous mode still works:
  the answers arrive collected in one block at your cursor, with each question
  repeated above its answer, and the panel tells you plainly why the placement
  is different. You can withdraw the permission at any time at
  [myaccount.google.com](https://myaccount.google.com/permissions).

## Deletion

Deleting a conversation removes its stored content immediately. Deleting your
account removes everything (contact us during beta: sehit@degirmenci.dk).

## Permissions, in plain language

| Permission | Why |
|---|---|
| Access to websites | Insert text into the editor you're using — the product's one purpose |
| Storage | Remember your session, theme and settings |
| Active tab / tabs | Screenshot capture and sidebar toggling |
| Clipboard write | The Copy button and the clipboard fallback when insertion fails |
| Identity | Google sign-in, and the Docs permission above when you first use autonomous mode on a Doc |
| Google Docs (`auth/documents`) | Read the open document's questions and write the answers under them — requested at first use, never at sign-up, and declinable |
