---
id: 260908-ejy-2
slug: besvar-alle-spoergsmaal
date: 2026-09-08
status: in-progress
---

# Besvar alle spørgsmål — tilbage, uden Google-tilladelsen

Find hvert spørgsmål i dokumentet, skriv et svar under hvert af dem, uden at
stoppe undervejs. Pause, Stop og Fortryd alle svar er der hele tiden.

## Det er en genskabelse, ikke et nybyggeri

Præmissen om at "vi kunne ikke få den til at virke" holder ikke. Den virkede.
Historikken siger det:

- `f5cb0f8` rettede tre målte fejl og endte på **20 ud af 20 kørsler med et
  fuldt sæt svar** — før den var 2 ud af 9 tomme.
- `2b0804e` rettede placeringen og verificerede den ved at læse dokumentet
  tilbage bagefter: tre spørgsmål, tre rigtige svar, Fortryd stillede
  dokumentet præcis tilbage.
- `eac8071` fik Docs' egen søgefunktion til at virke. Den havde aldrig virket,
  og årsagen var **én selector**, ikke mekanismen.

Det der faktisk fældede funktionen står i `63aedf5`: den vej der *placerede*
svarene brugte Google Docs API'et, og dets `auth/documents`-tilladelse betød
Google-verifikation — den eneste blokering for en offentlig udgivelse, og den
blev målt i uger. Funktionen blev skåret væk for at komme i butikken.

## Hvad der kommer tilbage, og hvad der ikke gør

**Tilbage, uændret:** hele besvarelses-siden. Backenden har aldrig vidst noget
om Google — den får en liste af afsnit, finder spørgsmålene og svarer på dem.

**Tilbage, som den nye placeringsvej:** `docs-find.ts`. Den styrer Docs' egen
Ctrl+F, sætter markøren under spørgsmålet, og den eksisterende
`InsertionSession` skriver svaret ind derfra. **Ingen Google-tilladelse, intet
at vente på.**

**Bliver væk:**

- `GDocsApiWriteSource`, `docs-get`, `docs-batch-update`, OAuth-klienten og
  `oauth2`-blokken i manifestet. Det er hele grunden til at funktionen røg.
- `vision.ts` og `AutonomousParagraph.images`. At læse et billede inde i
  dokumentet *var* et API-kald. Et spørgsmål der ER et billede kan altså ikke
  besvares ad denne vej længere; **+ Skærmbillede** er den ærlige rute til det.
- "Besvar markeringen". Den blev fjernet samtidig, og der er ikke spurgt efter
  den. Kun hele dokumentet.

## Prisen ved at droppe API'et, sagt højt

API'et var **reservevejen**, når Find ikke kunne finde et spørgsmål — en
formateringsforskel, den samme sætning to gange, et spørgsmål inde i et billede.
Nu er reservevejen at **sige det**: spørgsmålet lander i `unplaced` og bliver
vist i panelet under "Kunne ikke placeres".

Det er det rigtige bytte. Alternativet er at gætte en position, og et gæt skriver
et svar midt i brugerens rigtige dokument.

## Opgaver

1. **Delte typer** — `AutonomousRequest/Answer/Response` tilbage, uden `images`.
2. **Backend** — `autonomous/{parse,prompt,complete}.ts` + ruten, uden `vision.ts`.
3. **Placering** — `autonomous/{orchestrator,locator,plan,docs-find}.ts` tilbage;
   `docs-source.ts` uden API-kilden; `writeAll`/`undoWrites` ud af `QuestionSource`.
4. **Panel** — `sidebar/autonomous.ts`, `autoRun` i store, knappen og
   transportbjælken i `ChatView.tsx`.
5. **Bevis** — mod et rigtigt Google Doc, læst tilbage gennem Docs' teksteksport.

## Sådan ved vi at det virker

Et rigtigt dokument med rigtige spørgsmål, kørt gennem den rigtige knap, og
dokumentet læst tilbage bagefter: hvert spørgsmål har sit eget svar under sig,
i den rigtige rækkefølge, og Fortryd stiller dokumentet tilbage som det var.
Ikke "det bygger". Ikke "testene er grønne".
