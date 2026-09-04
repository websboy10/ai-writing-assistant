# Chrome Web Store: fra kode til "Tilføj til Chrome"

Skrevet 2026-08-06. Udvidelsen er teknisk klar til indsendelse (kører mod den
udrullede backend). Denne guide viser hvem der gør hvad, og hvor lang tid det tager.

## Trin 1 — Udviklerkonto (DIG — 10 min, engangsbeløb $5)

1. Gå til https://chromewebstore.google.com/devconsole
2. Log ind med din Google-konto
3. Acceptér udvikleraftalen og betal **$5** (engangsgebyr, dækker alle
   fremtidige udgivelser)
4. Bekræft din e-mail under **Account** i konsollen

## Trin 2 — Pakken (MIG — færdig på minutter)

Jeg bygger den færdige zip (`wxt zip`), klar til upload. Intet for dig her.

## Trin 3 — Opret udgivelsen (DIG med min opskrift — ~20 min)

I devconsole: **+ New item** → upload zippen. Udfyld derefter fanerne — jeg
leverer al teksten færdigskrevet, du kopierer den ind:

**Store listing:**
- Navn: `AI Skriveassistent`
- Beskrivelse: (jeg skriver den — dansk + engelsk)
- Kategori: **Productivity**
- Sprog: Dansk
- Ikon 128×128: har vi (logoet)
- Skærmbilleder 1280×800: jeg genererer dem

**Privacy (det Google faktisk afviser folk på):**
- **Single purpose**-erklæring: én sætning om at udvidelsen er en
  AI-skriveassistent, der indsætter tekst i felter, brugeren selv vælger
- **Permission justifications** — jeg skriver begrundelsen for hver:
  `<all_urls>` (assistenten skal kunne indsætte tekst på den side, brugeren
  arbejder på), `storage`, `activeTab`, `clipboardWrite` og `identity`
- **Privacy policy URL**: `https://ai-skriveassistent.vercel.app/privatliv.html` ✅ (findes allerede)
- **Data use**-skemaet: vi indsamler login-oplysninger og brugerindhold, kun
  til appens funktion, sælges ikke, deles ikke til reklame — jeg giver dig
  præcis hvilke bokse, der skal krydses af

**Distribution:**
- Anbefaling: start **Unlisted** — kun folk med linket kan installere.
  Perfekt til betabrugere, samme review-proces, og du kan skifte til Public
  senere uden ny godkendelse af selve udvidelsen.

## Trin 3½ — Én ting at kontrollere efter upload (DIG — 1 min)

**Udvidelsens ID skal være det, Supabases redirect-liste kender.**

"Log ind med Google" sender brugeren tilbage til
`https://<udvidelses-id>.chromiumapp.org/`, og Supabase accepterer kun adresser,
der står på dens liste. Vi har låst ID'et på forhånd: `wxt.config.ts` indeholder
en `key`-værdi, og Chrome udleder altid ID'et af den, så butikken får samme ID
som din lokale kopi.

**Kontrollér det alligevel én gang efter upload:** ID'et står øverst på
udgivelsens side i devconsole. Er det et andet, tilføj
`https://<det-nye-id>.chromiumapp.org/*` til Supabases Redirect URLs. Supabase
accepterer flere ad gangen, så begge kan virke samtidig.

Det fejler tavst for brugeren, ikke for dig — derfor står det her.

> **Der er ikke længere noget Google-scope at vente på.** Udvidelsen beder ikke
> om `auth/documents`, så der er ingen *sensitive scope*, ingen Testing-tilstand
> med 100 brugere og ingen OAuth-verifikation før en offentlig udgivelse. Det
> var tidligere den langsomste af de to processer; nu er der kun Web
> Store-reviewet.

## Trin 4 — Indsend til review (1 klik)

**Submit for review** → status ses i konsollen, og du får mail ved svar.

## Hvor lang tid tager det? (ærligt)

| Fase | Typisk | Kan tage |
|---|---|---|
| Udviklerkonto + betaling | 10 min | — |
| Udfylde listing (med mine tekster) | ~20 min | — |
| **Googles review** | **1-3 dage** | op til 2-3 uger |

Vores udvidelse beder om den bredeste tilladelse, der findes (`<all_urls>` —
nødvendig for at kunne skrive i alle editorer), og den slags får næsten altid
**manuel** gennemgang. Regn med nogle dage, ikke timer. Afvisninger sker og er
ikke katastrofer: Google skriver hvorfor, vi retter, og genindsender (ny review
går typisk hurtigere).

Efter godkendelse: hver fremtidig opdatering af udvidelsen skal også igennem
review (typisk hurtigere end første gang). Landing-sidens "Kommer snart"-knap
skifter jeg til det rigtige butikslink samme dag, vi er live.

## Rækkefølge-anbefaling

Web Store-review og Stripe-aktivering kan køre **parallelt** — start begge i
dag, så er begge typisk klar inden for en uge.
