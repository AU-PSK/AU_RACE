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

## Åbn spillet via en offentlig URL

[Åbn AU Race](https://au-psk.github.io/AU_RACE/) på GitHub Pages.
Hvis linket ikke virker endnu, skal Pages først aktiveres under
**Settings → Pages** med **GitHub Actions** som deployment source. Workflowet
bygger og udgiver browserklienten.

Når spillet er åbent, opret et løb og del det invitationslink, spillet viser.
Venner åbner linket, vælger kaldenavn og trykker **Deltag i løb**.

## Sådan spiller du

Skriv et kaldenavn og vælg **Spil solo på tid** for at køre alene.
For multiplayer vælg **Opret peer-to-peer-løb**. Del invitationslinket fra
lobbyen; hver gæst åbner linket, vælger kaldenavn, racer/tilskuer og kartfarve
og trykker **Deltag i løb**. Værten starter løbet og skal blive online.

Kør med **W / ↑**, brems og bak med **S / ↓**, og styr frit med **A / D / ← / →**.
Hold **Shift** nede, mens du styrer, for at drifte: jo længere drift, jo større
turbo bagefter (gnisterne skifter fra hvid til blå til orange). Brug en bonus med
**Mellemrum**.

Du kan køre ud i græsset og mellem træerne, men det går langsomt, og bygninger og
træer stopper dig. Kører du i søen eller for langt væk, sættes du tilbage på
banen. Gas lige efter "2" i nedtællingen giver raketstart.

Bonuskasser på banen giver Kaffeboost (fart), Papirbunke (smides bag dig) eller
Frisbee (affyres frem); jo længere bagude, jo oftere får du fart. Solo er en
tidskørsel med tre kaffeboosts.

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
