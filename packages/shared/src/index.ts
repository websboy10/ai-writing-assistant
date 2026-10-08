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
/** GET /api/referral — the caller's invitation code and what it has earned. */
export interface ReferralInfo {
  /** false → the operator has switched invitations off; hide the offer */
  enabled: boolean;
  code: string;
  /** Read by 0.2.4 only, which showed free days; the offer is `discountPercent` now. */
  friendTrialDays: number;
  rewardDays: number;
  /** What both get off one month: the friend on their first, the inviter once that friend has paid. */
  discountPercent: number;
  /** The caller's own next checkout is discounted: an unused invitation, or a month earned by inviting. */
  myDiscount: boolean;
  invited: number;
  paid: number;
  rewards: number;
  /** The yearly ceiling is reached: further friends still get their discount. */
  capReached: boolean;
  /** Whether the caller may still redeem somebody else's code. */
  canClaim: boolean;
}

/** Where an invitation link points. The landing page keeps the code across the store install. */
export const referralLink = (code: string): string => `https://chatbotskriv.dk/?r=${code}`;

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

/**
 * What a paragraph IS, not only what it says.
 *
 * Until 2026-09-08 the model received a flat list of lines, so an empty answer
 * box and a blank line looked identical — both were "". Google Docs hands the
 * document's structure over on the same synthetic copy the extension already
 * fires (the `text/html` flavour, see target.ts), and this is that structure,
 * reduced to what the model and the placement logic actually use.
 *
 * Every field but `index` and `text` is optional so the plain-field and
 * contenteditable sources, which have no structure to report, keep sending
 * exactly what they always did.
 */
export type ParagraphKind = 'heading' | 'text' | 'bullet' | 'numbered' | 'cell';

export interface AutonomousParagraph {
  index: number;
  text: string;
  kind?: ParagraphKind;
  /** Heading 1-6, or list nesting depth from 1. */
  level?: number;
  /** The whole paragraph is bold — a label, not a sentence. */
  bold?: boolean;
  /** Where in which table. `text === ''` in a cell means an empty answer box. */
  cell?: { table: number; row: number; col: number };
  /**
   * A cell of several lines ("Manden skal herske" / "fortsæt herunder…")
   * reads as one paragraph, and `text` is its lines joined. This is the last
   * of them: the line Docs' Find is given when an answer is to go BELOW the
   * cell's text, since Find matches within one line only. Absent for a
   * one-line cell, where `text` is that line.
   */
  lastLine?: string;
}

/**
 * Where a fill lands relative to its paragraph `at`:
 * - `fill`: `at` is an EMPTY box or list item and the answer starts in it.
 * - `below`: a new line under `at`'s text — the question itself when the
 *   document draws nothing for it, or a cell that asks to be continued.
 * - `inline`: on `at`'s own line, after a label ("Navn:").
 * - `replace`: INSIDE `at`'s own line, in place of `target`: a blank drawn
 *   with underscores, an empty tick box, a "Sandt / Falsk" to settle. Only
 *   sent to a client that asked for it (AutonomousRequest.replace).
 */
export type FillMode = 'fill' | 'below' | 'inline' | 'replace';

export interface AutonomousRequest {
  scope: 'document' | 'selection';
  paragraphs: AutonomousParagraph[];
  /**
   * "Besvar markeringen" on Google Docs: `paragraphs` is the WHOLE document,
   * read the same way "Besvar alle" reads it, and this is where in it the
   * user's marking sits (both ends inclusive). Only questions inside the
   * range are answered; the rest is there so the model can see the box under
   * the last marked line, which the marking alone never showed it.
   */
  marked?: { from: number; to: number };
  documentTitle?: string;
  context?: ContextItem[];
  prefs?: OutputPrefs;
  /**
   * The client places every fill on its own (2026-09-09 and later). Without
   * it the server hands back ONE answer per question, its fills joined, with
   * `answerAt` as before: an extension built earlier would otherwise type a
   * grid's twenty-five cells one under the other beneath the question.
   */
  fills?: boolean;
  /**
   * The client can write INTO a line, not only under or after it (FillMode
   * `replace`). Without it a blank or a tick box is answered the old way, on
   * a line of its own, which every extension can place.
   */
  replace?: boolean;
  /**
   * Answer as a stream of AutonomousStreamEvent instead of one JSON body.
   *
   * Two reasons, one mechanism. The run is 10-60s of model calls, and for all
   * of it the panel could only say "Finder spørgsmål". And Chrome ends an
   * extension's service worker when a fetch has waited 30s for its response,
   * which is this request on any form of real size: the run then died with
   * nothing written and nothing said. A stream answers at once and keeps
   * talking, so the worker lives and the user can read what is happening.
   */
  stream?: boolean;
}

/** What "Besvar alle" is doing right now, and at the end what it produced. */
export type AutonomousStreamEvent =
  | { type: 'stage'; stage: 'found'; questions: number; places: number }
  | { type: 'stage'; stage: 'searching' }
  | { type: 'stage'; stage: 'answering'; done: number; total: number }
  | { type: 'result'; response: AutonomousResponse }
  | { type: 'error'; code: string; message: string };

/**
 * One place in the document and the text that goes there.
 *
 * Until 2026-09-09 a question had one answer and one optional place. A real
 * worksheet — a grid of verses × "Manden?"/"Kvinden?", a five-column table
 * with five empty rows, a cell that says "fortsæt herunder…" — has many
 * places for one question, and text to continue under rather than an empty
 * box. So the unit is the fill: the model plans every place with the whole
 * document in view, and the extension carries each out in document order.
 */
export interface AutonomousAnswer {
  /** The question this fill answers — the paragraph the fill is FOR. */
  paragraphIndex: number;
  questionText: string;
  /** What belongs at this place, in a few words, when the question alone does not say ("Manden? for 1. Korintherbrev 11,3"). */
  task?: string;
  /** The paragraph the fill lands at or under — see FillMode. Validated server-side against the paragraphs the extension sent; the extension checks again. */
  at: number;
  mode: FillMode;
  /** `replace` only: the piece of line `at`, verbatim and occurring once in it, that the answer takes the place of. */
  target?: string;
  /** `at` when `mode` is `fill`, for extensions built before fills existed; never read by the current client. */
  answerAt?: number;
  /**
   * The answer as the model wrote it: plain prose, with the markdown subset
   * the paced engine can type as real formatting — paragraphs, *italic*,
   * "- " bullets and "1. " numbers. The extension flattens it for editors
   * that cannot hold structure and compiles it to keystrokes for Google Docs
   * (insertion/richsteps.ts). Never headings: an answer sits under a
   * question, it does not become a section. Never bold, anywhere: the
   * operator's rule of 2026-09-09, stripped server-side before it gets here.
   */
  answer: string;
  /** false = nothing in the document or attached context grounded this answer (D-12). */
  grounded: boolean;
  /**
   * Client-side only. The extension flattens `answer` to plain text for every
   * path and keeps the model's original here for the one that can type it
   * formatted. Never sent by the server; never read by it.
   */
  markdown?: string;
}

export interface AutonomousResponse {
  answers: AutonomousAnswer[];
  detected: number;
}

/** Fills per run. A five-column table with five empty rows is twenty-five on its own. */
export const MAX_AUTONOMOUS_ANSWERS = 80;
export const MAX_AUTONOMOUS_DOC_CHARS = 60_000;
/** Fills per answer call. A question's fills always travel together, so a group larger than this is one batch by itself. */
export const ANSWER_BATCH_SIZE = 10;
