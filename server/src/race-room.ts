import { MapSchema, Schema, type } from "@colyseus/schema";
import { Room, type Client } from "@colyseus/core";

const MAX_RACERS = 4;
const MAX_SPECTATORS = 8;
const LAP_COUNT = 3;
const COUNTDOWN_SECONDS = 3;
const RACE_LIMIT_SECONDS = 180;
const PROGRESS_PER_SECOND = 0.06;

type Role = "racer" | "spectator";

interface JoinOptions {
  name?: unknown;
  role?: unknown;
  kartStyle?: unknown;
}

interface RaceInput {
  throttle?: unknown;
  brake?: unknown;
  steer?: unknown;
  useItem?: unknown;
}

class PlayerState extends Schema {
  @type("string") name = "";
  @type("string") role: Role = "racer";
  @type("string") color = "#d7f36a";
  @type("boolean") host = false;
  @type("number") progress = 0;
  @type("number") speed = 0;
  @type("number") lane = 0;
  @type("number") lap = 0;
  @type("number") place = 0;
  @type("boolean") finished = false;
  @type("number") finishTime = 0;
  @type("boolean") hasItem = false;
  @type("number") boostRemaining = 0;
}

class PickupState extends Schema {
  @type("string") id = "";
  @type("number") progress = 0;
  @type("number") lane = 0;
  @type("boolean") active = true;
}

class RaceState extends Schema {
  @type({ map: PlayerState }) players = new MapSchema<PlayerState>();
  @type({ map: PickupState }) pickups = new MapSchema<PickupState>();
  @type("string") hostId = "";
  @type("string") phase = "lobby";
  @type("number") countdown = 0;
  @type("number") elapsed = 0;
  @type("number") laps = LAP_COUNT;
}

interface InputState {
  throttle: boolean;
  brake: boolean;
  steer: -1 | 0 | 1;
  useItem: boolean;
}

const KART_COLORS: Record<string, string> = {
  lime: "#d7f36a",
  clay: "#f28d60",
  fjord: "#78c8c2",
  violet: "#b799e8",
};

function safeName(value: unknown): string {
  if (typeof value !== "string") return "";
  return value.trim().replace(/\s+/g, " ").slice(0, 20);
}

export class RaceRoom extends Room<{ state: RaceState }> {
  maxClients = MAX_RACERS + MAX_SPECTATORS;

  private playerInputs = new Map<string, InputState>();
  private hostId = "";
  private countdownLeft = 0;

  onCreate(): void {
    this.setPrivate();
    this.setState(new RaceState());

    this.onMessage("input", (client: Client, payload: RaceInput) => {
      const player = this.state.players.get(client.sessionId);
      if (!player || player.role !== "racer" || this.state.phase !== "racing" || player.finished) return;

      const steer = payload?.steer;
      this.playerInputs.set(client.sessionId, {
        throttle: payload?.throttle === true,
        brake: payload?.brake === true,
        steer: steer === -1 || steer === 1 ? steer : 0,
        useItem: payload?.useItem === true,
      });
    });

    this.onMessage("start", (client: Client) => this.startRace(client));
    this.onMessage("returnToLobby", (client: Client) => this.returnToLobby(client));
    this.setSimulationInterval((deltaTime) => this.update(deltaTime), 1000 / 30);
  }

