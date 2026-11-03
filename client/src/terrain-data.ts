// Pladsholder. Kør tools/terrain-data.mjs build <DHM/Terræn-GeoTIFF'er> for at lægge rigtige højdedata ind
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
