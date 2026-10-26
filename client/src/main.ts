import { Peer as PeerClient, type DataConnection } from "peerjs";
import { RaceScene, type PickupView, type PlayerView } from "./game.js";
import { BASE_SPEED, ROUTE_LENGTH } from "./track.js";
import "./style.css";

interface PlayerState extends PlayerView {
  boostRemaining: number;
}

interface RaceState {
  players: Map<string, PlayerState>;
  pickups: Map<string, PickupView>;
  hostId: string;
  phase: string;
  countdown: number;
  elapsed: number;
  laps: number;
}

interface RaceResult {
  players: Array<{ name: string; place: number; finished: boolean; finishTime: number }>;
}

interface InputState {
  throttle: boolean;
  brake: boolean;
  steer: -1 | 0 | 1;
  useItem: boolean;
}

interface PeerConnection {
  channel: DataConnection;
  playerId: string;
}

type PeerMessage =
  | { type: "input"; input: InputState }
  | { type: "start" }
  | { type: "returnToLobby" }
  | { type: "state"; state: SerializedRaceState }
  | { type: "welcome"; playerId: string }
  | { type: "toast"; message: string }
  | { type: "error"; message: string }
  | { type: "results"; result: RaceResult }
  | { type: "hello"; player: PlayerState };

interface SerializedRaceState {
  players: Array<[string, PlayerState]>;
  pickups: Array<[string, PickupView]>;
  hostId: string;
  phase: string;
  countdown: number;
  elapsed: number;
  laps: number;
}

const MAX_RACERS = 4;
const MAX_SPECTATORS = 8;
const KART_COLORS: Record<string, string> = {
  lime: "#d7f36a",
  clay: "#f28d60",
  fjord: "#78c8c2",
  violet: "#b799e8",
};
const RTC_CONFIGURATION: RTCConfiguration = {
  iceServers: [{ urls: "stun:stun.l.google.com:19302" }],
};
const CONNECT_TIMEOUT_MS = 15000;
const CONNECTION_BLOCKED_MESSAGE =
  "Kunne ikke oprette direkte forbindelse til værten. Netværket kan blokere peer-to-peer-trafik (fx eduroam, firmanetværk eller VPN). Prøv et andet netværk eller en telefon som hotspot, og tjek at værten stadig er online.";

const byId = <T extends HTMLElement>(id: string): T => {
  const element = document.getElementById(id);
  if (!element) throw new Error(`Mangler HTML-elementet #${id}`);
  return element as T;
};

const menu = byId<HTMLElement>("menu");
const lobby = byId<HTMLElement>("lobby");
const raceHud = byId<HTMLElement>("race-hud");
const errorElement = byId<HTMLElement>("error");
const nicknameInput = byId<HTMLInputElement>("nickname");
const roleInput = byId<HTMLSelectElement>("role");
const kartStyleInput = byId<HTMLSelectElement>("kart-style");
const roomIdInput = byId<HTMLInputElement>("room-id");
const createButton = byId<HTMLButtonElement>("create-button");
const soloButton = byId<HTMLButtonElement>("solo-button");
const joinButton = byId<HTMLButtonElement>("join-button");
const startButton = byId<HTMLButtonElement>("start-button");
const copyLinkButton = byId<HTMLButtonElement>("copy-link");
const inviteLink = byId<HTMLElement>("invite-link");
const playersList = byId<HTMLUListElement>("players");
const lobbyStatus = byId<HTMLElement>("lobby-status");
const standings = byId<HTMLElement>("standings");
const resultsPanel = byId<HTMLElement>("results");
const resultList = byId<HTMLOListElement>("result-list");
const returnButton = byId<HTMLButtonElement>("return-button");
const lapElement = byId<HTMLElement>("lap");
const raceStatus = byId<HTMLElement>("race-status");
const speedLabel = byId<HTMLElement>("speed");
const speedFill = byId<HTMLElement>("speed-fill");
const toast = byId<HTMLElement>("toast");
let game: RaceScene | null = null;
let localSessionId = "";
let hostMode = false;
let isHost = false;
let peerClient: PeerClient | null = null;
let inputTimer = 0;
let simulationTimer = 0;
let toastTimer = 0;
let soloTimer = 0;
let soloLastTick = 0;
let soloCountdownLeft = 0;
let soloBoostRemaining = 0;
let soloMode = false;
let raceState: RaceState | null = null;
let peer: PeerConnection | null = null;
const peers = new Map<string, PeerConnection>();
const playerInputs = new Map<string, InputState>();
const heldKeys = new Set<string>();

