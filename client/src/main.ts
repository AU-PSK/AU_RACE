import { Client, type Room } from "@colyseus/sdk";
import { RaceScene, type PickupView, type PlayerView } from "./game.js";
import "./style.css";

interface PlayerState extends PlayerView {}

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
  players: Array<{
    name: string;
    place: number;
    finished: boolean;
    finishTime: number;
  }>;
}

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
const joinButton = byId<HTMLButtonElement>("join-button");
const startButton = byId<HTMLButtonElement>("start-button");
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

const serverUrl =
  import.meta.env.VITE_GAME_SERVER_URL ??
  (window.location.hostname === "localhost" || window.location.hostname === "127.0.0.1"
    ? "ws://127.0.0.1:2567"
    : `${window.location.protocol === "https:" ? "wss" : "ws"}://${window.location.host}`);
const client = new Client(serverUrl);

let room: Room<RaceState> | null = null;
let game: RaceScene | null = null;
let localSessionId = "";
let inputTimer = 0;
let toastTimer = 0;
const heldKeys = new Set<string>();

const joinedRoomFromUrl = new URLSearchParams(window.location.search).get("room");
if (joinedRoomFromUrl) roomIdInput.value = joinedRoomFromUrl;

function showError(message: string): void {
  errorElement.textContent = message;
}

function messageFromError(error: unknown): string {
  if (error instanceof Error && error.message) return error.message;
  return "Forbindelsen kunne ikke oprettes. Kontrollér serveren, og prøv igen.";
}

function roomIdFromInput(value: string): string {
  const trimmed = value.trim();
  if (!trimmed) return "";
  try {
    const url = new URL(trimmed);
    return url.searchParams.get("room") ?? trimmed;
  } catch {
    return trimmed;
  }
}

async function connect(create: boolean): Promise<void> {
  const name = nicknameInput.value.trim().replace(/\s+/g, " ").slice(0, 20);
  if (!name) {
    showError("Skriv et kaldenavn på 1–20 tegn.");
    nicknameInput.focus();
    return;
  }
  const role = roleInput.value === "spectator" ? "spectator" : "racer";
  const roomId = roomIdFromInput(roomIdInput.value);
  if (!create && !roomId) {
    showError("Indsæt et invitationslink eller en rumkode.");
    roomIdInput.focus();
    return;
  }

  createButton.disabled = true;
  joinButton.disabled = true;
  showError("");
  try {
    room = create
      ? await client.create<RaceState>("race", { name, role, kartStyle: kartStyleInput.value })
      : await client.joinById<RaceState>(roomId, { name, role, kartStyle: kartStyleInput.value });
    localSessionId = room.sessionId;
    window.history.replaceState({}, "", `${window.location.pathname}?room=${encodeURIComponent(room.roomId)}`);
    inviteLink.textContent = `${window.location.origin}${window.location.pathname}?room=${room.roomId}`;
    menu.classList.add("hidden");
    lobby.classList.remove("hidden");
    lobbyStatus.textContent =
      role === "spectator"
        ? "Du er tilskuer og kan følge løbet live."
        : "Du kan starte en tidskørsel alene eller invitere andre til løbet.";
    game = new RaceScene(document.body, localSessionId);

    room.onStateChange((state) => renderState(state));
    room.onMessage("error", (payload: { message?: string }) => {
      showToast(payload?.message ?? "Handlingen kunne ikke udføres.");
    });
    room.onMessage("toast", (payload: { sessionId: string; message: string }) => {
      if (payload.sessionId === localSessionId) showToast(payload.message);
    });
    room.onMessage("results", (payload: RaceResult) => renderResults(payload));
    room.onLeave((code) => {
      if (room) void leaveRoom(false, code === 1000 ? "" : "Forbindelsen til løbet blev afbrudt.");
    });
    renderState(room.state);
    startInputUpdates();
  } catch (error) {
    room = null;
    createButton.disabled = false;
    joinButton.disabled = false;
    showError(messageFromError(error));
  }
}

