// ARENA DE GEONOSIS — todas las medidas en un solo sitio (metros). Norte = −z, este = +x.
// Cambiando estos números cambia la arena entera (suelo, muro, gradas, puertas, coberturas).

/** Ronda en la que el combate pasa del cañón a la arena (al completar la 7). */
export const ARENA_ROUND = 8;

/** Suelo ovalado: medio ancho (este-oeste) y medio largo (norte-sur). 64,4 × 82,8 m (un 15 % más que la primera maqueta, de 56 × 72). */
export const ARENA_A = 32.2;
export const ARENA_B = 41.4;

/** Muro bajo que rodea el suelo. */
export const WALL = { height: 2.2, thick: 1.0 };
/** Postes sobre el muro: separación aproximada a lo largo del borde, alto y grosor. */
export const POSTS = { spacing: 8, height: 3.8, radius: 0.32 };

/** Gradas: anillos escalonados que empiezan detrás del muro. */
export const TIERS = {
  count: 7,
  firstTop: 4.6, // altura del primer escalón (por encima del muro)
  rise: 2.6, // lo que sube cada anillo
  depth: 3.3, // lo que retrocede cada anillo
};

/** Pared de roca por encima de las gradas y columnas altas con surcos. */
export const CLIFF = { height: 58, thick: 10, columns: 17 };

/** Puertas a ras de suelo: ancho, alto y fondo del túnel. Ángulo 0 = este, en sentido contrario al reloj visto desde arriba. */
export const DOOR = { width: 7, height: 7, depth: 11 };
export interface Door { name: string; x: number; z: number; out: [number, number] }
export const DOORS: Door[] = [
  { name: 'norte', x: 0, z: -ARENA_B, out: [0, -1] },
  { name: 'sur', x: 0, z: ARENA_B, out: [0, 1] },
  { name: 'este', x: ARENA_A, z: 0, out: [1, 0] },
  { name: 'oeste', x: -ARENA_A, z: 0, out: [-1, 0] },
];

/** Los tres pilares de la película, en fila en el centro (al norte de tu posición). */
export const PILLARS = [-4.5, 0, 4.5].map((x) => ({ x, z: -1.5 }));
export const PILLAR = { height: 7.5, radius: 0.5, baseRadius: 0.8 };

/** Punto de referencia junto a los pilares (para las fotos de la maqueta). */
export const ARENA_SPAWN = { x: 0, z: 5, yaw: 0 };

/** Dónde apareces en la partida: en la puerta sur (la única por la que no salen droides), a la entrada del túnel, mirando al norte. */
export const ARENA_ENTRY = { x: 0, z: ARENA_B + 2.5, yaw: 0 };

/** Puertas por las que entran los droides (por la sur entras tú: de ahí no salen enemigos). */
export const ENEMY_DOORS = ['norte', 'este', 'oeste'] as const;

/**
 * Coberturas. Rocas caídas de las gradas, restos de chapa de la batalla y el montón de arena y chatarra al final del surco de impacto.
 * Repartidas para que haya protección frente a las puertas. (Sin droides destruidos: Víctor los quitó.)
 */
export type CoverKind = 'roca' | 'chapa' | 'monticulo';
export interface Cover { kind: CoverKind; x: number; z: number; rot: number }
export const COVERS: Cover[] = [
  // rocas caídas de las gradas
  { kind: 'roca', x: -5.8, z: -25.3, rot: 0.3 },
  { kind: 'roca', x: 5.8, z: 25.3, rot: 1.9 },
  { kind: 'roca', x: 19.5, z: -6.9, rot: 0.8 },
  { kind: 'roca', x: -19.5, z: 6.9, rot: 2.6 },
  { kind: 'roca', x: 16.1, z: -24.1, rot: 1.2 },
  { kind: 'roca', x: -16.1, z: 24.1, rot: 0.1 },
  { kind: 'roca', x: -18.4, z: -20.7, rot: 2.1 },
  { kind: 'roca', x: 18.4, z: 20.7, rot: 3.0 },
  // restos de chapa (donde estaban los montones de droides)
  { kind: 'chapa', x: 8.5, z: -13.5, rot: 0.2 },
  { kind: 'chapa', x: -6.9, z: 14.9, rot: -0.4 },
  { kind: 'roca', x: 11.5, z: 5.8, rot: 0.9 },
  { kind: 'chapa', x: -11.5, z: -5.8, rot: -0.2 },
  { kind: 'chapa', x: 3.5, z: -31, rot: 0.5 },
  { kind: 'roca', x: -3.5, z: 31, rot: -0.6 },
  { kind: 'chapa', x: 24, z: 3.5, rot: 1.3 },
  { kind: 'chapa', x: -24, z: -3.5, rot: -1.8 },
  // roca al sur del centro (donde estaba el droideka roto)
  { kind: 'roca', x: 3.4, z: 13.8, rot: -0.3 },
  // arena y chatarra amontonadas al final del surco de impacto
  { kind: 'monticulo', x: -2.6, z: -11.2, rot: 0 },
];

