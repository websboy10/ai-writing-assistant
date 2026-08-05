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
  | 'all_models_failed'
  | 'policy_no_paid_models'
  | 'upstream_error'
  | 'bad_request';

export interface ConversationSummary {
  id: string;
  title: string;
  updatedAt: string;
  messageCount: number;
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
