// Omsætter OpenStreetMap-data (se fetch-osm.mjs) til client/src/campus-data.ts.
// Brug: node tools/build-campus.mjs <roads.json> <area.json> <client/src/campus-data.ts>
// Data © OpenStreetMap-bidragsydere, ODbL.
import { readFile, writeFile } from "node:fs/promises";

const METERS_PER_UNIT = 4;
const ROUTE_CLEARANCE = 3.8; // bygninger tættere på banen end dette (spilenheder) fjernes
const SIMPLIFY_METERS = 4;
const MAX_LABELS = 14;

// Rækkefølgen følger den ønskede rute: Bartholins Allé → Wilhelm Meyers Allé →
// Ole Worms Allé → Karl Verners Vej → Victor Albecks Vej → tilbage til start.
const WAY_ORDER = [
  1108152805, 1108152953, 1108153019, 1108153179, 1108153372, 1108153634,
  146224573,
  23346162,
  23346455, 961345831, 884315386,
  1108149903, 1108150006, 1108152295, 1108152418,
];

const [roadsPath, areaPath, outPath] = process.argv.slice(2);
if (!roadsPath || !areaPath || !outPath) throw new Error("Brug: build-campus.mjs <roads.json> <area.json> <ud.ts>");
const roads = JSON.parse(await readFile(roadsPath, "utf8")).elements;
const area = JSON.parse(await readFile(areaPath, "utf8")).elements;

// Projektion: lokal flad kort omkring midten af ruten; nord er -z.
const roadsById = new Map(roads.map((way) => [way.id, way.geometry]));
const lats = [...roadsById.values()].flat().map((p) => p.lat);
const lons = [...roadsById.values()].flat().map((p) => p.lon);
const lat0 = (Math.min(...lats) + Math.max(...lats)) / 2;
const lon0 = (Math.min(...lons) + Math.max(...lons)) / 2;
const mPerLat = 111_132;
const mPerLon = 111_320 * Math.cos((lat0 * Math.PI) / 180);
const project = (p) => [((p.lon - lon0) * mPerLon) / METERS_PER_UNIT, (-(p.lat - lat0) * mPerLat) / METERS_PER_UNIT];
const dist = (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1]);

// Sammensæt vejstykkerne til én lukket kurve; huller på få meter lukkes med en ret linje.
const path = [];
for (const id of WAY_ORDER) {
  const geometry = roadsById.get(id);
  if (!geometry) throw new Error(`Mangler vej ${id}`);
  let points = geometry.map(project);
  const end = path[path.length - 1];
  if (end && dist(end, points[0]) > dist(end, points[points.length - 1])) points = points.reverse();
  for (const point of points) if (!end || dist(path[path.length - 1], point) > 1e-6) path.push(point);
}

function simplify(points, tolerance) {
  if (points.length < 3) return points;
  const [a, b] = [points[0], points[points.length - 1]];
  let index = 0;
  let max = 0;
  for (let i = 1; i < points.length - 1; i++) {
    const [px, pz] = points[i];
    const length = dist(a, b) || 1;
    const d = Math.abs((b[0] - a[0]) * (a[1] - pz) - (a[0] - px) * (b[1] - a[1])) / length;
    if (d > max) [max, index] = [d, i];
  }
  if (max <= tolerance) return [a, b];
  return [...simplify(points.slice(0, index + 1), tolerance).slice(0, -1), ...simplify(points.slice(index), tolerance)];
}
// Kurven er lukket, så den deles ved det fjerneste punkt; ellers har simplify ingen basislinje.
if (dist(path[0], path[path.length - 1]) < 1e-6) path.pop();
const far = path.reduce((best, p, i) => (dist(p, path[0]) > dist(path[best], path[0]) ? i : best), 0);
const route = [
  ...simplify(path.slice(0, far + 1), SIMPLIFY_METERS / METERS_PER_UNIT).slice(0, -1),
  ...simplify([...path.slice(far), path[0]], SIMPLIFY_METERS / METERS_PER_UNIT).slice(0, -1),
];

// Banen skal være en enkelt kurve uden selvskæringer, og dens længde bruges til at skalere farten.
const segments = route.map((point, i) => [point, route[(i + 1) % route.length]]);
const cross = (a, b, c) => (b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0]);
for (let i = 0; i < segments.length; i++) {
  for (let j = i + 2; j < segments.length; j++) {
    if (i === 0 && j === segments.length - 1) continue;
    const [a, b] = segments[i];
    const [c, d] = segments[j];
    if (cross(a, b, c) * cross(a, b, d) < 0 && cross(c, d, a) * cross(c, d, b) < 0) {
      throw new Error(`Banen skærer sig selv ved segment ${i} og ${j}`);
    }
  }
}

