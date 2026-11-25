import { Builder, place } from './builder';
import { COMANDO } from '../cinematic/script';
import { buildGunship } from './gunship';
import { laatReady } from './laat';
import { terrainHeight } from './terrain';

// Zona a defender: centrada en (0,0). La nave se estrelló en el centro y dejó un cráter.
// Los enemigos llegan desde los dos extremos del cañón (-Z y +Z).
// Todas las coberturas bajas miden ~1,15 m: de pie asomas, agachado quedas cubierto.
/** Donde empieza la partida (y la cinemática deja al comando): la misma posición que `COMANDO` del guion de la cinemática. */
export const SPAWN = COMANDO;
export const COVER_HEIGHT = 1.15;

const WHITE = 0xd9d6cc;

/** Altura del suelo en un punto (el cráter y el relieve hacen que no sea plano). */
const gy = (x: number, z: number) => terrainHeight(x, z);

export function buildDefenseZone(b: Builder) {
  buildGunship(b);

  // Trozo de ala arrancado, apoyado en el suelo a la derecha (con el modelo de la LAAT, el ala de verdad ya está tirada ahí)
  if (!laatReady()) b.addBox([3.2, 0.25, 1.8], place(10.4, gy(10.4, 1.6) + 0.55, 1.6, 0.5, 0.55, 0), WHITE);

  // Barricadas y cajas de suministros: ahora son muros de chapa y cajas de la República (src/world/wreckage.ts), en los mismos sitios
}
