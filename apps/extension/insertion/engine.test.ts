import { test } from 'node:test';
import assert from 'node:assert/strict';
import { InsertionSession } from './engine.js';
import type { InsertionAdapter, InsertResult, InsertionState } from './types.js';

// The engine schedules its ticks through window.setTimeout (it lives in a
// content script). Node has no window; this is the whole shim it needs.
type WindowLike = { setTimeout: typeof setTimeout; clearTimeout: typeof clearTimeout };
(globalThis as unknown as { window?: WindowLike }).window ??= {
  setTimeout: setTimeout.bind(globalThis),
  clearTimeout: clearTimeout.bind(globalThis),
};

/**
 * Synthetic events are always isTrusted:false, which is exactly what the guard
 * filters on — so a plain dispatch cannot reproduce the bug. Forcing the flag
 * is what makes these events stand in for the browser's own edit reports.
 */
function trusted(type: string, init: EventInit & { key?: string } = {}): Event {
  const ev = type === 'keydown' ? new Event(type, init) : new Event(type, init);
  Object.defineProperty(ev, 'isTrusted', { value: true });
  if (init.key !== undefined) Object.defineProperty(ev, 'key', { value: init.key });
  return ev;
}

/**
 * Stands in for Google Docs: it accepts the write, but the browser only
 * reports the edit AFTER insert() has already returned. Plain fields and
 * contenteditable echo synchronously, inside the call — which is why this bug
 * is invisible everywhere except Docs.
 */
class LateEchoAdapter implements InsertionAdapter {
  readonly kind = 'gdocs' as const;
  // Typed as boolean, not `true`, so the synchronous variant below can narrow
  // it without TS2416.
  readonly echoesAsync: boolean = true;
  readonly target = new EventTarget();
  written = '';

  prepare(): InsertResult {
    return { ok: true, verified: false };
  }

  insert(chunk: string): InsertResult {
    this.written += chunk;
    // Late, like Docs: after insert() returns and the guard flag is down.
    setTimeout(() => this.target.dispatchEvent(trusted('input', { bubbles: true })), 0);
    return { ok: true, verified: false };
  }

  undoAll(): InsertResult {
    this.written = '';
    return { ok: true, verified: false };
  }

  eventTarget(): EventTarget {
    return this.target;
  }
}

function run(adapter: InsertionAdapter, text: string) {
  const states: { state: InsertionState; detail?: string }[] = [];
  const session = new InsertionSession(adapter, text, { wpm: 600 }, {
    onState: (state, detail) => states.push({ state, detail }),
    onProgress: () => {},
  });
  return { session, states };
}

const settle = (ms = 400) => new Promise((r) => setTimeout(r, ms));

test('a late edit report from the editor is our own echo, not the user typing', async () => {
  const adapter = new LateEchoAdapter();
  const text = 'Hej med dig';
  const { session, states } = run(adapter, text);

  session.start();
  await settle();

  // Before the fix this stopped after the first letter: the echo of chunk 1
  // arrived once inOwnDispatch was already false, so the guard read our own
  // write as the user typing and paused the run.
  assert.equal(adapter.written, text, `only wrote ${JSON.stringify(adapter.written)}`);
  assert.equal(session.getState(), 'done');
  assert.equal(
    states.some((s) => s.detail === 'user-typing'),
    false,
    'the run paused itself blaming the user',
  );
});

test('a real keystroke still pauses the run on the same adapter', async () => {
  const adapter = new LateEchoAdapter();
  const { session } = run(adapter, 'Hej med dig');

  session.start();
  // A user typing always produces a trusted keydown; our writes never do.
  // That is the signal the guard keeps on async-echo editors.
  adapter.target.dispatchEvent(trusted('keydown', { bubbles: true, key: 'a' }));
  await settle();

  assert.equal(session.getState(), 'paused', 'the typing-race guard was lost, not narrowed');
});

test('synchronous editors keep the strict input guard', async () => {
  class SyncEchoAdapter extends LateEchoAdapter {
    readonly echoesAsync = false;
  }
  const adapter = new SyncEchoAdapter();
  const { session } = run(adapter, 'Hej med dig');

  session.start();
  adapter.target.dispatchEvent(trusted('input', { bubbles: true }));
  await settle();

  assert.equal(session.getState(), 'paused', 'plain/contenteditable lost their input guard');
});
