# Plan: AU Universitetspark 3D-gokartspil

## Mål

Et 3D-gokartspil, der spilles i pc-browseren uden installation. En vært opretter et løb og deler et link; gæster åbner linket, vælger et kaldenavn og kører med. Værtens browser styrer løbet. Banen er en spilfortolkning af Universitetsparkens rundstrækning (Bartholins Allé → Wilhelm Meyers Allé → Ole Worms Allé → Karl Verners Vej → Victor Albecks Vej → start), ikke en køreguide til de virkelige veje.

Spillet er en **uofficiel prototype** til kolleger og venner. Det bruger ikke officielt AU-branding og kopierer ingen andre spils figurer, musik eller baner.

## Arkitektur

- Klient: TypeScript, Vite og Three.js, udgivet som statisk side på GitHub Pages (`https://au-psk.github.io/AU_RACE/`).
- Multiplayer: direkte WebRTC-dataforbindelser via PeerJS. PeerJS' offentlige signaleringstjeneste og en offentlig STUN-tjeneste bruges til at finde og forbinde browserne; spiltrafikken går direkte mellem dem.
- Værtsstyret løb: værtens browser simulerer løbet og sender tilstanden til gæsterne. Der er ingen spilserver, så der er intet at drive eller betale for.
- Rum: 2–4 racere og op til 8 tilskuere. Ingen konti; kaldenavne og resultater findes kun i rummet.

- Bane og omgivelser er genereret fra OpenStreetMap (`tools/`), så rundstrækningen følger de virkelige veje og bygninger. Kortdata kræver kildeangivelse (ODbL).

- Kørslen er fri bevægelse (position, retning, fart) styret af vært-browseren: terrænkørsel, kollision med bygninger, træer og andre karts, drift med tre trin mini-turbo, boost-pads og tre bonustyper med roulette.
- Computerkarts (`bots`) fylder startfeltet op til fire racere og køres af samme simulering som spillerne. De holdes tæt på de menneskelige spillere (rubber-banding).
- Udseende: cartoon-look (toon-materialer, sorte konturer, rødhvide kantstriber, himmel med skyer, partikler), dynamisk kamera og en HUD i racerspilsstil med minimap. Lyde syntetiseres med Web Audio, så der ikke er lydfiler at licensere.

## Kendte begrænsninger

- Forsvinder værten, ender løbet for alle. Gæsterne får en tydelig besked og sendes tilbage til menuen; værten overdrages ikke.
- Der er ingen TURN-relay. Direkte forbindelser kan derfor fejle på netværk, hvor NAT eller firewall blokerer WebRTC-forbindelser (fx eduroam, firmanetværk eller VPN). Berørte gæster kan ikke deltage, før de prøver et andet netværk eller hotspot; spillet viser en fejlmeddelelse efter 15 sekunder. En TURN-tjeneste kan videresende trafikken og forbedre forbindelsesmuligheden, men kræver drift, konfiguration og medfører mulig trafik-/driftsomkostning. Det er endnu ikke besluttet, om TURN skal indføres; test på AU-netværk skal informere beslutningen.

## Status og afklaringer

Status ud fra planen; gennemførelse skal bekræftes ved test og implementering.

