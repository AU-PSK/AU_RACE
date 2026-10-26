# AU Race

Et originalt browserbaseret 3D-gokartprototype inspireret af ruten gennem
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

Klienten hostes på GitHub Pages, for eksempel
`https://SUND-Okonomi.github.io/AU_RACE/`. GitHub Actions bygger og udgiver
browserklienten uden serverkonfiguration. Under **Settings → Pages** skal
deployment source være sat til **GitHub Actions**.

Push ændringer til `main` (eller kør workflowet manuelt under **Actions**), og
åbn Pages-linket, når workflowet er færdigt.

## Sådan spiller du

Skriv et kaldenavn og vælg **Spil solo på tid** for at køre alene uden server.
For multiplayer vælg **Opret peer-to-peer-løb**. Værten laver en kode og sender
den til en spiller; spilleren indsætter koden og sender sin svar-kode tilbage
til værten. Værten indsætter svaret og laver derefter en ny invitationskode
til hver ekstra spiller. Tilsluttede spillere vælger racer eller tilskuer før
de opretter svar-koden. Værten starter løbet og skal blive i spillet.

Kør med **W / ↑**, brems med **S / ↓**, skift bane med **A / D / ← / →**, og
brug en samlet bonus med **Mellemrum**.

## Prototypeomfang

- Direkte WebRTC-dataforbindelser med værtsstyret løb, op til fire racere og
  otte tilskuere.
- Forbindelseskoder udveksles manuelt; der kræves ingen spilsserver eller
  signaleringstjeneste, men værten skal være online under løbet.
- En offentlig STUN-tjeneste bruges til at finde netværksruter. Der er ingen
  TURN-relay; nogle netværk kan derfor forhindre direkte forbindelse.
- Three.js-scene i browseren og værtsstyrede bevægelsesopdateringer.
- Fire originale kosmetiske kartfarver uden forskel i styring.
- Kaldenavne og resultater gemmes kun i rummet; ingen konti eller global
  rekordliste.

Denne tekniske prototype bruger foreløbige kartfarver og en original
spilfortolkning af ruten, ikke verificerede kortdata. Tre omgange, nedtælling på
tre sekunder og Campus-puls er prototypevalg, ikke endeligt fastlagte regler.
Fakultetsnavne og -karts, brandingstilladelser og endelig balance mangler stadig
afklaring.