const joinedRoomFromUrl = new URLSearchParams(window.location.search).get("room");
if (joinedRoomFromUrl) roomIdInput.value = joinedRoomFromUrl;

function showError(message: string): void {
  errorElement.textContent = message;
}

function showToast(message: string): void {
  toast.textContent = message;
  toast.classList.remove("hidden");
  window.clearTimeout(toastTimer);
  toastTimer = window.setTimeout(() => toast.classList.add("hidden"), 3200);
}

function safeName(): string {
  return nicknameInput.value.trim().replace(/\s+/g, " ").slice(0, 20);
}

function makePlayer(name: string, role: "racer" | "spectator", kartStyle: string): PlayerState {
  return {
    name,
    role,
    color: role === "racer" ? KART_COLORS[kartStyle] ?? KART_COLORS.lime : "#b7c0ba",
    progress: 0,
    speed: 0,
    lane: 0,
    lap: 0,
    place: 0,
    finished: false,
    finishTime: 0,
    host: false,
    hasItem: false,
    boostRemaining: 0,
  };
}

function serializeState(state: RaceState): SerializedRaceState {
  return {
    players: [...state.players.entries()].map(([id, player]) => [id, { ...player }]),
    pickups: [...state.pickups.entries()].map(([id, pickup]) => [id, { ...pickup }]),
    hostId: state.hostId,
    phase: state.phase,
    countdown: state.countdown,
    elapsed: state.elapsed,
    laps: state.laps,
  };
}

function deserializeState(state: SerializedRaceState): RaceState {
  return {
    ...state,
    players: new Map(state.players),
    pickups: new Map(state.pickups),
  };
}

function syncLobby(state: RaceState): void {
  if (!hostMode) return;
  const racers = [...state.players.values()].filter((player) => player.role === "racer").length;
  const spectators = [...state.players.values()].filter((player) => player.role === "spectator").length;
  lobbyStatus.textContent = `${racers}/${MAX_RACERS} racere og ${spectators}/${MAX_SPECTATORS} tilskuere. Del invitationslinket med spillerne.`;
}

function renderState(state: RaceState): void {
  if (!raceState && !soloMode) return;
  const players = [...state.players.entries()];
  const racers = players.filter(([, player]) => player.role === "racer");
  const spectators = players.filter(([, player]) => player.role === "spectator");
  const isLocalHost = localSessionId === state.hostId;
  const me = state.players.get(localSessionId);

  playersList.replaceChildren();
  for (const [id, player] of players) {
    const item = document.createElement("li");
    const name = document.createElement("span");
    name.textContent = `${player.name}${id === state.hostId ? " ★" : ""}`;
    const role = document.createElement("span");
    role.className = "player-role";
    role.textContent = player.role === "racer" ? "RACER" : "TILSKUER";
    item.append(name, role);
    playersList.appendChild(item);
  }

  startButton.classList.toggle("hidden", !isLocalHost);
  startButton.disabled = racers.length === 0 || state.phase !== "lobby";
  startButton.textContent = racers.length === 1 ? "Start tidskørsel" : "Start løb";
  returnButton.classList.toggle("hidden", !isLocalHost && !soloMode);
  if (state.phase === "lobby") {
    menu.classList.add("hidden");
    lobby.classList.remove("hidden");
    raceHud.classList.add("hidden");
    if (hostMode) syncLobby(state);
    else if (!soloMode) lobbyStatus.textContent = "Forbundet med værten. Venter på, at løbet starter.";
  } else {
    lobby.classList.add("hidden");
    raceHud.classList.remove("hidden");
    game?.updatePlayers(players);
    game?.updatePickups(state.pickups.entries());
    lapElement.textContent = me?.role === "spectator" ? "LIVE" : `${me?.lap ?? 0} / ${state.laps}`;
    speedLabel.textContent = me?.role === "spectator" ? "—" : `${Math.round((me?.speed ?? 0) * 100)}`;
    speedFill.style.width = `${Math.min(100, ((me?.speed ?? 0) / 1.35) * 100)}%`;
    if (state.phase === "countdown") {
      raceStatus.textContent = racers.length === 1 ? `TIDSKØRSEL · STARTER OM ${state.countdown}` : `STARTER OM ${state.countdown}`;
    } else if (state.phase === "racing") {
      const status = me?.hasItem ? "CAMPUS-PULS KLAR · MELLEMRUM" : "LØBET ER I GANG";
      raceStatus.textContent = racers.length === 1 ? `TIDSKØRSEL · ${status}` : status;
    } else {
      raceStatus.textContent = racers.length === 1 ? "TIDSKØRSEL · LØBET ER SLUT" : "LØBET ER SLUT";
    }
    renderStandings(players);
  }
}

