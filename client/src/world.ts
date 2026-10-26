import * as THREE from "three";
import { campus } from "./campus-data.js";
import { route } from "./track.js";

// Den faste verden, som både simuleringen (kollisioner) og 3D-scenen (visning) bruger.

export interface Polygon {
  points: number[];
  minX: number;
  maxX: number;
  minZ: number;
  maxZ: number;
}

export interface Tree {
  x: number;
  z: number;
  scale: number;
  radius: number;
}

function toPolygon(flat: number[]): Polygon {
  const xs = flat.filter((_, i) => i % 2 === 0);
  const zs = flat.filter((_, i) => i % 2 === 1);
  return { points: flat, minX: Math.min(...xs), maxX: Math.max(...xs), minZ: Math.min(...zs), maxZ: Math.max(...zs) };
}

export const buildingColliders = campus.buildings.map((building) => toPolygon(building.p));
export const waterAreas = campus.water.map(toPolygon);

export function pointInPolygon(polygon: Polygon, x: number, z: number): boolean {
  if (x < polygon.minX || x > polygon.maxX || z < polygon.minZ || z > polygon.maxZ) return false;
  const flat = polygon.points;
  let result = false;
  for (let i = 0, j = flat.length - 2; i < flat.length; j = i, i += 2) {
    const [xi, zi, xj, zj] = [flat[i], flat[i + 1], flat[j], flat[j + 1]];
    if (zi > z !== zj > z && x < ((xj - xi) * (z - zi)) / (zj - zi) + xi) result = !result;
  }
  return result;
}

// Ruten samples tæt, så nærmeste punkt kan findes hurtigt uden at spørge kurven hver gang.
const ROUTE_SAMPLES = 1200;
const routeSamples = route.getSpacedPoints(ROUTE_SAMPLES).slice(0, ROUTE_SAMPLES);

export function routeFrame(t: number): { x: number; z: number; tx: number; tz: number } {
  const u = ((t % 1) + 1) % 1;
  const point = route.getPointAt(u);
  const tangent = route.getTangentAt(u);
  return { x: point.x, z: point.z, tx: tangent.x, tz: tangent.z };
}

// Nærmeste punkt på banens midterlinje. Med et hint søges kun lokalt, så et kart ikke
// "hopper" til en anden del af ruten, der tilfældigvis ligger tæt på.
export function nearestRouteT(x: number, z: number, hintT?: number): { t: number; distance: number } {
  const window = hintT === undefined ? ROUTE_SAMPLES : 70;
  const center = hintT === undefined ? 0 : Math.round((((hintT % 1) + 1) % 1) * ROUTE_SAMPLES);
  let best = 0;
  let bestDistance = Infinity;
  for (let offset = -window; offset <= window; offset++) {
    const index = (((center + offset) % ROUTE_SAMPLES) + ROUTE_SAMPLES) % ROUTE_SAMPLES;
    const point = routeSamples[index];
    const distance = (point.x - x) ** 2 + (point.z - z) ** 2;
    if (distance < bestDistance) [best, bestDistance] = [index, distance];
  }
  return { t: best / ROUTE_SAMPLES, distance: Math.sqrt(bestDistance) };
}

// Træer spredes deterministisk i skov og parker, men holdes væk fra banen.
function scatterTrees(): Tree[] {
  let seed = 4813;
  const random = () => {
    seed = (seed * 16807) % 2147483647;
    return (seed - 1) / 2147483646;
  };
  const trees: Tree[] = [];
  const scatter = (polygons: number[][], perUnit: number): void => {
    for (const polygon of polygons.map(toPolygon)) {
      const attempts = Math.ceil((polygon.maxX - polygon.minX) * (polygon.maxZ - polygon.minZ) * perUnit);
      for (let i = 0; i < attempts; i++) {
        const x = polygon.minX + random() * (polygon.maxX - polygon.minX);
        const z = polygon.minZ + random() * (polygon.maxZ - polygon.minZ);
        const scale = 0.8 + random() * 0.9;
        if (pointInPolygon(polygon, x, z) && nearestRouteT(x, z).distance > 6.5) {
          trees.push({ x, z, scale, radius: 0.45 * scale });
        }
      }
    }
  };
  scatter(campus.forests, 0.07);
  scatter(campus.parks, 0.012);
  return trees;
}

export const trees = scatterTrees();

// Skubber en cirkel ud af bygninger og træer. Returnerer den rettede position, og om den ramte noget.
export function resolveWorldCollision(x: number, z: number, radius: number): { x: number; z: number; hit: boolean } {
  let hit = false;
  for (const tree of trees) {
    const dx = x - tree.x;
    const dz = z - tree.z;
    const min = radius + tree.radius;
    if (Math.abs(dx) > min || Math.abs(dz) > min) continue;
    const distance = Math.hypot(dx, dz);
    if (distance < min && distance > 1e-6) {
      x = tree.x + (dx / distance) * min;
      z = tree.z + (dz / distance) * min;
      hit = true;
    }
  }
  for (const polygon of buildingColliders) {
    if (x < polygon.minX - radius || x > polygon.maxX + radius || z < polygon.minZ - radius || z > polygon.maxZ + radius) continue;
    const flat = polygon.points;
    let nearestX = x;
    let nearestZ = z;
    let nearestDistance = Infinity;
    for (let i = 0, j = flat.length - 2; i < flat.length; j = i, i += 2) {
      const [ax, az, bx, bz] = [flat[j], flat[j + 1], flat[i], flat[i + 1]];
      const lengthSq = (bx - ax) ** 2 + (bz - az) ** 2 || 1;
      const t = Math.max(0, Math.min(1, ((x - ax) * (bx - ax) + (z - az) * (bz - az)) / lengthSq));
      const px = ax + t * (bx - ax);
      const pz = az + t * (bz - az);
      const distance = Math.hypot(x - px, z - pz);
      if (distance < nearestDistance) [nearestX, nearestZ, nearestDistance] = [px, pz, distance];
    }
    const inside = pointInPolygon(polygon, x, z);
    if (!inside && nearestDistance >= radius) continue;
    // Udefra skubbes væk fra kanten; indefra skubbes gennem kanten og ud på den anden side.
    const direction = new THREE.Vector2(x - nearestX, z - nearestZ);
    if (direction.lengthSq() < 1e-9) continue;
    direction.normalize().multiplyScalar(inside ? -radius : radius);
    x = nearestX + direction.x;
    z = nearestZ + direction.y;
    hit = true;
  }
  return { x, z, hit };
}
