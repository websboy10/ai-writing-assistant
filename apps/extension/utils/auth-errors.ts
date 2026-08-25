/**
 * GoTrue's English → the Danish the user actually reads.
 *
 * The auth proxy passes Supabase's own error body straight through so failures
 * stay specific (apps/backend/src/routes/auth.ts), and the background worker
 * showed whichever field it found. The result: a Danish product whose very
 * first screen answered a mistyped password with "Invalid login credentials",
 * and a bad address with `Email address "x@y" is invalid`. Confirmed against
 * production 2026-08-25.
 *
 * That is the worst possible place for it. Sign-in is the one screen every
 * single user meets before they have any reason to trust the product, and it
 * is the screen where they are already slightly annoyed.
 *
 * Matching is by `error_code` first, because that is GoTrue's stable
 * identifier; the message text is only consulted for older responses that
 * predate error codes. Anything unrecognised falls back to a plain Danish
 * sentence rather than to English — an unknown failure is still our failure to
 * explain, not the user's to translate.
 */

/** Where the user was when it failed — the same code means different things. */
export type AuthAction = 'login' | 'signup' | 'reset';

const BY_CODE: Record<string, string> = {
  invalid_credentials: 'Forkert e-mail eller adgangskode.',
  email_address_invalid: 'Den e-mailadresse ser ikke ud til at være gyldig. Tjek den, og prøv igen.',
  email_address_not_authorized: 'Der kan ikke sendes mail til den adresse.',
  user_already_exists: 'Der findes allerede en konto med den e-mail. Log ind i stedet.',
  email_exists: 'Der findes allerede en konto med den e-mail. Log ind i stedet.',
  weak_password: 'Adgangskoden er for svag. Brug mindst 6 tegn.',
  email_not_confirmed: 'Din e-mail er ikke bekræftet endnu. Åbn bekræftelseslinket i den mail, vi sendte dig.',
  user_not_found: 'Der findes ingen konto med den e-mail.',
  same_password: 'Den nye adgangskode er den samme som den gamle. Vælg en anden.',
  signup_disabled: 'Der kan ikke oprettes nye konti lige nu.',
  over_email_send_rate_limit: 'Der er sendt for mange mails til den adresse. Vent et par minutter, og prøv igen.',
  over_request_rate_limit: 'Der er for mange forsøg lige nu. Vent et minut, og prøv igen.',
  validation_failed: 'Udfyld både e-mail og adgangskode.',
};

/** Pre-error_code GoTrue, and anything else that still answers in prose. */
const BY_TEXT: [RegExp, string][] = [
  [/invalid login credentials/i, 'Forkert e-mail eller adgangskode.'],
  [/email address .* is invalid|unable to validate email/i, 'Den e-mailadresse ser ikke ud til at være gyldig. Tjek den, og prøv igen.'],
  [/user already registered|already been registered/i, 'Der findes allerede en konto med den e-mail. Log ind i stedet.'],
  [/password should be at least/i, 'Adgangskoden er for svag. Brug mindst 6 tegn.'],
  [/email not confirmed/i, 'Din e-mail er ikke bekræftet endnu. Åbn bekræftelseslinket i den mail, vi sendte dig.'],
  [/for security purposes, you can only request this after (\d+)/i, 'Vent $1 sekunder, før du prøver igen.'],
  [/rate limit|too many requests/i, 'Der er for mange forsøg lige nu. Vent et minut, og prøv igen.'],
];

const FALLBACK: Record<AuthAction, string> = {
  login: 'Der kunne ikke logges ind lige nu. Prøv igen om et øjeblik.',
  signup: 'Kontoen kunne ikke oprettes lige nu. Prøv igen om et øjeblik.',
  reset: 'Adgangskoden kunne ikke nulstilles lige nu. Prøv igen om et øjeblik.',
};

export function danishAuthError(action: AuthAction, status: number, body: unknown): string {
  const data = (body ?? {}) as Record<string, unknown>;

  // Our OWN backend already answers in Danish and is specific about it
  // ("E-mail og adgangskode er påkrævet"). It is told apart from GoTrue by the
  // shape rather than by the language: ours pairs a string `code` with a
  // string `error`, GoTrue's `code` is the numeric HTTP status.
  if (typeof data.code === 'string' && typeof data.error === 'string' && data.error) return data.error;

  const code = typeof data.error_code === 'string' ? data.error_code : undefined;
  if (code && BY_CODE[code]) return BY_CODE[code];

  const text = [data.msg, data.error_description, data.error, data.message].find(
    (v): v is string => typeof v === 'string' && v.length > 0,
  );
  if (text) {
    for (const [re, danish] of BY_TEXT) {
      const m = re.exec(text);
      if (m) return danish.replace('$1', m[1] ?? '');
    }
  }

  // 429 has no body worth reading when it comes from the rate limiter itself.
  if (status === 429) return 'Der er for mange forsøg lige nu. Vent et minut, og prøv igen.';
  return FALLBACK[action];
}