function renderStandings(players: Array<[string, PlayerState]>): void {
  const racers = players
    .filter(([, player]) => player.role === "racer")
    .sort(([, a], [, b]) => {
      if (a.finished !== b.finished) return a.finished ? -1 : 1;
      if (a.finished && b.finished) return a.finishTime - b.finishTime;
      return b.progress - a.progress;
    });
  standings.replaceChildren();
  racers.forEach(([id, player], index) => {
    const row = document.createElement("div");
    row.className = "standing";
    const name = document.createElement("span");
    name.textContent = `${player.place || index + 1}. ${player.name}${id === localSessionId ? " (dig)" : ""}`;
    const distance = document.createElement("small");
    distance.textContent = player.finished ? "MÅL" : `${Math.floor(player.progress * 100)}%`;
    row.append(name, distance);
    standings.appendChild(row);
  });
  if (!racers.length) {
    const row = document.createElement("div");
    row.className = "standing";
    row.textContent = "Følger løbet live";
    standings.appendChild(row);
  }
}

function renderResults(result: RaceResult): void {
  resultList.replaceChildren();
  for (const player of result.players) {
    const item = document.createElement("li");
    const name = document.createElement("span");
    name.textContent = `${player.place}. ${player.name}`;
    const time = document.createElement("span");
    time.className = "player-role";
    time.textContent = player.finished ? `${player.finishTime.toFixed(1)} s` : "Ikke i mål";
    item.append(name, time);
    resultList.appendChild(item);
  }
  resultsPanel.classList.remove("hidden");
}

function sendToPeer(target: PeerConnection, message: PeerMessage): void {
  if (target.channel.open) target.channel.send(message);
}

function broadcast(message: PeerMessage): void {
  for (const connectedPeer of peers.values()) sendToPeer(connectedPeer, message);
}

function publishState(): void {
  if (!raceState || !isHost) return;
  const snapshot = serializeState(raceState);
  broadcast({ type: "state", state: snapshot });
  renderState(raceState);
}

function removePlayer(playerId: string): void {
  if (!raceState || !peers.has(playerId)) return;
  raceState.players.delete(playerId);
  playerInputs.delete(playerId);
  const disconnected = peers.get(playerId);
  disconnected?.channel.close();
  peers.delete(playerId);
  publishState();
}

function handlePeerMessage(source: PeerConnection, message: PeerMessage): void {
  if (!raceState) return;
  if (isHost) {
    if (message.type === "hello") {
      const name = typeof message.player.name === "string"
        ? message.player.name.trim().replace(/\s+/g, " ").slice(0, 20)
        : "";
      const role = message.player.role === "spectator" ? "spectator" : "racer";
      if (!name) {
        sendToPeer(source, { type: "error", message: "Skriv et gyldigt kaldenavn før du deltager." });
        source.channel.close();
        return;
      }
      const racerCount = [...raceState.players.values()].filter((player) => player.role === "racer").length;
      const spectatorCount = [...raceState.players.values()].filter((player) => player.role === "spectator").length;
      if (
        raceState.phase !== "lobby" ||
        (role === "racer" && racerCount >= MAX_RACERS) ||
        (role === "spectator" && spectatorCount >= MAX_SPECTATORS)
      ) {
        sendToPeer(source, { type: "error", message: "Lobbyen er fuld, eller løbet er allerede startet." });
        source.channel.close();
        return;
      }
      const player = makePlayer(name, role, "lime");
      if (role === "racer" && Object.values(KART_COLORS).includes(message.player.color)) {
        player.color = message.player.color;
      }
      raceState.players.set(source.playerId, player);
      playerInputs.set(source.playerId, { throttle: false, brake: false, steer: 0, useItem: false });
      sendToPeer(source, { type: "welcome", playerId: source.playerId });
      publishState();
      return;
    }
    if (message.type === "input") {
      if (raceState.players.get(source.playerId)?.role === "racer" && raceState.phase === "racing") {
        const input = message.input;
        playerInputs.set(source.playerId, {
          throttle: input?.throttle === true,
          brake: input?.brake === true,
          steer: input?.steer === -1 || input?.steer === 1 ? input.steer : 0,
          useItem: input?.useItem === true,
        });
      }
      return;
    }
    if (message.type === "start" && source.playerId === raceState.hostId) startRace();
    if (message.type === "returnToLobby" && source.playerId === raceState.hostId) returnToLobby();
    return;
  }
  if (message.type === "welcome") {
    localSessionId = message.playerId;
    return;
  }
  if (message.type === "error") {
    showError(message.message);
    return;
  }
  if (message.type === "state") {
    raceState = deserializeState(message.state);
    renderState(raceState);
  }
  if (message.type === "toast") showToast(message.message);
  if (message.type === "results") renderResults(message.result);
}

