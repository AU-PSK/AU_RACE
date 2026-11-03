# Terrain Data Attribution & License

## Danish Height Model (DHM/Terræn – Danmarks Højdemodel / Terræn)

**Source:** Styrelsen for Dataforsyning og Infrastruktur (SDFI)  
**Product:** DHM/Terræn (Raster)  
**Coordinate System:** ETRS89 / UTM zone 32N (EPSG:25832)  
**Height Datum:** DVR90 (EPSG:5799)  
**Unit:** Meters  
**Nominal Resolution:** 40 cm per pixel (0.4 m)  
**License:** CC BY 4.0 (Creative Commons Attribution 4.0 International)  
**Access:** https://dataforsyningen.dk/  

### Attribution Requirement

When using DHM/Terræn data in AU RACE, include the following attribution:

> © Styrelsen for Dataforsyning og Infrastruktur (SDFI). Data: Danmarks Højdemodel / Terræn. License: CC BY 4.0. https://dataforsyningen.dk/

This attribution must appear in:
1. Project README.md (separate from OpenStreetMap attribution)
2. In-game credits or help text
3. Any exported or redistributed datasets

### License Terms Summary

- **Permitted:** Use, modification, and redistribution for any purpose
- **Requirement:** Attribute the dataset and license
- **Requirement:** Indicate if the data has been modified
- **No Warranty:** The data is provided "as-is"

For full license text, see: https://creativecommons.org/licenses/by/4.0/

### Coordinate System Notes

- **CRS:** ETRS89 / UTM zone 32N (EPSG:25832) — European standard for Scandinavia
- **Datum:** DVR90 — Danish Vertical Reference 1990, referenced to mean sea level
- **Game Coordinates:** AU RACE uses a local flat-earth projection (see `tools/build-campus.mjs`)
  - Origin: center of campus area
  - X: east (game units; 1 unit = 4 m)
  - Z: south (game units; −Z is north)
  - Y: height (game units; 1 unit = 4 m, relative to the route start)

### Transformation from UTM to Game Coordinates

`tools/terrain-data.mjs` samples the raster in game coordinates, using the same projection as `tools/build-campus.mjs`
(origin `ORIGIN_LAT`/`ORIGIN_LON` in `client/src/campus-data.ts`; 1 game unit = `METERS_PER_UNIT` = 4 m; north is −z):

1. Game `(x, z)` → latitude/longitude: `lat = lat0 − z·4/111132`, `lon = lon0 + x·4/(111320·cos lat0)`
2. Latitude/longitude → ETRS89 / UTM zone 32N (EPSG:25832) → raster pixel
3. Each grid cell (default 4 m) is the mean of the underlying pixels; NoData aborts the build unless `--fill-missing` is given
4. Height: `y_game = (height_m(DVR90) − baseM) / METERS_PER_UNIT`, where `baseM` is the height at the route start, so the start line is y = 0.
   No vertical exaggeration is applied. Heights are stored as Int16 centimetres in `client/src/terrain-data.ts`.

### Data Quality Notes

- Coverage: Nationwide (Denmark)
- Campus coverage: NOT yet verified (no real raster has been downloaded or inspected; `terrain-data.ts` is currently a flat placeholder)
- No-data values: Represented as -9999 in the raster; the build stops with a clear error unless `--fill-missing` (max 10 % of cells) is given
- Interpolation: Cell mean at build time, bilinear sampling at runtime; heights fade to 0 over the outermost ~18 game units so the terrain meets the flat surroundings
- Dataset vintage must be passed with `--vintage` and is recorded in the generated file

### Reproduction & Transparency

1. The conversion is documented and runnable via `npm run terrain` (`tools/terrain-data.mjs`); it makes no network requests
2. Credentials (API tokens) are never stored in the repository; download the GeoTIFF tiles yourself with your own account
3. The generated file records source, licence, CRS, height datum, vintage, bounds, cell size and number of filled cells
4. `npm run terrain -- selftest` verifies the reader, projection and orientation with synthetic data

### Related Attribution

- **OpenStreetMap:** Separate license (ODbL); see main README.md
- **Spike (DHM WMS):** Not used in AU RACE; keep separate if added later
