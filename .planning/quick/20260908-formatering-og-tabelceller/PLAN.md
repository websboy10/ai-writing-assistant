---
id: 260908-ejy-3
slug: formatering-og-tabelceller
date: 2026-09-08
status: in-progress
---

# Formatering, og svar der lander i tabellens svarfelt

To ting, som viser sig at dele én mekanisme: Docs tager imod **HTML** gennem
præcis den indsættelse produktet allerede bruger, og Docs' egen eksport kan
levere dokumentet **som HTML** uden nogen tilladelse.

## Målt, ikke antaget

Alt herunder er kørt mod et rigtigt Google Doc 2026-09-08, ikke ræsonneret frem:

| Spørgsmål | Svar |
|---|---|
| Giver en `text/html`-indsættelse rigtig formatering? | **Ja** — eksporten indeholder rigtig `<h1>`, fed, kursiv, `<ul>` og `<ol>` |
| Viser `export?format=html` tabellens struktur? | **Ja** — 1 tabel, 2 rækker, 4 celler, og celleindholdet kan læses |
| Kan en tom celle kendes fra en udfyldt? | **Ja** — `["Hvad hedder du?", "", "Hvor bor du?", ""]` |
| Flytter et syntetisk Tab markøren til næste celle? | **Ja** — markøren landede i cellen ved siden af spørgsmålet |

En faldgrube, skrevet ned så den ikke koster nogen en time igen: Docs'
**tekst**-eksport gengiver et ægte punkttegn som `* `. Det ligner markdown der
er sluppet igennem, og er det ikke. Kun HTML-eksporten kan afgøre det.

## A. Formatering

### Beslutning: prompten bliver IKKE rørt — forsøgt, målt, rullet tilbage

Planen var at ophæve markdown-forbuddet, så modellen måtte skrive overskrifter
og fed skrift. sehit godkendte det 2026-09-08. **Det blev prøvet, og det
ødelagde output. Det er rullet helt tilbage.**

Hvad der blev målt, tre gange med den rigtige model:

| Prompt | Kørsler med ødelagt output |
|---|---|
| master, urørt | **0 af 3** |
| forbuddet ophævet, hele FORMAT-blokken omskrevet | **3 af 3** |
| forbuddet ophævet, minimal ændring på to linjer | **1 af 4** |

Fejlen var ikke formatering, men at modellen begyndte at **nummerere sine egne
ord** midt i svaret: `(32) og (33) vi (34) skal (35) nok (36) hjælpe`. Et andet
svar skrev sine egne arbejdsnoter ud i brugerens tekst:
`(Slip 1: "og vi" - comma missing... Let's use: ...)`.

Den sandsynlige årsag står allerede i filen: en regel længere nede siger *"Give
the task the size it asks for, **and count it**"*, og filens egen kommentar
siger at modellen kopierer promptens form frem for dens indhold. Det absolutte
*"not a single asterisk, hash or backtick"* holdt tilsyneladende mere sammen end
sin egen ordlyd — også trangen til at tælle højt. Løsnes det, slipper noget
andet også.

Én ud af fire kørsler med ødelagt tekst er ikke noget man sender ud til et
produkt der er i luften med rigtige brugere. Fed skrift er ikke det værd.

### Hvad der så bliver leveret

Prompten tillader **allerede** nummererede lister (`"1. "`, `"2. "`). Så uden
at røre en eneste promptlinje giver `markdownToHtml()` + `insertRich()`:

- **rigtige nummererede lister** i Google Docs — `<ol><li>`, ikke tal skrevet som tekst
- **rigtige afsnit og linjeafstand**

**Ikke leveret: fed skrift og overskrifter.** De kræver promptændringen, og den
er målt til at koste mere end den giver. Det er to af de tre ting der blev
bedt om; den tredje står åben.

### Hvor teksten bliver flad i dag

`sidebar/chat.ts:93` kører `stripMarkdown(rawText)` **mens der streames**, så
det er den flade tekst der ligger i `messages`. Den rå markdown bliver aldrig
gemt — den lever kun i en lokal variabel i stream-closuren og bliver smidt væk.
Rig indsættelse kan altså ikke laves i indsættelseslaget alene; teksten skal
overleve dertil.

