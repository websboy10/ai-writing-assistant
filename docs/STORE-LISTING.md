# Chrome Web Store — færdig tekst til alle felter

Skrevet 2026-08-06. Alt herunder er skrevet til at blive **kopieret direkte ind**
i devconsole. Rækkefølgen følger fanerne i konsollen.

Pakken der skal uploades:
`apps/extension/.output/extension-0.1.0-chrome.zip` (101 KB)

> **Én ting skal afgøres før indsendelse** — se afsnittet "Blokering" nederst.
> Det handler om, hvilke AI-modeller brugernes tekst sendes til, og det påvirker
> både privatlivspolitikken og den erklæring, Google beder dig underskrive.

---

## Fanen: Store listing

### Navn (max 75 tegn)

```
AI Skriveassistent
```

### Kort beskrivelse / "Summary" (max 132 tegn)

```
Chat med en AI-assistent i kanten af enhver side — og få svaret skrevet direkte ind i dit dokument, i dit eget tempo.
```

*(115 tegn)*

### Fuld beskrivelse (dansk — max 16.000 tegn)

```
Ikke endnu en chatboks. En assistent, der skriver dér, hvor du skriver.

De fleste AI-værktøjer giver dig et svar, du selv skal kopiere videre. AI
Skriveassistent afleverer teksten direkte i det tekstfelt eller dokument, du
allerede arbejder i — og du bestemmer hvordan.

SÅDAN VIRKER DET

En lille rund knap sidder i kanten af siden. Klik på den (eller tryk
Alt+Shift+A), så åbner et panel i højre side. Skriv til assistenten som i en
almindelig chat. Når svaret er klar, vælger du selv, hvordan det skal ind:

• Indsæt straks — hele teksten lander på ét sekund
• Indsæt langsomt — bogstav for bogstav i et naturligt skrivetempo, cirka 30
  ord i minuttet, så det ser ud som almindelig skrivning

Undervejs kan du sætte på pause, fortsætte, stoppe helt og fortryde. Begynder du
selv at skrive midt i en indsættelse, sætter assistenten automatisk på pause og
fortæller dig hvorfor. Det er dit dokument hele vejen.

VIRKER I DIN EDITOR — OGSÅ GOOGLE DOCS

Assistenten skriver i almindelige tekstfelter, i rige editorer, i CMS'er og i
webmail. Google Docs bruger sin egen særlige editor, som de fleste udvidelser
ikke kan skrive i — den har vi bygget specifik understøttelse af.

VEDHÆFT FILER — OGSÅ SCANNEDE

Træk PDF, Word, tekst, Markdown eller billeder ind i samtalen, og skriv ud fra
indholdet. Scannede dokumenter og fotos af tekst læses automatisk med OCR, med
fuld understøttelse af dansk.

MARKÉR TEKST — VÆLG HVAD DEN SKAL BRUGES TIL

Markér tekst på en side og vælg mellem to ting: få den besvaret, så svaret
lander lige under det markerede — eller vedhæft den som baggrund til samtalen.
Assistenten overskriver aldrig det, du har markeret.

DINE SAMTALER GEMMES

Du kan altid vende tilbage til en tidligere samtale, søge i dem og slette dem.

PRIS

7 dage gratis. Du skal ikke oplyse kort for at prøve. Derefter 50 kr. om
måneden, ingen binding, opsig når som helst. Betaling håndteres af Stripe.

DINE DATA

Konto og samtalehistorik opbevares hos Supabase i EU (Stockholm). Vedhæftede
filer behandles kun midlertidigt for at udtrække tekst — selve filerne gemmes
ikke. Vi bruger ingen sporingscookies og sælger ikke data.
Privatlivspolitik: https://ai-skriveassistent.vercel.app/privatliv.html

Bygget i Danmark. Spørgsmål: sehit@degirmenci.dk
```

### Fuld beskrivelse (engelsk — hvis du tilføjer engelsk som sprog)

