import * as THREE from "three";
import { describe, expect, it } from "vitest";
import { mergeByMaterial } from "./geometry.js";

function extruded(size: number): THREE.ExtrudeGeometry {
  const shape = new THREE.Shape([new THREE.Vector2(0, 0), new THREE.Vector2(size, 0), new THREE.Vector2(size, size), new THREE.Vector2(0, size)]);
  return new THREE.ExtrudeGeometry(shape, { depth: 3, bevelEnabled: false });
}

describe("mergeByMaterial", () => {
  it("keeps exactly one group per material and every vertex covered", () => {
    const sources = [extruded(2), extruded(3), extruded(4), extruded(5)];
    const vertices = sources.reduce((sum, geometry) => sum + geometry.getAttribute("position").count, 0);
    const merged = mergeByMaterial(sources, 2)!;
    expect(merged.groups.map((group) => group.materialIndex)).toEqual([0, 1]);
    expect(merged.groups.reduce((sum, group) => sum + group.count, 0)).toBe(vertices);
    expect(merged.getAttribute("position").count).toBe(vertices);
  });
});
