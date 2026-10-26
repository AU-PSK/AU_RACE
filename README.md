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

Kør med **W / ↑**, brems med **S / ↓**, skift bane med **A / D / ← / →**, og
brug en samlet bonus med **Mellemrum**.

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
