import * as THREE from 'three';
import { Builder, place } from './builder';
import { CANYON_HALF_L, CANYON_HALF_W, crashField, makeRng, terrainHeight, WORLD_SEED } from './terrain';

const ROCK = 0x8a4a30;
const SPIRE = 0x96502f;
const RUIN = 0x7d5a48;
const METAL = 0x4a4744;
const CAP = 0xa8643c;
// Capas de roca para mesetas y setas
const STRATA = [0x9a4a2c, 0xb85c36, 0x7e3a22, 0xc0693c, 0x6e3220];
const PEBBLES = [0x6e3a26, 0x5a3322, 0x7a4a30, 0x4a3a34, 0x8a5535];

/** Obstáculo del mapa: lo usan los droides para esquivar y para buscar cobertura. */
export interface Obstacle { x: number; z: number; radius: number; height: number }
export const OBSTACLES: Obstacle[] = [];

// Deformación repetible: el mismo punto siempre se mueve igual (así la roca no se "abre").
function hash(x: number, y: number, z: number, seed: number) {
  const r = (v: number) => Math.round(v * 1000) / 1000;
  const n = Math.sin(r(x) * 127.1 + r(y) * 311.7 + r(z) * 74.7 + seed * 13.37) * 43758.5453;
  return n - Math.floor(n);
}

function spireGeometry(radius: number, height: number, seed: number, lean: number, detail = true) {
  const g = new THREE.ConeGeometry(radius, height, detail ? 8 : 6, detail ? 12 : 9);
  g.translate(0, height / 2, 0);
  const p = g.attributes.position as THREE.BufferAttribute;
  for (let i = 0; i < p.count; i++) {
    const x = p.getX(i), y = p.getY(i), z = p.getZ(i);
    const t = y / height;
    const k = radius * 0.45 * (1 - t * 0.7);
    // Anillos a lo largo de la aguja y base ancha, como las torres de las referencias.
    const rib = 1 + 0.11 * Math.sin(t * 36 + seed) + 1.0 * Math.pow(1 - t, 7);
    p.setXYZ(
      i,
      x * rib + (hash(x, y, z, seed) - 0.5) * k + lean * t * t * height,
      t > 0.99 || t < 0.01 ? y : y + (hash(z, x, y, seed + 1) - 0.5) * height * 0.06,
      z * rib + (hash(y, z, x, seed + 2) - 0.5) * k,
    );
  }
  return g;
}

/** Meseta: bloque plano por arriba, de paredes casi verticales y base algo ensanchada. */
function mesaGeometry(radius: number, height: number, seed: number) {
  const g = new THREE.CylinderGeometry(radius * 0.86, radius, height, 11, 6);
  g.translate(0, height / 2, 0);
  const p = g.attributes.position as THREE.BufferAttribute;
  for (let i = 0; i < p.count; i++) {
    const x = p.getX(i), y = p.getY(i), z = p.getZ(i);
    const t = y / height;
    if (t > 0.995) continue; // la cima queda plana
    const k = 0.88 + hash(x, y, z, seed) * 0.24 + Math.pow(1 - t, 4) * 0.28;
    p.setXYZ(i, x * k, y, z * k);
  }
  return g;
}

