import { Server } from "@colyseus/core";
import { WebSocketTransport } from "@colyseus/ws-transport";
import { RaceRoom } from "./race-room.js";

const port = Number(process.env.PORT ?? 2567);
const gameServer = new Server({ transport: new WebSocketTransport() });

gameServer.define("race", RaceRoom);
await gameServer.listen(port, "0.0.0.0");
console.info(`AU Race server listening on port ${port}`);
