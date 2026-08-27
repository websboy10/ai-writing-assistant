# Stripe: fra testtilstand til rigtige penge

Skrevet 2026-08-06. Alt det tekniske er allerede bygget og virker i testtilstand.
Denne guide er KUN de trin, der kræver dig som ejer af Stripe-kontoen. Sig til,
når et trin er gjort — så klarer jeg resten automatisk (nøgler, produkt, webhook).

## Trin 1 — Aktivér din konto (≈ 15 min + 1-2 hverdages ventetid)

1. Gå til https://dashboard.stripe.com → knappen **"Activate payments"** (eller
   "Complete your profile")
2. Udfyld: virksomhedstype (enkeltmandsvirksomhed med CVR **eller** privatperson),
   adresse, og din **bankkonto** (der hvor pengene skal udbetales)
3. Bekræft din identitet (MitID/pas — Stripes standardproces)
4. Stripe verificerer typisk inden for **1-2 hverdage**. Du får en mail.

## Trin 2 — Ret navnet, kunderne ser (2 min)

Checkout viser lige nu **"Chat sandbox"** som sælger.

1. Dashboard → **Settings → Business → Public details**
2. Sæt **Public business name** til: `AI Skriveassistent`
3. Samme sted: support-email `sehit@degirmenci.dk`

## Trin 3 — Branding (2 min, valgfrit men anbefalet)

1. **Settings → Branding**
2. Upload logoet (jeg har filen: `apps/extension/public/icon/128.png`)
3. Farver: sort/hvid matcher produktet

## Trin 4 — Slå MobilePay til (2 min — vigtigt i Danmark!)

1. **Settings → Payment methods**
2. Aktivér **MobilePay** (og lad Apple Pay/Google Pay/kort stå til)
3. Ingen kodeændring behøves — vores checkout viser automatisk alle
   aktiverede betalingsmetoder

## Trin 5 — Kvitteringer (1 min)

1. **Settings → Emails** → slå **"Successful payments"** til
   (kunderne får automatisk kvittering fra Stripe)

## Trin 6 — Sæt live-nøglerne selv (2 min)

> **RETTET 2026-08-27.** Her stod tidligere "giv dem til mig i chatten". Det var
> forkert råd om den ene nøgle, der aldrig må gå den vej. `sk_live_...` kan
> hæve penge og læse alle kundedata, og alt i en chat kan ende i en log, en
> transkription eller et commit. Præcis dét skete på denne maskine 2026-08-12:
> tre live-nøgler lækkede, fordi transkriptioner blev committet til et repo.
> Samme grund til at `SUPABASE_SERVICE_ROLE_KEY` blev sat direkte i Vercel og
> aldrig passerede en samtale.

1. Slå **Test mode** fra (kontakten øverst til højre i dashboardet)
2. **Developers → API keys**
3. Kopiér **Secret key** (`sk_live_...`)
4. Gå til Vercel → projektet `ai-skriveassistent-api` → **Settings → Environment
   Variables** → sæt `STRIPE_SECRET_KEY` til værdien, scope **Production**
5. Sig til, at det er gjort — så udruller jeg og kører testen. Jeg behøver
   aldrig at se værdien.

**Publishable key** (`pk_live_...`) er offentlig af natur og må gerne deles i
chatten, hvis den skulle bruges. Den bruges ikke i dag: checkout åbnes af
serveren, ikke af udvidelsen.

## Hvad jeg derefter gør automatisk (du skal intet gøre)

- Opretter produktet + prisen (50 kr./md.) i live-tilstand
- Skifter serverens nøgler til live og genudruller
- Registrerer live-webhooken og dens hemmelighed
- Kører en ende-til-ende test og rapporterer

## Moms — det ene punkt til din revisor

Handelsbetingelserne siger "50 kr. inkl. moms". Ved reelt salg skal virksomheden
sandsynligvis **momsregistreres** (revisor-spørgsmål, ikke teknik). Når/hvis du
registreres, siger du til — så aktiverer jeg Stripe Tax, som derefter beregner og
bogfører momsen automatisk på hver betaling.

## Tidslinje, samlet

| Trin | Din tid | Ventetid |
|---|---|---|
| Kontoaktivering | ~15 min | 1-2 hverdage (Stripes verificering) |
| Navn, branding, MobilePay, kvitteringer | ~7 min | ingen |
| Live-nøgler til mig | ~2 min | jeg er færdig samme dag |