/** Seta de roca: tallo estrecho y sombrero ancho (la erosión del viento). */
function hoodooStem(radius: number, height: number, seed: number) {
  const g = new THREE.CylinderGeometry(radius * 0.7, radius * 1.15, height, 8, 4);
  g.translate(0, height / 2, 0);
  const p = g.attributes.position as THREE.BufferAttribute;
  for (let i = 0; i < p.count; i++) {
    const x = p.getX(i), y = p.getY(i), z = p.getZ(i);
    const k = 0.85 + hash(x, y, z, seed) * 0.3;
    p.setXYZ(i, x * k, y, z * k);
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
  const spireCluster = (x: number, z: number, big: number, slender = false) => {
    const n = 1 + Math.floor(rng() * 3);
    for (let i = 0; i < n; i++) {
      const main = i === 0;
      const h = (main ? range(12, 26) : range(4, 11)) * big * (slender ? 1.8 : 1);
      const r = h * (slender ? range(0.06, 0.095) : range(0.13, 0.2));
      const ox = main ? 0 : range(-1, 1) * 5 * big;
      const oz = main ? 0 : range(-1, 1) * 5 * big;
      const y = terrainHeight(x + ox, z + oz) - 1.5;
      const floor = onFloor(x + ox, z + oz);
      if (floor) OBSTACLES.push({ x: x + ox, z: z + oz, radius: r * 0.9, height: h });
      b.addHull(spireGeometry(r, h, seed++, range(-0.12, 0.12), floor), place(x + ox, y, z + oz, range(0, 6.28)), SPIRE, range(0.8, 1.1), floor, true);
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
    b.addBox([w, h, 0.6], place(x, terrainHeight(x, z) + h / 2 - 0.35, z, range(-0.6, 0.6), 0, range(-0.06, 0.06)), RUIN, true, 0.7);
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

  // --- Mesetas bajas: bloques planos de paredes verticales, buenas coberturas grandes ---
  for (let n = 0; n < 8; ) {
    const x = range(-HW + 4, HW - 4), z = range(-HL + 4, HL - 4);
    if (!clear(x, z) || Math.hypot(x, z) < 24) continue;
    const r = range(3, 6.5), h = range(3.5, 8);
    const gh = terrainHeight(x, z);
    OBSTACLES.push({ x, z, radius: r * 0.95, height: h });
    b.addStrataHull(mesaGeometry(r, h, seed++), place(x, gh - 1, z, range(0, 6.28)), STRATA, 1.7);
    // Un par de rocas caídas a su pie
    for (let k = 0; k < 2; k++) { const a = range(0, 6.28); boulder(x + Math.cos(a) * (r + 1.2), z + Math.sin(a) * (r + 1.2), range(0.8, 1.6)); }
    n++;
  }

  // --- Rocas en forma de seta ---
  for (let n = 0; n < 16; ) {
    const x = range(-HW, HW), z = range(-HL, HL);
    if (!clear(x, z) || Math.hypot(x, z) < 20) continue;
    const r = range(0.8, 1.4), h = range(2.0, 3.6), cap = range(1.8, 3.0);
    const gh = terrainHeight(x, z);
    const rot = range(0, 6.28);
    OBSTACLES.push({ x, z, radius: Math.max(r, cap * 0.55), height: h + 0.8 });
    b.addStrataHull(hoodooStem(r, h, seed++), place(x, gh - 0.4, z, rot), STRATA, 0.9);
    const capGeo = boulderGeometry(seed++);
    b.addHull(capGeo, place(x, gh + h - 0.1, z, rot, 0, 0, new THREE.Vector3(cap, cap * 0.36, cap * range(0.8, 1.1))), CAP, range(0.85, 1.1));
    n++;
  }

  // --- Losas planas de piedra y grava suelta, para que el suelo no sea liso ---
  for (let n = 0; n < 90; ) {
    const x = range(-HW - 2, HW + 2), z = range(-HL, HL);
    if (!clear(x, z)) continue;
    const g = new THREE.BoxGeometry(range(0.8, 2.4), range(0.06, 0.13), range(0.6, 1.7));
    b.addDecor(g, place(x, terrainHeight(x, z) + 0.04, z, range(0, 3.14), range(-0.12, 0.12), range(-0.12, 0.12)), 0x8f5636, range(0.7, 1.15), 1);
    n++;
  }
  for (let n = 0; n < 420; ) {
    const x = range(-HW - 2, HW + 2), z = range(-HL, HL);
    if (Math.hypot(x + 2.5, z - 3.2) < 3 || crashField(x, z).h < -0.4) continue;
    const sz = range(0.07, 0.24);
    b.addDecor(new THREE.TetrahedronGeometry(sz), place(x, terrainHeight(x, z) + sz * 0.25, z, range(0, 6.28), range(0, 3), range(0, 3)), PEBBLES[Math.floor(rng() * PEBBLES.length)], range(0.75, 1.15), 1);
    n++;
  }

  // --- Más allá de las grietas: el cañón sigue, solo para mirar (sin cuerpo sólido) ---
  for (const side of [-1, 1]) {
    for (let i = 0; i < 70; i++) boulder(range(-HW, HW), side * range(CANYON_HALF_L + 20, 270), range(1.2, 3.4));
    for (let i = 0; i < 12; i++) {
      const x = range(-HW + 6, HW - 6), z = side * range(CANYON_HALF_L + 24, 250), r = range(4, 9), h = range(5, 12);
      b.addStrataHull(mesaGeometry(r, h, seed++), place(x, terrainHeight(x, z) - 1, z, range(0, 6.28)), STRATA, 1.9, false);
    }
    for (let i = 0; i < 18; i++) spireCluster(range(-HW, HW), side * range(CANYON_HALF_L + 22, 260), range(0.8, 1.5), true);
  }

  // --- Pie de las paredes: rocas caídas ---
  for (let i = 0; i < 40; i++) {
    const side = rng() < 0.5 ? -1 : 1;
    boulder(side * range(CANYON_HALF_W - 5, CANYON_HALF_W + 1.5), range(-HL, HL), range(1, 2.8));
  }

  // --- Borde del cañón: agujas altas que se recortan contra el cielo (solo decorado) ---
  for (let i = 0; i < 44; i++) {
    const side = rng() < 0.5 ? -1 : 1;
    spireCluster(side * range(CANYON_HALF_W + 8, CANYON_HALF_W + 40), range(-130, 130), range(1.0, 1.5), true);
  }
  // Extremos del cañón
  for (let i = 0; i < 18; i++) {
    const side = rng() < 0.5 ? -1 : 1;
    spireCluster(range(-70, 70), side * range(CANYON_HALF_L + 8, CANYON_HALF_L + 36), range(1.0, 1.5), true);
  }
}
