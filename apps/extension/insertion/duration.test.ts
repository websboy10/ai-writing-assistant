import assert from 'node:assert/strict';
import test from 'node:test';
import { pacedDurationText } from './duration';
import { DEFAULT_PACING, MAX_WPM, MIN_WPM } from './types';

// ---------------------------------------------------------------------------
// The number the whole feature turns on. 60.000 tegn is MAX_CONTEXT_CHARS_PER_ITEM
// — the most a single attachment can hold — and the default tempo is 30 ord/min.
// If this figure is wrong, the button lies about a run that takes most of a
// working day.
//
// The engine's own rate is 60.000 / (wpm × 5) ms per character, so at 30 ord/min
// that is 400 ms each: 60.000 × 0,4 s = 24.000 s = 400 min = 6 t 40 min.
// ---------------------------------------------------------------------------

test('a full attachment at the default tempo: 6 timer og 40 minutter', () => {
  assert.equal(pacedDurationText(60_000, DEFAULT_PACING.wpm), 'ca. 6 timer og 40 minutter');
});

test('under a minute is said in words, not as "ca. 0 minutter"', () => {
  assert.equal(pacedDurationText(50, 30), 'under et minut');
});

test('singular minut, not "1 minutter"', () => {
  // 1 minut at 30 ord/min is 150 characters.
  assert.equal(pacedDurationText(150, 30), 'ca. 1 minut');
});

test('minutes below the hour stay minutes', () => {
  assert.equal(pacedDurationText(1_500, 30), 'ca. 10 minutter');
});

test('a whole number of hours drops the minutes half entirely', () => {
  // 9.000 characters at 30 ord/min is exactly 60 minutes.
  assert.equal(pacedDurationText(9_000, 30), 'ca. 1 time');
});

test('singular time, not "1 timer"', () => {
  assert.equal(pacedDurationText(9_150, 30), 'ca. 1 time og 1 minut');
});

// ---------------------------------------------------------------------------
// The slider's own ends. Neither may produce NaN, a negative, or a bare number
// with no unit — the estimate sits under a button that starts a real run.
// ---------------------------------------------------------------------------

test('both ends of the tempo slider produce sane text', () => {
  for (const wpm of [MIN_WPM, MAX_WPM]) {
    const text = pacedDurationText(60_000, wpm);
    assert.match(text, /^(under et minut|ca\. \d+ (minut|minutter|time|timer)( og \d+ (minut|minutter))?)$/);
  }
});

test('an empty attachment does not claim to take time', () => {
  assert.equal(pacedDurationText(0, 30), 'under et minut');
});