function configurePeer(target: PeerConnection, name?: string, role?: "racer" | "spectator", kartStyle?: string): void {
  const channel = target.channel;
  channel.on("open", () => {
    if (!isHost) {
      lobbyStatus.textContent = "Forbundet med værten.";
      if (name && role) sendToPeer(target, { type: "hello", player: makePlayer(name, role, kartStyle ?? "lime") });
      return;
    }
    lobbyStatus.textContent = "Spilleren er forbundet. Del invitationslinket med flere.";
  });
  channel.on("data", (data) => {
    if (typeof data !== "object" || data === null || !("type" in data) || typeof data.type !== "string") {
      showToast("Modtog en ugyldig spilbesked.");
      return;
    }
    handlePeerMessage(target, data as PeerMessage);
  });
  channel.on("close", () => {
    if (isHost) {
      removePlayer(target.playerId);
      return;
    }
    if (peer !== target) return;
    const previousError = errorElement.textContent;
    leaveSession();
    showError(previousError || "Værten forlod løbet, eller forbindelsen blev afbrudt. Løbet kan ikke fortsætte uden værten.");
  });
  channel.on("error", () => showError("Forbindelsen til spilleren fejlede."));
}

function showLobby(): void {
  menu.classList.add("hidden");
  lobby.classList.remove("hidden");
  raceHud.classList.add("hidden");
  resultsPanel.classList.add("hidden");
}

function createRoom(): void {
  const name = safeName();
  if (!name) {
    showError("Skriv et kaldenavn på 1–20 tegn.");
    nicknameInput.focus();
    return;
  }
  resetSession();
  isHost = true;
  hostMode = true;
  lobbyStatus.textContent = "Opretter lobby og invitationslink …";
  showError("");
  peerClient = new PeerClient({ config: RTC_CONFIGURATION });
  peerClient.on("open", (id) => {
    localSessionId = id;
    raceState = {
      players: new Map(),
      pickups: new Map(),
      hostId: localSessionId,
      phase: "lobby",
      countdown: 0,
      elapsed: 0,
      laps: 3,
    };
    const player = makePlayer(name, "racer", kartStyleInput.value);
    player.host = true;
    raceState.players.set(localSessionId, player);
    playerInputs.set(localSessionId, { throttle: false, brake: false, steer: 0, useItem: false });
    const url = `${window.location.origin}${window.location.pathname}?room=${encodeURIComponent(id)}`;
    inviteLink.textContent = url;
    inviteLink.setAttribute("href", url);
    showLobby();
    game = new RaceScene(document.body, localSessionId);
    renderState(raceState);
    startInputUpdates();
  });
  peerClient.on("connection", (channel) => {
    const target: PeerConnection = { channel, playerId: channel.peer };
    peers.set(target.playerId, target);
    configurePeer(target);
  });
  peerClient.on("error", (error) => {
    showError(`Signaltjenesten kunne ikke oprette lobbyen: ${error.message}`);
  });
  peerClient.on("disconnected", () => {
    showError("Forbindelsen til signaltjenesten blev afbrudt. Genindlæs siden for at oprette en ny lobby.");
  });
  showLobby();
  game = new RaceScene(document.body, "");
  copyLinkButton.textContent = "Kopiér invitationslink";
}

