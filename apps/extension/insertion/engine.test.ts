import { test } from 'node:test';
import assert from 'node:assert/strict';
import { InsertionSession } from './engine.js';
import type { InsertionAdapter, InsertResult, InsertionState } from './types.js';
import { GDocsAdapter } from './adapters/gdocs.js';

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

  deleteBack(count: number): InsertResult {
    this.written = this.written.slice(0, this.written.length - count);
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

function run(adapter: InsertionAdapter, text: string, pacing = { wpm: 600, human: false }, opts = {}) {
  const states: { state: InsertionState; detail?: string }[] = [];
  const progress: number[] = [];
  const session = new InsertionSession(
    adapter,
    text,
    pacing,
    {
      onState: (state, detail) => states.push({ state, detail }),
      onProgress: (n) => progress.push(n),
    },
    opts,
  );
  return { session, states, progress };
}

function seeded(seed: number): () => number {
  let s = seed >>> 0 || 1;
  return () => {
    s ^= s << 13;
    s ^= s >>> 17;
    s ^= s << 5;
    return ((s >>> 0) % 100_000) / 100_000;
  };
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

test('human mode ends with the text byte for byte, having deleted along the way', async () => {
  const text = 'Medarbejderen viste tydelig fremgang i salget. Hun lukkede fjorten aftaler, hvilket er over målet.';
  let deleted = 0;
  class CountingAdapter extends LateEchoAdapter {
    deleteBack(count: number): InsertResult {
      deleted += count;
      return super.deleteBack(count);
    }
  }
  for (let seed = 1; seed <= 8; seed++) {
    deleted = 0;
    const adapter = new CountingAdapter();
    const { session, progress } = run(adapter, text, { wpm: 20_000, human: true }, { rng: seeded(seed), pauseScale: 0 });
    session.start();
    for (let i = 0; i < 100 && session.getState() === 'running'; i++) await settle(50);
    assert.equal(session.getState(), 'done', `seed ${seed}`);
    assert.equal(adapter.written, text, `seed ${seed}`);
    assert.equal(progress[progress.length - 1], text.length, `seed ${seed}: progress did not end at the whole text`);
  }
});

test('human mode: a slip is typed and taken back before the real text goes on', async () => {
  // With the default rates a short text may get no slip at all; run enough
  // seeds that at least one does, and check that every one ends clean.
  const text = 'Kundekontakten er blevet bedre og mere direkte gennem hele perioden.';
  let sawDeletion = false;
  for (let seed = 1; seed <= 40 && !sawDeletion; seed++) {
    const adapter = new LateEchoAdapter();
    const origDelete = adapter.deleteBack.bind(adapter);
    adapter.deleteBack = (n) => {
      sawDeletion = true;
      return origDelete(n);
    };
    const { session } = run(adapter, text, { wpm: 20_000, human: true }, { rng: seeded(seed), pauseScale: 0 });
    session.start();
    for (let i = 0; i < 100 && session.getState() === 'running'; i++) await settle(50);
    assert.equal(adapter.written, text, `seed ${seed}`);
  }
  assert.ok(sawDeletion, 'forty seeds and never a single slip');
});

test('plain slow mode is unchanged: one insert per chunk, nothing deleted', async () => {
  const adapter = new LateEchoAdapter();
  adapter.deleteBack = () => {
    throw new Error('deleteBack must never be called outside human mode');
  };
  const { session, progress } = run(adapter, 'Hej med dig');
  session.start();
  await settle();
  assert.equal(adapter.written, 'Hej med dig');
  assert.deepEqual(progress, [1, 2, 3, 5, 6, 7, 9, 10, 11]);
});

test('on Docs, human mode never hands a paste a space at either edge', async () => {
  // Docs discards a space sitting at the edge of an individual paste
  // (adapters/gdocs.ts measured it), which is why GDocsAdapter chunks the way
  // it does. Human mode adds cuts of its own — a slip, a rewrite — and this
  // is the check that those cuts inherit the same rule. Without it the words
  // around every correction would glue together in the user's document, and
  // nothing on the canvas can be read back to notice.
  const text = 'Medarbejderen viste tydelig fremgang i salget i år. Hun lukkede mange aftaler, hvilket er pænt over målet.';
  const docsChunk = GDocsAdapter.prototype.chunkText.bind(new GDocsAdapter());
  for (let seed = 1; seed <= 12; seed++) {
    const chunks: string[] = [];
    class DocsChunkingAdapter extends LateEchoAdapter {
      chunkText = docsChunk;
      insert(chunk: string): InsertResult {
        chunks.push(chunk);
        return super.insert(chunk);
      }
    }
    const adapter = new DocsChunkingAdapter();
    const { session } = run(adapter, text, { wpm: 20_000, human: true }, { rng: seeded(seed), pauseScale: 0 });
    session.start();
    for (let i = 0; i < 100 && session.getState() === 'running'; i++) await settle(50);
    assert.equal(adapter.written, text, `seed ${seed}`);
    for (const c of chunks) {
      assert.doesNotMatch(c[0], /[ \t]/, `seed ${seed}: chunk starts with a space: ${JSON.stringify(c)}`);
      assert.doesNotMatch(c[c.length - 1], /[ \t]/, `seed ${seed}: chunk ends with a space: ${JSON.stringify(c)}`);
    }
  }
});
