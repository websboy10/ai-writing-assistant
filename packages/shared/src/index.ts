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

/**
 * The one thing the user sets about the shape of a reply.
 *
 * Tone used to live here too, as five adjectives. It went 2026-09-04: the
 * voice is now fixed by the system prompt (plain words, short sentences, the
 * odd slip) and a "Formel" switch fought that on every request — two rules
 * describing the same sentence, with the picker usually losing. One knob that
 * works beats two that argue.
 */
export interface OutputPrefs {
  /** Three fixed sizes with real word counts behind them (see backend prompt.ts). */
  length?: OutputLength;
  language?: string; // target language for translate
}

export type OutputLength = 'short' | 'medium' | 'long';

export const LENGTH_LABELS: Record<OutputLength, string> = {
  short: 'Kort',
  medium: 'Middel',
  long: 'Lang',
};

/** What each size promises, shown as the picker's tooltip so it is not a guess. */
export const LENGTH_HINTS: Record<OutputLength, string> = {
  short: 'Kort — én til to sætninger, 15 til 40 ord',
  medium: 'Middel — 120 til 180 ord, to til tre afsnit',
  long: 'Lang — 300 til 450 ord, fire til seks afsnit',
};

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

/**
 * One page the answer was based on.
 *
 * These never reach the document. OpenRouter returns them as structured data
 * alongside the reply, so the sidebar can show where an answer came from while
 * the text stays clean prose — which is the whole reason search is safe to
 * ship here at all. See PROSE_RULES and docs/WEB-SEARCH.md.
 *
 * They are also the only way the user learns a search happened at all: the
 * decision is the server's (backend/websearch.ts), so sources appearing under
 * an answer is what says "this one was looked up".
 */
export interface WebSource {
  title: string;
  url: string;
}

/** SSE events emitted by POST /api/chat */
export type ChatStreamEvent =
  | { type: 'meta'; conversationId: string; model: string }
  | { type: 'token'; text: string }
  /**
   * What the assistant is doing before the first word arrives.
   *
   * The wait used to be one undifferentiated pause. It is now made of parts
   * the user cannot see: deciding whether to look something up (~0.8s), and
   * then possibly searching (2-4s). Silence for five seconds reads as broken,
   * and the honest fix is to say which of the two is happening rather than to
   * show a spinner that means nothing.
   *
   * Superseded by the first token — once words appear, they are the status.
   */
  | { type: 'status'; state: ChatStatus }
  | { type: 'sources'; sources: WebSource[] }
  // usage is null when the post-stream usage lookup failed — the response
  // itself still succeeded and clients must treat it as such.
  | { type: 'done'; usage: { used: number; limit: number; resetsAt: string } | null }
  | { type: 'error'; code: ChatErrorCode; message: string };

export type ChatStatus = 'thinking' | 'searching';

/** Shown while waiting. Danish, and specific about which wait it is. */
export const CHAT_STATUS_LABELS: Record<ChatStatus, string> = {
  thinking: 'Tænker',
  searching: 'Søger på internettet',
};

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
  /**
   * When a bought month pass runs out, or null if none is running.
   *
   * A pass is the MobilePay route: MobilePay is a single-use wallet and Stripe
   * cannot bill it again next month (docs.stripe.com/payments/mobilepay —
   * "Recurring payments: No"), so the only honest way to take MobilePay money
   * is to sell one month at a time and say so.
   */
  passEndsAt: string | null;
  passDaysLeft: number;
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

// ---- pricing, in one place ----
// The number the extension shows. The backend keeps its own copy (its imports
// from this package are type-only by contract — see routes/files.ts), and the
// real authority is the Stripe Price. Three copies of one number is two too
// many, but a shared runtime constant cannot cross into the Vercel bundle.
export const PRICE_DKK = 100;
export const PASS_DAYS = 30;

// ---- "Besvar alle spørgsmål": POST /api/autonomous/answer ----
// The extension hands over an ordered list of paragraphs (whichever editor it
// came from); the backend decides what counts as a question (D-10) and
// answers every one it finds, grounded in the paragraphs plus any attached
// context. Model-returned indices are always positions into THIS list, never
// offsets into a live document — see apps/backend/src/autonomous/parse.ts.
//
// Restored 2026-09-08. It was cut on 2026-09-03 (63aedf5) only because the
// mechanism that PLACED the answers used the Google Docs API, whose
// `auth/documents` scope meant OAuth verification and blocked publishing. The
// answering half below never knew about Google at all, so it comes back
// unchanged; placement now goes through Docs' own Find bar instead, which
// needs no permission.
//
// What did NOT come back: `AutonomousParagraph.images`. Reading an inline
// image out of a document was a Docs API read, and nothing in the no-permission
// path can see one — so a question that IS a picture cannot be answered this
// way any more. "+ Skærmbillede" remains the honest route for those.

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