/** Surco de impacto en la arena (algo se estrelló aquí; más adelante, una nave droide): de dónde a dónde va, ancho y hondo. */
export const FURROW = { x0: 12, z0: -27, x1: -1.5, z1: -12.5, halfWidth: 1.8, depth: 0.6 };

/** Altura del suelo de la arena (plano, salvo el surco de impacto y el montón de arena del final). */
export function floorHeight(x: number, z: number): number {
  const F = FURROW;
  const dx = F.x1 - F.x0, dz = F.z1 - F.z0, L = Math.hypot(dx, dz);
  const ux = dx / L, uz = dz / L;
  const rx = x - F.x0, rz = z - F.z0;
  const s = rx * ux + rz * uz, l = rx * -uz + rz * ux;
  if (s < -6 || s > L + 8 || Math.abs(l) > 8) return 0;
  const sm = (a: number, b: number, v: number) => { const t = Math.min(1, Math.max(0, (v - a) / (b - a))); return t * t * (3 - 2 * t); };
  const along = sm(-4, 3, s) * (1 - sm(L - 1, L + 1.5, s)); // el surco empieza suave y acaba contra el montón
  const deep = 0.55 + 0.45 * (s / L); // más hondo según avanza
  let h = -F.depth * deep * Math.exp(-((l / F.halfWidth) ** 2)) * along;
  h += 0.38 * Math.exp(-(((Math.abs(l) - F.halfWidth * 1.7) / 1.1) ** 2)) * along; // bordes de arena levantada
  h += 1.15 * Math.exp(-(((s - L - 1.6) / 2.3) ** 2) - (l / 3.0) ** 2); // montón de arena empujada al final
  return h;
}

/** Palco en forma de torre, encima de la puerta este. */
export const PALCO = { x: ARENA_A + 9, z: 0, height: 34 };

/** Punto del borde del óvalo agrandado `d` metros, en el ángulo `t` (0 = este, π/2 = sur). */
export function ovalPoint(t: number, d = 0): [number, number] {
  return [Math.cos(t) * (ARENA_A + d), Math.sin(t) * (ARENA_B + d)];
}

/**
 * Distancia (m) de un punto al borde del suelo, medida «en óvalos»: 0 en el borde, negativa dentro de la arena, positiva hacia las gradas.
 * Es la inversa de `ovalPoint`: el punto queda sobre el óvalo agrandado esa distancia.
 */
export function ovalDist(x: number, z: number): number {
  const r = Math.hypot(x, z);
  if (r < 1e-3) return -Math.min(ARENA_A, ARENA_B);
  const re = 1 / Math.hypot(x / r / ARENA_A, z / r / ARENA_B);
  let d = r - re;
  for (let i = 0; i < 8; i++) {
    const a = ARENA_A + d, b = ARENA_B + d;
    if (a < 0.5) return d;
    const f = (x * x) / (a * a) + (z * z) / (b * b) - 1;
    const df = (-2 * x * x) / (a * a * a) - (2 * z * z) / (b * b * b);
    const nd = d - f / df;
    if (Math.abs(nd - d) < 1e-4) return nd;
    d = nd;
  }
  return d;
}

/** Ángulo (0 = este, π/2 = sur) del punto sobre su óvalo. */
export const ovalAngle = (x: number, z: number, d: number) => Math.atan2(z / (ARENA_B + d), x / (ARENA_A + d));

/** Sol de la arena: en diagonal desde arriba, por el suroeste (oeste = −x, sur = +z), a unos 52° de altura. */
export const ARENA_SUN = { x: -0.707, y: 1.28, z: 0.707 };

/** Ángulo de cada puerta sobre el óvalo. */
export const doorAngle = (d: Door) => Math.atan2(d.z / ARENA_B, d.x / ARENA_A);
