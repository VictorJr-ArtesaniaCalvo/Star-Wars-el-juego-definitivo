import * as THREE from 'three';
import { Builder, place } from './builder';
import { makeRng, terrainHeight, WORLD_SEED } from './terrain';

const ROCK = 0x8f4a2e;
const SPIRE = 0xa2552f;
const RUIN = 0x7d5a48;
const METAL = 0x4a4744;

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

export function buildRocks(b: Builder) {
  const rng = makeRng(WORLD_SEED);
  const range = (a: number, c: number) => a + rng() * (c - a);
  let seed = 1;

  const spireCluster = (x: number, z: number, big: number) => {
    const n = 1 + Math.floor(rng() * 3);
    for (let i = 0; i < n; i++) {
      const main = i === 0;
      const h = (main ? range(12, 26) : range(4, 11)) * big;
      const r = h * range(0.13, 0.2);
      const ox = main ? 0 : range(-1, 1) * 5 * big;
      const oz = main ? 0 : range(-1, 1) * 5 * big;
      const y = terrainHeight(x + ox, z + oz) - 1.5;
      b.addHull(spireGeometry(r, h, seed++, range(-0.12, 0.12)), place(x + ox, y, z + oz, range(0, 6.28)), SPIRE, range(0.8, 1.1));
    }
  };

  const boulder = (x: number, z: number, r: number) => {
    const s = new THREE.Vector3(r * range(0.8, 1.3), r * range(0.55, 0.9), r * range(0.8, 1.3));
    b.addHull(boulderGeometry(seed++), place(x, terrainHeight(x, z) + s.y * 0.3, z, range(0, 6.28), 0, 0, s), ROCK, range(0.75, 1.1));
  };

  // --- Zona enemiga (delante, hacia -Z): muchos obstáculos para que no haya línea de tiro limpia ---
  for (let i = 0; i < 100; i++) {
    const x = range(-78, 78), z = range(-108, -13);
    if (Math.hypot(x, z) < 14) continue;
    boulder(x, z, range(0.8, 2.3));
  }
  for (let i = 0; i < 20; i++) {
    const x = range(-82, 82), z = range(-110, -24);
    spireCluster(x, z, 1);
  }
  // Muros en ruinas
  for (let i = 0; i < 26; i++) {
    const x = range(-65, 65), z = range(-95, -17);
    const w = range(3, 6.5), h = range(1.3, 2.3);
    b.addBox([w, h, 0.6], place(x, terrainHeight(x, z) + h / 2 - 0.35, z, range(-0.6, 0.6), 0, range(-0.06, 0.06)), RUIN);
    if (rng() < 0.5) {
      // tramo caído al lado
      const x2 = x + w / 2 + 1.2, z2 = z + range(-1, 1);
      b.addBox([range(1.2, 2.2), 0.6, 1], place(x2, terrainHeight(x2, z2) + 0.15, z2, range(0, 3), 0, range(-0.2, 0.2)), RUIN);
    }
  }
  // Restos metálicos
  for (let i = 0; i < 18; i++) {
    const x = range(-60, 60), z = range(-85, -16);
    const sx = range(1, 2.6), sy = range(0.8, 1.6), sz = range(0.8, 1.8);
    b.addBox([sx, sy, sz], place(x, terrainHeight(x, z) + sy * 0.3, z, range(0, 6.28), range(-0.3, 0.3), range(-0.3, 0.3)), METAL);
  }

  // --- Laterales y retaguardia: algunas formaciones para que no quede vacío ---
  for (let i = 0; i < 14; i++) {
    const a = range(-0.25, Math.PI + 0.25); // semicírculo de detrás y lados
    const d = range(32, 95);
    spireCluster(Math.cos(a) * d, Math.sin(a) * d, 1);
  }
  for (let i = 0; i < 22; i++) {
    const a = range(0, Math.PI), d = range(18, 90);
    boulder(Math.cos(a) * d, Math.sin(a) * d, range(0.8, 2));
  }

  // --- Borde del mapa: muralla de agujas enormes ---
  for (let i = 0; i < 30; i++) {
    const a = (i / 30) * Math.PI * 2 + range(-0.06, 0.06);
    const d = range(110, 124);
    spireCluster(Math.cos(a) * d, Math.sin(a) * d, range(1.4, 2));
  }
}
