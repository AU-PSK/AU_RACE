# Plan: AU Universitetspark 3D-gokartspil

## Mål

Et 3D-gokartspil, der spilles i pc-browseren uden installation. En vært opretter et løb og deler et link; gæster åbner linket, vælger et kaldenavn og kører med. Værtens browser styrer løbet. Banen er en spilfortolkning af Universitetsparkens rundstrækning (Bartholins Allé → Wilhelm Meyers Allé → Ole Worms Allé → Karl Verners Vej → Victor Albecks Vej → start), ikke en køreguide til de virkelige veje.

Spillet er en **uofficiel prototype** til kolleger og venner. Det bruger ikke officielt AU-branding og kopierer ingen andre spils figurer, musik eller baner.

## Arkitektur

- Klient: TypeScript, Vite og Three.js, udgivet som statisk side på GitHub Pages (`https://au-psk.github.io/AU_RACE/`).
- Multiplayer: direkte WebRTC-dataforbindelser via PeerJS. PeerJS' offentlige signaleringstjeneste og en offentlig STUN-tjeneste bruges til at finde og forbinde browserne; spiltrafikken går direkte mellem dem.
- Værtsstyret løb: værtens browser simulerer løbet og sender tilstanden til gæsterne. Der er ingen spilserver, så der er intet at drive eller betale for.
- Rum: 2–4 racere og op til 8 tilskuere. Ingen konti; kaldenavne og resultater findes kun i rummet.

## Kendte begrænsninger

- Forsvinder værten, ender løbet for alle. Gæsterne får en tydelig besked og sendes tilbage til menuen; værten overdrages ikke.
- Der er ingen TURN-relay, så direkte forbindelser kan fejle på nogle netværk (fx eduroam, firmanetværk, VPN). Gæsten får en fejlmeddelelse efter 15 sekunder med forslag om andet netværk eller hotspot. Tilføj en TURN-tjeneste, hvis fejl viser sig almindelige ved test på AU-nettet.

## Næste skridt

1. Test med to pc'er på AU-netværk og på tværs af netværk; vurdér om TURN er nødvendig.
2. Afklar tilladelse til AU-navn/branding og fakultetsnavne, før spillet deles bredt på AU.
3. Fakultetskarts, originale bonusser og endelig balance.
4. Test i moderne pc-browsere.

## Beslutninger og hensyn

- Web-first og serverløs multiplayer er valgt, fordi spillet skal åbnes via et link og styres fra en vært-pc.
- Gæstekaldenavne og rumdata er midlertidige; undgå unødig persondataindsamling.
- Brug kun egne eller korrekt licenserede modeller, lyde, skrifttyper og musik.
- Tydelig skiltning og banegrænser skal forhindre, at banen forveksles med en invitation til at køre ræs på de virkelige veje.
- Den tidligere Colyseus-server er fjernet (se git-historikken), fordi værtsstyret WebRTC dækker behovet.