```
Not another chat box. An assistant that writes where you write.

Most AI tools hand you an answer you then have to copy somewhere else. AI
Skriveassistent delivers the text straight into the field or document you are
already working in — and you decide how.

HOW IT WORKS

A small round button sits at the edge of the page. Click it (or press
Alt+Shift+A) and a panel opens on the right. Chat with the assistant normally.
When the answer is ready, you choose how it goes in:

• Insert instantly — the whole text lands in one second
• Insert slowly — letter by letter at a natural typing pace, about 30 words per
  minute, so it reads as ordinary typing

You can pause, resume, stop and undo at any point. If you start typing during
an insertion, the assistant pauses itself and tells you why. It stays your
document throughout.

WORKS IN YOUR EDITOR — INCLUDING GOOGLE DOCS

The assistant writes into plain text fields, rich editors, CMSes and webmail.
Google Docs uses its own editor that most extensions cannot write into — we
built specific support for it.

ATTACH FILES — INCLUDING SCANNED ONES

Drag PDF, Word, text, Markdown or image files into the conversation and write
from their contents. Scanned documents and photos of text are read
automatically with OCR, with full Danish support.

SELECT TEXT — CHOOSE WHAT IT IS FOR

Select text on a page and pick one of two things: have it answered, with the
answer landing just below your selection — or attach it as background for the
conversation. The assistant never overwrites what you selected.

PRICING

7 days free, no card required. Then DKK 50 per month, no lock-in, cancel any
time. Payment is handled by Stripe.

YOUR DATA

Account and conversation history are stored with Supabase in the EU
(Stockholm). Attached files are processed only briefly to extract text — the
files themselves are not kept. No tracking cookies, no data selling.
Privacy policy: https://ai-skriveassistent.vercel.app/privatliv.html

Built in Denmark. Questions: sehit@degirmenci.dk
```

### Kategori

**Productivity** (Værktøjer/Produktivitet)

### Sprog

**Dansk** som primært sprog.

### Grafik

| Felt | Krav | Status |
|---|---|---|
| Ikon | 128×128 PNG | ✅ `apps/extension/public/icon/128.png` |
| Skærmbilleder | 1280×800 eller 640×400, mindst 1, op til 5 | ⏳ afventer (se nedenfor) |
| Lille promo-billede | 440×280 | Valgfrit — spring over |
| Marquee promo | 1400×560 | Valgfrit — spring over |

---

## Fanen: Privacy practices

### Single purpose (én erklæring — dette felt afviser Google flest på)

```
AI Skriveassistent har ét formål: at hjælpe brugeren med at skrive tekst og
indsætte den i det tekstfelt eller dokument, brugeren selv har valgt på den
side, de arbejder på. Alle udvidelsens funktioner — chatpanelet, vedhæftning af
filer, arbejde med markeret tekst og selve indsættelsen — tjener dette ene
formål.
```

### Permission justifications

Skriv én begrundelse per tilladelse. Google læser dem faktisk.

**`host_permissions: <all_urls>`** *(den vigtigste — det er her afvisninger sker)*

```
Udvidelsens formål er at indsætte tekst i den editor, brugeren arbejder i, og
brugeren skriver på vilkårlige websider — webmail, CMS'er, intranet, Google
Docs, kundeportaler. Der findes ingen liste af domæner, der kan dække det, uden
at produktet holder op med at virke dér, hvor brugeren rent faktisk skriver.

Udvidelsen læser ikke sideindhold automatisk. Den er passiv, indtil brugeren
selv åbner panelet, og den skriver kun i et felt, brugeren selv har placeret
markøren i. Markeret tekst sendes kun, når brugeren udtrykkeligt vælger det.
```

**`storage`**

```
Gemmer brugerens loginsession, så man ikke skal logge ind ved hvert sideskift,
et lokalt genereret installations-id til at forhindre misbrug af den gratis
prøveperiode, samt om brugeren har skjult den runde knap. Ingen sideindhold
gemmes lokalt.
```

**`activeTab`**

```
Bruges udelukkende til at tage et skærmbillede af den aktive fane, når brugeren
selv trykker på skærmbillede-knappen i panelet, så assistenten kan se det, man
spørger om. Der tages aldrig et skærmbillede uden brugerens klik.
```

**`clipboardWrite`**

```
To ting: brugeren kan kopiere assistentens svar med en kopiknap, og i editorer
der afviser programmatisk indsættelse (blandt andet Google Docs i visse
tilstande) falder udvidelsen tilbage på at lægge teksten i udklipsholderen, så
brugeren selv kan sætte ind i stedet for at få en tavs fejl.
```

**`identity`**

