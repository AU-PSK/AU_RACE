import { campus, METERS_PER_UNIT } from "./campus-data.js";
import { terrain } from "./terrain-data.js";

// Terrænhøjde i spilenheder (y). Uden genererede højdedata (tools/terrain-data.mjs) er terrænet fladt.
// Højderne er DHM/Terræn omregnet til spilenheder uden overdrivelse og med rutens startpunkt som y = 0.
// Mod kanten af området glider højden mod 0, så terrænet møder det flade omland uden skel.

const MARGIN = 30;
const EDGE_FADE = 18;

function bounds(): { minX: number; maxX: number; minZ: number; maxZ: number } {
  if (terrain) {
    return {
      minX: terrain.x0,
      maxX: terrain.x0 + (terrain.cols - 1) * terrain.step,
      minZ: terrain.z0,
      maxZ: terrain.z0 + (terrain.rows - 1) * terrain.step,
    };
  }
  let minX = Infinity;
  let maxX = -Infinity;
  let minZ = Infinity;
  let maxZ = -Infinity;
  const add = (flat: readonly number[]): void => {
    for (let i = 0; i < flat.length; i += 2) {
      minX = Math.min(minX, flat[i]);
      maxX = Math.max(maxX, flat[i]);
      minZ = Math.min(minZ, flat[i + 1]);
      maxZ = Math.max(maxZ, flat[i + 1]);
    }
  };
  add(campus.route);
  for (const building of campus.buildings) add(building.p);
  for (const group of [campus.forests, campus.parks, campus.pitches, campus.water, campus.streams]) group.forEach(add);
  return { minX: minX - MARGIN, maxX: maxX + MARGIN, minZ: minZ - MARGIN, maxZ: maxZ + MARGIN };
}

export const terrainBounds = bounds();
/** Afstand mellem gitterpunkter i spilenheder; terrænmeshet bruger samme gitter som dataene. */
export const terrainStep = terrain ? terrain.step : 4;

const heights = ((): Float32Array | null => {
  if (!terrain) return null;
  const binary = atob(terrain.cm);
  const count = terrain.cols * terrain.rows;
  if (binary.length !== count * 2) throw new Error("Terrændata har forkert størrelse; kør tools/terrain-data.mjs igen.");
  const view = new DataView(new ArrayBuffer(binary.length));
  for (let i = 0; i < binary.length; i++) view.setUint8(i, binary.charCodeAt(i));
  const out = new Float32Array(count);
  for (let i = 0; i < count; i++) out[i] = (view.getInt16(i * 2, true) / 100 - terrain.baseM) / METERS_PER_UNIT;
  return out;
})();

function smoothstep(t: number): number {
  const c = Math.min(1, Math.max(0, t));
  return c * c * (3 - 2 * c);
}

export function terrainHeightAt(x: number, z: number): number {
  if (!terrain || !heights) return 0;
  const { cols, rows, step, x0, z0 } = terrain;
  const fi = Math.min(cols - 1, Math.max(0, (x - x0) / step));
  const fj = Math.min(rows - 1, Math.max(0, (z - z0) / step));
  const i = Math.min(cols - 2, Math.floor(fi));
  const j = Math.min(rows - 2, Math.floor(fj));
  const u = fi - i;
  const v = fj - j;
  const raw =
    heights[j * cols + i] * (1 - u) * (1 - v) +
    heights[j * cols + i + 1] * u * (1 - v) +
    heights[(j + 1) * cols + i] * (1 - u) * v +
    heights[(j + 1) * cols + i + 1] * u * v;
  const edge = Math.min(x - terrainBounds.minX, terrainBounds.maxX - x, z - terrainBounds.minZ, terrainBounds.maxZ - z);
  return raw * smoothstep(edge / EDGE_FADE);
}

export interface TerrainFrame {
  y: number;
  /** Positiv hvis terrænet stiger i kørselsretningen (løfter næsen). */
  pitch: number;
  /** Positiv hvis terrænet stiger mod højre. */
  roll: number;
}

const MAX_TILT = 0.5;

/** Højde og hældning under noget, der peger mod `heading` (som kartene: fremad er (−sin, −cos)). */
export function terrainFrame(x: number, z: number, heading: number, halfLength = 1.3, halfWidth = 1): TerrainFrame {
  if (!terrain) return { y: 0, pitch: 0, roll: 0 };
  const fx = -Math.sin(heading);
  const fz = -Math.cos(heading);
  const rx = Math.cos(heading);
  const rz = -Math.sin(heading);
  const front = terrainHeightAt(x + fx * halfLength, z + fz * halfLength);
  const back = terrainHeightAt(x - fx * halfLength, z - fz * halfLength);
  const right = terrainHeightAt(x + rx * halfWidth, z + rz * halfWidth);
  const left = terrainHeightAt(x - rx * halfWidth, z - rz * halfWidth);
  const clamp = (value: number): number => Math.max(-MAX_TILT, Math.min(MAX_TILT, value));
  return {
    y: (front + back + right + left) / 4,
    pitch: clamp(Math.atan2(front - back, 2 * halfLength)),
    roll: clamp(Math.atan2(right - left, 2 * halfWidth)),
  };
}

