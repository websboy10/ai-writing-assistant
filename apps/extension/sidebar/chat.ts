import type { ChatRequest } from '@awa/shared';
import { CHAT_PORT, type ChatPortClientMsg, type ChatPortServerMsg } from '@/utils/protocol';
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
    messages: s.messages.map((m) => (m.streaming ? { ...m, streaming: false } : m)),
  });
}

export function sendChat(userText: string, subject?: string): void {
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
    operation: s.operation,
    subject,
    context: s.context.length ? s.context : undefined,
    prefs: s.prefs,
    conversationId: s.conversationId,
    contentClass: s.containsRealData ? 'real' : 'synthetic',
  };

  const port = chrome.runtime.connect({ name: CHAT_PORT });
  activePort = port;

  // MV3 reality: if the service worker dies mid-stream the port disconnects.
  // That must surface as a visible, specific message — never a silent stall
  // (CHAT-04 / QUOT-07).
  let sawTerminal = false;

  port.onMessage.addListener((msg: ChatPortServerMsg) => {
    const state = useStore.getState();
    if (msg.type === 'closed') {
      if (!sawTerminal) {
        state.set({
          streaming: false,
          error: 'The response stream was interrupted before it finished. Try again.',
          messages: state.messages.map((m) => (m.streaming ? { ...m, streaming: false } : m)),
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
      case 'token': {
        const msgs = [...state.messages];
        const last = msgs[msgs.length - 1];
        if (last?.streaming) {
          msgs[msgs.length - 1] = { ...last, content: last.content + ev.text };
          state.set({ messages: msgs });
        }
        break;
      }
      case 'done': {
        sawTerminal = true;
        state.set({
          streaming: false,
          // null usage = the server's usage lookup failed; keep the last known value.
          usage: ev.usage ? { used: ev.usage.used, limit: ev.usage.limit, resetsAt: ev.usage.resetsAt } : state.usage,
          messages: state.messages.map((m) => (m.streaming ? { ...m, streaming: false } : m)),
        });
        break;
      }
      case 'error': {
        sawTerminal = true;
        // Chat streams bypass the call() wrapper, so session death surfaces
        // here too (WR-08).
        if (ev.code === 'unauthenticated') {
          state.set({
            streaming: false,
            email: null,
            view: 'auth',
            error: 'Your session expired — sign in again.',
            messages: state.messages
              .map((m) => (m.streaming ? { ...m, streaming: false } : m))
              .filter((m) => m.content.length > 0 || m.role === 'user'),
          });
          break;
        }
        const partial = state.messages[state.messages.length - 1];
        const kept = partial?.streaming && partial.content.length > 0;
        state.set({
          streaming: false,
          error: ev.message,
          notice: kept ? 'The partial response above was kept.' : null,
          messages: state.messages
            .map((m) => (m.streaming ? { ...m, streaming: false } : m))
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
          'The connection to the assistant dropped mid-response (the browser suspended the extension worker). The partial text is kept — press send to continue.',
        messages: state.messages.map((m) => (m.streaming ? { ...m, streaming: false } : m)),
      });
    }
  });

  const startMsg: ChatPortClientMsg = { type: 'start', request };
  port.postMessage(startMsg);
}
