import * as THREE from 'three';
import { Builder, place } from './builder';
import { CANYON_HALF_L, CANYON_HALF_W, crashField, makeRng, terrainHeight, WORLD_SEED } from './terrain';

const ROCK = 0x8f4a2e;
const SPIRE = 0xa2552f;
const RUIN = 0x7d5a48;
const METAL = 0x4a4744;

/** Obstáculo del mapa: lo usan los droides para esquivar y para buscar cobertura. */
export interface Obstacle { x: number; z: number; radius: number; height: number }
export const OBSTACLES: Obstacle[] = [];

// Deformación repetible: el mismo punto siempre se mueve igual (así la roca no se "abre").
function hash(x: number, y: number, z: number, seed: number) {
  const r = (v: number) => Math.round(v * 1000) / 1000;
  const n = Math.sin(r(x) * 127.1 + r(y) * 311.7 + r(z) * 74.7 + seed * 13.37) * 43758.5453;
  return n - Math.floor(n);
}

function spireGeometry(radius: number, height: number, seed: number, lean: number) {
  const g = new THREE.ConeGeometry(radius, height, 7, 5);
  g.translate(0, height / 2, 0);
  const p = g.attributes.position as THREE.BufferAttribute;
  for (let i = 0; i < p.count; i++) {
    const x = p.getX(i), y = p.getY(i), z = p.getZ(i);
    const t = y / height;
    const k = radius * 0.45 * (1 - t * 0.7);
    p.setXYZ(
      i,
      x + (hash(x, y, z, seed) - 0.5) * k + lean * t * t * height,
      t > 0.99 || t < 0.01 ? y : y + (hash(z, x, y, seed + 1) - 0.5) * height * 0.06,
      z + (hash(y, z, x, seed + 2) - 0.5) * k,
    );
  }
  return g;
}

function boulderGeometry(seed: number) {
  const g = new THREE.IcosahedronGeometry(1, 1);
  const p = g.attributes.position as THREE.BufferAttribute;
  for (let i = 0; i < p.count; i++) {
    const x = p.getX(i), y = p.getY(i), z = p.getZ(i);
    const k = 0.75 + hash(x, y, z, seed) * 0.45;
    p.setXYZ(i, x * k, y * k, z * k);
  }
  return g;
}

/** ¿Está dentro del suelo del cañón (donde se puede caminar)? */
const onFloor = (x: number, z: number) => Math.abs(x) < CANYON_HALF_W - 1 && Math.abs(z) < CANYON_HALF_L - 1;

