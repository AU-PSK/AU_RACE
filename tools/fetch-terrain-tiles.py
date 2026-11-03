#!/usr/bin/env python3
"""Henter åbne højdefliser (Mapterhorn, terrarium-kodet WebP) og skriver et rå Web Mercator-højderaster,
som tools/terrain-data.mjs kan bygge terrændata ud fra.

Mapterhorn (https://mapterhorn.com) sammenstiller åbne højdemodeller. For Danmark er kilden Danmarks Højdemodel,
DHM/Terræn (Klimadatastyrelsen, 0,4 m, CC BY 4.0), jf. source-catalog/dk/metadata.json i
https://github.com/mapterhorn/mapterhorn. Fliserne kræver hverken konto eller token.

Brug (normalt via `npm run terrain -- fetch-tiles`, som regner området ud):
  python tools/fetch-terrain-tiles.py --bbox <syd> <vest> <nord> <øst> [--zoom 17] [--out data/mapterhorn]

Kræver Pillow med WebP-understøttelse: python -m pip install --target data/pylib pillow
"""
import argparse
import array
import io
import json
import math
import os
import sys
import time
import urllib.error
import urllib.request

ROOT = os.path.join(os.path.dirname(os.path.abspath(__file__)), "..")
sys.path.insert(0, os.path.join(ROOT, "data", "pylib"))
try:
    from PIL import Image
except ImportError:
    sys.exit("Pillow mangler. Installer med: python -m pip install --target data/pylib pillow")

TILE = 512
R = 6378137.0
URL = "https://tiles.mapterhorn.com/{z}/{x}/{y}.webp"


def global_pixel(lat, lon, zoom):
    scale = (2 ** zoom) * TILE
    gx = (lon + 180.0) / 360.0 * scale
    gy = (1.0 - math.asinh(math.tan(math.radians(lat))) / math.pi) / 2.0 * scale
    return gx, gy


def fetch(z, x, y, cache):
    path = os.path.join(cache, f"{z}_{x}_{y}.webp")
    if not os.path.exists(path):
        request = urllib.request.Request(URL.format(z=z, x=x, y=y), headers={"User-Agent": "AU_RACE terrain tool"})
        for attempt in range(3):
            try:
                with urllib.request.urlopen(request, timeout=30) as response:
                    data = response.read()
                break
            except urllib.error.HTTPError as error:
                sys.exit(f"Flise {z}/{x}/{y} kunne ikke hentes: HTTP {error.code}")
            except urllib.error.URLError:
                if attempt == 2:
                    raise
                time.sleep(2)
        with open(path, "wb") as handle:
            handle.write(data)
    return path


def decode(path):
    image = Image.open(path).convert("RGB")
    if image.size != (TILE, TILE):
        sys.exit(f"{path}: uventet størrelse {image.size}")
    raw = image.tobytes()
    r, g, b = raw[0::3], raw[1::3], raw[2::3]
    # Terrarium: højde[m] = R·256 + G + B/256 − 32768
    return array.array("f", (r[i] * 256 + g[i] + b[i] / 256.0 - 32768.0 for i in range(TILE * TILE)))


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--bbox", nargs=4, type=float, required=True, metavar=("SYD", "VEST", "NORD", "ØST"))
    parser.add_argument("--zoom", type=int, default=17)
    parser.add_argument("--out", default=os.path.join(ROOT, "data", "mapterhorn"))
    args = parser.parse_args()
    south, west, north, east = args.bbox
    z = args.zoom

    pad = 8
    gx0, gy1 = global_pixel(south, west, z)
    gx1, gy0 = global_pixel(north, east, z)
    px0, py0 = int(math.floor(gx0)) - pad, int(math.floor(gy0)) - pad
    px1, py1 = int(math.ceil(gx1)) + pad, int(math.ceil(gy1)) + pad
    width, height = px1 - px0, py1 - py0
    tx0, tx1 = px0 // TILE, (px1 - 1) // TILE
    ty0, ty1 = py0 // TILE, (py1 - 1) // TILE
    print(f"Zoom {z}: {(tx1 - tx0 + 1) * (ty1 - ty0 + 1)} fliser, udsnit {width}×{height} px")

    cache = os.path.join(ROOT, "data", "tiles")
    os.makedirs(cache, exist_ok=True)
    out = array.array("f", bytes(4 * width * height))
    for ty in range(ty0, ty1 + 1):
        for tx in range(tx0, tx1 + 1):
            heights = decode(fetch(z, tx, ty, cache))
            ox, oy = tx * TILE, ty * TILE
            sx0, sx1 = max(px0, ox), min(px1, ox + TILE)
            sy0, sy1 = max(py0, oy), min(py1, oy + TILE)
            for gy in range(sy0, sy1):
                src = (gy - oy) * TILE + (sx0 - ox)
                dst = (gy - py0) * width + (sx0 - px0)
                out[dst:dst + (sx1 - sx0)] = heights[src:src + (sx1 - sx0)]
        print(f"  række {ty - ty0 + 1}/{ty1 - ty0 + 1}")

    total = (2 ** z) * TILE
    metres = 2 * math.pi * R
    meta = {
        "kind": "mapterhorn-terrarium-webmercator",
        "source": "Mapterhorn (tiles.mapterhorn.com), kilde for Danmark: DHM/Terræn, Klimadatastyrelsen, 0,4 m, CC BY 4.0",
        "crs": "EPSG:3857 (Web Mercator)",
        "zoom": z,
        "width": width,
        "height": height,
        "x0": (px0 / total - 0.5) * metres,
        "y0": (0.5 - py0 / total) * metres,
        "px": metres / total,
        "file": os.path.basename(args.out) + ".f32",
        "bbox": args.bbox,
        "fetched": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
    }
    with open(args.out + ".f32", "wb") as handle:
        out.tofile(handle)
    with open(args.out + ".json", "w", encoding="utf8") as handle:
        json.dump(meta, handle, indent=2, ensure_ascii=False)
    lo, hi = min(out), max(out)
    print(f"Skrev {args.out}.json og .f32. Højde i udsnittet {lo:.1f}–{hi:.1f} m, {meta['px'] * math.cos(math.radians((south + north) / 2)):.2f} m/px.")


if __name__ == "__main__":
    main()
