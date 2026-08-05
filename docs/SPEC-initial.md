# Project Specification: Universal AI Writing Assistant Browser Extension

> Source: user-provided brief, 2026-08-05. This is the raw input spec that seeds
> GSD planning. Treat `.planning/PROJECT.md` and `.planning/ROADMAP.md` as the
> living source of truth once created.

## Overview

A cross-browser extension providing an AI-powered writing assistant through a
collapsible sidebar available on supported websites.

Users collect context from multiple sources — uploaded documents, pasted text,
screenshots, images — and use that context to generate, edit, summarize,
explain, or rewrite content with an LLM.

Generated content can be reviewed in the extension and inserted into compatible
web editors using either instant insertion or a configurable progressive typing
animation.

Modular architecture, designed for future expansion to additional websites, AI
providers, and productivity features.

## Primary Objectives

### Context Collection

Provide information from multiple sources without leaving the current webpage.

Supported inputs:

- PDF documents
- Microsoft Word documents (.docx)
- Plain text
- Drag-and-drop files
- Clipboard paste
- Screenshots
- Images
- OCR-processed content
- Previous conversation history
- Saved knowledge collections

All uploaded material is processed into a unified context before requests are
sent to the AI.

### AI Workspace

An always-accessible workspace where users can:

- Ask questions about uploaded material
- Generate drafts
- Summarize documents
- Rewrite text
- Expand ideas
- Simplify complex material
- Brainstorm
- Explain concepts
- Continue existing writing
- Translate text
- Organize notes

The workspace maintains conversational context throughout the current session.

### Writing Assistance

Generated responses are editable before insertion. Users may:

- Copy the generated text
- Insert immediately
- Insert progressively with configurable typing behavior

Typing animation settings are user-configurable and intended as a presentation
preference rather than a representation of authorship.

## Core Features

### Sidebar Interface

- Collapsible sidebar
- Floating action button
- Keyboard shortcut support
- Light and dark themes
- Resizable panel
- Conversation history
- Session management

### Context Manager

Accepts multiple forms of input simultaneously: PDF, DOCX, TXT, images,
clipboard, screenshots, OCR, saved files, existing conversations. Combines all
available information into a structured prompt for the AI.

### AI Engine

- Streaming responses
- Multiple AI providers
- Prompt templates
- Conversation memory
- Configurable system instructions
- Structured prompt assembly
- Token management
- Error recovery

The AI provider is abstracted behind a service layer so different models are
interchangeable.

### Text Insertion Engine

Insertion into compatible web editors.

Modes:

- **Instant** — insert the entire generated response immediately.
- **Progressive** — insert text incrementally with configurable speed and pacing.

User-adjustable options: characters per second, words per second, pause
duration, sentence pauses, paragraph pauses.

The insertion engine is independent from the AI generation process.

### File Processing

Supported formats: PDF, DOCX, TXT, Markdown, images (PNG, JPG).

Pipeline:

```
Upload → Extract Text → OCR (if required) → Clean Formatting → Chunk Content
      → Context Builder → Prompt Assembly
```

### OCR

Text extraction from screenshots, photos, scanned PDFs, whiteboards, and
handwritten notes (where feasible).

### Prompt Builder

Requests are constructed from structured sections rather than a single prompt:

- System Instructions
- User Request
- Uploaded Context
- Conversation History
- Output Preferences
- Style Preferences
- Formatting Requirements

## Technical Architecture

```
Browser Extension
├── React Sidebar
├── Popup
├── Options Page
├── Background Service Worker
├── Content Scripts
├── Storage Layer
├── Context Manager
└── Text Insertion Engine
        │
        ▼
Backend API
├── Authentication
├── AI Gateway
├── Prompt Builder
├── Context Processing
├── OCR Service
├── File Processing
├── Database
└── Storage
```

## Recommended Technology Stack

| Layer | Choice |
|---|---|
| Frontend | React, TypeScript, Vite, Tailwind CSS, React Query, Zustand |
| Extension | Chrome Manifest V3, Chrome Storage API, Background Service Worker, Content Scripts, Commands API |
| Backend | Node.js, NestJS or Fastify, TypeScript |
| Database | PostgreSQL, Prisma ORM |
| Storage | S3-compatible object storage |
| AI Layer | LLM provider abstraction, streaming API, prompt templates, conversation memory, context compression |
| OCR | Tesseract, optional cloud OCR service |
| Parsing | pdf.js, Mammoth, Markdown parser |
| Auth | Google OAuth, email/password, session management |

## Suggested Folder Structure

```
apps/
├── extension/
│   ├── sidebar/
│   ├── popup/
│   ├── options/
│   ├── background/
│   ├── content/
│   ├── insertion/
│   ├── storage/
│   └── shared/
├── backend/
│   ├── auth/
│   ├── ai/
│   ├── prompts/
│   ├── uploads/
│   ├── parser/
│   ├── ocr/
│   ├── users/
│   ├── conversations/
│   └── database/
└── shared/
    ├── types/
    ├── utils/
    └── constants/
```

## Development Roadmap

**Phase 1 — Foundation:** Browser extension scaffold, sidebar interface,
authentication, basic AI chat, prompt assembly, streaming responses.

**Phase 2 — Context Processing:** File uploads, PDF parsing, DOCX parsing, image
uploads, OCR, context builder, session management.

**Phase 3 — Editor Integration:** Content scripts, supported editor detection,
text insertion, progressive insertion, clipboard support, error handling.

**Phase 4 — Productivity Features:** Saved workspaces, prompt templates,
conversation history, writing preferences, export options, search.

**Phase 5 — Advanced AI:** Multi-document reasoning, knowledge collections,
citation generation, translation, long-context support, multiple AI providers.