function joinRoom(): void {
  const name = safeName();
  if (!name) {
    showError("Skriv et kaldenavn på 1–20 tegn.");
    nicknameInput.focus();
    return;
  }
  const roomId = roomIdInput.value.trim() || joinedRoomFromUrl || "";
  if (!roomId) {
    showError("Åbn værtens invitationslink eller indsæt lobbykoden.");
    roomIdInput.focus();
    return;
  }
  resetSession();
  isHost = false;
  hostMode = false;
  const role = roleInput.value === "spectator" ? "spectator" : "racer";
  raceState = {
    players: new Map(),
    pickups: new Map(),
    hostId: roomId,
    phase: "lobby",
    countdown: 0,
    elapsed: 0,
    laps: 3,
  };
  showError("");
  lobbyStatus.textContent = "Forbinder til lobbyen …";
  showLobby();
  game = new RaceScene(document.body, "");
  peerClient = new PeerClient({ config: RTC_CONFIGURATION });
  peerClient.on("open", () => {
    if (!peerClient) return;
    const channel = peerClient.connect(roomId, { reliable: true, serialization: "json" });
    const target: PeerConnection = { channel, playerId: roomId };
    peer = target;
    configurePeer(target, name, role, kartStyleInput.value);
    startInputUpdates();
    window.setTimeout(() => {
      if (peer !== target || channel.open) return;
      leaveSession();
      showError(CONNECTION_BLOCKED_MESSAGE);
    }, CONNECT_TIMEOUT_MS);
  });
  peerClient.on("error", (error) => {
    leaveSession();
    showError(
      error.type === "peer-unavailable"
        ? "Lobbyen blev ikke fundet. Tjek linket, og at værten stadig er online."
        : `Kunne ikke forbinde til lobbyen: ${error.message}`,
    );
  });
}

function startInputUpdates(): void {
  window.clearInterval(inputTimer);
  inputTimer = window.setInterval(() => {
    if (!raceState || raceState.phase !== "racing") return;
    const input: InputState = {
      throttle: heldKeys.has("KeyW") || heldKeys.has("ArrowUp"),
      brake: heldKeys.has("KeyS") || heldKeys.has("ArrowDown"),
      steer: heldKeys.has("KeyA") || heldKeys.has("ArrowLeft") ? -1 : heldKeys.has("KeyD") || heldKeys.has("ArrowRight") ? 1 : 0,
      useItem: heldKeys.has("Space"),
    };
    if (isHost) playerInputs.set(localSessionId, input);
    else if (peer) sendToPeer(peer, { type: "input", input });
  }, 50);
}

function startRace(): void {
  if (!raceState || !isHost || raceState.phase !== "lobby") return;
  raceState.phase = "countdown";
  raceState.countdown = 3;
  raceState.elapsed = 0;
  raceState.pickups.clear();
  for (let lap = 0; lap < raceState.laps; lap++) {
    for (const [index, fraction] of [0.14, 0.47, 0.81].entries()) {
      const id = `pulse-${lap}-${fraction}`;
      raceState.pickups.set(id, {
        id,
        progress: lap + fraction,
        lane: [-0.65, 0.65, 0][(lap + index) % 3],
        active: true,
      });
    }
  }
  simulationTimer = window.setInterval(updateRace, 1000 / 30);
  publishState();
}

function finishRace(): void {
  if (!raceState) return;
  raceState.phase = "results";
  const racers = [...raceState.players.entries()].filter(([, player]) => player.role === "racer");
  racers.sort(([, a], [, b]) => {
    if (a.finished !== b.finished) return a.finished ? -1 : 1;
    if (a.finished) return a.finishTime - b.finishTime;
    return b.progress - a.progress;
  });
  racers.forEach(([, player], index) => {
    player.place = index + 1;
    player.speed = 0;
  });
  const result = {
    players: racers.map(([, player]) => ({
      name: player.name,
      place: player.place,
      finished: player.finished,
      finishTime: Math.round(player.finishTime * 10) / 10,
    })),
  };
  broadcast({ type: "results", result });
  renderResults(result);
  window.clearInterval(simulationTimer);
  publishState();
}

