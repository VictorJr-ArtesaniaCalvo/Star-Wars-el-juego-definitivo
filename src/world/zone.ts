import { CANYON_HALF_L, CANYON_HALF_W, terrainHeight } from './terrain';
import { OBSTACLES, type Obstacle } from './rocks';
import { DOOR, DOORS, floorHeight, ovalDist } from './arena/layout';

// ZONA ACTUAL DEL COMBATE: el cañón (rondas 1–7) o la arena (desde la ronda 8). Todo lo que se mueve por el suelo (jugador, droides,
// kits médicos) pregunta aquí por la altura del suelo, por dónde se puede andar y qué coberturas hay, sin saber en qué zona está.

export type ZoneName = 'canyon' | 'arena';
let zone: ZoneName = 'canyon';
let arenaObstacles: Obstacle[] = [];

export const currentZone = () => zone;

/** Cambia de zona. En la arena, `obstacles` son sus coberturas (para los droides). */
export function setZone(z: ZoneName, obstacles: Obstacle[] = []) {
  zone = z;
  arenaObstacles = obstacles;
}

/** Coberturas de la zona actual (los droides las usan para avanzar a cubierto). */
export const zoneObstacles = (): Obstacle[] => (zone === 'arena' ? arenaObstacles : OBSTACLES);

/** Largo de los túneles de las puertas de la arena (por donde salen los droides). */
export const TUNNEL_DEPTH = 16;

/** ¿Está el punto dentro del túnel de alguna puerta de la arena? (`margin`: metros de separación con las paredes). */
function inTunnel(x: number, z: number, margin: number) {
  for (const d of DOORS) {
    const s = (x - d.x) * d.out[0] + (z - d.z) * d.out[1];
    const lat = Math.abs(-(x - d.x) * d.out[1] + (z - d.z) * d.out[0]);
    if (s > -1.5 && s < TUNNEL_DEPTH - 0.8 - margin && lat < DOOR.width / 2 - 0.5 - margin) return true;
  }
  return false;
}

/** Altura del suelo en la zona actual. */
export function groundHeight(x: number, z: number): number {
  if (zone === 'canyon') return terrainHeight(x, z);
  return ovalDist(x, z) < 0 ? floorHeight(x, z) : 0.02;
}

/** ¿Se puede estar ahí? (suelo de juego y, en la arena, también los túneles de las puertas). */
export function walkable(x: number, z: number, margin = 0): boolean {
  if (zone === 'canyon') return Math.abs(x) <= CANYON_HALF_W - margin && Math.abs(z) <= CANYON_HALF_L - margin;
  return ovalDist(x, z) < -0.7 - margin || inTunnel(x, z, margin);
}

/** ¿Es un buen sitio para que un droide se pare? (en la arena, solo en el suelo ovalado, no en los túneles). */
export function standable(x: number, z: number, margin = 0): boolean {
  if (zone === 'canyon') return walkable(x, z, margin);
  return ovalDist(x, z) < -1.2 - margin;
}

/** Acerca un punto al centro hasta que se pueda estar en él (para destinos que caen fuera). */
export function clampInside(x: number, z: number, margin = 2): [number, number] {
  if (zone === 'canyon') return [Math.max(-CANYON_HALF_W + margin, Math.min(CANYON_HALF_W - margin, x)), Math.max(-CANYON_HALF_L + margin, Math.min(CANYON_HALF_L - margin, z))];
  let k = 1;
  while (k > 0.05 && !standable(x * k, z * k, margin)) k -= 0.05;
  return [x * k, z * k];
}
