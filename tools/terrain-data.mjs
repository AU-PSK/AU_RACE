// Omsætter DHM/Terræn-GeoTIFF'er (Danmarks Højdemodel) til client/src/terrain-data.ts.
// Data: Styrelsen for Dataforsyning og Infrastruktur / Klimadatastyrelsen, CC BY 4.0 (se TERRAIN_DATA_LICENSE.md).
//
// Brug:
//   node tools/terrain-data.mjs bounds
//   node tools/terrain-data.mjs build <tile.tif> [<tile.tif> ...] [--out client/src/terrain-data.ts]
//        [--step-m 4] [--margin 30] [--vintage "2023"] [--fill-missing]
//   node tools/terrain-data.mjs selftest
//   node tools/terrain-data.mjs synthetic <out.tif>     (kunstigt raster til at afprøve kæden; ikke rigtige data)
//   node tools/terrain-data.mjs reset                   (skriver pladsholderen uden højdedata, så verden er flad)
//
// Der hentes intet fra nettet, og ingen adgangsnøgler bruges: download GeoTIFF'erne selv fra Dataforsyningen
// (DHM/Terræn, 1 km-fliser) med din egen konto og læg dem uden for repoet (fx data/).
// Rasteret samples i spillets lokale koordinater (samme projektion som build-campus.mjs) ved at gå
// spil-xz → lat/lon → ETRS89 / UTM zone 32N (EPSG:25832) → pixel. Hver gittercelle er middelværdien af de
// underliggende pixels. Manglende data (NoData) afbryder med en tydelig fejl, medmindre --fill-missing angives.
import { readFile, writeFile } from "node:fs/promises";
import { deflateSync, inflateSync } from "node:zlib";
import { fileURLToPath } from "node:url";
import { dirname, join, basename } from "node:path";

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, "..");
const CAMPUS_PATH = join(root, "client", "src", "campus-data.ts");
const DEFAULT_OUT = join(root, "client", "src", "terrain-data.ts");

const ATTRIBUTION =
  "Indeholder data fra Danmarks Højdemodel, DHM/Terræn (Klimadatastyrelsen / Styrelsen for Dataforsyning og Infrastruktur), " +
  "CC BY 4.0, https://dataforsyningen.dk/. Data er omsat til et grovere gitter i spillets koordinater.";

// ---------------------------------------------------------------- UTM zone 32N (ETRS89 ≈ GRS80)

export function toUtm32(latDeg, lonDeg) {
  const a = 6378137;
  const f = 1 / 298.257222101;
  const k0 = 0.9996;
  const n = f / (2 - f);
  const A = (a / (1 + n)) * (1 + n ** 2 / 4 + n ** 4 / 64);
  const alpha = [
    n / 2 - (2 / 3) * n ** 2 + (5 / 16) * n ** 3 + (41 / 180) * n ** 4,
    (13 / 48) * n ** 2 - (3 / 5) * n ** 3 + (557 / 1440) * n ** 4,
    (61 / 240) * n ** 3 - (103 / 140) * n ** 4,
    (49561 / 161280) * n ** 4,
  ];
  const phi = (latDeg * Math.PI) / 180;
  const dLon = ((lonDeg - 9) * Math.PI) / 180;
  const c = (2 * Math.sqrt(n)) / (1 + n);
  const t = Math.sinh(Math.atanh(Math.sin(phi)) - c * Math.atanh(c * Math.sin(phi)));
  const xi = Math.atan2(t, Math.cos(dLon));
  const eta = Math.atanh(Math.sin(dLon) / Math.sqrt(1 + t * t));
  let e = eta;
  let nn = xi;
  alpha.forEach((al, i) => {
    const j = 2 * (i + 1);
    e += al * Math.cos(j * xi) * Math.sinh(j * eta);
    nn += al * Math.sin(j * xi) * Math.cosh(j * eta);
  });
  return { e: 500000 + k0 * A * e, n: k0 * A * nn };
}

// ---------------------------------------------------------------- Spillets projektion (som build-campus.mjs)

const M_PER_LAT = 111_132;

async function loadCampus() {
  const text = await readFile(CAMPUS_PATH, "utf8");
  const number = (name) => {
    const match = text.match(new RegExp(`export const ${name} = (-?[0-9.eE+-]+);`));
    if (!match) throw new Error(`${name} mangler i campus-data.ts; kør tools/build-campus.mjs igen.`);
    return Number(match[1]);
  };
  const json = text.match(/export const campus: Campus = (\{[\s\S]*\});\s*$/);
  if (!json) throw new Error("Kunne ikke læse campus fra campus-data.ts");
  const campus = JSON.parse(json[1]);
  const metersPerUnit = number("METERS_PER_UNIT");
  const lat0 = number("ORIGIN_LAT");
  const lon0 = number("ORIGIN_LON");
  const mPerLon = 111_320 * Math.cos((lat0 * Math.PI) / 180);
  return {
    campus,
    metersPerUnit,
    lat0,
    lon0,
    // spil-xz (enheder) → UTM
    gameToUtm(x, z) {
      return toUtm32(lat0 - (z * metersPerUnit) / M_PER_LAT, lon0 + (x * metersPerUnit) / mPerLon);
    },
  };
}

