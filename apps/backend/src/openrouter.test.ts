import { test } from 'node:test';
import assert from 'node:assert/strict';

// env.ts throws at import for a missing key; none of these reach a network.
for (const name of ['SUPABASE_URL', 'SUPABASE_ANON_KEY', 'OPENROUTER_API_KEY', 'STRIPE_SECRET_KEY', 'STRIPE_PRICE_ID']) {
  process.env[name] ??= `test-${name}`;
}
const { streamChat, NoModelsError } = await import('./openrouter.js');

/**
 * The chain, driven against a fake OpenRouter. What is checked is the ORDER
 * of attempts and what each one carried, because that order is the whole
 * point of the two rules added 2026-09-09 (see streamChat): a model that
 * fails with the web plugin is retried bare before the next model, and a
 * chain that failed for transient reasons gets one more pass.
 */
type Seen = { model: string; web: boolean };

function sse(text: string): string {
  return (
    `data: ${JSON.stringify({ choices: [{ delta: { content: text }, finish_reason: 'stop' }], usage: { prompt_tokens: 1, completion_tokens: 1 } })}\n\n` +
    'data: [DONE]\n\n'
  );
}

/** `decide` says how the fake answers each call, in order of calls. */
function fakeFetch(decide: (seen: Seen, callIndex: number) => number | 'ok' | 'drop', seen: Seen[]) {
  return async (_url: string | URL | Request, init?: RequestInit): Promise<Response> => {
    const body = JSON.parse(String(init?.body));
    const s = { model: body.model as string, web: Array.isArray(body.plugins) };
    const verdict = decide(s, seen.length);
    seen.push(s);
    if (verdict === 'drop') throw new TypeError('fetch failed');
    if (verdict === 'ok') return new Response(sse('svar'), { status: 200, headers: { 'content-type': 'text/event-stream' } });
    return new Response(JSON.stringify({ error: { message: 'Internal Server Error', code: verdict } }), { status: verdict });
  };
}

const messages = [{ role: 'user' as const, content: 'Skriv et resumé af novellen.' }];
const handlers = () => {
  const failed: { model: string; reason: string }[] = [];
  let text = '';
  return {
    failed,
    text: () => text,
    h: {
      onToken: (t: string) => {
        text += t;
      },
      onMeta: () => {},
      onUsage: () => {},
      onModelFailed: (model: string, reason: string) => failed.push({ model, reason }),
    },
  };
};

const realFetch = globalThis.fetch;

test('a model that fails WITH web search is retried at once WITHOUT it, before the next model', async () => {
  const seen: Seen[] = [];
  globalThis.fetch = fakeFetch((s) => (s.web ? 500 : 'ok'), seen) as typeof fetch;
  try {
    const hs = handlers();
    await streamChat(messages, 'real', new AbortController().signal, hs.h, { webSearch: true });
    assert.equal(hs.text(), 'svar');
    assert.deepEqual(seen.map((s) => s.web), [true, false]);
    assert.equal(seen[0].model, seen[1].model);
    assert.equal(hs.failed.length, 1);
    assert.match(hs.failed[0].reason, /^with web search: HTTP 500/);
  } finally {
    globalThis.fetch = realFetch;
  }
});

test('without web search each model is tried once, in chain order', async () => {
  const seen: Seen[] = [];
  globalThis.fetch = fakeFetch((_s, i) => (i === 0 ? 400 : 'ok'), seen) as typeof fetch;
  try {
    const hs = handlers();
    await streamChat(messages, 'real', new AbortController().signal, hs.h, {});
    assert.deepEqual(seen.map((s) => s.web), [false, false]);
    assert.notEqual(seen[0].model, seen[1].model);
  } finally {
    globalThis.fetch = realFetch;
  }
});

test('when every model failed for a transient reason, the chain gets ONE more pass a moment later', async () => {
  const seen: Seen[] = [];
  // Three models, three transient failures, then the first model answers.
  globalThis.fetch = fakeFetch((_s, i) => (i === 0 ? 503 : i === 1 ? 429 : i === 2 ? 'drop' : 'ok'), seen) as typeof fetch;
  try {
    const hs = handlers();
    const t0 = Date.now();
    await streamChat(messages, 'real', new AbortController().signal, hs.h, {});
    assert.equal(hs.text(), 'svar');
    assert.equal(seen.length, 4);
    assert.equal(seen[3].model, seen[0].model);
    assert.ok(Date.now() - t0 >= 900, 'the second pass waits before trying again');
  } finally {
    globalThis.fetch = realFetch;
  }
});

test('a refusal that will not change (HTTP 400) gets no second pass — the chain fails once, with every reason kept', async () => {
  const seen: Seen[] = [];
  globalThis.fetch = fakeFetch((_s, i) => (i === 1 ? 400 : 503), seen) as typeof fetch;
  try {
    const hs = handlers();
    await assert.rejects(
      streamChat(messages, 'real', new AbortController().signal, hs.h, {}),
      (err: unknown) => err instanceof NoModelsError && err.attempts.length === 3 && /HTTP 400/.test(err.attempts[1].reason),
    );
    assert.equal(seen.length, 3);
  } finally {
    globalThis.fetch = realFetch;
  }
});
