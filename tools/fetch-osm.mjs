// Henter vejene og omgivelserne omkring Universitetsparken fra OpenStreetMap (Overpass API).
// Data © OpenStreetMap-bidragsydere, ODbL. Brug: node tools/fetch-osm.mjs <output-mappe>
import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";

const endpoint = "https://overpass-api.de/api/interpreter";
const userAgent = "au-race-prototype/1.0 (github.com/AU-PSK/AU_RACE)";
const loopBox = "56.158,10.185,56.18,10.22";
const areaBox = "56.1655,10.1960,56.1725,10.2095";

const queries = {
  "roads.json": `[out:json][timeout:60];
way["name"~"^(Bartholins Allé|Wilhelm Meyers Allé|Ole Worms Allé|Karl Verners Vej|Victor Albecks Vej)$"](${loopBox});
out geom;`,
  "area.json": `[out:json][timeout:60];
(
  way["building"](${areaBox});
  way["natural"="water"](${areaBox});
  way["waterway"](${areaBox});
  way["leisure"~"^(park|pitch|garden)$"](${areaBox});
  way["landuse"="forest"](${areaBox});
  way["natural"="wood"](${areaBox});
);
out geom;`,
};

async function fetchWithBackoff(query) {
  for (let attempt = 0, wait = 5000; attempt < 6; attempt++, wait *= 2) {
    const response = await fetch(endpoint, {
      method: "POST",
      headers: { "User-Agent": userAgent, "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({ data: query }),
    });
    if (response.ok) return response.text();
    console.warn(`Overpass svarede ${response.status}, prøver igen om ${wait / 1000} s`);
    await new Promise((resolve) => setTimeout(resolve, wait));
  }
  throw new Error("Overpass API var ikke tilgængelig");
}

const outDir = process.argv[2];
if (!outDir) throw new Error("Angiv en output-mappe");
await mkdir(outDir, { recursive: true });
for (const [file, query] of Object.entries(queries)) {
  await writeFile(join(outDir, file), await fetchWithBackoff(query));
  console.log(`Skrev ${file}`);
}