function campusBounds(campus) {
  let minX = Infinity;
  let maxX = -Infinity;
  let minZ = Infinity;
  let maxZ = -Infinity;
  const add = (flat) => {
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
  return { minX, maxX, minZ, maxZ };
}

function gridFor(campus, stepUnits, marginUnits) {
  const b = campusBounds(campus);
  const x0 = Math.floor(b.minX - marginUnits);
  const z0 = Math.floor(b.minZ - marginUnits);
  const cols = Math.ceil((b.maxX + marginUnits - x0) / stepUnits) + 1;
  const rows = Math.ceil((b.maxZ + marginUnits - z0) / stepUnits) + 1;
  return { x0, z0, step: stepUnits, cols, rows };
}

// ---------------------------------------------------------------- GeoTIFF-læser (ukomprimeret/DEFLATE, strips/tiles, forudsigere 1/2/3)

const TYPE_SIZE = { 1: 1, 2: 1, 3: 2, 4: 4, 5: 8, 6: 1, 7: 1, 8: 2, 9: 4, 10: 8, 11: 4, 12: 8 };

export function readGeoTiff(buf, name = "raster") {
  const bom = buf.toString("ascii", 0, 2);
  if (bom !== "II" && bom !== "MM") throw new Error(`${name}: ikke en TIFF-fil`);
  const le = bom === "II";
  const u16 = (o) => (le ? buf.readUInt16LE(o) : buf.readUInt16BE(o));
  const u32 = (o) => (le ? buf.readUInt32LE(o) : buf.readUInt32BE(o));
  const magic = u16(2);
  if (magic === 43) throw new Error(`${name}: BigTIFF understøttes ikke; konvertér med gdal_translate -co BIGTIFF=NO`);
  if (magic !== 42) throw new Error(`${name}: ugyldig TIFF-header`);

  const tags = new Map();
  const ifd = u32(4);
  const count = u16(ifd);
  for (let i = 0; i < count; i++) {
    const at = ifd + 2 + i * 12;
    const tag = u16(at);
    const type = u16(at + 2);
    const n = u32(at + 4);
    const size = TYPE_SIZE[type];
    if (!size) continue;
    const base = size * n <= 4 ? at + 8 : u32(at + 8);
    if (type === 2) {
      tags.set(tag, buf.toString("latin1", base, base + n).replace(/\0+$/, ""));
      continue;
    }
    const values = [];
    for (let k = 0; k < n; k++) {
      const o = base + k * size;
      if (type === 3) values.push(u16(o));
      else if (type === 4) values.push(u32(o));
      else if (type === 1 || type === 7) values.push(buf[o]);
      else if (type === 11) values.push(le ? buf.readFloatLE(o) : buf.readFloatBE(o));
      else if (type === 12) values.push(le ? buf.readDoubleLE(o) : buf.readDoubleBE(o));
      else if (type === 5) values.push(u32(o) / u32(o + 4));
    }
    tags.set(tag, values);
  }

  const one = (tag, fallback) => (tags.has(tag) ? tags.get(tag)[0] : fallback);
  const width = one(256);
  const height = one(257);
  const bits = one(258, 1);
  const compression = one(259, 1);
  const samplesPerPixel = one(277, 1);
  const predictor = one(317, 1);
  const format = one(339, 1);
  if (!width || !height) throw new Error(`${name}: mangler bredde/højde`);
  if (samplesPerPixel !== 1) throw new Error(`${name}: forventer ét bånd, fandt ${samplesPerPixel}`);
  if (![1, 8, 32946].includes(compression)) throw new Error(`${name}: kompression ${compression} understøttes ikke (brug ingen eller DEFLATE)`);
  const bytes = bits / 8;
  const isFloat = format === 3 && (bits === 32 || bits === 64);
  const isInt = (format === 1 || format === 2) && [8, 16, 32].includes(bits);
  if (!isFloat && !isInt) throw new Error(`${name}: sampleformat ${format}/${bits} bit understøttes ikke`);
  if (predictor === 3 && !isFloat) throw new Error(`${name}: forudsigelse 3 kræver flydende tal`);

  const readSample = (block, o) => {
    if (isFloat) return bits === 32 ? (le ? block.readFloatLE(o) : block.readFloatBE(o)) : le ? block.readDoubleLE(o) : block.readDoubleBE(o);
    if (bits === 8) return format === 2 ? block.readInt8(o) : block[o];
    if (bits === 16) return format === 2 ? (le ? block.readInt16LE(o) : block.readInt16BE(o)) : le ? block.readUInt16LE(o) : block.readUInt16BE(o);
    return format === 2 ? (le ? block.readInt32LE(o) : block.readInt32BE(o)) : le ? block.readUInt32LE(o) : block.readUInt32BE(o);
  };

  const decode = (offset, length, bw, bh) => {
    let block = buf.subarray(offset, offset + length);
    if (compression !== 1) block = inflateSync(block);
    block = Buffer.from(block);
    const rowBytes = bw * bytes;
    if (block.length < rowBytes * bh) throw new Error(`${name}: en datablok er kortere end forventet`);
    const out = new Float32Array(bw * bh);
    for (let r = 0; r < bh; r++) {
      const row = block.subarray(r * rowBytes, (r + 1) * rowBytes);
      if (predictor === 3) {
        for (let i = 1; i < rowBytes; i++) row[i] = (row[i] + row[i - 1]) & 255;
        const joined = Buffer.alloc(rowBytes);
        for (let i = 0; i < bw; i++) for (let b = 0; b < bytes; b++) joined[i * bytes + b] = row[b * bw + i];
        for (let i = 0; i < bw; i++) out[r * bw + i] = bytes === 4 ? joined.readFloatBE(i * 4) : joined.readDoubleBE(i * 8);
      } else if (predictor === 2) {
        const modulus = 2 ** bits;
        let sum = 0;
        for (let i = 0; i < bw; i++) {
          const raw = format === 2 ? readSample(row, i * bytes) : readSample(row, i * bytes);
          sum = (((sum + raw) % modulus) + modulus) % modulus;
          out[r * bw + i] = format === 2 && sum >= modulus / 2 ? sum - modulus : sum;
        }
      } else {
        for (let i = 0; i < bw; i++) out[r * bw + i] = readSample(row, i * bytes);
      }
    }
    return out;
  };

  const data = new Float32Array(width * height);
  if (tags.has(322)) {
    const tw = one(322);
    const th = one(323);
    const offsets = tags.get(324);
    const lengths = tags.get(325);
    const across = Math.ceil(width / tw);
    const down = Math.ceil(height / th);
    if (offsets.length < across * down) throw new Error(`${name}: for få tiles`);
    for (let ty = 0; ty < down; ty++) {
      for (let tx = 0; tx < across; tx++) {
        const index = ty * across + tx;
        const tile = decode(offsets[index], lengths[index], tw, th);
        for (let y = 0; y < th && ty * th + y < height; y++) {
          for (let x = 0; x < tw && tx * tw + x < width; x++) data[(ty * th + y) * width + tx * tw + x] = tile[y * tw + x];
        }
      }
    }
  } else {
    const rowsPerStrip = Math.min(one(278, height), height);
    const offsets = tags.get(273);
    const lengths = tags.get(279);
    for (let s = 0; s * rowsPerStrip < height; s++) {
      const rows = Math.min(rowsPerStrip, height - s * rowsPerStrip);
      data.set(decode(offsets[s], lengths[s], width, rows), s * rowsPerStrip * width);
    }
  }

  const scale = tags.get(33550);
  const tie = tags.get(33922);
  if (!scale || !tie || tie.length < 6) throw new Error(`${name}: mangler georeferering (ModelPixelScale/ModelTiepoint)`);
  const keys = { 1025: 1 };
  const geo = tags.get(34735);
  if (geo) for (let i = 0; i < geo[3]; i++) if (geo[4 + i * 4 + 1] === 0) keys[geo[4 + i * 4]] = geo[4 + i * 4 + 3];
  const half = keys[1025] === 2 ? 0.5 : 0;
  const noDataTag = tags.get(42113);
  return {
    name,
    width,
    height,
    data,
    px: scale[0],
    py: scale[1],
    x0: tie[3] - (tie[0] + half) * scale[0],
    y0: tie[4] + (tie[1] + half) * scale[1],
    noData: noDataTag === undefined ? null : Number(noDataTag),
    horizontalEpsg: keys[3072] ?? null,
    verticalEpsg: keys[4096] ?? null,
  };
}

// ---------------------------------------------------------------- GeoTIFF-skriver (til selvtest og kunstigt testraster)

export function writeGeoTiff({ width, height, x0, y0, px, py, data, deflate = true, predictor3 = false, tile = 0, noData = -9999, verticalEpsg = 5799 }) {
  const blocks = [];
  const encode = (bw, bh, get) => {
    const rows = [];
    for (let r = 0; r < bh; r++) {
      const be = Buffer.alloc(bw * 4);
      for (let i = 0; i < bw; i++) be.writeFloatBE(get(i, r), i * 4);
      if (!predictor3) {
        const row = Buffer.alloc(bw * 4);
        for (let i = 0; i < bw; i++) row.writeFloatLE(be.readFloatBE(i * 4), i * 4);
        rows.push(row);
        continue;
      }
      const planes = Buffer.alloc(bw * 4);
      for (let i = 0; i < bw; i++) for (let b = 0; b < 4; b++) planes[b * bw + i] = be[i * 4 + b];
      for (let i = planes.length - 1; i >= 1; i--) planes[i] = (planes[i] - planes[i - 1]) & 255;
      rows.push(planes);
    }
    const raw = Buffer.concat(rows);
    return deflate ? deflateSync(raw) : raw;
  };
  const value = (x, y) => (x < width && y < height ? data[y * width + x] : noData);
  let layout;
  if (tile) {
    const across = Math.ceil(width / tile);
    const down = Math.ceil(height / tile);
    for (let ty = 0; ty < down; ty++) for (let tx = 0; tx < across; tx++) blocks.push(encode(tile, tile, (i, r) => value(tx * tile + i, ty * tile + r)));
    layout = { tiled: true };
  } else {
    const rps = Math.min(64, height);
    for (let y = 0; y < height; y += rps) {
      const rows = Math.min(rps, height - y);
      blocks.push(encode(width, rows, (i, r) => value(i, y + r)));
    }
    layout = { rps };
  }

  const chunks = [Buffer.alloc(8)];
  chunks[0].write("II", 0, "ascii");
  chunks[0].writeUInt16LE(42, 2);
  let cursor = 8;
  const offsets = [];
  const lengths = [];
  for (const block of blocks) {
    offsets.push(cursor);
    lengths.push(block.length);
    chunks.push(block);
    cursor += block.length;
    if (cursor % 2) {
      chunks.push(Buffer.alloc(1));
      cursor += 1;
    }
  }

  const geoKeys = [1, 1, 0, 4, 1024, 0, 1, 1, 1025, 0, 1, 1, 3072, 0, 1, 25832, 4096, 0, 1, verticalEpsg];
  const entries = [
    [256, 4, [width]],
    [257, 4, [height]],
    [258, 3, [32]],
    [259, 3, [deflate ? 8 : 1]],
    [262, 3, [1]],
    [layout.tiled ? 324 : 273, 4, offsets],
    [277, 3, [1]],
    ...(layout.tiled ? [] : [[278, 4, [layout.rps]]]),
    [layout.tiled ? 325 : 279, 4, lengths],
    [284, 3, [1]],
    [317, 3, [predictor3 ? 3 : 1]],
    ...(layout.tiled ? [[322, 4, [tile]], [323, 4, [tile]]] : []),
    [339, 3, [3]],
    [33550, 12, [px, py, 0]],
    [33922, 12, [0, 0, 0, x0, y0, 0]],
    [34735, 3, geoKeys],
    [42113, 2, String(noData)],
  ].sort((a, b) => a[0] - b[0]);

  const ifdSize = 2 + entries.length * 12 + 4;
  const ifdOffset = cursor;
  let extraAt = ifdOffset + ifdSize;
  const ifd = Buffer.alloc(ifdSize);
  ifd.writeUInt16LE(entries.length, 0);
  const extras = [];
  entries.forEach(([tag, type, values], i) => {
    const at = 2 + i * 12;
    const text = type === 2;
    const list = text ? Buffer.from(`${values}\0`, "latin1") : values;
    const count = list.length;
    const size = TYPE_SIZE[type] * count;
    ifd.writeUInt16LE(tag, at);
    ifd.writeUInt16LE(type, at + 2);
    ifd.writeUInt32LE(count, at + 4);
    const payload = Buffer.alloc(size);
    if (text) list.copy(payload);
    else list.forEach((v, k) => (type === 3 ? payload.writeUInt16LE(v, k * 2) : type === 4 ? payload.writeUInt32LE(v, k * 4) : payload.writeDoubleLE(v, k * 8)));
    if (size <= 4) payload.copy(ifd, at + 8);
    else {
      ifd.writeUInt32LE(extraAt, at + 8);
      extras.push(payload);
      extraAt += size;
      if (size % 2) {
        extras.push(Buffer.alloc(1));
        extraAt += 1;
      }
    }
  });
  chunks.push(ifd, ...extras);
  chunks[0].writeUInt32LE(ifdOffset, 4);
  return Buffer.concat(chunks);
}

// ---------------------------------------------------------------- Sampling

function sampleCell(rasters, e, n, cellM) {
  let sum = 0;
  let valid = 0;
  let expected = 0;
  for (const r of rasters) {
    const c0 = Math.ceil((e - cellM / 2 - r.x0) / r.px - 0.5);
    const c1 = Math.floor((e + cellM / 2 - r.x0) / r.px - 0.5);
    const r0 = Math.ceil((r.y0 - (n + cellM / 2)) / r.py - 0.5);
    const r1 = Math.floor((r.y0 - (n - cellM / 2)) / r.py - 0.5);
    for (let row = Math.max(0, r0); row <= Math.min(r.height - 1, r1); row++) {
      for (let col = Math.max(0, c0); col <= Math.min(r.width - 1, c1); col++) {
        expected++;
        const v = r.data[row * r.width + col];
        if (Number.isFinite(v) && v !== r.noData && v > -100 && v < 400) {
          sum += v;
          valid++;
        }
      }
    }
  }
  const nominal = Math.max(1, Math.round(cellM / rasters[0].px) * Math.round(cellM / rasters[0].py));
  // Mindst halvdelen af cellens pixels skal findes; ellers regnes cellen som manglende.
  return expected > 0 && valid >= nominal * 0.5 ? sum / valid : NaN;
}

function fillMissing(heights, cols, rows) {
  let missing = heights.reduce((count, v) => count + (Number.isNaN(v) ? 1 : 0), 0);
  const filled = missing;
  while (missing > 0) {
    const next = Float64Array.from(heights);
    let progress = 0;
    for (let j = 0; j < rows; j++) {
      for (let i = 0; i < cols; i++) {
        if (!Number.isNaN(heights[j * cols + i])) continue;
        let sum = 0;
        let n = 0;
        for (const [di, dj] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
          const ni = i + di;
          const nj = j + dj;
          if (ni < 0 || nj < 0 || ni >= cols || nj >= rows) continue;
          const v = heights[nj * cols + ni];
          if (!Number.isNaN(v)) {
            sum += v;
            n++;
          }
        }
        if (n) {
          next[j * cols + i] = sum / n;
          progress++;
        }
      }
    }
    if (!progress) throw new Error("Ingen gyldige celler at udfylde fra.");
    heights.set(next);
    missing -= progress;
  }
  return filled;
}

// ---------------------------------------------------------------- Kommandoer

function parseArgs(argv) {
  const positional = [];
  const flags = {};
  for (let i = 0; i < argv.length; i++) {
    if (argv[i].startsWith("--")) {
      const key = argv[i].slice(2);
      if (key === "fill-missing") flags[key] = true;
      else flags[key] = argv[++i];
    } else positional.push(argv[i]);
  }
  return { positional, flags };
}

async function commandBounds() {
  const world = await loadCampus();
  const grid = gridFor(world.campus, 1, 30);
  const corners = [
    [grid.x0, grid.z0],
    [grid.x0 + (grid.cols - 1) * grid.step, grid.z0],
    [grid.x0, grid.z0 + (grid.rows - 1) * grid.step],
    [grid.x0 + (grid.cols - 1) * grid.step, grid.z0 + (grid.rows - 1) * grid.step],
  ].map(([x, z]) => world.gameToUtm(x, z));
  const es = corners.map((c) => c.e);
  const ns = corners.map((c) => c.n);
  const emin = Math.floor(Math.min(...es) / 1000);
  const emax = Math.floor(Math.max(...es) / 1000);
  const nmin = Math.floor(Math.min(...ns) / 1000);
  const nmax = Math.floor(Math.max(...ns) / 1000);
  console.log(`Nødvendigt område i EPSG:25832: E ${Math.floor(Math.min(...es))}–${Math.ceil(Math.max(...es))}, N ${Math.floor(Math.min(...ns))}–${Math.ceil(Math.max(...ns))}`);
  console.log("DHM/Terræn-fliser (1 km), angivet som nord- og østkilometer (fx DTM_1km_<N>_<E>.tif):");
  for (let n = nmin; n <= nmax; n++) for (let e = emin; e <= emax; e++) console.log(`  N ${n}, E ${e}`);
}

async function commandBuild(files, flags) {
  if (!files.length) throw new Error("Angiv mindst én GeoTIFF: build <fil.tif> [...]");
  const world = await loadCampus();
  const stepM = Number(flags["step-m"] ?? 4);
  const margin = Number(flags.margin ?? 30);
  if (!(stepM > 0) || !(margin >= 0)) throw new Error("--step-m skal være > 0 og --margin ≥ 0");
  const stepUnits = stepM / world.metersPerUnit;

  const rasters = [];
  for (const file of files) {
    const raster = readGeoTiff(await readFile(file), basename(file));
    if (raster.horizontalEpsg !== null && raster.horizontalEpsg !== 25832) throw new Error(`${raster.name}: koordinatsystem EPSG:${raster.horizontalEpsg}, forventer 25832`);
    if (raster.horizontalEpsg === null) console.warn(`ADVARSEL ${raster.name}: koordinatsystemet står ikke i filen; antager EPSG:25832`);
    if (raster.verticalEpsg !== null && raster.verticalEpsg !== 5799) throw new Error(`${raster.name}: højdedatum EPSG:${raster.verticalEpsg}, forventer 5799 (DVR90)`);
    if (raster.verticalEpsg === null) console.warn(`ADVARSEL ${raster.name}: højdedatum står ikke i filen; antager DVR90 (EPSG:5799) ifølge produktbeskrivelsen`);
    if (Math.abs(raster.px - raster.py) > 1e-9) throw new Error(`${raster.name}: ikke-kvadratiske pixels`);
    if (raster.noData === null) console.warn(`ADVARSEL ${raster.name}: ingen NoData-værdi i filen; ugyldige tal (NaN, < -100 m, > 400 m) behandles som manglende`);
    console.log(`${raster.name}: ${raster.width}×${raster.height} px, ${raster.px} m/px, E ${raster.x0}–${raster.x0 + raster.width * raster.px}, N ${raster.y0 - raster.height * raster.py}–${raster.y0}`);
    rasters.push(raster);
  }
  if (new Set(rasters.map((r) => r.px)).size > 1) throw new Error("Fliserne har forskellig pixelstørrelse; de skal omprøves til ét gitter først.");

  const grid = gridFor(world.campus, stepUnits, margin);
  const heights = new Float64Array(grid.cols * grid.rows);
  const missingCells = [];
  for (let j = 0; j < grid.rows; j++) {
    for (let i = 0; i < grid.cols; i++) {
      const { e, n } = world.gameToUtm(grid.x0 + i * grid.step, grid.z0 + j * grid.step);
      const h = sampleCell(rasters, e, n, stepM);
      heights[j * grid.cols + i] = h;
      if (Number.isNaN(h)) missingCells.push([i, j]);
    }
  }

  let filled = 0;
  if (missingCells.length) {
    const share = ((100 * missingCells.length) / heights.length).toFixed(1);
    const bb = missingCells.reduce((b, [i, j]) => ({ i0: Math.min(b.i0, i), i1: Math.max(b.i1, i), j0: Math.min(b.j0, j), j1: Math.max(b.j1, j) }), { i0: Infinity, i1: -Infinity, j0: Infinity, j1: -Infinity });
    const message =
      `${missingCells.length} af ${heights.length} gitterceller (${share} %) mangler højdedata (NoData eller uden for fliserne). ` +
      `Kolonner ${bb.i0}–${bb.i1}, rækker ${bb.j0}–${bb.j1}. Kør "bounds" for at se, hvilke fliser der skal bruges.`;
    if (!flags["fill-missing"]) throw new Error(`${message}\nAfbrudt. Tilføj de manglende fliser, eller brug --fill-missing for at udfylde fra nabogitterceller (registreres i metadata).`);
    if (missingCells.length > heights.length * 0.1) throw new Error(`${message}\nFor meget mangler til --fill-missing (maks. 10 %).`);
    console.warn(`ADVARSEL: ${message} Udfylder fra naboceller.`);
    filled = fillMissing(heights, grid.cols, grid.rows);
  }

  const start = world.campus.route;
  const startIndex = Math.round((start[1] - grid.z0) / grid.step) * grid.cols + Math.round((start[0] - grid.x0) / grid.step);
  const baseM = Math.round(heights[startIndex] * 10) / 10;
  const cm = Buffer.alloc(heights.length * 2);
  let min = Infinity;
  let max = -Infinity;
  heights.forEach((h, k) => {
    const value = Math.round(h * 100);
    if (value < -32768 || value > 32767) throw new Error(`Højde ${h} m kan ikke gemmes som centimeter i 16 bit`);
    cm.writeInt16LE(value, k * 2);
    min = Math.min(min, h);
    max = Math.max(max, h);
  });

  // Højdeprofil langs ruten som kontrol mod kildedataene.
  const heightAt = (x, z) => {
    const fi = Math.min(grid.cols - 1, Math.max(0, (x - grid.x0) / grid.step));
    const fj = Math.min(grid.rows - 1, Math.max(0, (z - grid.z0) / grid.step));
    const i = Math.min(grid.cols - 2, Math.floor(fi));
    const j = Math.min(grid.rows - 2, Math.floor(fj));
    const u = fi - i;
    const v = fj - j;
    const at = (a, b) => heights[b * grid.cols + a];
    return at(i, j) * (1 - u) * (1 - v) + at(i + 1, j) * u * (1 - v) + at(i, j + 1) * (1 - u) * v + at(i + 1, j + 1) * u * v;
  };
  let routeMin = Infinity;
  let routeMax = -Infinity;
  let maxSlope = 0;
  let previous = null;
  for (let k = 0; k < start.length; k += 2) {
    const h = heightAt(start[k], start[k + 1]);
    routeMin = Math.min(routeMin, h);
    routeMax = Math.max(routeMax, h);
    if (previous) maxSlope = Math.max(maxSlope, Math.abs(h - previous.h) / (Math.hypot(start[k] - previous.x, start[k + 1] - previous.z) * world.metersPerUnit));
    previous = { x: start[k], z: start[k + 1], h };
  }

  const meta = {
    source: "DHM/Terræn (Danmarks Højdemodel)",
    license: "CC BY 4.0",
    attribution: ATTRIBUTION,
    crs: "ETRS89 / UTM zone 32N (EPSG:25832); ETRS89 sidestilles med WGS84 (afvigelse under ca. 1 m)",
    verticalDatum: "DVR90 (EPSG:5799)",
    unit: "m",
    inputs: rasters.map((r) => `${r.name} (${r.px} m/px)`),
    vintage: flags.vintage ?? "ukendt (angiv med --vintage)",
    resampling: `middelværdi af kildepixels pr. ${stepM} m-celle; bilineær interpolation i spillet`,
    cellMeters: stepM,
    filledCells: filled,
    generated: new Date().toISOString(),
  };
  const source = `// Genereret af tools/terrain-data.mjs. Ret ikke i hånden; kør generatoren igen.
// ${ATTRIBUTION}
// Højder er DVR90 i centimeter (Int16, little-endian, række for række fra nord mod syd i spillet, ${grid.cols}×${grid.rows} celler).
// Spilhøjde y = (højde[m] − baseM) / METERS_PER_UNIT, så ruten starter i y = 0.
export interface TerrainGrid {
  x0: number;
  z0: number;
  step: number;
  cols: number;
  rows: number;
  baseM: number;
  cm: string;
}
export const terrain: TerrainGrid | null = ${JSON.stringify({ ...grid, baseM, cm: cm.toString("base64") })};
export const terrainMeta: Record<string, unknown> | null = ${JSON.stringify(meta, null, 2)};
`;
  await writeFile(flags.out ?? DEFAULT_OUT, source);
  console.log(`Skrev ${flags.out ?? DEFAULT_OUT}: ${grid.cols}×${grid.rows} celler à ${stepM} m, ${Math.round(source.length / 1024)} kB`);
  console.log(`Højde ${min.toFixed(1)}–${max.toFixed(1)} m (DVR90); rute ${routeMin.toFixed(1)}–${routeMax.toFixed(1)} m, største stigning ${(maxSlope * 100).toFixed(1)} %; nulpunkt ${baseM} m; udfyldte celler ${filled}`);
  if (flags.vintage === undefined) console.warn("ADVARSEL: dataårgang er ikke angivet (--vintage); dokumentér den før PR 1 godkendes.");
}

function expect(condition, message) {
  if (!condition) throw new Error(`Selvtest fejlede: ${message}`);
}

function commandSelftest() {
  const equator = toUtm32(45, 9);
  expect(Math.abs(equator.e - 500000) < 1e-6 && Math.abs(equator.n - 4982950.4) < 0.05, `UTM 45°N 9°E gav ${equator.e}, ${equator.n}`);
  const aarhus = toUtm32(56.16824, 10.2024);
  expect(aarhus.e > 574000 && aarhus.e < 575500 && aarhus.n > 6225000 && aarhus.n < 6226500, `UTM Aarhus gav ${aarhus.e}, ${aarhus.n}`);

  const width = 37;
  const height = 29;
  const data = new Float32Array(width * height);
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) data[y * width + x] = 20 + x * 0.1 - y * 0.05 + Math.sin(x) * 0.3;
  data[5 * width + 5] = -9999;
  for (const options of [{ deflate: false }, { deflate: true }, { deflate: true, predictor3: true }, { deflate: true, predictor3: true, tile: 16 }, { deflate: false, tile: 16 }]) {
    const raster = readGeoTiff(writeGeoTiff({ width, height, x0: 574000, y0: 6226000, px: 0.4, py: 0.4, data, ...options }), "test");
    expect(raster.width === width && raster.height === height, `mål ${JSON.stringify(options)}`);
    expect(raster.x0 === 574000 && raster.y0 === 6226000 && raster.px === 0.4, `georeferering ${JSON.stringify(options)}`);
    expect(raster.horizontalEpsg === 25832 && raster.verticalEpsg === 5799 && raster.noData === -9999, `nøgler ${JSON.stringify(options)}`);
    expect(raster.data.every((v, i) => v === data[i]), `pixels ${JSON.stringify(options)}`);
  }
  // Pixel (0,1) ligger 0,4 m syd for pixel (0,0), dvs. med lavere nordværdi.
  const raster = readGeoTiff(writeGeoTiff({ width, height, x0: 574000, y0: 6226000, px: 0.4, py: 0.4, data }), "test");
  const cell = sampleCell([raster], 574000 + 0.2, 6226000 - 0.2 - 0.4, 0.4);
  expect(Math.abs(cell - data[width]) < 1e-5, `orientering gav ${cell}, forventer ${data[width]}`);
  expect(Number.isNaN(sampleCell([raster], 574000 + 5 * 0.4 + 0.2, 6226000 - 5 * 0.4 - 0.2, 0.4)), "NoData skal give manglende celle");
  console.log("Selvtest OK: UTM-omregning, GeoTIFF-læsning (strips/tiles, ingen/DEFLATE, forudsigere 1 og 3), orientering og NoData.");
}

