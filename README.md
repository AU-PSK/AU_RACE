# AU Race

Et uofficielt, originalt browserbaseret 3D-gokartprototype inspireret af ruten gennem
Universitetsparken. Spillet bruger ikke officielt AU-branding eller kopierer
andre spils figurer, musik eller banedesign.

## Kør lokalt

Krav: Node.js 20 eller nyere.

```sh
npm install
npm run dev
```

Åbn Vite-adressen fra terminalen (normalt `http://localhost:5173`). Både solo
og multiplayer kan prøves uden at starte en spilsserver.

Kvalitetstjek: `npm run typecheck`, `npm run lint`, `npm test` (Vitest) og
`npm run test:e2e` (Playwright-røgtest; kræver `npx playwright install chromium` første gang).

## Valgfri TURN-server til multiplayer

Multiplayer bruger direkte WebRTC-forbindelser (PeerJS) med en offentlig STUN-server. På netværk,
der blokerer peer-to-peer-trafik (fx eduroam, firmanetværk eller VPN), kan gæster ikke forbinde.
En TURN-server kan videresende trafikken. Den er slået fra som standard og aktiveres ved build via
miljøvariabler (fx i en lokal `.env`, som er git-ignoreret):

```sh
VITE_TURN_URL=turn:turn.example.org:3478,turns:turn.example.org:5349
VITE_TURN_USERNAME=bruger
VITE_TURN_CREDENTIAL=adgangskode
```

`VITE_TURN_URL` kan indeholde flere adresser adskilt af komma. Brugernavn og adgangskode er
valgfrie. Variablerne bliver en del af den offentlige klientkode, så brug kun midlertidige eller
begrænsede legitimationsoplysninger, og læg dem ikke i repoet. Til GitHub Pages skal de sættes som
miljøvariabler i build-trinnet i workflowet.

## Åbn spillet via en offentlig URL