function updateRace(): void {
  const state = raceState;
  if (!state || !isHost) return;
  const dt = 1 / 30;
  if (state.phase === "countdown") {
    state.countdown = Math.max(0, state.countdown - dt);
    if (state.countdown <= 0) {
      state.phase = "racing";
      state.countdown = 0;
    }
    publishState();
    return;
  }
  if (state.phase !== "racing") return;
  state.elapsed += dt;
  const racers = [...state.players.entries()].filter(([, player]) => player.role === "racer");
  for (const [id, player] of racers) {
    if (player.finished) continue;
    const input = playerInputs.get(id);
    if (!input) continue;
    let boostRemaining = player.boostRemaining;
    if (input.useItem && player.hasItem) {
      player.hasItem = false;
      boostRemaining = 2.5;
    }
    const boost = boostRemaining > 0;
    boostRemaining = Math.max(0, boostRemaining - dt);
    player.boostRemaining = boostRemaining;
    const targetSpeed = input.brake ? 0 : input.throttle ? (boost ? 1.35 : 1) : 0;
    const acceleration = input.throttle || input.brake ? 2.4 : 0.55;
    player.speed += Math.max(-acceleration * dt, Math.min(acceleration * dt, targetSpeed - player.speed));
    player.speed = Math.max(0, Math.min(1.35, player.speed));
    player.lane = Math.max(-1, Math.min(1, player.lane + input.steer * dt * 0.85));
    const previousProgress = player.progress;
    player.progress += (BASE_SPEED / ROUTE_LENGTH) * player.speed * dt;
    player.lap = Math.min(state.laps, Math.floor(player.progress));
    state.pickups.forEach((pickup) => {
      if (!player.hasItem && pickup.active && Math.abs(player.lane - pickup.lane) <= 0.45 &&
        pickup.progress >= previousProgress && pickup.progress <= player.progress) {
        pickup.active = false;
        player.hasItem = true;
        const message = "Campus-puls samlet op! Tryk mellemrum for et fartboost.";
        if (id === localSessionId) showToast(message);
        else {
          const recipient = peers.get(id);
          if (recipient) sendToPeer(recipient, { type: "toast", message });
        }
      }
    });
    if (player.progress >= state.laps) {
      player.progress = state.laps;
      player.lap = state.laps;
      player.speed = 0;
      player.finished = true;
      player.finishTime = state.elapsed;
      player.place = racers.filter(([, other]) => other.finished).length;
    }
  }
  if (state.elapsed >= 180 || racers.every(([, player]) => player.finished)) finishRace();
  publishState();
}

function returnToLobby(): void {
  if (!raceState || !isHost || raceState.phase !== "results") return;
  raceState.phase = "lobby";
  raceState.elapsed = 0;
  raceState.countdown = 0;
  raceState.pickups.clear();
  let gridPosition = 0;
  raceState.players.forEach((player, id) => {
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
      playerInputs.set(id, { throttle: false, brake: false, steer: 0, useItem: false });
    } else player.progress = 0;
  });
  resultsPanel.classList.add("hidden");
  publishState();
}

function startSoloTimeTrial(): void {
  const name = safeName();
  if (!name) {
    showError("Skriv et kaldenavn på 1–20 tegn.");
    nicknameInput.focus();
    return;
  }
  resetSession();
  soloMode = true;
  localSessionId = "solo-player";
  soloCountdownLeft = 3;
  soloBoostRemaining = 0;
  raceState = {
    players: new Map([[localSessionId, { ...makePlayer(name, "racer", kartStyleInput.value), host: true, place: 1 }]]),
    pickups: new Map(),
    hostId: localSessionId,
    phase: "countdown",
    countdown: 3,
    elapsed: 0,
    laps: 3,
  };
  for (let lap = 0; lap < raceState.laps; lap++) {
    for (const [index, fraction] of [0.14, 0.47, 0.81].entries()) {
      const id = `pulse-${lap}-${fraction}`;
      raceState.pickups.set(id, { id, progress: lap + fraction, lane: [-0.65, 0.65, 0][(lap + index) % 3], active: true });
    }
  }
  showError("");
  showLobby();
  lobby.classList.add("hidden");
  raceHud.classList.remove("hidden");
  game = new RaceScene(document.body, localSessionId);
  renderState(raceState);
  soloLastTick = performance.now();
  soloTimer = window.setInterval(updateSoloTimeTrial, 1000 / 30);
}

