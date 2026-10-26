import { BASE_SPEED, TRACK_WIDTH } from "./track.js";
import { nearestRouteT, pointInPolygon, resolveWorldCollision, routeFrame, waterAreas } from "./world.js";

// Løbssimuleringen. Værten (eller solo-spilleren) kører den; gæster modtager kun resultatet.
// Retning: heading 0 peger mod -z, og fremad er (-sin heading, -cos heading).

export type ItemKind = "coffee" | "paper" | "frisbee";
export type RacePhase = "lobby" | "countdown" | "racing" | "results";

export interface KartInput {
  throttle: boolean;
  brake: boolean;
  steer: -1 | 0 | 1;
  drift: boolean;
  useItem: boolean;
}

export interface PlayerState {
  name: string;
  role: "racer" | "spectator";
  color: string;
  host: boolean;
  x: number;
  z: number;
  heading: number;
  speed: number;
  /** Omgange kørt som kommatal; 1.5 er halvvejs gennem anden omgang. Negativ bag startlinjen. */
  progress: number;
  routeT: number;
  safeT: number;
  lap: number;
  place: number;
  finished: boolean;
  finishTime: number;
  item: ItemKind | null;
  itemCount: number;
  boost: number;
  driftDir: -1 | 0 | 1;
  driftCharge: number;
  spin: number;
  respawn: number;
  offroad: boolean;
  wrongWay: boolean;
  startPress: number;
  useHeld: boolean;
}

export interface RaceObject {
  id: string;
  kind: "box" | "paper" | "frisbee";
  x: number;
  z: number;
  heading: number;
  active: boolean;
  timer: number;
  owner: string;
}

export interface RaceState {
  players: Map<string, PlayerState>;
  objects: Map<string, RaceObject>;
  hostId: string;
  phase: RacePhase;
  countdown: number;
  elapsed: number;
  laps: number;
  timeTrial: boolean;
  nextObjectId: number;
}

export interface RaceEvent {
  playerId: string;
  message: string;
}

export const IDLE_INPUT: KartInput = { throttle: false, brake: false, steer: 0, drift: false, useItem: false };
export const ITEM_NAMES: Record<ItemKind, string> = { coffee: "Kaffeboost", paper: "Papirbunke", frisbee: "Frisbee" };
export const BOOST_SPEED = 19;
export const TIME_LIMIT = 240;

const KART_RADIUS = 0.9;
const OFFROAD_SPEED = 6;
const ACCELERATION = 9;
const BRAKING = 22;
const REVERSE_SPEED = 4;
const COAST_DRAG = 4;
const OVERSPEED_DRAG = 16;
const TURN_RATE = 2.1;
const DRIFT_MIN_SPEED = 7;
const MINI_TURBO = [
  { charge: 1.6, boost: 1.2 },
  { charge: 0.7, boost: 0.7 },
];
const OUT_OF_BOUNDS = 16;
const RESPAWN_TIME = 1.2;
const SPIN_TIME = 1;
const FRISBEE_SPEED = 26;
const FRISBEE_LIFETIME = 3;
const PAPER_LIFETIME = 45;
const BOX_RESPAWN = 5;
const BOX_ROWS = [0.18, 0.5, 0.78];
const BOX_OFFSETS = [-2.1, -0.7, 0.7, 2.1];
const TIME_TRIAL_COFFEES = 3;

export function createPlayer(name: string, role: "racer" | "spectator", color: string): PlayerState {
  return {
    name, role, color, host: false,
    x: 0, z: 0, heading: 0, speed: 0,
    progress: 0, routeT: 0, safeT: 0, lap: 1, place: 0, finished: false, finishTime: 0,
    item: null, itemCount: 0, boost: 0, driftDir: 0, driftCharge: 0, spin: 0, respawn: 0,
    offroad: false, wrongWay: false, startPress: -1, useHeld: false,
  };
}

export function createRaceState(hostId: string): RaceState {
  return {
    players: new Map(), objects: new Map(), hostId,
    phase: "lobby", countdown: 0, elapsed: 0, laps: 3, timeTrial: false, nextObjectId: 0,
  };
}

const headingAlong = (tx: number, tz: number): number => Math.atan2(-tx, -tz);

function racers(state: RaceState): Array<[string, PlayerState]> {
  return [...state.players.entries()].filter(([, player]) => player.role === "racer");
}