[Åbn AU Race](https://au-psk.github.io/AU_RACE/) på GitHub Pages.
Hvis linket ikke virker endnu, skal Pages først aktiveres under
**Settings → Pages** med **GitHub Actions** som deployment source. Workflowet
bygger og udgiver browserklienten.

Når spillet er åbent, opret et løb og del det invitationslink, spillet viser.
Venner åbner linket, vælger kaldenavn og trykker **Deltag i løb**.

## Sådan spiller du

Skriv et kaldenavn og vælg **Kør mod computeren** for et løb mod tre computerkarts, eller
**Tidskørsel alene** for at jagte tiden.
For multiplayer vælg **Opret peer-to-peer-løb**. Del invitationslinket fra
lobbyen; hver gæst åbner linket, vælger kaldenavn, racer/tilskuer og kartfarve
og trykker **Deltag i løb**. Værten starter løbet og skal blive online.

Kør med **W / ↑**, brems og bak med **S / ↓**, og styr frit med **A / D / ← / →**.
Hold **Shift** nede, mens du styrer, for at drifte: jo længere drift, jo større
turbo bagefter (gnisterne skifter fra hvid til blå, orange og lilla). Brug en bonus med
**Mellemrum**; **M** slår lyden til og fra. Gule pile på vejen er boost-pads.

Du kan køre ud i græsset og mellem træerne, men det går langsomt, og bygninger og
træer stopper dig. Kører du i søen eller for langt væk, sættes du tilbage på
banen. Gas lige efter "2" i nedtællingen giver raketstart.

Bonuskasser på banen giver Kaffeboost (fart), Papirbunke (smides bag dig) eller
Frisbee (affyres frem); jo længere bagude, jo oftere får du fart. Computerkartene
holder sig tæt på dig, så løbet bliver spændende, og de fylder op til fire racere.
Tidskørsel er uden bonuskasser, men med tre kaffeboosts.

## Bane og omgivelser

Banen følger de virkelige veje: Bartholins Allé → Wilhelm Meyers Allé → Ole Worms
Allé → Karl Verners Vej → Victor Albecks Vej → start (ca. 1,4 km, 1 spilenhed = 4 m).
Veje, bygninger, skov, sø og Universitetsbækken kommer fra OpenStreetMap
(© OpenStreetMap-bidragsydere, [ODbL](https://www.openstreetmap.org/copyright)) og
ligger færdigbehandlet i [client/src/campus-data.ts](client/src/campus-data.ts).
Banen er en spilfortolkning, ikke en køreguide til de virkelige veje. Genskab data med:

```sh
node tools/fetch-osm.mjs data
node tools/build-campus.mjs data/roads.json data/area.json client/src/campus-data.ts
```

## Terræn og højdedata

Terrænet bruger højdedata fra Danmarks Højdemodel, DHM/Terræn (Klimadatastyrelsen / Styrelsen for Dataforsyning og Infrastruktur, CC BY 4.0). `client/src/terrain-data.ts` indeholder et gitter à 4 m over campus (rute 34–48 m over havet, største stigning ca. 11 %). Uden data (`npm run terrain -- reset`) er verden flad.

Datakilden er [Mapterhorn](https://mapterhorn.com), som udstiller DHM/Terræn som åbne fliser uden konto eller token. Det er et omprøvet mirror og ikke den officielle download. Ingen adgangsnøgler gemmes i repoet.

1. `pip install`: `python -m pip install --target data/pylib pillow` (kun til at dekode WebP-fliserne).
2. `npm run terrain -- fetch-tiles` henter zoom 17-fliser (ca. 0,33 m/px) for campus til `data/` (git-ignoreret).
3. `npm run terrain -- build data/mapterhorn.json` omsætter dem til spillets koordinater og skriver `client/src/terrain-data.ts` (middelværdi pr. 4 m-celle). Rapporten viser rutens højdeprofil.
4. Alternativt: officielle DHM/Terræn-GeoTIFF-fliser fra [Dataforsyningen](https://dataforsyningen.dk/) (kræver egen konto) kan bygges med `npm run terrain -- build data/<flise>.tif ... --vintage "<dataårgang>"`; `bounds` viser, hvilke fliser der skal bruges.
5. `npm run terrain -- selftest` afprøver værktøjet, og `npm run terrain -- reset` fjerner højdedata igen.

Højderne gengives 3 gange overdrevet (`HEIGHT_EXAGGERATION` i `client/src/terrain.ts`), fordi banens reelle relief på ca. 14 m ellers ikke kan ses, og ruten starter i y = 0. Løbsfysik, kollision og multiplayer bruger stadig kun x/z; højden er kun visuel (terrænmesh, vej og kantsten, bygninger, træer, objekter og karts, der følger terrænet og læner med skråningen). Se `TERRAIN_DATA_LICENSE.md` for kreditering og transformation.

Vejen er flad på tværs og følger en udglattet højdeprofil langs midterlinjen (`terrain.ts`). Terrænet graves eller fyldes op til vejen med en blød skråning, så terrænet ikke stikker op gennem vejen, og karts kører på vejfladen. Hvor to strækninger af ruten ligger tæt i forskellig højde, blandes skråningerne. Kameraet løftes, så terrænet ikke ligger mellem kamera og kart (fx over en bakketop).

> Terrændata: Indeholder data fra Danmarks Højdemodel, DHM/Terræn (Klimadatastyrelsen / Styrelsen for Dataforsyning og Infrastruktur), CC BY 4.0, <https://dataforsyningen.dk/>, leveret som åbne højdefliser af Mapterhorn (<https://mapterhorn.com>). Data er omprøvet og omsat til et grovere gitter i spillets koordinater. Kreditering skal stå adskilt fra OpenStreetMap-krediteringen. Private tokens må aldrig lægges i repositoriet eller klientkoden.

## Prototypeomfang

- Direkte WebRTC-dataforbindelser med værtsstyret løb, op til fire racere og
  otte tilskuere.
- PeerJS' offentlige signaleringstjeneste hjælper browserne med at finde
  hinanden; selve spiltrafikken sendes direkte mellem browserne. Du behøver
  ikke at drive en spilsserver, men værten skal være online under løbet.
- WebRTC bruger en offentlig STUN-tjeneste. Der er ingen TURN-relay, så
  direkte forbindelser kan fejle på nogle netværk.
- Three.js-scene i browseren og værtsstyrede bevægelsesopdateringer.
- Fire originale kosmetiske kartfarver uden forskel i styring.
- Kaldenavne og resultater gemmes kun i rummet; ingen konti eller global
  rekordliste.

Denne tekniske prototype bruger foreløbige kartfarver og en original
spilfortolkning af ruten, ikke verificerede kortdata. Tre omgange, nedtælling på
tre sekunder og Campus-puls er prototypevalg, ikke endeligt fastlagte regler.
Fakultetsnavne og -karts, brandingstilladelser og endelig balance mangler stadig
afklaring.