function renderState(state: RaceState): void {
  if (!room) return;
  const players = [...state.players.entries()];
  const racers = players.filter(([, player]) => player.role === "racer");
  const spectators = players.filter(([, player]) => player.role === "spectator");
  const isHost = localSessionId === state.hostId;
  const me = state.players.get(localSessionId);

  playersList.replaceChildren();
  for (const [id, player] of players) {
    const item = document.createElement("li");
    const name = document.createElement("span");
    name.textContent = player.name;
    if (id === state.hostId) name.textContent += " ★";
    const role = document.createElement("span");
    role.className = "player-role";
    role.textContent = player.role === "racer" ? "RACER" : "TILSKUER";
    item.append(name, role);
    playersList.appendChild(item);
  }

  startButton.classList.toggle("hidden", !isHost);
  startButton.disabled = racers.length === 0 || state.phase !== "lobby";
  startButton.textContent = racers.length === 1 ? "Start tidskørsel" : "Start løb";
  returnButton.classList.toggle("hidden", !isHost);
  if (state.phase === "lobby") {
    menu.classList.add("hidden");
    lobby.classList.remove("hidden");
    raceHud.classList.add("hidden");
    lobbyStatus.textContent = racers.length === 0
      ? "Der skal være mindst én racer for at starte. Du kan også køre alene på tid."
      : racers.length === 1
        ? `Tidskørsel klar · ${spectators.length}/8 tilskuere. Invitér andre for at køre mod dem.`
        : `${racers.length}/4 racere og ${spectators.length}/8 tilskuere er klar.`;
  } else {
    lobby.classList.add("hidden");
    raceHud.classList.remove("hidden");
    game?.updatePlayers(players);
    game?.updatePickups(state.pickups.entries());
    lapElement.textContent = me?.role === "spectator"
      ? "LIVE"
      : `${me?.lap ?? 0} / ${state.laps}`;
    speedLabel.textContent = me?.role === "spectator"
      ? "—"
      : `${Math.round((me?.speed ?? 0) * 100)}`;
    speedFill.style.width = `${Math.min(100, ((me?.speed ?? 0) / 1.35) * 100)}%`;
    if (state.phase === "countdown") {
      raceStatus.textContent = racers.length === 1
        ? `TIDSKØRSEL · STARTER OM ${state.countdown}`
        : `STARTER OM ${state.countdown}`;
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

function showToast(message: string): void {
  toast.textContent = message;
  toast.classList.remove("hidden");
  window.clearTimeout(toastTimer);
  toastTimer = window.setTimeout(() => toast.classList.add("hidden"), 3200);
}

function startInputUpdates(): void {
  window.clearInterval(inputTimer);
  inputTimer = window.setInterval(() => {
    if (!room || room.state.phase !== "racing") return;
    room.send("input", {
      throttle: heldKeys.has("KeyW") || heldKeys.has("ArrowUp"),
      brake: heldKeys.has("KeyS") || heldKeys.has("ArrowDown"),
      steer:
        heldKeys.has("KeyA") || heldKeys.has("ArrowLeft")
          ? -1
          : heldKeys.has("KeyD") || heldKeys.has("ArrowRight")
            ? 1
            : 0,
      useItem: heldKeys.has("Space"),
    });
  }, 50);
}

async function leaveRoom(showDisconnectError = false, disconnectMessage = ""): Promise<void> {
  window.clearInterval(inputTimer);
  heldKeys.clear();
  const activeRoom = room;
  room = null;
  if (activeRoom && showDisconnectError) await activeRoom.leave();
  localSessionId = "";
  game?.dispose();
  game = null;
  lobby.classList.add("hidden");
  raceHud.classList.add("hidden");
  resultsPanel.classList.add("hidden");
  menu.classList.remove("hidden");
  createButton.disabled = false;
  joinButton.disabled = false;
  window.history.replaceState({}, "", window.location.pathname);
  if (disconnectMessage) showError(disconnectMessage);
}

byId<HTMLFormElement>("join-form").addEventListener("submit", (event) => {
  event.preventDefault();
  void connect(true);
});

joinButton.addEventListener("click", () => void connect(false));
startButton.addEventListener("click", () => room?.send("start"));
byId<HTMLButtonElement>("leave-button").addEventListener("click", () => void leaveRoom(true));
returnButton.addEventListener("click", () => {
  resultsPanel.classList.add("hidden");
  room?.send("returnToLobby");
});

byId<HTMLButtonElement>("copy-link").addEventListener("click", async () => {
  try {
    await navigator.clipboard.writeText(inviteLink.textContent ?? "");
    showToast("Invitationslink kopieret.");
  } catch {
    showToast("Kopiér linket manuelt fra feltet.");
  }
});

window.addEventListener("keydown", (event) => {
  const target = event.target;
  if (target instanceof HTMLInputElement || target instanceof HTMLSelectElement) return;
  if (["ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight", "Space"].includes(event.code)) event.preventDefault();
  heldKeys.add(event.code);
});

window.addEventListener("keyup", (event) => heldKeys.delete(event.code));
window.addEventListener("blur", () => heldKeys.clear());
