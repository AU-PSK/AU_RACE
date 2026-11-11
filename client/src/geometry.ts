import * as THREE from "three";
import { mergeGeometries } from "three/examples/jsm/utils/BufferGeometryUtils.js";

function sliceRange(source: THREE.BufferGeometry, start: number, count: number): THREE.BufferGeometry {
  const out = new THREE.BufferGeometry();
  for (const name of ["position", "normal", "uv"]) {
    const attribute = source.getAttribute(name) as THREE.BufferAttribute;
    const size = attribute.itemSize;
    out.setAttribute(name, new THREE.BufferAttribute(attribute.array.slice(start * size, (start + count) * size), size));
  }
  return out;
}

/**
 * Slår ikke-indekserede geometrier med materialegrupper sammen til én geometri med én gruppe pr. materialeindeks.
 * THREE.mergeGeometries(useGroups) opretter i stedet én gruppe pr. kildegeometri og ville give ugyldige materialeindeks.
 */
export function mergeByMaterial(geometries: THREE.BufferGeometry[], materialCount: number): THREE.BufferGeometry | null {
  const parts: THREE.BufferGeometry[] = [];
  for (let material = 0; material < materialCount; material++) {
    const slices: THREE.BufferGeometry[] = [];
    for (const geometry of geometries) {
      for (const group of geometry.groups) {
        if (group.materialIndex === material) slices.push(sliceRange(geometry, group.start, group.count));
      }
    }
    const merged = slices.length ? mergeGeometries(slices) : null;
    for (const slice of slices) slice.dispose();
    if (!merged) {
      for (const part of parts) part.dispose();
      return null;
    }
    parts.push(merged);
  }
  const result = mergeGeometries(parts, true);
  for (const part of parts) part.dispose();
  return result;
}
