import { describe, expect, it } from "vitest";
import { IDLE_INPUT, MAX_RACERS, addBots, createPlayer, createRaceState, prepareRace, resetToLobby, stepRace, type KartInput } from "./race.js";

function lobbyWith(...names: string[]) {
  const state = createRaceState("host");
  names.forEach((name, index) => state.players.set(index === 0 ? "host" : `p${index}`, createPlayer(name, "racer", "#8fe03c")));
  return state;
}

describe("race setup", () => {
  it("treats a single racer as a time trial with coffee boosts and no item boxes", () => {
    const state = lobbyWith("Solo");
    prepareRace(state);
    const solo = state.players.get("host")!;
    expect(state.timeTrial).toBe(true);
    expect(solo.item).toBe("coffee");
    expect(solo.itemCount).toBe(3);
    expect([...state.objects.values()].some((object) => object.kind === "box")).toBe(false);
    expect([...state.objects.values()].some((object) => object.kind === "pad")).toBe(true);
  });

  it("adds item boxes when several racers start", () => {
    const state = lobbyWith("A", "B");
    prepareRace(state);
    expect(state.timeTrial).toBe(false);
    expect([...state.objects.values()].some((object) => object.kind === "box")).toBe(true);
    expect(state.phase).toBe("countdown");
  });

  it("fills the grid with bots up to MAX_RACERS and removes them again in the lobby", () => {
    const state = lobbyWith("A");
    addBots(state);
    expect([...state.players.values()].filter((player) => player.role === "racer")).toHaveLength(MAX_RACERS);
    resetToLobby(state);
    expect([...state.players.values()].some((player) => player.bot)).toBe(false);
    expect(state.phase).toBe("lobby");
  });

  it("does not count spectators towards the grid", () => {
    const state = lobbyWith("A");
    state.players.set("watcher", createPlayer("Watcher", "spectator", "#fff"));
    addBots(state);
    expect(state.players.size).toBe(MAX_RACERS + 1);
  });
});

describe("race simulation", () => {
  const throttle: KartInput = { ...IDLE_INPUT, throttle: true };

  it("starts racing after the countdown and moves a throttling kart forward", () => {
    const state = lobbyWith("A", "B");
    prepareRace(state);
    const inputs = new Map<string, KartInput>([["host", throttle]]);
    for (let i = 0; i < 30 * 3.1; i++) stepRace(state, inputs, 1 / 30);
    expect(state.phase).toBe("racing");
    const before = state.players.get("host")!.progress;
    for (let i = 0; i < 60; i++) stepRace(state, inputs, 1 / 30);
    const after = state.players.get("host")!;
    expect(after.speed).toBeGreaterThan(0);
    expect(after.progress).toBeGreaterThan(before);
    expect(Number.isFinite(after.x) && Number.isFinite(after.z)).toBe(true);
  });

  it("leaves an idle kart standing still", () => {
    const state = lobbyWith("A", "B");
    prepareRace(state);
    const inputs = new Map<string, KartInput>();
    for (let i = 0; i < 30 * 5; i++) stepRace(state, inputs, 1 / 30);
    expect(state.players.get("host")!.speed).toBeCloseTo(0, 1);
  });

  it("keeps bots racing without producing NaN state", () => {
    const state = lobbyWith("A");
    addBots(state);
    prepareRace(state);
    for (let i = 0; i < 30 * 20; i++) stepRace(state, new Map(), 1 / 30);
    for (const player of state.players.values()) {
      expect(Number.isFinite(player.x)).toBe(true);
      expect(Number.isFinite(player.z)).toBe(true);
      expect(Number.isFinite(player.progress)).toBe(true);
    }
    expect([...state.players.values()].some((player) => player.bot && player.progress > -0.99)).toBe(true);
  });
});
