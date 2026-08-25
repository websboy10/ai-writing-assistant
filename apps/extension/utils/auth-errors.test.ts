import assert from 'node:assert/strict';
import test from 'node:test';
import { danishAuthError } from './auth-errors';

// The two bodies below are verbatim from the production auth proxy on
// 2026-08-25 — the reason this module exists.

test('the measured wrong-password reply is Danish, not "Invalid login credentials"', () => {
  const body = { code: 400, error_code: 'invalid_credentials', msg: 'Invalid login credentials' };
  assert.equal(danishAuthError('login', 400, body), 'Forkert e-mail eller adgangskode.');
});

test('the measured bad-address reply is Danish and says what to do', () => {
  const body = { code: 400, error_code: 'email_address_invalid', msg: 'Email address "x@example.com" is invalid' };
  assert.equal(
    danishAuthError('signup', 400, body),
    'Den e-mailadresse ser ikke ud til at være gyldig. Tjek den, og prøv igen.',
  );
});

test('an already-registered address points at sign-in rather than repeating the failure', () => {
  assert.match(danishAuthError('signup', 422, { error_code: 'user_already_exists' }), /log ind/i);
});

test('older GoTrue replies without an error_code are matched on their text', () => {
  assert.equal(danishAuthError('login', 400, { msg: 'Invalid login credentials' }), 'Forkert e-mail eller adgangskode.');
  assert.match(danishAuthError('signup', 422, { msg: 'User already registered' }), /allerede en konto/);
  assert.match(danishAuthError('signup', 422, { msg: 'Password should be at least 6 characters.' }), /mindst 6 tegn/);
});

test('a send-rate limit keeps the number of seconds it told us', () => {
  const body = { msg: 'For security purposes, you can only request this after 47 seconds.' };
  assert.equal(danishAuthError('reset', 429, body), 'Vent 47 sekunder, før du prøver igen.');
});

test("our own backend's Danish is passed through, never replaced", () => {
  const ours = { error: 'E-mail og adgangskode er påkrævet', code: 'bad_request' };
  assert.equal(danishAuthError('login', 400, ours), 'E-mail og adgangskode er påkrævet');
});

test('a numeric GoTrue code is not mistaken for one of ours', () => {
  // GoTrue puts the HTTP status in `code`; ours puts a string slug there.
  // Getting this backwards would leak the English `error` field straight out.
  const body = { code: 400, error: 'Something went wrong', msg: 'Invalid login credentials' };
  assert.equal(danishAuthError('login', 400, body), 'Forkert e-mail eller adgangskode.');
});

test('an unrecognised failure still answers in Danish, and says which step failed', () => {
  assert.equal(danishAuthError('login', 500, { msg: 'unexpected_failure' }), 'Der kunne ikke logges ind lige nu. Prøv igen om et øjeblik.');
  assert.equal(danishAuthError('signup', 500, {}), 'Kontoen kunne ikke oprettes lige nu. Prøv igen om et øjeblik.');
  assert.equal(danishAuthError('reset', 500, null), 'Adgangskoden kunne ikke nulstilles lige nu. Prøv igen om et øjeblik.');
});

test('a bodyless 429 from the rate limiter is still explained', () => {
  assert.match(danishAuthError('login', 429, {}), /for mange forsøg/i);
});

test('no English ever reaches the user for any known GoTrue code', () => {
  const codes = [
    'invalid_credentials',
    'email_address_invalid',
    'user_already_exists',
    'email_exists',
    'weak_password',
    'email_not_confirmed',
    'user_not_found',
    'same_password',
    'signup_disabled',
    'over_email_send_rate_limit',
    'over_request_rate_limit',
    'validation_failed',
  ];
  for (const c of codes) {
    const msg = danishAuthError('login', 400, { code: 400, error_code: c, msg: 'Some English text' });
    assert.ok(!msg.includes('English'), `${c} leaked the English message`);
    assert.ok(/[a-zæøå]/i.test(msg), `${c} produced nothing readable`);
  }
});
