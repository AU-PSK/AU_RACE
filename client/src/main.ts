import { RaceScene, type PickupView, type PlayerView } from "./game.js";
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

interface SignalCode {
  type: "offer" | "answer";
  sdp: RTCSessionDescriptionInit;
}

interface Peer {
  connection: RTCPeerConnection;
  channel: RTCDataChannel | null;
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
const roomIdInput = byId<HTMLTextAreaElement>("room-id");
const createButton = byId<HTMLButtonElement>("create-button");
const soloButton = byId<HTMLButtonElement>("solo-button");
const joinButton = byId<HTMLButtonElement>("join-button");
const startButton = byId<HTMLButtonElement>("start-button");
const copyLinkButton = byId<HTMLButtonElement>("copy-link");
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
const signalInput = byId<HTMLTextAreaElement>("signal-input");
const signalAction = byId<HTMLButtonElement>("signal-action");

let game: RaceScene | null = null;
let localSessionId = "";
let hostMode = false;
let isHost = false;
let awaitingAnswer = false;
let pendingPeer: Peer | null = null;
let inputTimer = 0;
let simulationTimer = 0;
let toastTimer = 0;
let soloTimer = 0;
let soloLastTick = 0;
let soloCountdownLeft = 0;
let soloBoostRemaining = 0;
let soloMode = false;
let raceState: RaceState | null = null;
let peer: Peer | null = null;
const peers = new Map<string, Peer>();
const playerInputs = new Map<string, InputState>();
const heldKeys = new Set<string>();

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

function encodeSignal(signal: SignalCode): string {
  const bytes = new TextEncoder().encode(JSON.stringify(signal));
  let binary = "";
  bytes.forEach((byte) => (binary += String.fromCharCode(byte)));
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function decodeSignal(value: string): SignalCode {
  try {
    const base64 = value.trim().replace(/-/g, "+").replace(/_/g, "/");
    const binary = atob(base64.padEnd(Math.ceil(base64.length / 4) * 4, "="));
    const bytes = Uint8Array.from(binary, (character) => character.charCodeAt(0));
    const parsed: unknown = JSON.parse(new TextDecoder().decode(bytes));
    if (
      typeof parsed !== "object" ||
      parsed === null ||
      !("type" in parsed) ||
      !("sdp" in parsed) ||
      (parsed.type !== "offer" && parsed.type !== "answer") ||
      typeof parsed.sdp !== "object" ||
      parsed.sdp === null ||
      !("type" in parsed.sdp) ||
      !("sdp" in parsed.sdp)
    ) {
      throw new Error("Ugyldig forbindelseskode.");
    }
    return parsed as SignalCode;
  } catch {
    throw new Error("Koden kunne ikke læses. Kontrollér, at hele koden er kopieret.");
  }
}

function syncLobby(state: RaceState): void {
  if (!hostMode) return;
  const racers = [...state.players.values()].filter((player) => player.role === "racer").length;
  const spectators = [...state.players.values()].filter((player) => player.role === "spectator").length;
  lobbyStatus.textContent = `${racers}/${MAX_RACERS} racere og ${spectators}/${MAX_SPECTATORS} tilskuere. Del en ny forbindelseskode for hver spiller.`;
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

function sendToPeer(target: Peer, message: PeerMessage): void {
  if (target.channel?.readyState === "open") target.channel.send(JSON.stringify(message));
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
  if (!raceState) return;
  raceState.players.delete(playerId);
  playerInputs.delete(playerId);
  const disconnected = peers.get(playerId);
  disconnected?.connection.close();
  peers.delete(playerId);
  publishState();
}

function handlePeerMessage(source: Peer, message: PeerMessage): void {
  if (!raceState) return;
  if (isHost) {
    if (message.type === "hello") {
      const racerCount = [...raceState.players.values()].filter((player) => player.role === "racer").length;
      const spectatorCount = [...raceState.players.values()].filter((player) => player.role === "spectator").length;
      if (
        raceState.phase !== "lobby" ||
        (message.player.role === "racer" && racerCount >= MAX_RACERS) ||
        (message.player.role === "spectator" && spectatorCount >= MAX_SPECTATORS)
      ) {
        sendToPeer(source, { type: "error", message: "Lobbyen er fuld, eller løbet er allerede startet." });
        source.connection.close();
        return;
      }
      raceState.players.set(source.playerId, message.player);
      playerInputs.set(source.playerId, { throttle: false, brake: false, steer: 0, useItem: false });
      sendToPeer(source, { type: "welcome", playerId: source.playerId });
      publishState();
      return;
    }
    if (message.type === "input") {
      if (raceState.players.get(source.playerId)?.role === "racer" && raceState.phase === "racing") {
        playerInputs.set(source.playerId, message.input);
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
  if (message.type === "hello") {
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

function configurePeer(target: Peer, channel: RTCDataChannel): void {
  target.channel = channel;
  channel.onopen = () => {
    if (!isHost) {
      lobbyStatus.textContent = "Forbundet med værten.";
      return;
    }
    lobbyStatus.textContent = "Spilleren er forbundet. Del næste kode for at invitere flere.";
  };
  channel.onmessage = (event: MessageEvent<string>) => {
    try {
      const message = JSON.parse(event.data) as PeerMessage;
      handlePeerMessage(target, message);
    } catch {
      showToast("Modtog en ugyldig spilbesked.");
    }
  };
  channel.onclose = () => {
    if (isHost) removePlayer(target.playerId);
    else showToast("Forbindelsen til værten blev afbrudt.");
  };
}

function createHostPeerConnection(playerId: string): Peer {
  const connection = new RTCPeerConnection(RTC_CONFIGURATION);
  const target: Peer = { connection, channel: null, playerId };
  configurePeer(target, connection.createDataChannel("au-race", { ordered: true }));
  connection.onconnectionstatechange = () => {
    if (connection.connectionState === "failed" || connection.connectionState === "closed") {
      if (isHost) removePlayer(playerId);
    }
  };
  return target;
}

function showLobby(): void {
  menu.classList.add("hidden");
  lobby.classList.remove("hidden");
  raceHud.classList.add("hidden");
  resultsPanel.classList.add("hidden");
}

async function createRoom(): Promise<void> {
  const name = safeName();
  if (!name) {
    showError("Skriv et kaldenavn på 1–20 tegn.");
    nicknameInput.focus();
    return;
  }
  resetSession();
  isHost = true;
  hostMode = true;
  localSessionId = crypto.randomUUID();
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
  signalInput.value = "";
  signalInput.placeholder = "Tryk på knappen for at lave en forbindelseskode.";
  signalAction.textContent = "Lav forbindelseskode";
  signalAction.disabled = false;
  awaitingAnswer = false;
  copyLinkButton.textContent = "Kopiér kode";
  showError("");
  showLobby();
  game = new RaceScene(document.body, localSessionId);
  renderState(raceState);
  startInputUpdates();
}

async function createOffer(): Promise<void> {
  try {
    if (pendingPeer) {
      pendingPeer.connection.close();
      pendingPeer = null;
    }
    const playerId = crypto.randomUUID();
    const target = createHostPeerConnection(playerId);
    pendingPeer = target;
    const offer = await target.connection.createOffer();
    await target.connection.setLocalDescription(offer);
    await waitForIce(target.connection);
    signalInput.value = encodeSignal({ type: "offer", sdp: target.connection.localDescription! });
    awaitingAnswer = true;
    lobbyStatus.textContent = "Send koden til én spiller. Når spilleren sender sin svar-kode retur, skal den indsættes her.";
    signalAction.textContent = "Tilslut med svar-kode";
  } catch (error) {
    showError(error instanceof Error ? error.message : "Forbindelseskoden kunne ikke oprettes.");
  }
}

async function acceptAnswer(): Promise<void> {
  if (!pendingPeer) {
    showError("Lav først en forbindelseskode.");
    return;
  }
  try {
    const signal = decodeSignal(signalInput.value);
    if (signal.type !== "answer") throw new Error("Indsæt spillerens svar-kode, ikke din egen invitationskode.");
    await pendingPeer.connection.setRemoteDescription(signal.sdp);
    peers.set(pendingPeer.playerId, pendingPeer);
    pendingPeer = null;
    awaitingAnswer = false;
    signalInput.value = "";
    signalAction.textContent = "Lav ny forbindelseskode";
    lobbyStatus.textContent = "Forbinder til spilleren. Lav en ny kode, når forbindelsen er klar.";
  } catch (error) {
    showError(error instanceof Error ? error.message : "Svar-koden kunne ikke bruges.");
  }
}

async function joinRoom(): Promise<void> {
  const name = safeName();
  if (!name) {
    showError("Skriv et kaldenavn på 1–20 tegn.");
    nicknameInput.focus();
    return;
  }
  const signalText = roomIdInput.value.trim();
  if (!signalText) {
    showError("Indsæt værtens forbindelseskode.");
    roomIdInput.focus();
    return;
  }
  try {
    resetSession();
    const signal = decodeSignal(signalText);
    if (signal.type !== "offer") throw new Error("Koden skal være værtens invitationskode.");
    isHost = false;
    hostMode = false;
    const role = roleInput.value === "spectator" ? "spectator" : "racer";
    localSessionId = crypto.randomUUID();
    raceState = {
      players: new Map(),
      pickups: new Map(),
      hostId: "",
      phase: "lobby",
      countdown: 0,
      elapsed: 0,
      laps: 3,
    };
    const connection = new RTCPeerConnection(RTC_CONFIGURATION);
    const target: Peer = { connection, channel: null, playerId: "" };
    peer = target;
    connection.ondatachannel = (event) => {
      configurePeer(target, event.channel);
      const announce = () => sendToPeer(target, {
        type: "hello",
        player: makePlayer(name, role, kartStyleInput.value),
      });
      if (event.channel.readyState === "open") announce();
      else event.channel.addEventListener("open", announce, { once: true });
    };
    connection.onconnectionstatechange = () => {
      if (connection.connectionState === "failed" || connection.connectionState === "closed") {
        showError("Forbindelsen til værten blev afbrudt.");
      }
    };
    await connection.setRemoteDescription(signal.sdp);
    const answer = await connection.createAnswer();
    await connection.setLocalDescription(answer);
    await waitForIce(connection);
    signalInput.value = encodeSignal({ type: "answer", sdp: connection.localDescription! });
    signalInput.readOnly = true;
    signalAction.textContent = "Svar-kode klar";
    signalAction.disabled = true;
    showError("");
    showLobby();
    lobbyStatus.textContent = "Send svar-koden nedenfor til værten. Lobbyen åbner, når værten har tilsluttet den.";
    game = new RaceScene(document.body, localSessionId);
    startInputUpdates();
  } catch (error) {
    resetSession();
    showError(error instanceof Error ? error.message : "Forbindelseskoden kunne ikke bruges.");
  }
}

function waitForIce(connection: RTCPeerConnection): Promise<void> {
  if (connection.iceGatheringState === "complete") return Promise.resolve();
  return new Promise((resolve, reject) => {
    const timeout = window.setTimeout(() => {
      connection.removeEventListener("icegatheringstatechange", checkState);
      reject(new Error("Netværksoplysningerne kunne ikke hentes. Prøv igen."));
    }, 12000);
    const checkState = () => {
      if (connection.iceGatheringState !== "complete") return;
      window.clearTimeout(timeout);
      connection.removeEventListener("icegatheringstatechange", checkState);
      resolve();
    };
    connection.addEventListener("icegatheringstatechange", checkState);
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
    player.progress += 0.06 * player.speed * dt;
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
  player.progress += 0.06 * player.speed * dt;
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
  pendingPeer?.connection.close();
  pendingPeer = null;
  peer?.connection.close();
  peer = null;
  for (const connectedPeer of peers.values()) connectedPeer.connection.close();
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
  signalInput.readOnly = false;
  signalInput.value = "";
  signalAction.disabled = false;
  awaitingAnswer = false;
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
signalAction.addEventListener("click", () => {
  if (hostMode) {
    if (awaitingAnswer) void acceptAnswer();
    else void createOffer();
  }
});
copyLinkButton.addEventListener("click", async () => {
  try {
    await navigator.clipboard.writeText(signalInput.value);
    showToast("Forbindelseskode kopieret.");
  } catch {
    signalInput.focus();
    signalInput.select();
    showToast("Markér og kopiér koden manuelt.");
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