### Beslutning: `content` bliver ved med at være flad

`content` er flad tekst, som nu — panelet, Kopiér, historikken og al
almindelig indsættelse afhænger af det, og at lave om på det ville røre
alting. Der kommer ét felt ved siden af, `markdown`, som **kun** rig
indsættelse læser.

### Beslutning: Straks bliver formateret, Langsomt bliver ved med at være fladt

De to kan ikke forenes. Langsomt skriver ét tegn ad gangen, og formatering
ankommer som én samlet indsættelse — man kan ikke indsætte en halv fed sætning
bogstav for bogstav. Alternativet, at skrive fladt og så genindsætte det hele
formateret til sidst, ville få teksten til at hoppe synligt når den var færdig.

Så: **Straks** giver overskrifter, fed skrift og rigtige punkttegn. **Langsomt**
er uændret. Knappernes hjælpetekst siger hvad man får, så det ikke er noget man
skal opdage.

### Beslutning: kun editorer der kan bære det

Et almindeligt `<textarea>` kan fysisk ikke indeholde formatering. Google Docs
og rige editorer (`contenteditable`) kan. Adapteren siger selv om den kan tage
imod det; kan den ikke, sker der præcis det samme som i dag.

## B. Svaret i tabellens svarfelt

Et skema i Docs er næsten altid en tabel: spørgsmålet i én celle, en tom celle
ved siden af. I dag finder Find spørgsmålet og skriver svaret lige **efter**
spørgsmålsteksten — altså inde i spørgsmålets egen celle.

### Beslutning: Tabs egen opførsel ER reglen

Ingen heuristik om "hvilken celle hører til hvilket spørgsmål". Efter Find er
markøren i spørgsmålets celle; ét syntetisk Tab flytter den til næste celle i
dokumentets rækkefølge. Det er målt, og det er den samme rækkefølge et menneske
selv ville tabbe sig igennem.

### Beslutning: en optaget celle bliver aldrig overskrevet

Er nabocellen ikke tom, bliver spørgsmålet meldt under **"Kunne ikke placeres"**
i stedet. Det er den samme regel som resten af placeringen allerede følger, og
grunden er den samme: at skrive oven i brugerens egen tekst er værre end ikke
at svare.

## Opgaver

1. **`insertion/richtext.ts`** — `markdownToHtml()`: overskrifter, fed, kursiv,
   punkt- og nummerlister, afsnit. Escaper `& < >` først, så dokumentets
   indhold aldrig kan blive til markup.
2. **Adaptere** — valgfri `insertRich(html, plain)`. Google Docs og
   contenteditable implementerer den; almindelige felter gør ikke.
3. **Motoren** — bruger `insertRich` i Straks når både adapteren og teksten
   kan bære det. Langsomt rører ikke.
4. **Rå markdown overlever** — `markdown` på `UiMessage`, sat i `chat.ts` ved
   siden af den flade `content`; det samme for svarene i `autonomous.ts`.
5. **`docs-export-html`** — en besked til baggrundsworkeren, samme
   cookie-baserede eksport som `docs-export`, bare `format=html`. Siden selv må
   ikke kalde den; dens CSP blokerer det.
6. **`insertion/autonomous/docs-tables.ts`** — læs eksporten, byg en liste af
   celler i dokumentrækkefølge, og svar på: ligger dette spørgsmål i en celle,
   og er den næste celle tom?
7. **`GDocsFindSource.locate()`** — er svaret på 6 ja, så Tab efter Find. Er
   nabocellen optaget, returnér `null` med en specifik grund.

## Sådan ved vi at det virker

Et rigtigt dokument med en rigtig tabel, kørt gennem den rigtige knap, læst
tilbage gennem **HTML**-eksporten:

- hvert svar står i den tomme celle ved siden af sit eget spørgsmål
- spørgsmålscellerne er urørte
- et Straks-svar med overskrift, fed skrift og en punktliste kommer ud som
  rigtig `<h1>`, rigtig fed og rigtig `<ul>` — ikke som stjerner og bindestreger
- Fortryd stiller dokumentet tilbage som det var

Ikke "det bygger". Ikke "testene er grønne".
