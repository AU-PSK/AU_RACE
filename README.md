# AU Race

An original, browser-first 3D kart-racing prototype inspired by the
Universitetsparken route. It does not use official AU branding or reproduce
existing games' characters, music, or track designs.

## Run locally

Requirements: Node.js 20 or newer.

```sh
npm install
npm run dev
```

Open the Vite URL printed in the terminal (normally `http://localhost:5173`).
The Colyseus server runs at `ws://localhost:2567`. Open another browser window
to test multiplayer.

Drive with **W / ↑** to accelerate, **S / ↓** to brake, **A / D / ← / →** to
change lanes, and **Space** to use a collected boost. When hosting the game
server separately, set `VITE_GAME_SERVER_URL` in the client environment to its
`wss://` URL before building.

## Prototype scope

- Private Colyseus rooms with a host, up to four racers, and eight spectators.
- Browser-based Three.js scene and server-authoritative movement snapshots.
- Four original cosmetic kart colors with no handling differences.
- Room-only player names and race results; no accounts or global leaderboard.

This technical slice uses placeholder kart colors and an original game-inspired
route, not verified map data. The three-lap, three-second-countdown race and
Campus Pulse boost are prototype defaults, not confirmed product rules.
Official faculty names and kart assignments, branding permissions, and final
balance rules remain to be decided.