```
Bruges til "Log ind med Google" via chrome.identity.launchWebAuthFlow, så
brugeren kan oprette konto uden at vælge endnu et kodeord. Der hentes kun
e-mail og navn til kontooprettelsen.
```

**Remote code** *(Google spørger: bruger du fjernkode?)*

```
Nej. Al JavaScript ligger i pakken. Udvidelsen henter kun data (tekstsvar) fra
egen backend, aldrig kode der udføres.
```

### Data use — sådan udfylder du skemaet

Kryds **kun** disse af:

| Kategori | Kryds? | Hvorfor |
|---|---|---|
| Personally identifiable information | ✅ JA | e-mailadresse ved kontooprettelse |
| Health information | ❌ nej | — |
| Financial and payment information | ✅ JA | abonnementsstatus og Stripe-id. **Kortdata rører aldrig vores servere** — men kryds af alligevel, Google straffer under-oplysning, aldrig over-oplysning |
| Authentication information | ✅ JA | adgangskode/loginsession |
| Personal communications | ✅ JA | samtalehistorikken gemmes |
| Location | ❌ nej | — |
| Web history | ❌ nej | vi ser ikke, hvilke sider brugeren besøger |
| User activity | ❌ nej | ingen klik-, muse- eller tastelogning. Udvidelsen mærker efter, om brugeren skriver, for at sætte indsættelse på pause — det forlader aldrig maskinen |
| Website content | ✅ JA | markeret tekst og vedhæftede filer, kun når brugeren selv sender dem |

De tre erklæringer nederst — sæt flueben i **alle tre**:

- ✅ Jeg sælger eller videregiver ikke brugerdata til tredjeparter uden for de godkendte anvendelser
- ✅ Jeg bruger eller videregiver ikke brugerdata til formål uden for udvidelsens ene formål
- ✅ Jeg bruger eller videregiver ikke brugerdata til kreditvurdering eller långivning

**Privacy policy URL** (feltet lige over erklæringerne):

```
https://ai-skriveassistent.vercel.app/privatliv.html
```

---

## Fanen: Distribution

- **Visibility: Unlisted** — kun folk med linket kan installere. Samme review,
  men ingen offentlig side, mens du finder de sidste skævheder. Du kan skifte
  til Public bagefter uden at udvidelsen skal godkendes forfra.
- **Distribution: alle lande** (eller kun Danmark — det er ligegyldigt for
  review, og alt er på dansk alligevel)

---

## Efter indsendelse

- Status står i devconsole, og du får mail ved svar
- `<all_urls>` betyder næsten altid **manuel** gennemgang: regn med 1-3 dage,
  i sjældne tilfælde et par uger
- Afvisning er ikke en katastrofe — Google skriver hvorfor, vi retter, og
  genindsender. Anden runde går typisk hurtigere
- Når den er godkendt: landingssidens "Kommer snart"-knap skiftes til det
  rigtige butikslink

---

## Blokering — skal afgøres, før du trykker Submit

**Privatlivspolitikken lover noget, koden ikke gør i dag.**

Politikken på hjemmesiden siger: *"Personligt og reelt indhold sendes
udelukkende til betalte modeller, hvor træning på dine data er slået fra."*

Sådan er koden ikke skrevet lige nu. Da afkrydsningsfeltet "indeholder rigtige
data" blev fjernet i forenklingen den 6. august, blev der ikke lavet om på den
kode, der læste feltet — så feltet er permanent slået fra, og **al tekst sendes
afsted som "syntetisk", hvilket sender den til de gratis AI-modeller, der har
lov til at træne på indholdet.**

Det betyder tre ting på én gang:

1. Privatlivspolitikken, der ligger offentligt, er ikke sand i dag
2. Fluebenet "jeg bruger ikke brugerdata til formål uden for udvidelsens
   formål" ville ikke være rigtigt at sætte
3. Det er et GDPR-problem i det øjeblik, den første rigtige bruger skriver
   noget personligt

Rettelsen er lille i kode (én linje i `apps/extension/sidebar/chat.ts:48` plus
en serverside-håndhævelse), men den koster penge: betalte modeller trækker på
OpenRouter-kontoen ved hver besked. Det er derfor, det er din beslutning og
ikke bare noget, jeg har lavet om.

**Anbefaling:** ret det, før du sender ind. Alt andet i denne pakke er klar.