  onJoin(client: Client, options: JoinOptions): void {
    const name = safeName(options?.name);
    const role = options?.role === "spectator" ? "spectator" : "racer";
    const kartStyle =
      typeof options?.kartStyle === "string" && Object.hasOwn(KART_COLORS, options.kartStyle)
        ? options.kartStyle
        : "lime";
    if (!name) throw new Error("Skriv et kaldenavn på 1–20 tegn.");
    if (this.state.phase === "results") throw new Error("Løbet er afsluttet. Opret et nyt rum.");
    if (role === "racer") {
      const racerCount = this.racerCount();
      if (racerCount >= MAX_RACERS) throw new Error("Der er allerede fire racere i rummet.");
      if (this.state.phase !== "lobby") throw new Error("Løbet er i gang; du kan kun deltage som tilskuer.");
    } else if (this.spectatorCount() >= MAX_SPECTATORS) {
      throw new Error("Der er allerede otte tilskuere i rummet.");
    }

    const player = new PlayerState();
    player.name = name;
    player.role = role;
    player.color = role === "racer" ? KART_COLORS[kartStyle] : "#b7c0ba";
    player.progress = this.racerCount() * 0.012;
    player.host = this.hostId === "";

    if (!this.hostId) {
      this.hostId = client.sessionId;
      this.state.hostId = this.hostId;
      player.host = true;
    }

    this.state.players.set(client.sessionId, player);
    if (role === "racer") {
      this.playerInputs.set(client.sessionId, { throttle: false, brake: false, steer: 0, useItem: false });
    }
  }

  onLeave(client: Client): void {
    this.state.players.delete(client.sessionId);
    this.playerInputs.delete(client.sessionId);

    if (client.sessionId === this.hostId) {
      const nextHost = this.state.players.entries().next();
      this.hostId = nextHost.done ? "" : nextHost.value[0];
      this.state.hostId = this.hostId;
      if (this.hostId) this.state.players.get(this.hostId)!.host = true;
    }
  }

  private racerCount(): number {
    let count = 0;
    this.state.players.forEach((player) => {
      if (player.role === "racer") count++;
    });
    return count;
  }

  private spectatorCount(): number {
    let count = 0;
    this.state.players.forEach((player) => {
      if (player.role === "spectator") count++;
    });
    return count;
  }

  private startRace(client: Client): void {
    if (client.sessionId !== this.hostId) {
      client.send("error", { message: "Kun værten kan starte løbet." });
      return;
    }
    if (this.state.phase !== "lobby") return;
    if (this.racerCount() < 2) {
      client.send("error", { message: "Der skal være mindst to racere for at starte." });
      return;
    }

    this.state.phase = "countdown";
    this.state.countdown = COUNTDOWN_SECONDS;
    this.countdownLeft = COUNTDOWN_SECONDS;
    this.state.elapsed = 0;
    this.state.pickups.clear();
    for (let lap = 0; lap < LAP_COUNT; lap++) {
      for (const [index, fraction] of [0.14, 0.47, 0.81].entries()) {
        const pickup = new PickupState();
        pickup.id = `pulse-${lap}-${fraction}`;
        pickup.progress = lap + fraction;
        pickup.lane = [-0.65, 0.65, 0][(lap + index) % 3];
        this.state.pickups.set(pickup.id, pickup);
      }
    }
  }

  private returnToLobby(client: Client): void {
    if (client.sessionId !== this.hostId || this.state.phase !== "results") {
      client.send("error", { message: "Kun værten kan starte et nyt løb." });
      return;
    }
    this.state.phase = "lobby";
    this.state.elapsed = 0;
    this.state.countdown = 0;
    this.state.pickups.clear();
    let gridPosition = 0;
    this.state.players.forEach((player) => {
      player.speed = 0;
      player.lane = 0;
      player.lap = 0;
      player.place = 0;
      player.finished = false;
      player.finishTime = 0;
      player.hasItem = false;
      player.boostRemaining = 0;
      if (player.role === "racer") {
        player.progress = gridPosition * 0.012;
        gridPosition++;
        this.playerInputs.set(this.sessionIdFor(player), {
          throttle: false,
          brake: false,
          steer: 0,
          useItem: false,
        });
      } else {
        player.progress = 0;
      }
    });
  }

  private sessionIdFor(target: PlayerState): string {
    for (const [sessionId, player] of this.state.players.entries()) {
      if (player === target) return sessionId;
    }
    return "";
  }

