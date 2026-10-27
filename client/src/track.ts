import * as THREE from "three";
import { campus } from "./campus-data.js";

// Banen følger Bartholins Allé, Wilhelm Meyers Allé, Ole Worms Allé, Karl Verners Vej og
// Victor Albecks Vej (OpenStreetMap-data, se tools/build-campus.mjs). Start/mål ligger ved
// nordenden af Bartholins Allé.
const points: THREE.Vector3[] = [];
for (let i = 0; i < campus.route.length; i += 2) points.push(new THREE.Vector3(campus.route[i], 0, campus.route[i + 1]));

export const TRACK_WIDTH = 7.5;
export const route = new THREE.CatmullRomCurve3(points, true, "centripetal");
export const ROUTE_LENGTH = route.getLength();

// Fart ved fuld gas i spilenheder pr. sekund; en omgang tager ROUTE_LENGTH / BASE_SPEED sekunder.
export const BASE_SPEED = 16;

export function trackPosition(progress: number, lane = 0): THREE.Vector3 {
  const t = ((progress % 1) + 1) % 1;
  const point = route.getPointAt(t);
  const tangent = route.getTangentAt(t);
  const normal = new THREE.Vector3(-tangent.z, 0, tangent.x);
  return point.addScaledVector(normal, lane * 1.65);
}
