import * as THREE from "three";

const points = [
  new THREE.Vector3(0, 0, 38),
  new THREE.Vector3(18, 0, 32),
  new THREE.Vector3(29, 0, 18),
  new THREE.Vector3(27, 0, 3),
  new THREE.Vector3(17, 0, -11),
  new THREE.Vector3(2, 0, -23),
  new THREE.Vector3(-15, 0, -25),
  new THREE.Vector3(-28, 0, -13),
  new THREE.Vector3(-30, 0, 6),
  new THREE.Vector3(-22, 0, 25),
  new THREE.Vector3(-8, 0, 37),
];

export const TRACK_WIDTH = 9;
export const route = new THREE.CatmullRomCurve3(points, true, "centripetal");

export function trackPosition(progress: number, lane = 0): THREE.Vector3 {
  const t = ((progress % 1) + 1) % 1;
  const point = route.getPointAt(t);
  const tangent = route.getTangentAt(t);
  const normal = new THREE.Vector3(-tangent.z, 0, tangent.x);
  return point.addScaledVector(normal, lane * 1.65);
}
