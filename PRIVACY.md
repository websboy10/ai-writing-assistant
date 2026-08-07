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
| Identity | Google sign-in |