function updateSoloTimeTrial(): void {
  const state = raceState;
  const player = state?.players.get(localSessionId);
  if (!state || !player) return;
  const now = performance.now();
  const dt = Math.min((now - soloLastTick) / 1000, 0.1);
  soloLastTick = now;
  if (state.phase === "countdown") {
    soloCountdownLeft -= dt;
    state.countdown = Math.max(0, Math.ceil(soloCountdownLeft));
    if (soloCountdownLeft <= 0) state.phase = "racing";
    renderState(state);
    return;
  }
  if (state.phase !== "racing" || player.finished) return;
  state.elapsed += dt;
  if (heldKeys.has("Space") && player.hasItem) {
    player.hasItem = false;
    soloBoostRemaining = 2.5;
  }
  const boost = soloBoostRemaining > 0;
  soloBoostRemaining = Math.max(0, soloBoostRemaining - dt);
  const throttle = heldKeys.has("KeyW") || heldKeys.has("ArrowUp");
  const brake = heldKeys.has("KeyS") || heldKeys.has("ArrowDown");
  const steer = heldKeys.has("KeyA") || heldKeys.has("ArrowLeft") ? -1 : heldKeys.has("KeyD") || heldKeys.has("ArrowRight") ? 1 : 0;
  const targetSpeed = brake ? 0 : throttle ? (boost ? 1.35 : 1) : 0;
  const acceleration = throttle || brake ? 2.4 : 0.55;
  player.speed = Math.max(0, Math.min(1.35, player.speed + Math.max(-acceleration * dt, Math.min(acceleration * dt, targetSpeed - player.speed))));
  player.lane = Math.max(-1, Math.min(1, player.lane + steer * dt * 0.85));
  const previousProgress = player.progress;
  player.progress += (BASE_SPEED / ROUTE_LENGTH) * player.speed * dt;
  player.lap = Math.min(state.laps, Math.floor(player.progress));
  state.pickups.forEach((pickup) => {
    if (!player.hasItem && pickup.active && Math.abs(player.lane - pickup.lane) <= 0.45 &&
      pickup.progress >= previousProgress && pickup.progress <= player.progress) {
      pickup.active = false;
      player.hasItem = true;
      showToast("Campus-puls samlet op! Tryk mellemrum for et fartboost.");
    }
  });
  if (player.progress >= state.laps || state.elapsed >= 180) {
    player.progress = Math.min(player.progress, state.laps);
    player.lap = Math.min(state.laps, Math.floor(player.progress));
    player.speed = 0;
    player.finished = player.progress >= state.laps;
    player.finishTime = state.elapsed;
    state.phase = "results";
    window.clearInterval(soloTimer);
    renderResults({ players: [{ name: player.name, place: 1, finished: player.finished, finishTime: player.finishTime }] });
  }
  renderState(state);
}

function leaveSession(): void {
  resetSession();
  lobby.classList.add("hidden");
  raceHud.classList.add("hidden");
  resultsPanel.classList.add("hidden");
  menu.classList.remove("hidden");
  showError("");
}

function resetSession(): void {
  window.clearInterval(inputTimer);
  window.clearInterval(simulationTimer);
  window.clearInterval(soloTimer);
  heldKeys.clear();
  peerClient?.destroy();
  peerClient = null;
  peer?.channel.close();
  peer = null;
  for (const connectedPeer of peers.values()) connectedPeer.channel.close();
  peers.clear();
  playerInputs.clear();
  game?.dispose();
  game = null;
  raceState = null;
  localSessionId = "";
  soloMode = false;
  hostMode = false;
  isHost = false;
  soloBoostRemaining = 0;
  inviteLink.textContent = "";
  inviteLink.removeAttribute("href");
}

createButton.addEventListener("click", (event) => {
  event.preventDefault();
  void createRoom();
});
joinButton.addEventListener("click", () => void joinRoom());
startButton.addEventListener("click", () => {
  if (isHost) startRace();
  else if (peer) sendToPeer(peer, { type: "start" });
});
byId<HTMLButtonElement>("leave-button").addEventListener("click", leaveSession);
returnButton.addEventListener("click", () => {
  if (soloMode) leaveSession();
  else if (isHost) returnToLobby();
  else if (peer) sendToPeer(peer, { type: "returnToLobby" });
});
soloButton.addEventListener("click", startSoloTimeTrial);
copyLinkButton.addEventListener("click", async () => {
  try {
    await navigator.clipboard.writeText(inviteLink.textContent ?? "");
    showToast("Invitationslink kopieret.");
  } catch {
    showError("Kopiér invitationslinket manuelt fra feltet.");
  }
});
window.addEventListener("keydown", (event) => {
  const target = event.target;
  if (target instanceof HTMLInputElement || target instanceof HTMLSelectElement || target instanceof HTMLTextAreaElement) return;
  if (["ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight", "Space"].includes(event.code)) event.preventDefault();
  heldKeys.add(event.code);
});
window.addEventListener("keyup", (event) => heldKeys.delete(event.code));
window.addEventListener("blur", () => heldKeys.clear());
