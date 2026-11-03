import type { PlayerState } from "./race.js";
import { route } from "./track.js";

const outline = route.getSpacedPoints(180);
const xs = outline.map((point) => point.x);
const zs = outline.map((point) => point.z);
const minX = Math.min(...xs);
const minZ = Math.min(...zs);
const span = Math.max(Math.max(...xs) - minX, Math.max(...zs) - minZ);
const PADDING = 26;

/** Tegner banen set oppefra med alle karts som farvede prikker; nord er opad. */
export function drawMinimap(canvas: HTMLCanvasElement, players: Iterable<[string, PlayerState]>, myId: string): void {
  const context = canvas.getContext("2d");
  if (!context) return;
  const size = canvas.width;
  const scale = (size - PADDING * 2) / span;
  const offsetX = (size - (Math.max(...xs) - minX) * scale) / 2;
  const offsetZ = (size - (Math.max(...zs) - minZ) * scale) / 2;
  const toCanvas = (x: number, z: number): [number, number] => [offsetX + (x - minX) * scale, offsetZ + (z - minZ) * scale];

  context.clearRect(0, 0, size, size);
  context.lineJoin = "round";
  context.lineCap = "round";
  context.beginPath();
  outline.forEach((point, index) => {
    const [x, y] = toCanvas(point.x, point.z);
    if (index === 0) context.moveTo(x, y);
    else context.lineTo(x, y);
  });
  context.closePath();
  context.strokeStyle = "#0f1519";
  context.lineWidth = 20;
  context.stroke();
  context.strokeStyle = "#e9eef5";
  context.lineWidth = 12;
  context.stroke();

  const [startX, startY] = toCanvas(outline[0].x, outline[0].z);
  context.fillStyle = "#ffe066";
  context.fillRect(startX - 11, startY - 3, 22, 6);

  const racers = [...players].filter(([, player]) => player.role === "racer" && player.respawn <= 0);
  // Den lokale spiller tegnes sidst, så prikken aldrig skjules af de andre.
  racers.sort(([a], [b]) => Number(a === myId) - Number(b === myId));
  for (const [id, player] of racers) {
    const [x, y] = toCanvas(player.x, player.z);
    context.beginPath();
    context.arc(x, y, id === myId ? 13 : 9, 0, Math.PI * 2);
    context.fillStyle = player.color;
    context.fill();
    context.lineWidth = id === myId ? 5 : 3;
    context.strokeStyle = id === myId ? "#ffffff" : "#0f1519";
    context.stroke();
  }
}
