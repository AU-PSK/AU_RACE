import { describe, expect, it } from "vitest";
import { INSTITUTES, instituteById, playerLabel } from "./institutes.js";

describe("institutes", () => {
  it("gives every institute its own kart color", () => {
    expect(new Set(INSTITUTES.map((institute) => institute.color)).size).toBe(INSTITUTES.length);
  });

  it("appends the institute to the player name and ignores unknown ids", () => {
    expect(playerLabel({ name: "Anna", institute: "biomedicin" })).toBe("Anna · Biomedicin");
    expect(playerLabel({ name: "Anna", institute: "ukendt" })).toBe("Anna");
    expect(playerLabel({ name: "Anna" })).toBe("Anna");
    expect(instituteById(42)).toBeUndefined();
  });
});
