import { describe, expect, it } from "vitest";
import { roadHeightAt, terrainHeightAt } from "./terrain.js";
import { ROUTE_LENGTH, trackPosition } from "./track.js";

describe("terrain", () => {
  it("returns finite heights along the whole route", () => {
    for (let i = 0; i <= 200; i++) {
      const position = trackPosition(i / 200);
      expect(Number.isFinite(terrainHeightAt(position.x, position.z))).toBe(true);
      expect(Number.isFinite(roadHeightAt(i / 200))).toBe(true);
    }
  });

  it("keeps the road close to the terrain beneath it", () => {
    for (let i = 0; i < 100; i++) {
      const t = i / 100;
      const position = trackPosition(t);
      expect(Math.abs(terrainHeightAt(position.x, position.z) - roadHeightAt(t))).toBeLessThan(1.5);
    }
  });

  it("has a positive route length", () => {
    expect(ROUTE_LENGTH).toBeGreaterThan(0);
  });
});
