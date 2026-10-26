import { Peer as PeerClient, type DataConnection } from "peerjs";
import { RaceScene } from "./game.js";
import {
  BOOST_SPEED, IDLE_INPUT, ITEM_NAMES, createPlayer, createRaceState, prepareRace, resetToLobby, stepRace,
  type KartInput, type PlayerState, type RaceEvent, type RaceObject, type RaceState,
} from "./race.js";
import { BASE_SPEED } from "./track.js";
import "./style.css";

interface RaceResult {
  players: Array<{ name: string; place: number; finished: boolean; finishTime: number }>;
}

interface PeerConnection {
  channel: DataConnection;
  playerId: string;
}

type PeerMessage =
  | { type: "input"; input: KartInput }
  | { type: "start" }
  | { type: "returnToLobby" }
  | { type: "state"; state: SerializedRaceState }
  | { type: "welcome"; playerId: string }
  | { type: "toast"; message: string }
  | { type: "error"; message: string }
  | { type: "results"; result: RaceResult }
  | { type: "hello"; player: PlayerState };

interface SerializedRaceState extends Omit<RaceState, "players" | "objects"> {
  players: Array<[string, PlayerState]>;
  objects: Array<[string, RaceObject]>;
}

const MAX_RACERS = 4;
const MAX_SPECTATORS = 8;
const SIMULATION_HZ = 30;
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
const itemSlot = byId<HTMLElement>("item-slot");
const speedLabel = byId<HTMLElement>("speed");
const speedFill = byId<HTMLElement>("speed-fill");
const toast = byId<HTMLElement>("toast");
let game: RaceScene | null = null;
let localSessionId = "";
let hostMode = false;
let isHost = false;
let soloMode = false;
let peerClient: PeerClient | null = null;
let inputTimer = 0;
let simulationTimer = 0;
let toastTimer = 0;
let raceState: RaceState | null = null;
let peer: PeerConnection | null = null;
const peers = new Map<string, PeerConnection>();
const playerInputs = new Map<string, KartInput>();
const heldKeys = new Set<string>();
// Et kort tryk på mellemrum kan falde mellem to simuleringsskridt; derfor huskes det, til det er læst.
let itemPressed = false;

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
  return createPlayer(name, role, role === "racer" ? KART_COLORS[kartStyle] ?? KART_COLORS.lime : "#b7c0ba");
}

function readInput(): KartInput {
  return {
    throttle: heldKeys.has("KeyW") || heldKeys.has("ArrowUp"),
    brake: heldKeys.has("KeyS") || heldKeys.has("ArrowDown"),
    steer: heldKeys.has("KeyA") || heldKeys.has("ArrowLeft") ? -1 : heldKeys.has("KeyD") || heldKeys.has("ArrowRight") ? 1 : 0,
    drift: heldKeys.has("ShiftLeft") || heldKeys.has("ShiftRight"),
    useItem: heldKeys.has("Space") || itemPressed,
  };
}

function takeInput(): KartInput {
  const input = readInput();
  itemPressed = false;
  return input;
}

function serializeState(state: RaceState): SerializedRaceState {
  return {
    ...state,
    players: [...state.players.entries()].map(([id, player]) => [id, { ...player }]),
    objects: [...state.objects.entries()].map(([id, object]) => [id, { ...object }]),
  };
}

function deserializeState(state: SerializedRaceState): RaceState {
  return {
    ...state,
    players: new Map(state.players),
    objects: new Map(state.objects),
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
  const isLocalHost = localSessionId === state.hostId;
  const me = state.players.get(localSessionId);
  const racing = me?.role === "racer";

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
    return;
  }

  lobby.classList.add("hidden");
  raceHud.classList.remove("hidden");
  game?.updatePlayers(players, localSessionId);
  game?.updateObjects(state.objects.entries());
  lapElement.textContent = racing && me ? `${me.lap} / ${state.laps}` : "LIVE";
  const speed = Math.max(0, me?.speed ?? 0);
  speedLabel.textContent = racing ? `${Math.round((speed / BASE_SPEED) * 100)}` : "—";
  speedFill.style.width = `${Math.min(100, (speed / BOOST_SPEED) * 100)}%`;
  itemSlot.classList.toggle("hidden", !racing || !me?.item);
  if (me?.item) itemSlot.textContent = `${ITEM_NAMES[me.item]}${me.itemCount > 1 ? ` ×${me.itemCount}` : ""} · MELLEMRUM`;

  const prefix = state.timeTrial ? "TIDSKØRSEL · " : "";
  if (state.phase === "countdown") {
    raceStatus.textContent = `${prefix}STARTER OM ${Math.ceil(state.countdown)}`;
  } else if (state.phase === "racing") {
    let status = state.timeTrial ? `${state.elapsed.toFixed(1)} s` : `${me?.place ?? "–"}. PLADS`;
    if (me?.finished) status = "I MÅL";
    else if (me?.respawn) status = "SÆTTES TILBAGE PÅ BANEN";
    else if (me?.wrongWay) status = "⟲ FORKERT VEJ";
    else if (me?.offroad) status += " · I GRÆSSET";
    raceStatus.textContent = `${prefix}${status}`;
  } else {
    raceStatus.textContent = `${prefix}LØBET ER SLUT`;
  }
  raceStatus.classList.toggle("warning", state.phase === "racing" && Boolean(me?.wrongWay && !me.finished));
  renderStandings(racers);
}