export function buildRocks(b: Builder) {
  OBSTACLES.length = 0;
  const rng = makeRng(WORLD_SEED);
  const range = (a: number, c: number) => a + rng() * (c - a);
  let seed = 1;
  const HW = CANYON_HALF_W - 4; // las piezas del suelo se reparten por todo el ancho del cañón
  const HL = CANYON_HALF_L - 4;

  /** Grupo de agujas. En el suelo del cañón sirven de cobertura; en el borde son solo decorado. */
  const spireCluster = (x: number, z: number, big: number) => {
    const n = 1 + Math.floor(rng() * 3);
    for (let i = 0; i < n; i++) {
      const main = i === 0;
      const h = (main ? range(12, 26) : range(4, 11)) * big;
      const r = h * range(0.13, 0.2);
      const ox = main ? 0 : range(-1, 1) * 5 * big;
      const oz = main ? 0 : range(-1, 1) * 5 * big;
      const y = terrainHeight(x + ox, z + oz) - 1.5;
      const floor = onFloor(x + ox, z + oz);
      if (floor) OBSTACLES.push({ x: x + ox, z: z + oz, radius: r * 0.9, height: h });
      b.addHull(spireGeometry(r, h, seed++, range(-0.12, 0.12)), place(x + ox, y, z + oz, range(0, 6.28)), SPIRE, range(0.8, 1.1), floor);
    }
  };

  const boulder = (x: number, z: number, r: number) => {
    const s = new THREE.Vector3(r * range(0.8, 1.3), r * range(0.55, 0.9), r * range(0.8, 1.3));
    const floor = onFloor(x, z);
    if (floor) OBSTACLES.push({ x, z, radius: Math.max(s.x, s.z) * 0.95, height: s.y * 1.6 });
    b.addHull(boulderGeometry(seed++), place(x, terrainHeight(x, z) + s.y * 0.3, z, range(0, 6.28), 0, 0, s), ROCK, range(0.75, 1.1), floor);
  };

  // Sitios libres: ni la zona de defensa ni el cráter ni el surco de la nave.
  const clear = (x: number, z: number) => Math.hypot(x + 2.5, z - 3.2) > 15 && crashField(x, z).h > -0.25;

  // --- Suelo del cañón: delante y detrás por igual, para que no haya línea de tiro limpia ---
  for (let n = 0; n < 130; ) {
    const x = range(-HW, HW), z = range(-HL, HL);
    if (!clear(x, z)) continue;
    boulder(x, z, range(0.8, 2.3));
    n++;
  }
  for (let n = 0; n < 16; ) {
    const x = range(-HW, HW), z = range(-HL, HL);
    if (Math.abs(z) < 24 || !clear(x, z)) continue;
    spireCluster(x, z, range(0.55, 0.8));
    n++;
  }
  // Muros en ruinas
  for (let n = 0; n < 30; ) {
    const x = range(-HW, HW), z = range(-HL, HL);
    if (!clear(x, z) || Math.hypot(x, z) < 19) continue;
    const w = range(3, 6.5), h = range(1.3, 2.3);
    b.addBox([w, h, 0.6], place(x, terrainHeight(x, z) + h / 2 - 0.35, z, range(-0.6, 0.6), 0, range(-0.06, 0.06)), RUIN);
    OBSTACLES.push({ x, z, radius: w * 0.5, height: h });
    if (rng() < 0.5) {
      const x2 = x + w / 2 + 1.2, z2 = z + range(-1, 1);
      if (onFloor(x2, z2)) b.addBox([range(1.2, 2.2), 0.6, 1], place(x2, terrainHeight(x2, z2) + 0.15, z2, range(0, 3), 0, range(-0.2, 0.2)), RUIN);
    }
    n++;
  }
  // Restos metálicos
  for (let n = 0; n < 24; ) {
    const x = range(-HW, HW), z = range(-HL, HL);
    if (!clear(x, z) || Math.hypot(x, z) < 17) continue;
    const sx = range(1, 2.6), sy = range(0.8, 1.6), sz = range(0.8, 1.8);
    b.addBox([sx, sy, sz], place(x, terrainHeight(x, z) + sy * 0.3, z, range(0, 6.28), range(-0.3, 0.3), range(-0.3, 0.3)), METAL);
    OBSTACLES.push({ x, z, radius: Math.max(sx, sz) * 0.6, height: sy });
    n++;
  }

  // --- Pie de las paredes: rocas caídas ---
  for (let i = 0; i < 40; i++) {
    const side = rng() < 0.5 ? -1 : 1;
    boulder(side * range(CANYON_HALF_W - 5, CANYON_HALF_W + 1.5), range(-HL, HL), range(1, 2.8));
  }

  // --- Borde del cañón: agujas altas que se recortan contra el cielo (solo decorado) ---
  for (let i = 0; i < 44; i++) {
    const side = rng() < 0.5 ? -1 : 1;
    spireCluster(side * range(CANYON_HALF_W + 8, CANYON_HALF_W + 34), range(-130, 130), range(1.1, 1.7));
  }
  // Extremos del cañón
  for (let i = 0; i < 18; i++) {
    const side = rng() < 0.5 ? -1 : 1;
    spireCluster(range(-70, 70), side * range(CANYON_HALF_L + 8, CANYON_HALF_L + 32), range(1.1, 1.7));
  }
}
