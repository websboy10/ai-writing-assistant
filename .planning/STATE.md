# Project State

## Project Reference

See: .planning/PROJECT.md (updated 2026-08-05)

**Core value:** Generated text lands correctly in the editor the user is already
in, arriving at a pace they can read along with and stop mid-flow.
**Current focus:** Operator walkthrough (UAT) of the full v1 build

## Current Position

Phase: 1–6 built in a single autonomous run (operator-directed via /goal)
Status: Built and machine-verified — awaiting operator walkthrough (see TESTING.md)
Last activity: 2026-08-05 — Full v1 built, 13/13 automated browser checks pass,
all API surfaces verified live

Progress: [████████░░] ~80% (built + machine-verified; operator UAT and
real-site verification outstanding)

## What exists and how it was verified

**Working, verified by automated real-Chromium walkthrough (scripts/verify.mjs, 13/13):**
sidebar injection + floating button, sign-in, streaming chat against live AI,
edit-response-before-insert, progressive insertion with pause/resume into plain
textarea, single-step undo, insertion surviving a framework-controlled input's
revert behavior, contenteditable insertion, typing-race auto-pause, real usage
numbers in header.

**Working, verified via live API calls:**
401 for unauthenticated chat (AUTH-06); atomic quota consumption + clear 429
with reset time (QUOT-01/03); server-side model policy — real content routed to
paid/no-training endpoints, free chain only for synthetic (QUOT-05); ordered
model fallback observed live (QUOT-06); PDF/DOCX/TXT parsing + PNG OCR with
specific rejection messages for oversized/malformed/unsupported files
(CTX-01/02/03/04/10/11); conversation list/reopen/delete with real deletion
(HIST-01/03).

**Built but needs operator eyes (documented in TESTING.md):**
- Google Docs adapter (paste-event via docs-texteventtarget-iframe, self-test +
  clipboard fallback) — automation has no Google login; THE priority manual test
- Rich-editor insertion on real Gmail/LinkedIn/Slack/Notion (passes on
  equivalent harness editor)
- Google OAuth button (needs operator's Google Cloud credential — SETUP.md Job 4)
- Screenshot capture, drag-drop, theme toggle, resize persistence, SPA-nav
  remount, keyboard shortcut (all built; not in the automated suite)

## Infrastructure

- Supabase project `ai-writing-assistant` (gkqpyqmuopqxumugszoa, eu-north-1):
  schema + RLS + quota RPCs applied; test user tester@example.com (confirmed)
- **`mariams-guide` Supabase project was PAUSED (not deleted)** to free the
  2-project free-tier slot — zero users/sign-ins, data intact, restorable from
  the dashboard in ~1 min
- Backend: Fastify on 127.0.0.1:8787 (local dev; Vercel-ready), serves /harness
- OpenRouter key in backend .env only; never in extension code

## Deviations from plan (all deliberate, operator informed via TESTING.md)

- Prisma dropped in favor of Supabase RPC/PostgREST with RLS — MCP-created
  projects don't expose a DB password for a Prisma DATABASE_URL; RLS +
  security-definer RPCs cover v1's needs with less machinery
- Phases built together rather than sequentially — operator's /goal directive
  ("build the entire app, don't ask questions") supersedes phase-by-phase flow

### Pending Todos

- Operator walkthrough per TESTING.md — especially Google Docs insertion
- Google OAuth credential (SETUP.md Job 4) when operator wants Google sign-in
- ~$5 OpenRouter credit before any real-content beta usage
- Vercel deployment when moving beyond local testing
- Real-site contenteditable spot-checks (Gmail/LinkedIn/Slack/Notion)

### Blockers/Concerns

- Google Docs mechanism remains unverified against live Docs until the operator
  (or a signed-in session) tests it — self-test + clipboard fallback ship either way
- Free OpenRouter models 429 unpredictably; fallback chain mitigates, observed live

## Session Continuity

Last session: 2026-08-05
Stopped at: Full build complete, verification green, TESTING.md written,
Chrome launched with extension for operator walkthrough
Resume file: None