function renderStandings(racers: Array<[string, PlayerState]>): void {
  const sorted = [...racers].sort(([, a], [, b]) => (a.place || 99) - (b.place || 99));
  standings.replaceChildren();
  sorted.forEach(([id, player], index) => {
    const row = document.createElement("div");
    row.className = "standing";
    const name = document.createElement("span");
    name.textContent = `${player.place || index + 1}. ${player.name}${id === localSessionId ? " (dig)" : ""}`;
    const distance = document.createElement("small");
    distance.textContent = player.finished ? "MÅL" : `OMG. ${player.lap}`;
    row.append(name, distance);
    standings.appendChild(row);
  });
  if (!sorted.length) {
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
  if (peers.size) broadcast({ type: "state", state: serializeState(raceState) });
  renderState(raceState);
}

function deliverEvents(events: RaceEvent[]): void {
  for (const event of events) {
    if (event.playerId === localSessionId) showToast(event.message);
    else {
      const recipient = peers.get(event.playerId);
      if (recipient) sendToPeer(recipient, { type: "toast", message: event.message });
    }
  }
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
      playerInputs.set(source.playerId, { ...IDLE_INPUT });
      sendToPeer(source, { type: "welcome", playerId: source.playerId });
      publishState();
      return;
    }
    if (message.type === "input") {
      const phase = raceState.phase;
      if (raceState.players.get(source.playerId)?.role === "racer" && (phase === "racing" || phase === "countdown")) {
        const input = message.input;
        playerInputs.set(source.playerId, {
          throttle: input?.throttle === true,
          brake: input?.brake === true,
          steer: input?.steer === -1 || input?.steer === 1 ? input.steer : 0,
          drift: input?.drift === true,
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
    raceState = createRaceState(localSessionId);
    const player = makePlayer(name, "racer", kartStyleInput.value);
    player.host = true;
    raceState.players.set(localSessionId, player);
    const url = `${window.location.origin}${window.location.pathname}?room=${encodeURIComponent(id)}`;
    inviteLink.textContent = url;
    inviteLink.setAttribute("href", url);
    showLobby();
    game = new RaceScene(document.body, localSessionId);
    renderState(raceState);
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
  raceState = createRaceState(roomId);
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

// Gæster sender deres taster til værten; værten læser sine egne direkte i updateRace.
function startInputUpdates(): void {
  window.clearInterval(inputTimer);
  inputTimer = window.setInterval(() => {
    if (!raceState || !peer || (raceState.phase !== "racing" && raceState.phase !== "countdown")) return;
    sendToPeer(peer, { type: "input", input: takeInput() });
  }, 50);
}

function startRace(): void {
  if (!raceState || !isHost || raceState.phase !== "lobby") return;
  prepareRace(raceState);
  for (const [id, player] of raceState.players) if (player.role === "racer") playerInputs.set(id, { ...IDLE_INPUT });
  resultsPanel.classList.add("hidden");
  window.clearInterval(simulationTimer);
  simulationTimer = window.setInterval(updateRace, 1000 / SIMULATION_HZ);
  publishState();
}

function finishRace(): void {
  if (!raceState) return;
  raceState.phase = "results";
  const racers = [...raceState.players.values()]
    .filter((player) => player.role === "racer")
    .sort((a, b) => a.place - b.place);
  for (const player of racers) player.speed = 0;
  const result = {
    players: racers.map((player) => ({
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
  if (state.players.get(localSessionId)?.role === "racer") playerInputs.set(localSessionId, takeInput());
  const { events, done } = stepRace(state, playerInputs, 1 / SIMULATION_HZ);
  deliverEvents(events);
  if (done) finishRace();
  else publishState();
}

function returnToLobby(): void {
  if (!raceState || !isHost || raceState.phase !== "results") return;
  resetToLobby(raceState);
  resultsPanel.classList.add("hidden");
  publishState();
}

// Solo er en tidskørsel: samme simulering som værten, bare uden netværk.
function startSoloTimeTrial(): void {
  const name = safeName();
  if (!name) {
    showError("Skriv et kaldenavn på 1–20 tegn.");
    nicknameInput.focus();
    return;
  }
  resetSession();
  soloMode = true;
  isHost = true;
  localSessionId = "solo-player";
  raceState = createRaceState(localSessionId);
  raceState.players.set(localSessionId, { ...makePlayer(name, "racer", kartStyleInput.value), host: true });
  showError("");
  showLobby();
  lobby.classList.add("hidden");
  raceHud.classList.remove("hidden");
  game = new RaceScene(document.body, localSessionId);
  startRace();
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
  if (event.code === "Space" && !event.repeat) itemPressed = true;
  heldKeys.add(event.code);
});
window.addEventListener("keyup", (event) => heldKeys.delete(event.code));
window.addEventListener("blur", () => heldKeys.clear());

// Kun i udvikling: giver automatiske browsertests adgang til løbstilstanden.
if (import.meta.env.DEV) Object.assign(window, { auRace: { state: () => raceState, me: () => localSessionId } });
