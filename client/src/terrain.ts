import { campus, METERS_PER_UNIT } from "./campus-data.js";
import { terrain } from "./terrain-data.js";
import { ROUTE_LENGTH, route, TRACK_WIDTH } from "./track.js";

// Terrænhøjde i spilenheder (y). Uden genererede højdedata (tools/terrain-data.mjs) er terrænet fladt.
// Højderne er DHM/Terræn omregnet til spilenheder med rutens startpunkt som y = 0 og ganget med
// HEIGHT_EXAGGERATION: banens reelle relief (ca. 14 m) er ellers for lille til at kunne ses i et kartspil.
// Mod kanten af området glider højden mod 0, så terrænet møder det flade omland uden skel.
// Vejen er indlagt i terrænet (se "Vejens højdeprofil" nedenfor).

const MARGIN = 30;
const EDGE_FADE = 18;
const HEIGHT_EXAGGERATION = 3;

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
  for (let i = 0; i < count; i++) out[i] = (view.getInt16(i * 2, true) / 100 - terrain.baseM) * HEIGHT_EXAGGERATION / METERS_PER_UNIT;
  return out;
})();

function smoothstep(t: number): number {
  const c = Math.min(1, Math.max(0, t));
  return c * c * (3 - 2 * c);
}

/** Terrænets rå højde fra højdedataene, uden vejens udgravning. */
export function rawTerrainHeightAt(x: number, z: number): number {
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

// Vejens højdeprofil: terrænets højde langs midterlinjen, udglattet så vejen er jævn. Vejen er flad på tværs,
// og terrænet graves eller fyldes op til den med en blød skråning, så karts og kamera aldrig ser terrænet
// stikke op gennem vejen (eller vejen svæve over det).
const ROAD_STEP = 0.5;
const ROAD_SMOOTH_RADIUS = 6;
const ROAD_FULL_WIDTH = TRACK_WIDTH / 2 + 0.9 + 1;
const ROAD_SLOPE_WIDTH = 7;
const ROAD_INFLUENCE = ROAD_FULL_WIDTH + ROAD_SLOPE_WIDTH;
const ROAD_CELL = 16;

const roadCount = Math.max(8, Math.round(ROUTE_LENGTH / ROAD_STEP));
const roadX = new Float32Array(roadCount);
const roadZ = new Float32Array(roadCount);
const roadY = new Float32Array(roadCount);
const roadGrid = new Map<number, number[]>();

function smoothClosed(values: Float32Array, radius: number): Float32Array {
  const count = values.length;
  const out = new Float32Array(count);
  for (let i = 0; i < count; i++) {
    let sum = 0;
    for (let k = -radius; k <= radius; k++) sum += values[(((i + k) % count) + count) % count];
    out[i] = sum / (2 * radius + 1);
  }
  return out;
}

if (terrain) {
  for (let i = 0; i < roadCount; i++) {
    const point = route.getPointAt(i / roadCount);
    roadX[i] = point.x;
    roadZ[i] = point.z;
    roadY[i] = rawTerrainHeightAt(point.x, point.z);
  }
  const radius = Math.max(1, Math.round(ROAD_SMOOTH_RADIUS / ROAD_STEP));
  roadY.set(smoothClosed(smoothClosed(roadY, radius), radius));
  const cellOf = (value: number): number => Math.floor(value / ROAD_CELL);
  for (let i = 0; i < roadCount; i++) {
    const j = (i + 1) % roadCount;
    const x0 = cellOf(Math.min(roadX[i], roadX[j]) - ROAD_INFLUENCE);
    const x1 = cellOf(Math.max(roadX[i], roadX[j]) + ROAD_INFLUENCE);
    const z0 = cellOf(Math.min(roadZ[i], roadZ[j]) - ROAD_INFLUENCE);
    const z1 = cellOf(Math.max(roadZ[i], roadZ[j]) + ROAD_INFLUENCE);
    for (let cx = x0; cx <= x1; cx++) {
      for (let cz = z0; cz <= z1; cz++) {
        const key = cx * 65536 + cz;
        const list = roadGrid.get(key);
        if (list) list.push(i);
        else roadGrid.set(key, [i]);
      }
    }
  }
}

/** Vejens højde ved rutens position t (0–1, cyklisk). */
export function roadHeightAt(t: number): number {
  if (!terrain) return 0;
  const f = (((t % 1) + 1) % 1) * roadCount;
  const i = Math.floor(f) % roadCount;
  const u = f - Math.floor(f);
  return roadY[i] * (1 - u) + roadY[(i + 1) % roadCount] * u;
}

// Rutens strækninger, der ligger mere end SECTION_GAP prøver fra hinanden langs ruten, regnes for forskellige
// veje (fx to baner side om side i hver sin højde); deres skråninger blandes i stedet for at skifte brat.
const SECTION_GAP = Math.round(20 / ROAD_STEP);
let projectedSq = 0;
let projectedY = 0;

function project(i: number, x: number, z: number): void {
  const j = (i + 1) % roadCount;
  const dx = roadX[j] - roadX[i];
  const dz = roadZ[j] - roadZ[i];
  const u = Math.max(0, Math.min(1, ((x - roadX[i]) * dx + (z - roadZ[i]) * dz) / (dx * dx + dz * dz || 1)));
  const px = roadX[i] + dx * u - x;
  const pz = roadZ[i] + dz * u - z;
  projectedSq = px * px + pz * pz;
  projectedY = roadY[i] * (1 - u) + roadY[j] * u;
}

function roadWeight(distance: number): number {
  return 1 - smoothstep((distance - ROAD_FULL_WIDTH) / ROAD_SLOPE_WIDTH);
}

/** Hvor meget vejen styrer terrænet i et punkt: 1 på vejen og kantstenen, aftagende mod 0 ud over skråningen. */
export function roadWeightAt(x: number, z: number): number {
  if (!terrain) return 0;
  const list = roadGrid.get(Math.floor(x / ROAD_CELL) * 65536 + Math.floor(z / ROAD_CELL));
  if (!list) return 0;
  let nearestSq = ROAD_INFLUENCE * ROAD_INFLUENCE;
  for (const i of list) {
    project(i, x, z);
    if (projectedSq < nearestSq) nearestSq = projectedSq;
  }
  return nearestSq >= ROAD_INFLUENCE * ROAD_INFLUENCE ? 0 : roadWeight(Math.sqrt(nearestSq));
}

/** Terrænhøjde med vejen indlagt: flad vej og en blød skråning ud til det rå terræn. */
export function terrainHeightAt(x: number, z: number): number {
  const raw = rawTerrainHeightAt(x, z);
  if (!terrain) return raw;
  const list = roadGrid.get(Math.floor(x / ROAD_CELL) * 65536 + Math.floor(z / ROAD_CELL));
  if (!list) return raw;
  let nearest = -1;
  let nearestSq = ROAD_INFLUENCE * ROAD_INFLUENCE;
  let nearestY = 0;
  for (const i of list) {
    project(i, x, z);
    if (projectedSq < nearestSq) [nearest, nearestSq, nearestY] = [i, projectedSq, projectedY];
  }
  if (nearest < 0) return raw;
  const w1 = roadWeight(Math.sqrt(nearestSq));
  if (w1 >= 1) return nearestY;
  let otherSq = ROAD_INFLUENCE * ROAD_INFLUENCE;
  let otherY = 0;
  for (const i of list) {
    const gap = Math.abs(i - nearest);
    if (Math.min(gap, roadCount - gap) < SECTION_GAP) continue;
    project(i, x, z);
    if (projectedSq < otherSq) [otherSq, otherY] = [projectedSq, projectedY];
  }
  if (otherSq >= ROAD_INFLUENCE * ROAD_INFLUENCE) return raw + (nearestY - raw) * w1;
  const w2 = roadWeight(Math.sqrt(otherSq));
  // Blandingen vejer efter nærhed; vejfladen selv (w1 = 1) forbliver flad.
  const pull = 1 - (1 - w1) * (1 - w2);
  return raw + (((nearestY - raw) * w1 + (otherY - raw) * w2) / (w1 + w2)) * pull;
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
    y: Math.max((front + back + right + left) / 4, terrainHeightAt(x, z)),
    pitch: clamp(Math.atan2(front - back, 2 * halfLength)),
    roll: clamp(Math.atan2(right - left, 2 * halfWidth)),
  };
}