// Stiller racerne op to og to bag startlinjen og gør banen klar. Med én racer er det tidskørsel:
// ingen bonuskasser, men tre kaffeboosts fra start.
export function prepareRace(state: RaceState): void {
  const grid = racers(state);
  state.timeTrial = grid.length === 1;
  state.phase = "countdown";
  state.countdown = 3;
  state.elapsed = 0;
  state.objects.clear();
  state.nextObjectId = 0;
  grid.forEach(([, player], index) => {
    const t = 1 - 0.006 - Math.floor(index / 2) * 0.011;
    const side = index % 2 === 0 ? -1 : 1;
    const frame = routeFrame(t);
    Object.assign(player, createPlayer(player.name, player.role, player.color), {
      host: player.host,
      x: frame.x - frame.tz * side * 1.5,
      z: frame.z + frame.tx * side * 1.5,
      heading: headingAlong(frame.tx, frame.tz),
      progress: t - 1,
      routeT: t,
      safeT: t,
      item: state.timeTrial ? "coffee" : null,
      itemCount: state.timeTrial ? TIME_TRIAL_COFFEES : 0,
    });
  });
  if (state.timeTrial) return;
  for (const row of BOX_ROWS) {
    const frame = routeFrame(row);
    for (const offset of BOX_OFFSETS) {
      addObject(state, {
        kind: "box", x: frame.x - frame.tz * offset, z: frame.z + frame.tx * offset,
        heading: 0, active: true, timer: 0, owner: "",
      });
    }
  }
}

export function resetToLobby(state: RaceState): void {
  state.phase = "lobby";
  state.elapsed = 0;
  state.countdown = 0;
  state.objects.clear();
  for (const [, player] of state.players) {
    Object.assign(player, createPlayer(player.name, player.role, player.color), { host: player.host });
  }
}

function addObject(state: RaceState, object: Omit<RaceObject, "id">): void {
  const id = `o${state.nextObjectId++}`;
  state.objects.set(id, { ...object, id });
}

/** Ét simuleringsskridt. Returnerer beskeder til spillerne, og om løbet er slut. */
export function stepRace(state: RaceState, inputs: Map<string, KartInput>, dt: number): { events: RaceEvent[]; done: boolean } {
  const events: RaceEvent[] = [];
  const field = racers(state);
  if (state.phase === "countdown") {
    const before = state.countdown;
    state.countdown = Math.max(0, state.countdown - dt);
    for (const [id, player] of field) {
      // Raketstart: gas lige efter "2". For tidligt, og motoren går i stå.
      if (inputs.get(id)?.throttle) {
        if (player.startPress < 0) player.startPress = before;
      } else player.startPress = -1;
    }
    if (state.countdown <= 0) {
      state.phase = "racing";
      for (const [id, player] of field) {
        if (player.startPress >= 0.3 && player.startPress <= 1.2) {
          player.boost = 1;
          events.push({ playerId: id, message: "Raketstart!" });
        } else if (player.startPress > 2) {
          player.spin = 0.7;
          events.push({ playerId: id, message: "For tidligt på gassen – motoren gik i stå." });
        }
      }
    }
    return { events, done: false };
  }
  if (state.phase !== "racing") return { events, done: false };

  state.elapsed += dt;
  for (const [id, player] of field) {
    stepKart(state, id, player, player.finished ? IDLE_INPUT : inputs.get(id) ?? IDLE_INPUT, dt, events);
  }
  collideKarts(field);
  stepObjects(state, field, dt, events);
  updatePlaces(field);
  return { events, done: state.elapsed >= TIME_LIMIT || field.every(([, player]) => player.finished) };
}

function stepKart(state: RaceState, id: string, player: PlayerState, input: KartInput, dt: number, events: RaceEvent[]): void {
  if (player.respawn > 0) {
    player.respawn = Math.max(0, player.respawn - dt);
    player.speed = 0;
    return;
  }
  const useNow = input.useItem && !player.useHeld;
  player.useHeld = input.useItem;

  if (player.spin > 0) {
    player.spin = Math.max(0, player.spin - dt);
    player.speed *= Math.exp(-3 * dt);
  } else {
    if (useNow && player.item) useItem(state, id, player);
    steer(player, input, dt);
  }
  player.boost = Math.max(0, player.boost - dt);

  const moved = resolveWorldCollision(
    player.x - Math.sin(player.heading) * player.speed * dt,
    player.z - Math.cos(player.heading) * player.speed * dt,
    KART_RADIUS,
  );
  player.x = moved.x;
  player.z = moved.z;
  if (moved.hit) {
    player.speed *= Math.exp(-8 * dt);
    endDrift(player, false);
  }

  if (waterAreas.some((area) => pointInPolygon(area, player.x, player.z))) {
    respawn(player);
    events.push({ playerId: id, message: "Plask! Du kørte i søen og bliver sat tilbage på banen." });
    return;
  }
  const nearest = nearestRouteT(player.x, player.z, player.routeT);
  if (nearest.distance > OUT_OF_BOUNDS) {
    respawn(player);
    events.push({ playerId: id, message: "For langt fra banen – du bliver sat tilbage." });
    return;
  }
  let delta = nearest.t - player.routeT;
  if (delta > 0.5) delta -= 1;
  if (delta < -0.5) delta += 1;
  const lapBefore = Math.floor(player.progress);
  player.progress += delta;
  player.routeT = nearest.t;
  player.offroad = nearest.distance > TRACK_WIDTH / 2 + 0.3;
  if (!player.offroad) player.safeT = nearest.t;
  const frame = routeFrame(nearest.t);
  const forwardDot = -Math.sin(player.heading) * frame.tx - Math.cos(player.heading) * frame.tz;
  player.wrongWay = forwardDot < -0.3 && Math.abs(player.speed) > 2;

  if (player.finished) return;
  const lapNow = Math.floor(player.progress);
  player.lap = Math.min(state.laps, Math.max(1, lapNow + 1));
  if (player.progress >= state.laps) {
    player.finished = true;
    player.finishTime = state.elapsed;
    player.item = null;
    events.push({ playerId: id, message: `I mål efter ${state.elapsed.toFixed(1)} s!` });
  } else if (lapNow > lapBefore && lapNow >= 1) {
    events.push({ playerId: id, message: lapNow + 1 === state.laps ? "Sidste omgang!" : `Omgang ${lapNow + 1} af ${state.laps}` });
  }
}

