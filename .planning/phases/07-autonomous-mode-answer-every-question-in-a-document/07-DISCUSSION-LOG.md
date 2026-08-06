# Phase 7: Autonomous mode — answer every question in a document - Discussion Log

> **Audit trail only.** Do not use as input to planning, research, or execution agents.
> Decisions are captured in CONTEXT.md — this log preserves the alternatives considered.

**Date:** 2026-08-06
**Phase:** 07-autonomous-mode-answer-every-question-in-a-document
**Areas discussed:** Where each answer lands, Unanswerable questions, Review before writing, What counts as a question, Fixing Google Docs

---

## Area selection

| Option | Description | Selected |
|--------|-------------|----------|
| Where the answers come from | The fabrication problem — notes-first, interview, or draft-and-mark | |
| Where each answer lands | In place per question vs one collected block | ✓ |
| Review before it writes | Panel approval vs straight into the document | ✓ |
| What counts as a question | Strict `?` matching vs AI judgement | ✓ |

**User's choice:** Three of four; "where the answers come from" delegated to Claude.
**Notes:** Claude had flagged the fabrication risk before the selection — that an
AI pointed at a questionnaire will invent confident specifics about the user's
own work. The operator chose not to discuss it directly.

---

## Where each answer lands

| Option | Description | Selected |
|--------|-------------|----------|
| In place where possible, block on Docs | In place in normal editors; one block on Docs, with the panel explaining why | ✓ |
| Always one block, everywhere | Identical behaviour on every site; predictable but worse where we could do better | |
| In place everywhere, by rewriting the doc | Select-all and write back an interleaved version — destroys formatting | |
| In place, and skip Docs entirely | Only offer the feature where it can be done properly | |

**User's choice:** In place where possible, block on Docs.
**Notes:** Later **superseded in part** by the decision to build the Google Docs
API path — the block becomes a degraded fallback (CONTEXT D-02) rather than the
expected behaviour on Docs.

---

## Unanswerable questions

| Option | Description | Selected |
|--------|-------------|----------|
| Visibly marked draft | Best attempt, marked `[UDKAST — tjek dette]` in the document | |
| Leave it blank with a note | Writes "cannot be answered from the document" | |
| Ask the user before writing | Collects missing facts first — best quality, but becomes a conversation | |
| Just answer everything | Fills every question with plausible content, marks nothing | ✓ |

**User's choice:** Just answer everything.
**Notes:** Chosen with the fabrication risk stated in the option's own
description. Claude restated the concern once — a worker submitting a review
containing invented specifics about their own work — then accepted the decision
and did not reopen it. Mitigation moved into Claude's delegated area instead:
source material widened to attached files (D-11) and the gaps surfaced in the
panel rather than the document (D-12), which leaves the operator's decision
about the document intact.

---

## Review before writing

| Option | Description | Selected |
|--------|-------------|----------|
| Show answers in panel first | Read, then press Straks or Langsomt | |
| Write straight into the document | One button, text appears immediately | |
| Straight in, one question at a time | Keep-or-skip per answer | |

**User's choice:** Free text — *"there should still be 2 options. either fast or
slow. if slow it just pastes all the answers in the right formatted way below
questions. and if slow is picked. its letter by letter starting with the question
at the top"*
**Notes:** No review step at all. The operator collapsed the interaction back to
the two existing buttons rather than any of the offered options — simpler than
what was proposed, and consistent with the "idiot friendly" bar. Langsomt was
specified as visibly working top-to-bottom through the document.

---

## What counts as a question

| Option | Description | Selected |
|--------|-------------|----------|
| Let the AI judge | Whole document to the model; it returns what needs answering | ✓ |
| Only lines ending in `?` | Strict and predictable; misses most of a real form | |
| AI judges, user confirms the list | Catches mistakes — but reintroduces the rejected review step | |

**User's choice:** Let the AI judge.

---

## Marked text (raised by the operator mid-discussion)

Not offered as an area — the operator introduced it directly:

> *"when somebody marks something on their screen whether in docs or somewhere
> else… the user clicks 'besvar markering', the side panel prompts and asks if it
> should be slow or fast. user picks and ai writes. that should also work for 10
> questions marked at the same time. if the other option is chosen which is brug
> som kontekst, it just stays in the context and answers the next question or
> request from said context."*

**Outcome:** Folded into this phase rather than deferred — it is the same engine
at a smaller scope, not a new capability. Recorded as CONTEXT D-04a/D-04b.
Multi-question selections were called out by the operator as a normal case.

---

## Fixing Google Docs

| Option | Description | Selected |
|--------|-------------|----------|
| Docs API, with the hack as fallback | Real positions, formatting preserved, better question detection; needs OAuth | ✓ |
| Drive the Find bar | Borrow Ctrl+F to position the cursor; no permissions, but a second undocumented hack | |
| Walk it with the keyboard | Feel down the document reading the hidden mirror; self-contained but slow and fragile | |
| Spike all three, then decide | Throwaway tests against a real Doc before committing | |

**User's choice:** Docs API, with the hack as fallback.
**Notes:** Prompted by the operator's *"lets be creative and fix google docs"* —
an explicit rejection of accepting the canvas limitation. The deciding fact was
that OAuth "Testing" mode allows up to 100 users with no Google verification, so
the API path is available for the whole beta and verification becomes a launch
task. Consequence: Google OAuth is promoted from optional (SETUP.md Job 4) to a
Phase 7 prerequisite.

---

## Claude's Discretion

- **Where the answers come from** — explicitly delegated. Decided as: the
  document plus any files already attached in the panel, with unanswerable
  questions listed in the panel (CONTEXT D-11, D-12).
- Mid-run user typing → auto-pause via the existing guard (D-13).
- Long Langsomt runs continue in a background tab (D-14).
- Stop/undo spans the whole run as one step (D-15).

These were offered to the operator as a further round and the offer was
interrupted by the Google Docs request; they were decided by Claude as delegated.

## Deferred Ideas

- Google OAuth app verification for public launch (>100 users).
- Microsoft Word Online as a second structured-document target.
- The `contentClass` model-routing fix (`chat.ts:48`) — an existing deferred
  defect, not introduced here, but this phase raises its stakes.
