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

Åbn Vite-adressen fra terminalen (normalt `http://localhost:5173`). Colyseus-
serveren kører på `ws://localhost:2567`. Åbn adressen i flere browservinduer
for at prøve multiplayer lokalt.

## Åbn spillet via en offentlig URL

Klienten kan hostes på GitHub Pages, så spillerne åbner et link i browseren,
for eksempel `https://SUND-Okonomi.github.io/AU_RACE/`. Multiplayer-serveren
kan ikke køre på GitHub Pages: den skal hostes separat hos en udbyder, der
understøtter Node.js og WebSockets, og have en offentlig `wss://`-adresse.

1. Udgiv Colyseus-serveren fra mappen `server` hos en WebSocket-kompatibel
   hostingudbyder. Serverens startkommando er `npm start`, og den lytter på
   porten i miljøvariablen `PORT`.
2. I GitHub-repositoriet: åbn **Settings → Secrets and variables → Actions →
   Variables**, og opret variablen `VITE_GAME_SERVER_URL` med serverens adresse,
   fx `wss://din-server.example.com`.
3. Under **Settings → Pages** vælg **GitHub Actions** som deployment source.
4. Push ændringer til `main` (eller kør workflowet manuelt under **Actions**).
   Når workflowet er færdigt, åbn `https://SUND-Okonomi.github.io/AU_RACE/`.

Workflowet bygger og udgiver browserklienten automatisk. Linket kan deles med
andre; værten opretter et privat rum i spillet og deler rummets invitationslink.
En offentlig spil-URL alene starter ikke serveren, så serveren skal være
udgivet og tilgængelig først.

## Sådan spiller du

Skriv et kaldenavn og vælg **Opret privat rum** for at være vært, eller indsæt
et invitationslink/rumkode og vælg **Deltag i rum**. Vælg tilskuerrollen, hvis
du kun vil følge et løb. Værten kan starte, når mindst to racere er i lobbyen.

Kør med **W / ↑**, brems med **S / ↓**, skift bane med **A / D / ← / →**, og
brug en samlet bonus med **Mellemrum**.

## Prototypeomfang

- Private Colyseus-rum med vært, op til fire racere og otte tilskuere.
- Three.js-scene i browseren og serverstyrede bevægelsesopdateringer.
- Fire originale kosmetiske kartfarver uden forskel i styring.
- Kaldenavne og resultater gemmes kun i rummet; ingen konti eller global
  rekordliste.

Denne tekniske prototype bruger foreløbige kartfarver og en original
spilfortolkning af ruten, ikke verificerede kortdata. Tre omgange, nedtælling på
tre sekunder og Campus-puls er prototypevalg, ikke endeligt fastlagte regler.
Fakultetsnavne og -karts, brandingstilladelser og endelig balance mangler stadig
afklaring.
