import type { ChatRequest } from '@awa/shared';
import { CHAT_PORT, type ChatPortClientMsg, type ChatPortServerMsg } from '@/utils/protocol';
import { stripMarkdown } from '@/insertion';
import { nextId, useStore } from './store';

let activePort: chrome.runtime.Port | null = null;

/** Stop generation (CHAT-03). Insertion, if running, is untouched (INST-10). */
export function stopGeneration(): void {
  if (activePort) {
    const msg: ChatPortClientMsg = { type: 'abort' };
    try {
      activePort.postMessage(msg);
      activePort.disconnect();
    } catch {
      /* already gone */
    }
    activePort = null;
  }
  const s = useStore.getState();
  s.set({
    streaming: false,
    messages: s.messages.map((m) => (m.streaming ? { ...m, streaming: false, status: undefined } : m)),
  });
}

export function sendChat(userText: string): void {
  const s = useStore.getState();
  if (s.streaming) return;

  const userMsg = { id: nextId(), role: 'user' as const, content: userText };
  const assistantMsg = { id: nextId(), role: 'assistant' as const, content: '', streaming: true };
  s.set({
    messages: [...s.messages, userMsg, assistantMsg],
    streaming: true,
    error: null,
    notice: null,
  });

  const request: ChatRequest = {
    messages: [...s.messages, userMsg]
      .filter((m) => m.role === 'user' || m.role === 'assistant')
      .map((m) => ({ role: m.role, content: m.content })),
    operation: 'chat',
    context: s.context.length ? s.context : undefined,
    prefs: s.prefs,
    conversationId: s.conversationId,
    // Always 'real' — the paid, no-training chain. This used to read a
    // `containsRealData` flag set by a "contains real data" checkbox; the
    // checkbox was removed from the UI but the read was left behind, so the
    // flag was permanently false and EVERY request shipped as 'synthetic',
    // routing real user text to free models whose providers may train on it —
    // the exact opposite of PRIVACY.md. 'synthetic' is now only sent by paths
    // that genuinely have no user data. Do not reintroduce a client-side
    // switch here: the extension cannot be trusted to classify the user's own
    // text, and the policy gate lives on the server (openrouter.ts, QUOT-05).
    contentClass: 'real',
  };

  const port = chrome.runtime.connect({ name: CHAT_PORT });
  activePort = port;

  // MV3 reality: if the service worker dies mid-stream the port disconnects.
  // That must surface as a visible, specific message — never a silent stall
  // (CHAT-04 / QUOT-07).
  let sawTerminal = false;

  // Token batching (WR-14): at ~40 tokens/s, one store write per token means
  // hundreds of component renders per second inside the host page's shadow
  // root. Buffer tokens and flush at most every 50 ms.
  //
  // `rawText` is the model's own words; the message holds the sanitised form.
  // Keeping both means the strip always runs over the WHOLE reply rather than
  // over one 50ms slice of it, which is what makes it correct: `**fed**` split
  // across two flushes is only recognisable once both halves have arrived.
  // The panel therefore shows exactly the text that insertion will write —
  // there is no second, different version of the draft anywhere.
  let rawText = '';
  let pendingText = '';
  let flushTimer: ReturnType<typeof setTimeout> | null = null;
  const flushTokens = () => {
    if (flushTimer !== null) {
      clearTimeout(flushTimer);
      flushTimer = null;
    }
    if (!pendingText) return;
    rawText += pendingText;
    pendingText = '';
    const st = useStore.getState();
    const msgs = [...st.messages];
    const last = msgs[msgs.length - 1];
    if (last?.streaming) {
      // The words ARE the status once they start, so it goes here rather than
      // on a timer — the label and the first word can never both be on screen.
      msgs[msgs.length - 1] = { ...last, content: stripMarkdown(rawText), markdown: rawText, status: undefined };
      st.set({ messages: msgs });
    }
  };

  port.onMessage.addListener((msg: ChatPortServerMsg) => {
    if (msg.type === 'ping') return; // relay keepalive, no UI meaning
    // Events from a superseded port must not touch state — "New conversation"
    // mid-stream would otherwise attach the old conversationId or resurrect
    // its tokens (WR-16).
    if (activePort !== port) return;
    if (msg.type === 'event' && msg.event.type === 'token') {
      pendingText += msg.event.text;
      flushTimer ??= setTimeout(flushTokens, 50);
      return;
    }
    // Any non-token message must see fully applied tokens first.
    flushTokens();
    const state = useStore.getState();
    if (msg.type === 'closed') {
      if (!sawTerminal) {
        state.set({
          streaming: false,
          error: 'Svaret blev afbrudt, før det var færdigt. Prøv igen.',
          messages: state.messages.map((m) => (m.streaming ? { ...m, streaming: false, status: undefined } : m)),
        });
      }
      activePort = null;
      return;
    }
    const ev = msg.event;
    switch (ev.type) {
      case 'meta':
        if (!state.conversationId) state.set({ conversationId: ev.conversationId });
        break;
      case 'status':
        state.set({
          messages: state.messages.map((m) => (m.streaming && !m.content ? { ...m, status: ev.state } : m)),
        });
        break;
      case 'sources':
        // Onto the message being written, not into it: `content` is what gets
        // typed into the document and must stay free of any address.
        state.set({
          messages: state.messages.map((m) => (m.streaming ? { ...m, sources: ev.sources } : m)),
        });
        break;
      case 'done': {
        sawTerminal = true;
        state.set({
          streaming: false,
          // null usage = the server's usage lookup failed; keep the last known value.
          usage: ev.usage ? { used: ev.usage.used, limit: ev.usage.limit, resetsAt: ev.usage.resetsAt } : state.usage,
          messages: state.messages.map((m) => (m.streaming ? { ...m, streaming: false, status: undefined } : m)),
        });
        break;
      }
      case 'error': {
        sawTerminal = true;
        // Trial ran out (possibly mid-session) → the hard paywall takes over.
        if (ev.code === 'payment_required') {
          state.set({
            streaming: false,
            billing: state.billing
              ? { ...state.billing, active: false }
              : { status: 'expired', active: false, subscribed: false, trialEndsAt: new Date(0).toISOString(), trialDaysLeft: 0, passEndsAt: null, passDaysLeft: 0 },
            messages: state.messages
              .map((m) => (m.streaming ? { ...m, streaming: false, status: undefined } : m))
              .filter((m) => m.content.length > 0 || m.role === 'user'),
          });
          void state.loadBilling();
          break;
        }
        // Chat streams bypass the call() wrapper, so session death surfaces
        // here too (WR-08).
        if (ev.code === 'unauthenticated') {
          state.set({
            streaming: false,
            email: null,
            view: 'auth',
            error: 'Din session er udløbet — log ind igen.',
            messages: state.messages
              .map((m) => (m.streaming ? { ...m, streaming: false, status: undefined } : m))
              .filter((m) => m.content.length > 0 || m.role === 'user'),
          });
          break;
        }
        const partial = state.messages[state.messages.length - 1];
        const kept = partial?.streaming && partial.content.length > 0;
        state.set({
          streaming: false,
          error: ev.message,
          notice: kept ? 'Det delvise svar ovenfor er beholdt.' : null,
          messages: state.messages
            .map((m) => (m.streaming ? { ...m, streaming: false, status: undefined } : m))
            .filter((m) => m.content.length > 0 || m.role === 'user'),
        });
        break;
      }
    }
  });

  port.onDisconnect.addListener(() => {
    if (activePort === port) activePort = null;
    const state = useStore.getState();
    if (state.streaming && !sawTerminal) {
      state.set({
        streaming: false,
        error:
          'Forbindelsen til assistenten røg midt i svaret (browseren satte udvidelsen i dvale). Den delvise tekst er beholdt — tryk send for at fortsætte.',
        messages: state.messages.map((m) => (m.streaming ? { ...m, streaming: false, status: undefined } : m)),
      });
    }
  });

  const startMsg: ChatPortClientMsg = { type: 'start', request };
  port.postMessage(startMsg);
}
