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

## Google Docs

The assistant writes into a Google Doc the same way it writes into any other
editor: through the document you already have open, at the cursor you placed.

- **No Google permission is requested, and none is needed.** There is no
  `documents` scope, no Drive scope, and no Google sign-in prompt for this.
  An earlier version of the extension asked for `auth/documents`; that was
  removed along with the feature that needed it.
- **"+ Denne side" on a Google Doc** fetches the document's own plain-text
  export with the cookies your browser already has, exactly as it would if you
  chose File, Download, Plain text yourself. It only ever succeeds for a
  document the account signed into your browser can already open, and it is
  only ever sent when you press that button.
- **Where the text goes:** to our backend, and from there to the AI provider on
  the paid endpoints where training and prompt publication are disabled — the
  same route as everything else you send. It is not stored beyond the
  conversation it belongs to.
- **What is never touched:** sharing settings, permissions, comments, version
  history, other documents, and Drive itself. Nothing can list your files.

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
| Identity | "Continue with Google" sign-in, and nothing else |