// Afstand fra et punkt til banens midterlinje.
function distanceToRoute(point) {
  let best = Infinity;
  for (const [a, b] of segments) {
    const dx = b[0] - a[0];
    const dz = b[1] - a[1];
    const t = Math.max(0, Math.min(1, ((point[0] - a[0]) * dx + (point[1] - a[1]) * dz) / (dx * dx + dz * dz)));
    best = Math.min(best, Math.hypot(point[0] - (a[0] + t * dx), point[1] - (a[1] + t * dz)));
  }
  return best;
}

const round = (value) => Math.round(value * 10) / 10;
const flat = (points) => points.flatMap(([x, z]) => [round(x), round(z)]);
const ring = (way) => {
  const points = way.geometry.map(project);
  if (dist(points[0], points[points.length - 1]) < 1e-6) points.pop();
  return points;
};
const area2 = (points) =>
  Math.abs(points.reduce((sum, p, i) => sum + p[0] * points[(i + 1) % points.length][1] - points[(i + 1) % points.length][0] * p[1], 0)) / 2;
// Tæt prøvetagning af omridset, så en bygning, der kun rammer banen midt på en kant, også fanges.
const nearRoute = (points) =>
  points.some((p, i) => {
    const q = points[(i + 1) % points.length];
    for (let s = 0; s <= 4; s++) {
      if (distanceToRoute([p[0] + ((q[0] - p[0]) * s) / 4, p[1] + ((q[1] - p[1]) * s) / 4]) < ROUTE_CLEARANCE) return true;
    }
    return false;
  });

const buildings = [];
for (const way of area.filter((w) => w.tags?.building && w.geometry.length >= 4)) {
  const points = ring(way);
  if (nearRoute(points)) continue;
  const levels = Number(way.tags["building:levels"]);
  const meters = Number(way.tags.height);
  const height = Number.isFinite(meters) && meters > 0 ? meters : (Number.isFinite(levels) && levels > 0 ? levels : 2) * 3.3 + 0.8;
  buildings.push({ name: way.tags.name ?? "", height: round(height / METERS_PER_UNIT * 1.25), size: area2(points), points: flat(points) });
}
const labelNames = new Set(
  buildings.filter((b) => b.name).sort((a, b) => b.size - a.size).slice(0, MAX_LABELS).map((b) => b.name),
);
const buildingData = buildings.map((b) => ({
  h: b.height,
  p: b.points,
  ...(labelNames.has(b.name) ? { n: b.name } : {}),
}));

const polygons = (predicate) => area.filter((w) => w.geometry.length >= 4 && predicate(w.tags ?? {})).map((w) => flat(ring(w)));
const forests = polygons((t) => t.landuse === "forest" || t.natural === "wood");
const parks = polygons((t) => t.leisure === "park" || t.leisure === "garden");
const pitches = polygons((t) => t.leisure === "pitch");
const water = polygons((t) => t.natural === "water");
const streams = area.filter((w) => w.tags?.waterway).map((w) => flat(w.geometry.map(project)));

const data = {
  route: flat(route),
  buildings: buildingData,
  forests,
  parks,
  pitches,
  water,
  streams,
};
const source = `// Genereret af tools/build-campus.mjs. Ret ikke i hånden; kør generatoren igen.
// Kortdata © OpenStreetMap-bidragsydere (ODbL, https://www.openstreetmap.org/copyright).
// 1 spilenhed = ${METERS_PER_UNIT} m; nord er -z. Polygoner og kurver er flade lister [x, z, x, z, …].
export const METERS_PER_UNIT = ${METERS_PER_UNIT};
export interface CampusBuilding {
  h: number;
  p: number[];
  n?: string;
}
export interface Campus {
  route: number[];
  buildings: CampusBuilding[];
  forests: number[][];
  parks: number[][];
  pitches: number[][];
  water: number[][];
  streams: number[][];
}
export const campus: Campus = ${JSON.stringify(data)};
`;
await writeFile(outPath, source);
const routeLength = segments.reduce((sum, [a, b]) => sum + dist(a, b), 0);
console.log(
  `Rute: ${route.length} punkter, ca. ${Math.round(routeLength)} enheder (${Math.round(routeLength * METERS_PER_UNIT)} m). ` +
    `Bygninger: ${buildingData.length} (${buildings.length} efter filter, ${area.filter((w) => w.tags?.building).length} i alt), ` +
    `skov ${forests.length}, parker ${parks.length}, vand ${water.length}, bække ${streams.length}, navne ${labelNames.size}`,
);