- **Afklaret:** Prototypen er godkendt til internt brug. Bredere offentlig deling kræver fortsat særskilt afklaring af AU-navn, branding og fakultetsnavne.
- **Kandidat identificeret, endnu ikke godkendt:** Danmarks Højdemodel, DHM/Terræn, er den foretrukne kandidat. [Produktbeskrivelsen](https://confluence.kds.dk/download/attachments/25722920/dhm-prodspec-v1.0.0.pdf?version=1&modificationDate=1742295701551&api=v2) angiver GeoTIFF, 32-bit float, 40 cm pixelstørrelse eller finere, ETRS89 / UTM zone 32N (EPSG:25832) og DVR90 (EPSG:5799). Dataforsyningens [officielle fildownload-API](https://api.dataforsyningen.dk/rest/fildownload/v1.0/openapi.json) kræver autentificering med token; en konkret download af DHM/Terræn-rasteret kræver derfor adgang via en bruger/session. Intet raster er hentet eller inspiceret endnu, så campus-pixeldækning, dataårgang og reproducerbar download er fortsat ubekræftet.
- **Åben beslutning:** Det er ikke besluttet, om TURN skal bruges. Uden TURN kan gæster på visse netværk være ude af stand til at forbinde; afprøv direkte WebRTC på AU-netværket og på tværs af netværk, før beslutningen træffes.
- **Implementeret, ikke verificeret i spillet:** PR 1–3 for terræn er implementeret i koden (commits `a48bec3` og `5c50ed7`), og build er grøn. Den visuelle kontrol langs banen (PR 3, punkt 4) og overgangene ved vejkanter (PR 2, punkt 6) er ikke testet i en browser.
- **Planlagt, ikke dokumenteret som gennemført:** multiplayer-, browser- og gameplaytest. Build- og spilletestresultater skal registreres, når arbejdet udføres.

## Plan: Mere naturtro terræn

### Mål

Gør landskabet i AU Race mere naturtro ved at gengive Universitetsparkens faktiske højdeforskelle. Terræn, veje og omgivelser skal følge højdedataene, så verden ikke fremstår som en flad spilleplade med 3D-modeller placeret ovenpå. Behold spillets eksisterende 3D- og cartoon-stil; fokus er terrænets form og overgangen mellem terræn, veje og omgivelser, ikke fotorealistisk grafik.

### Fakta om den nuværende codebase

- Spillet bruger allerede en 3D-scene med 3D-modeller og kamera i `client/src/game.ts`.
- Græsset er et stort fladt plan, og vej og kantsten tegnes i faste højder.
- Banens rute har kun `x/z`-koordinater; punkterne oprettes med `y = 0` i `client/src/track.ts`.
- `tools/build-campus.mjs` genererer campusgeometri fra OpenStreetMap-data. Den nuværende datagenerering indhenter ikke terrænhøjder.
- Løbsbevægelse og kollisionsberegning foregår primært i `x/z`. En visuel terræntilpasning kan derfor i første omgang gennemføres uden at ændre løbets grundlæggende fysik eller multiplayerbeskeder.
- Den eksisterende stil er bevidst stiliseret. Mere korrekte højdeforskelle kræver ikke fotorealistiske materialer, lys eller modeller.

### Plan

Arbejdet kan deles i følgende pull requests:

#### PR 1 — Find og klargør højdedata

1. Afprøv DHM/Terræn som foretrukken kilde ved at hente et lille numerisk rasterudsnit, der dækker campus og banen. Dataforsyningens officielle fildownload-API kræver en bearer-token eller brugertoken; brug en godkendt lokal konto/session og gem aldrig token i repoet, scripts, klientkode eller offentlige filer. Den dokumenterede [DHM-WMS](https://datafordeler.dk/dataoversigt/danmarks-hoejdemodel-dhm/dhm-wms/) kræver API-nøgle/OAuth og leverer renderede kortbilleder, ikke højdeværdier. Bekræft, at kontoen faktisk kan hente DHM/Terræn som GeoTIFF eller tilsvarende raster; den generelle fildownload-API dokumentation beviser ikke i sig selv, at dette konkrete rasterprodukt er tilgængeligt dér.
2. Kontrollér det faktiske udtræks dækning, NoData-værdier, opløsning, lokal indsamlings-/dataårgang og metadata. Bekræft, at højderne er i DVR90, og at rasteret kan transformeres fra ETRS89 / UTM zone 32N (EPSG:25832) til spillets lokale koordinater uden akse- eller orienteringsfejl.
3. Kontrollér licens og vilkår for det konkrete datasæt og adgangsvej. Dataforsyningens vilkår angiver CC BY 4.0 for Klimadatastyrelsens frie geografiske data; planlæg kreditering, licenslink og oplysning om ændringer. Hold DHM- og OSM-kreditering/licenser adskilt.
4. Sammenhold prøveudsnittet med ruten, og kontrollér, at den udledte højdeprofil afspejler kildedataene.
5. Når kilden er godkendt, udvid eller tilføj et reproducerbart dataflow i `tools/`, som henter/forbereder data og konverterer fra kildekoordinater til spillets lokale koordinater. Dokumentér kilde, CRS, højdedatum, enheder, dataårgang, udtræksområde og eventuel interpolation/omprøvetagning.
6. Generér terrændata, og sørg for, at manglende eller ugyldige højdedata rapporteres tydeligt i stedet for stiltiende at blive erstattet af misvisende værdier.

**Aktuel status:** Den officielle fildownload kræver token, som ikke var tilgængelig. Som alternativ bruges Mapterhorn (https://mapterhorn.com), som udstiller DHM/Terræn som åbne fliser uden konto (CC BY 4.0, kildekatalog `source-catalog/dk`: Klimadatastyrelsen, 0,4 m, tilgået 2025). Rasteret er hentet og bygget ind: 90 zoom 17-fliser (0,33 m/px), 298×348 celler à 4 m, ingen udfyldte celler, rute 33,6–48,2 m med største stigning 10,6 %. Det opfylder planens krav om reproducerbart udtræk uden hemmeligheder, men afviger fra "godkendt adgang": data er et omprøvet mirror. Datum (DVR90) og terræn-vs-overflade er ikke verificeret pr. flise; kun relative højder bruges. Officielle GeoTIFF-fliser kan stadig bygges med `build`.

**Udført:** `tools/terrain-data.mjs` (`npm run terrain`) kan `bounds`, `fetch-tiles` (via `tools/fetch-terrain-tiles.py`, kræver Pillow), `build` (Mapterhorn-JSON eller GeoTIFF → `client/src/terrain-data.ts`, med NoData-kontrol, metadata og rapport over rutens højdeprofil), `selftest`, `synthetic` og `reset`. Klienten (`terrain.ts`, `track.ts`, `game.ts`) bruger højdedata til terrænmesh, vej, kantsten, bygninger, træer, objekter, kamera og karts. Kreditering står i README, `TERRAIN_DATA_LICENSE.md` og spillets startside. Typecheck og build er grønne.

**Mangler:** Kør spillet langs banen og kontrollér terrænet visuelt (PR 3, punkt 4); det er ikke gjort, fordi der ikke var adgang til en browser. Kontrollér samtidig overgangen mellem vej/kantsten og terræn (PR 2, punkt 6), som i koden kun løses med et lille løft og `polygonOffset`.

**Implementering:** PR 1–3 ligger i to commits og ikke i separate pull requests.

#### PR 2 — Form terrænet efter højdedataene

1. Indfør en fælles funktion, der slår terrænhøjden op ved en given `x/z`-position.
2. Erstat det flade græsplan med et terrænmesh baseret på højdedataene.
3. Interpolér højderne, så terrænet fremstår jævnt ved datakildens opløsning, uden at tilføje udokumenterede højdeforskelle.
4. Tilpas mesh-opløsningen til datakildens detaljegrad og browserens ydelseskrav.
5. Lad vej og kantsten følge terrænet, så de ikke flyder over det eller skærer igennem det.
6. Tilpas synlige overgange ved vejkanter og andre terrænkanter, så overfladerne mødes naturligt.

#### PR 3 — Tilpas omgivelser og kvalitetssikr resultatet

1. Placér bygninger, træer og andre relevante objekter på terrænet.
2. Kontrollér bygninger på skrånende terræn, så fundamenter ikke tydeligt svæver eller begraves.
3. Lad karts følge terrænhøjden visuelt; tilføj kun visuel hældning, hvor terrænets hældning tilsiger det.
4. Gennemgå scenen fra spillerens kamera langs banen, og ret synlige ujævnheder, overlap og terrænartefakter.
5. Dokumentér højdedatakilden og dens kreditering i `README.md`.

PR 1 skal bekræfte både dataegnethed og praktisk, reproducerbar adgang til campusdata med anvendelige vilkår, før PR 2 baseres på dem. PR 3 afhænger af PR 2.

### Acceptkriterier

- Højdedatakilde, licens, koordinatsystem og enheder er dokumenteret.
- Et konkret campusudsnits dækning, dataårgang, NoData-håndtering og rastermetadata er kontrolleret.
- Dataudtræk og konvertering kan gentages uden at eksponere private adgangsnøgler.
- Terrænet gengiver højdeforskellene i kildedataene med 3× lodret overdrivelse (`HEIGHT_EXAGGERATION`), fordi banens reelle relief på ca. 14 m ellers ikke kan ses; terrænet skygges desuden efter højde.
- Terrænet fremstår jævnt ved datakildens opløsning uden tydelige trin eller tilfældige buler.
- Vej og kantsten følger terrænets profil uden synlige huller, gennemskæringer eller svæven.
- Bygninger, træer og karts er placeret i forhold til terrænets højde.
- Terrændata kan genereres igen med projektets værktøjer, og manglende data rapporteres tydeligt.
- Projektets build lykkes, og ændringen er kontrolleret i spillet langs ruten.
- Løbsregler, grundlæggende kollision og multiplayerens beskedformat behøver ikke ændres.

### Uden for scope

- At gøre hele spillet fotorealistisk eller udskifte den eksisterende cartoon-stil.
- At lade bakker påvirke fart, acceleration, bremsning, vejgreb eller drift.
- At ændre banens rute, løbsregler eller spilbalance.
- At indføre 3D-kollision, væltning, fald eller avanceret kartfysik.
- At hente terrænhøjder dynamisk, mens spillet kører.
- At modellere alle støttemure, trapper, bygningsdetaljer eller terrænforhold uden for spilleområdet.

Kilden er DHM/Terræn via Mapterhorn-fliser (se "Aktuel status" under PR 1); rasteret er hentet og inspiceret, og campusdækning er kontrolleret. Den officielle fildownload-API kræver stadig autentificering, så kilden er et omprøvet mirror og ikke formelt godkendt. Datum (DVR90) pr. flise og dataårgang skal endnu bekræftes, før datasættet kan regnes for endeligt godkendt.

## Næste skridt

1. Test med to pc'er på AU-netværk og på tværs af netværk; registrér forbindelsesfejl og afgør derefter, om TURN er nødvendig.
2. Brug prototypen internt som godkendt. Afklar særskilt tilladelse til AU-navn/branding og fakultetsnavne, før spillet deles bredt eller offentligt.
3. Fakultetskarts, originale bonusser og endelig balance (omgangstid er ca. 18 s; vurdér antal omgange og fart ved test).
4. Test i moderne pc-browsere.

## Beslutninger og hensyn

- Web-first og serverløs multiplayer er valgt, fordi spillet skal åbnes via et link og styres fra en vært-pc.
- Gæstekaldenavne og rumdata er midlertidige; undgå unødig persondataindsamling.
- Brug kun egne eller korrekt licenserede modeller, lyde, skrifttyper og musik.
- Tydelig skiltning og banegrænser skal forhindre, at banen forveksles med en invitation til at køre ræs på de virkelige veje.
- Den tidligere Colyseus-server er fjernet (se git-historikken), fordi værtsstyret WebRTC dækker behovet.
