---
id: 260908-ejy
slug: skriv-dokumentet-ind
date: 2026-09-08
status: in-progress
---

# Skriv dokumentet ind

Vedhæft en fil, klik én knap, og udvidelsen skriver hele filens tekst ind i
dokumentet — i det tempo du allerede har valgt.

## Hvorfor det er lille

Alt der skal til findes allerede og er i drift:

- Filen bliver læst og omsat til tekst af upload-ruten (`ingest.ts` →
  `/api/files`), og teksten ligger i `ContextItem.text`.
- Indsættelsen — tempo, Pause, Stop, Fortryd, tastekapløbs-vagten, Google
  Docs-adapteren — er `inserter.start(text, 'progressive')`, uændret.

Der er altså ingen ny mekanisme. Det der bygges er knappen imellem dem, og den
ærlighed brugeren skal have, før hun starter noget der kan tage timer.

## Beslutninger

**Knappen bor i chippens læse-visning, ikke på selve chippen.** Man skal se
teksten, før man sætter en maskine til at skrive den i seks timer. Læse-visningen
viser i forvejen præcis den tekst der bliver skrevet — det er det rigtige sted.

**Intet AI-kald.** Filens tekst skrives som den er. Kører ikke gennem modellen,
koster ingenting, tæller ikke mod kvoten.

**Tidsestimatet er ikke pynt.** Motorens eget tempo er `60.000 / (wpm × 5)` ms
pr. tegn. Ved 30 ord/min tager 60.000 tegn — loftet for én vedhæftning —
6 timer og 40 minutter. Uden et estimat er "Skriv ind" en fælde.

**Formatet går tabt, og det skal stå der.** Indsættelse skriver `text/plain`;
et Word-dokuments overskrifter, fed skrift og tabeller lander som flad tekst.
Det gælder al indsættelse i produktet i forvejen, men her er det brugeren
tydeligvis leverer et *formateret* dokument, så tavshed ville være vildledende.

## Opgaver

### 1. Én kilde til tempoformlen

`insertion/types.ts` får `paceDelayMs(wpm)`, og `engine.ts:182` kalder den i
stedet for at gentage udtrykket. Estimatet og motoren kan så ikke skride fra
hinanden.

### 2. Knap + estimat i læse-visningen

`sidebar/components/ContextPanel.tsx`:

- "Skriv ind i dokumentet" → `inserter.start(open.text, 'progressive')`
- "Skriv ind straks" → `inserter.start(open.text, 'instant')`, fordi langsomt
  ikke altid er pointen
- Under knapperne: hvor lang tid det tager ved det valgte tempo, og at
  formatering ikke følger med
- Uden et valgt tekstfelt (`hasInsertTarget`) er knapperne slået fra med den
  besked der allerede bruges andre steder: klik først i feltet

### 3. Test

- Enhedstest af varighedsformateringen (under et minut / minutter / timer)
- Observeret i den rigtige browser: en vedhæftet fil skrevet ind i et rigtigt
  Google Doc og i et almindeligt felt

## Sådan ved vi at det virker

Ikke "det bygger". En fil vedhæftet i den kørende udvidelse, knappen trykket,
og teksten set lande i dokumentet — plus at Pause og Fortryd stadig virker
midt i den indsættelse.