  private update(deltaMs: number): void {
    const dt = Math.min(deltaMs / 1000, 0.1);
    if (this.state.phase === "countdown") {
      this.countdownLeft -= dt;
      this.state.countdown = Math.max(0, Math.ceil(this.countdownLeft));
      if (this.countdownLeft <= 0) {
        this.state.phase = "racing";
        this.state.countdown = 0;
      }
      return;
    }
    if (this.state.phase !== "racing") return;

    this.state.elapsed += dt;
    const racers: Array<[string, PlayerState]> = [];
    this.state.players.forEach((player, sessionId) => {
      if (player.role === "racer") racers.push([sessionId, player]);
    });

    for (const [sessionId, player] of racers) {
      if (player.finished) continue;
      const input = this.playerInputs.get(sessionId);
      if (!input) continue;
      if (input.useItem && player.hasItem) {
        player.hasItem = false;
        player.boostRemaining = 2.5;
      }
      const boost = player.boostRemaining > 0;
      player.boostRemaining = Math.max(0, player.boostRemaining - dt);

      const targetSpeed = input.brake ? 0 : input.throttle ? (boost ? 1.35 : 1) : 0;
      const acceleration = input.throttle || input.brake ? 2.4 : 0.55;
      player.speed += Math.max(-acceleration * dt, Math.min(acceleration * dt, targetSpeed - player.speed));
      player.speed = Math.max(0, Math.min(1.35, player.speed));
      player.lane = Math.max(-1, Math.min(1, player.lane + input.steer * dt * 0.85));

      const previousProgress = player.progress;
      player.progress += PROGRESS_PER_SECOND * player.speed * dt;
      player.lap = Math.min(this.state.laps, Math.floor(player.progress));

      this.state.pickups.forEach((pickup) => {
        if (
          !player.hasItem &&
          pickup.active &&
          Math.abs(player.lane - pickup.lane) <= 0.45 &&
          pickup.progress >= previousProgress &&
          pickup.progress <= player.progress
        ) {
          pickup.active = false;
          player.hasItem = true;
          this.broadcast("toast", { sessionId, message: "Campus-puls samlet op! Tryk mellemrum for et fartboost." });
        }
      });

      if (player.progress >= this.state.laps) {
        player.progress = this.state.laps;
        player.lap = this.state.laps;
        player.speed = 0;
        player.finished = true;
        player.finishTime = this.state.elapsed;
        player.place = racers.filter(([, other]) => other.finished).length;
      }
    }

    this.resolveKartCollisions(racers);
    if (this.state.elapsed >= RACE_LIMIT_SECONDS || racers.every(([, player]) => player.finished)) {
      this.finishRace(racers);
    }
  }

  private resolveKartCollisions(racers: Array<[string, PlayerState]>): void {
    for (let i = 0; i < racers.length; i++) {
      const [, a] = racers[i];
      if (a.finished) continue;
      for (let j = i + 1; j < racers.length; j++) {
        const [, b] = racers[j];
        if (b.finished) continue;

        let gap = a.progress - b.progress;
        gap -= Math.round(gap);
        if (Math.abs(gap) > 0.008 || Math.abs(a.lane - b.lane) > 0.38) continue;

        const direction = a.lane === b.lane ? (i < j ? -1 : 1) : Math.sign(a.lane - b.lane);
        a.lane = Math.max(-1, Math.min(1, a.lane + direction * 0.035));
        b.lane = Math.max(-1, Math.min(1, b.lane - direction * 0.035));
        a.speed *= 0.88;
        b.speed *= 0.88;
      }
    }
  }

  private finishRace(racers: Array<[string, PlayerState]>): void {
    this.state.phase = "results";
    racers.sort(([, a], [, b]) => {
      if (a.finished !== b.finished) return a.finished ? -1 : 1;
      if (a.finished) return a.finishTime - b.finishTime;
      return b.progress - a.progress;
    });
    racers.forEach(([, player], index) => {
      player.place = index + 1;
      player.speed = 0;
    });
    this.broadcast("results", {
      players: racers.map(([, player]) => ({
        name: player.name,
        place: player.place,
        finished: player.finished,
        finishTime: Math.round(player.finishTime * 10) / 10,
      })),
    });
  }
}