async function commandSynthetic(output) {
  if (!output) throw new Error("Brug: synthetic <ud.tif>");
  const world = await loadCampus();
  const grid = gridFor(world.campus, 1, 60);
  const utm = [[grid.x0, grid.z0], [grid.x0 + grid.cols, grid.z0 + grid.rows], [grid.x0, grid.z0 + grid.rows], [grid.x0 + grid.cols, grid.z0]].map(([x, z]) => world.gameToUtm(x, z));
  const x0 = Math.floor(Math.min(...utm.map((c) => c.e))) - 10;
  const y0 = Math.ceil(Math.max(...utm.map((c) => c.n))) + 10;
  const width = Math.ceil((Math.max(...utm.map((c) => c.e)) + 10 - x0) / 0.8);
  const height = Math.ceil((y0 - (Math.min(...utm.map((c) => c.n)) - 10)) / 0.8);
  const data = new Float32Array(width * height);
  for (let r = 0; r < height; r++) {
    for (let c = 0; c < width; c++) {
      const e = x0 + c * 0.8;
      const n = y0 - r * 0.8;
      data[r * width + c] = 30 + (e - x0) * 0.004 + (n - y0) * 0.003 + 4 * Math.exp(-(((e - x0 - 300) / 120) ** 2 + ((n - y0 + 300) / 100) ** 2));
    }
  }
  await writeFile(output, writeGeoTiff({ width, height, x0, y0, px: 0.8, py: 0.8, data, predictor3: true, tile: 256 }));
  console.log(`Skrev kunstigt testraster ${output} (${width}×${height} px). IKKE rigtige højdedata; brug det kun til at afprøve kæden.`);
}