function steer(player: PlayerState, input: KartInput, dt: number): void {
  // Drift: hold drift-tasten og styr. Retningen låses, og jo længere driften, jo større turbo bagefter.
  if (input.drift && player.driftDir === 0 && input.steer !== 0 && player.speed > DRIFT_MIN_SPEED && !player.offroad) {
    player.driftDir = input.steer;
    player.driftCharge = 0;
  }
  if (player.driftDir !== 0 && (!input.drift || player.speed < DRIFT_MIN_SPEED - 2)) endDrift(player, true);

  const maxSpeed = player.boost > 0 ? BOOST_SPEED : player.offroad ? OFFROAD_SPEED : BASE_SPEED;
  if (player.boost > 0) player.speed = Math.min(BOOST_SPEED, player.speed + 25 * dt);
  else if (input.throttle) player.speed = Math.min(Math.max(player.speed, maxSpeed), player.speed + ACCELERATION * dt);
  else if (input.brake) player.speed = Math.max(-REVERSE_SPEED, player.speed - (player.speed > 0 ? BRAKING : ACCELERATION * 0.6) * dt);
  else player.speed -= Math.sign(player.speed) * Math.min(Math.abs(player.speed), COAST_DRAG * dt);
  // Over grænsen (fx når man kører ud i græsset) bremses der hårdt ned i stedet for et brat stop.
  if (player.speed > maxSpeed) player.speed = Math.max(maxSpeed, player.speed - OVERSPEED_DRAG * dt);

  let turn: number;
  if (player.driftDir !== 0) {
    turn = player.driftDir * TURN_RATE * (0.85 + 0.45 * input.steer * player.driftDir);
    if (!player.offroad) player.driftCharge += dt * (input.steer === player.driftDir ? 1.3 : 0.8);
  } else {
    const grip = Math.min(1, Math.abs(player.speed) / 5) * Math.sign(player.speed);
    turn = input.steer * TURN_RATE * (1 - 0.2 * Math.min(1, player.speed / BASE_SPEED)) * grip;
  }
  // Højresving (steer = 1) mindsker heading.
  player.heading -= turn * dt;
}

function endDrift(player: PlayerState, reward: boolean): void {
  if (player.driftDir === 0) return;
  if (reward) {
    const turbo = MINI_TURBO.find((level) => player.driftCharge >= level.charge);
    if (turbo) player.boost = Math.max(player.boost, turbo.boost);
  }
  player.driftDir = 0;
  player.driftCharge = 0;
}

function respawn(player: PlayerState): void {
  const frame = routeFrame(player.safeT);
  let delta = player.safeT - player.routeT;
  if (delta > 0.5) delta -= 1;
  if (delta < -0.5) delta += 1;
  Object.assign(player, {
    x: frame.x, z: frame.z, heading: headingAlong(frame.tx, frame.tz),
    speed: 0, boost: 0, spin: 0, driftDir: 0, driftCharge: 0,
    respawn: RESPAWN_TIME, routeT: player.safeT, progress: player.progress + delta,
    offroad: false, wrongWay: false,
  });
}

function spinOut(player: PlayerState): boolean {
  if (player.spin > 0 || player.respawn > 0 || player.finished) return false;
  player.spin = SPIN_TIME;
  player.speed *= 0.4;
  player.boost = 0;
  endDrift(player, false);
  return true;
}

