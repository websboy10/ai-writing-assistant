// Single source of truth for the API contract between extension and backend.
// The extension never talks to Supabase or OpenRouter directly — only to the backend.

export type ContentClass = 'synthetic' | 'real';

export interface ChatMessage {
  role: 'system' | 'user' | 'assistant';
  content: string;
}

export type PromptOperation =
  | 'chat'
  | 'summarize'
  | 'rewrite'
  | 'expand'
  | 'simplify'
  | 'explain'
  | 'translate'
  | 'continue';

export interface OutputPrefs {
  tone?: 'neutral' | 'formal' | 'friendly' | 'confident' | 'casual';
  length?: 'shorter' | 'same' | 'longer';
  language?: string; // target language for translate
}

export interface ContextItem {
  id: string;
  name: string;
  kind: 'pdf' | 'docx' | 'text' | 'image' | 'screenshot' | 'paste' | 'selection';
  text: string;
  chars: number;
  truncated: boolean;
}

export interface ChatRequest {
  messages: ChatMessage[];
  operation: PromptOperation;
  /** Text the operation acts on (page selection or typed input). */
  subject?: string;
  context?: ContextItem[];
  prefs?: OutputPrefs;
  conversationId?: string | null;
  /**
   * Compliance boundary, decided by the CLIENT's honest declaration but
   * ENFORCED server-side: 'real' content is only ever routed to paid,
   * no-training endpoints. The server treats unknown values as 'real'.
   */
  contentClass: ContentClass;
}

/** SSE events emitted by POST /api/chat */
export type ChatStreamEvent =
  | { type: 'meta'; conversationId: string; model: string }
  | { type: 'token'; text: string }
  // usage is null when the post-stream usage lookup failed — the response
  // itself still succeeded and clients must treat it as such.
  | { type: 'done'; usage: { used: number; limit: number; resetsAt: string } | null }
  | { type: 'error'; code: ChatErrorCode; message: string };

export type ChatErrorCode =
  | 'unauthenticated'
  | 'quota_exceeded'
  | 'payment_required'
  | 'all_models_failed'
  | 'policy_no_paid_models'
  | 'upstream_error'
  | 'bad_request';

/** GET /api/billing/status — the freemium gate as the UI sees it. */
export interface BillingInfo {
  status: 'trialing' | 'active' | 'past_due' | 'canceled' | 'expired';
  /** true → the product works; false → hard paywall */
  active: boolean;
  subscribed: boolean;
  trialEndsAt: string;
  trialDaysLeft: number;
}

export interface ConversationSummary {
  id: string;
  title: string;
  updatedAt: string;
  messageCount: number;
}

/** A reusable instruction, saved per user. GET/POST/DELETE /api/templates */
export interface PromptTemplate {
  id: string;
  name: string;
  instructions: string;
}

export interface UsageInfo {
  used: number;
  limit: number;
  resetsAt: string;
}

export interface ParsedFile {
  name: string;
  kind: ContextItem['kind'];
  text: string;
  chars: number;
  truncated: boolean;
}

export interface ApiError {
  error: string;
  code: string;
}

// ---- limits shared by client validation and server enforcement ----
export const MAX_FILE_BYTES = 10 * 1024 * 1024; // 10 MB
export const MAX_CONTEXT_CHARS_PER_ITEM = 60_000;
export const MAX_CONTEXT_ITEMS = 8;
export const ACCEPTED_FILE_TYPES: Record<string, ContextItem['kind']> = {
  'application/pdf': 'pdf',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document': 'docx',
  'text/plain': 'text',
  'text/markdown': 'text',
  'image/png': 'image',
  'image/jpeg': 'image',
};

export const OPERATION_LABELS: Record<PromptOperation, string> = {
  chat: 'Chat',
  summarize: 'Opsummér',
  rewrite: 'Omskriv',
  expand: 'Uddyb',
  simplify: 'Forenkl',
  explain: 'Forklar',
  translate: 'Oversæt',
  continue: 'Skriv videre',
};

// ---- Autonomous mode: POST /api/autonomous/answer (phase 7) ----
// The extension hands over an ordered list of paragraphs (whichever editor it
// came from); the backend decides what counts as a question (D-10) and
// answers every one it finds, grounded in the paragraphs plus any attached
// context. Model-returned indices are always positions into THIS list, never
// offsets into a live document — see apps/backend/src/autonomous/parse.ts.

export interface AutonomousParagraph {
  index: number;
  text: string;
}

export interface AutonomousRequest {
  scope: 'document' | 'selection';
  paragraphs: AutonomousParagraph[];
  documentTitle?: string;
  context?: ContextItem[];
  prefs?: OutputPrefs;
}

export interface AutonomousAnswer {
  paragraphIndex: number;
  questionText: string;
  answer: string;
  /** false = nothing in the document or attached context grounded this answer (D-12). */
  grounded: boolean;
}

export interface AutonomousResponse {
  answers: AutonomousAnswer[];
  detected: number;
}

export const MAX_AUTONOMOUS_QUESTIONS = 40;
export const MAX_AUTONOMOUS_DOC_CHARS = 60_000;
export const ANSWER_BATCH_SIZE = 5;