const NULL_STUB = `// Pladsholder. Kør tools/terrain-data.mjs build <DHM/Terræn-GeoTIFF'er> for at lægge rigtige højdedata ind
// (se README.md). Uden data er verden flad, så der ikke vises højdeforskelle, som ikke findes i kilden.
export interface TerrainGrid {
  x0: number;
  z0: number;
  step: number;
  cols: number;
  rows: number;
  baseM: number;
  cm: string;
}
export const terrain: TerrainGrid | null = null;
export const terrainMeta: Record<string, unknown> | null = null;
`;

async function commandReset(output = DEFAULT_OUT) {
  await writeFile(output, NULL_STUB);
  console.log(`Nulstillet ${output}: ingen højdedata, verden er flad.`);
}

const { positional, flags } = parseArgs(process.argv.slice(2));
const [command = "help", ...rest] = positional;
try {
  if (command === "bounds") await commandBounds();
  else if (command === "build") await commandBuild(rest, flags);
  else if (command === "selftest") commandSelftest();
  else if (command === "synthetic") await commandSynthetic(rest[0]);
  else if (command === "reset") await commandReset(rest[0]);
  else
    console.log(`Brug:
  node tools/terrain-data.mjs bounds
  node tools/terrain-data.mjs build <tile.tif> [...] [--out fil] [--step-m 4] [--margin 30] [--vintage ÅÅÅÅ] [--fill-missing]
  node tools/terrain-data.mjs selftest
  node tools/terrain-data.mjs synthetic <ud.tif>
  node tools/terrain-data.mjs reset            (fjerner højdedata igen, så verden er flad)`);
} catch (error) {
  console.error(`Fejl: ${error.message}`);
  process.exit(1);
}