function useItem(state: RaceState, id: string, player: PlayerState): void {
  const forwardX = -Math.sin(player.heading);
  const forwardZ = -Math.cos(player.heading);
  if (player.item === "coffee") player.boost = Math.max(player.boost, 1.4);
  if (player.item === "paper") {
    addObject(state, {
      kind: "paper", x: player.x - forwardX * 2.4, z: player.z - forwardZ * 2.4,
      heading: player.heading, active: true, timer: PAPER_LIFETIME, owner: id,
    });
  }
  if (player.item === "frisbee") {
    addObject(state, {
      kind: "frisbee", x: player.x + forwardX * 2, z: player.z + forwardZ * 2,
      heading: player.heading, active: true, timer: FRISBEE_LIFETIME, owner: id,
    });
  }
  player.itemCount -= 1;
  if (player.itemCount <= 0) {
    player.item = null;
    player.itemCount = 0;
  }
}

// Førstepladsen får mest forsvar, bagerst får mest fart, ligesom i genren.
function rollItem(place: number, racerCount: number): ItemKind {
  const position = racerCount <= 1 ? 1 : (place - 1) / (racerCount - 1);
  const weights: Array<[ItemKind, number]> = [
    ["coffee", 0.15 + 0.55 * position],
    ["paper", 0.55 - 0.45 * position],
    ["frisbee", 0.3],
  ];
  let roll = Math.random() * weights.reduce((sum, [, weight]) => sum + weight, 0);
  for (const [item, weight] of weights) {
    roll -= weight;
    if (roll <= 0) return item;
  }
  return "coffee";
}

function stepObjects(state: RaceState, field: Array<[string, PlayerState]>, dt: number, events: RaceEvent[]): void {
  for (const [id, object] of state.objects) {
    if (object.kind === "box") {
      if (!object.active) {
        object.timer -= dt;
        if (object.timer <= 0) object.active = true;
        continue;
      }
      for (const [playerId, player] of field) {
        if (player.item || player.finished || player.respawn > 0) continue;
        if (Math.hypot(player.x - object.x, player.z - object.z) > 1.6) continue;
        object.active = false;
        object.timer = BOX_RESPAWN;
        player.item = rollItem(player.place || field.length, field.length);
        player.itemCount = 1;
        events.push({ playerId, message: `Du fik ${ITEM_NAMES[player.item]} – tryk mellemrum` });
        break;
      }
      continue;
    }

    object.timer -= dt;
    if (object.kind === "frisbee") {
      const x = object.x - Math.sin(object.heading) * FRISBEE_SPEED * dt;
      const z = object.z - Math.cos(object.heading) * FRISBEE_SPEED * dt;
      const moved = resolveWorldCollision(x, z, 0.4);
      object.x = moved.x;
      object.z = moved.z;
      if (moved.hit) object.timer = 0;
    }
    const age = (object.kind === "frisbee" ? FRISBEE_LIFETIME : PAPER_LIFETIME) - object.timer;
    for (const [playerId, player] of field) {
      if (playerId === object.owner && age < 0.6) continue;
      if (Math.hypot(player.x - object.x, player.z - object.z) > 1.4) continue;
      if (spinOut(player)) {
        events.push({ playerId, message: object.kind === "paper" ? "Du kørte ind i en papirbunke!" : "Ramt af en frisbee!" });
        if (object.owner !== playerId) events.push({ playerId: object.owner, message: `Ramte ${player.name}!` });
      }
      object.timer = 0;
      break;
    }
    if (object.timer <= 0) state.objects.delete(id);
  }
}

function collideKarts(field: Array<[string, PlayerState]>): void {
  for (let i = 0; i < field.length; i++) {
    for (let j = i + 1; j < field.length; j++) {
      const a = field[i][1];
      const b = field[j][1];
      if (a.respawn > 0 || b.respawn > 0) continue;
      const dx = b.x - a.x;
      const dz = b.z - a.z;
      const distance = Math.hypot(dx, dz);
      if (distance >= KART_RADIUS * 2 || distance < 1e-6) continue;
      const push = (KART_RADIUS * 2 - distance) / 2;
      a.x -= (dx / distance) * push;
      a.z -= (dz / distance) * push;
      b.x += (dx / distance) * push;
      b.z += (dz / distance) * push;
      a.speed *= 0.92;
      b.speed *= 0.92;
    }
  }
}

function updatePlaces(field: Array<[string, PlayerState]>): void {
  [...field]
    .sort(([, a], [, b]) => {
      if (a.finished !== b.finished) return a.finished ? -1 : 1;
      if (a.finished && b.finished) return a.finishTime - b.finishTime;
      return b.progress - a.progress;
    })
    .forEach(([, player], index) => {
      player.place = index + 1;
    });
}
