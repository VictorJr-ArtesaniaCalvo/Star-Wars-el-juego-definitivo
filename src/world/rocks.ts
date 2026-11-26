import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { Builder, place } from './builder';
import { slabGeometry } from './scatter';
import { beadedSpire } from './landmarks';
import { caveKeepOut } from './cave';
import { METAL_WALL_SPOTS } from './wreckage';
import { CANYON_HALF_L, CANYON_HALF_W, crashFieldOriginal, crashMatrix, floorHalfWidth, makeRng, terrainHeight, WORLD_SEED } from './terrain';

const ROCK = 0x8a4a30;
const ROCK_DARK = 0x6a4b3c; // roca oscura marrón (se sigue viendo su textura)
const ROCK_PALE = 0xa98066; // roca clara de arenisca
const SPIRE = 0x96502f;
const CAP = 0xa8643c;
// Capas de roca para mesetas y setas
const STRATA = [0x9a4a2c, 0xb85c36, 0x7e3a22, 0xc0693c, 0x6e3220];
const PEBBLES = [0x8a5236, 0x6e4630, 0x946040, 0x6a5646, 0xa06a44];

/** Obstáculo del mapa: lo usan los droides para esquivar y para buscar cobertura. */
export interface Obstacle { x: number; z: number; radius: number; height: number }
export const OBSTACLES: Obstacle[] = [];
/** Hueco mínimo (m) entre el morro de la cañonera estrellada y el borde de cualquier roca. */
const NOSE_GAP = 3;

// Deformación repetible: el mismo punto siempre se mueve igual (así la roca no se "abre").
function hash(x: number, y: number, z: number, seed: number) {
  const r = (v: number) => Math.round(v * 1000) / 1000;
  const n = Math.sin(r(x) * 127.1 + r(y) * 311.7 + r(z) * 74.7 + seed * 13.37) * 43758.5453;
  return n - Math.floor(n);
}

/** Aguja con anillos redondeados (la misma forma que las torres del castillo): una pila de «cuentas» que se estrechan hasta una punta, algo irregulares y con una pequeña inclinación. */
function spireGeometry(radius: number, height: number, seed: number, lean: number, detail = true) {
  const beads = Math.max(3, Math.min(8, Math.round(height / 9)));
  const prof = beadedSpire(height, radius, beads);
  const g = new THREE.LatheGeometry(prof.map(([r, y]) => new THREE.Vector2(Math.max(r, 0.001), y)), detail ? 8 : 6);
  const p = g.attributes.position as THREE.BufferAttribute;
  const k = radius * 0.3;
  for (let i = 0; i < p.count; i++) {
    const x = p.getX(i), y = p.getY(i), z = p.getZ(i);
    const t = y / height;
    p.setXYZ(i, x + (hash(x, y, z, seed) - 0.5) * k + lean * t * t * height, y, z + (hash(y, z, x, seed + 2) - 0.5) * k);
  }
  g.userData.cuts = Array.from({ length: beads + 1 }, (_, b) => (b * height) / beads); // alturas de cada anillo (para su cuerpo sólido)
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

/** Cobertura de roca en capas: dos o tres losas irregulares apiladas, cada una algo más pequeña y desplazada. Mide w de largo y h de alto. */
function layeredWall(w: number, h: number, seed: number) {
  const rnd = (() => { let k = seed * 7919; return () => hash(k++, 1, 2, seed); })();
  const layers = h > 1.8 ? 3 : 2;
  const parts: THREE.BufferGeometry[] = [];
  let y = 0, rx = w * 0.5, ox = 0;
  for (let i = 0; i < layers; i++) {
    const t = (h / layers) * (0.9 + rnd() * 0.3);
    const g = slabGeometry(rnd, rx, rx * (0.28 + rnd() * 0.12), t).toNonIndexed();
    g.translate(ox, y, (rnd() - 0.5) * 0.25);
    parts.push(g);
    y += t * 0.82; rx *= 0.72 + rnd() * 0.2; ox += (rnd() - 0.5) * w * 0.12;
  }
  const g = mergeGeometries(parts, false)!;
  g.userData.parts = parts.map((q) => q.attributes.position.count); // cuántos vértices tiene cada capa
  for (const p of parts) p.dispose();
  return g;
}

/** `detail`: 0 = 20 caras (rocas pequeñas, más angulosas y ligeras) · 1 = 80 caras (rocas grandes). */
function boulderGeometry(seed: number, detail = 1) {
  const g = new THREE.IcosahedronGeometry(1, detail);
  const p = g.attributes.position as THREE.BufferAttribute;
  for (let i = 0; i < p.count; i++) {
    const x = p.getX(i), y = p.getY(i), z = p.getZ(i);
    // forma erosionada: bultos grandes y pequeños, la base algo más ancha y aplastada y la cima más suave
    const lump = 1 + 0.1 * Math.sin(x * 2.6 + seed) * Math.sin(z * 2.1 - seed * 0.7) + 0.06 * Math.sin(y * 4.1 + x * 3.3);
    const k = (0.76 + hash(x, y, z, seed) * 0.4) * lump;
    const base = y < -0.35 ? 1.08 : 1;
    p.setXYZ(i, x * k * base, y < -0.55 ? -0.55 * k : y * k, z * k * base);
  }
  // sombreado casi plano para que se vean los cantos: la luz mezcla la cara plana con un poco de la media de las caras vecinas
  const SMOOTH = detail === 0 ? 0.1 : 0.22;
  g.computeVertexNormals();
  const n = g.attributes.normal as THREE.BufferAttribute;
  const sum = new Map<string, THREE.Vector3>();
  const key = (i: number) => `${Math.round(p.getX(i) * 500)},${Math.round(p.getY(i) * 500)},${Math.round(p.getZ(i) * 500)}`;
  for (let i = 0; i < p.count; i++) { const k = key(i); (sum.get(k) ?? sum.set(k, new THREE.Vector3()).get(k)!).add(new THREE.Vector3(n.getX(i), n.getY(i), n.getZ(i))); }
  const v = new THREE.Vector3();
  for (let i = 0; i < p.count; i++) {
    const sm = sum.get(key(i))!.clone().normalize();
    v.set(n.getX(i), n.getY(i), n.getZ(i)).multiplyScalar(1 - SMOOTH).addScaledVector(sm, SMOOTH).normalize();
    n.setXYZ(i, v.x, v.y, v.z);
  }
  g.userData.keepNormals = true;
  return g;
}

/** ¿Está dentro del suelo del cañón (donde se puede caminar)? */
const onFloor = (x: number, z: number) => Math.abs(x) < CANYON_HALF_W - 1 && Math.abs(z) < CANYON_HALF_L - 1;

export function buildRocks(b: Builder) {
  OBSTACLES.length = 0;
  const rng = makeRng(WORLD_SEED);
  const range = (a: number, c: number) => a + rng() * (c - a);
  let seed = 1;
  let spireCount = 0;
  const HW = CANYON_HALF_W - 4; // las piezas del suelo se reparten por todo el ancho del cañón
  const HL = CANYON_HALF_L - 4;

  /** Grupo de agujas. En el suelo del cañón sirven de cobertura; en el borde son solo decorado. */
  const spireCluster = (x: number, z: number, big: number, slender = false, omit = false) => {
    const n = 1 + Math.floor(rng() * 3);
    for (let i = 0; i < n; i++) {
      const main = i === 0;
      const h = (main ? range(12, 26) : range(4, 11)) * big * (slender ? 1.8 : 1);
      const r = h * (slender ? range(0.06, 0.095) : range(0.13, 0.2));
      const ox = main ? 0 : range(-1, 1) * 5 * big;
      const oz = main ? 0 : range(-1, 1) * 5 * big;
      const y = terrainHeight(x + ox, z + oz) - 1.5;
      const floor = onFloor(x + ox, z + oz);
      const lean = range(-0.12, 0.12), turn = range(0, 6.28), shade = range(0.8, 1.1);
      // se quita una de cada dos agujas (repartidas por todo el mapa); se sigue gastando la misma cantidad de azar para que el resto del escenario no cambie
      // se quita una de cada dos y, de las que quedan, una de cada seis (repartidas por todo el mapa)
      const n = spireCount++;
      if (n % 2 === 1 || omit || (n >> 1) % 6 === 5) { seed++; continue; }
      if (floor) OBSTACLES.push({ x: x + ox, z: z + oz, radius: r * 0.9, height: h });
      b.addHull(spireGeometry(r, h, seed++, lean, floor), place(x + ox, y, z + oz, turn), SPIRE, shade, floor, true);
    }
  };

  /** Color de una roca suelta según la zona: por manchas, algunas son oscuras y otras más claras. */
  const rockTone = (x: number, z: number) => { const v = Math.sin(x * 0.11 + z * 0.07) * Math.sin(z * 0.09 - x * 0.05); return v > 0.3 ? ROCK_DARK : v < -0.45 ? ROCK_PALE : ROCK; };
  // Delante del morro de la cañonera estrellada no puede haber rocas encima (ahora la nave y su montón de arena son más grandes):
  // si alguna cae ahí, se aparta en línea recta desde el morro lo justo para dejar hueco.
  const nose = new THREE.Vector3(7.92, -2.2, 0.25).applyMatrix4(crashMatrix());
  const boulder = (x: number, z: number, r: number) => {
    const s = new THREE.Vector3(r * range(0.8, 1.3), r * range(0.55, 0.9), r * range(0.8, 1.3));
    const dn = Math.hypot(x - nose.x, z - nose.z), need = Math.max(s.x, s.z) + NOSE_GAP;
    if (dn < need) { x = nose.x + ((x - nose.x) / dn) * need; z = nose.z + ((z - nose.z) / dn) * need; }
    const floor = onFloor(x, z);
    if (floor) OBSTACLES.push({ x, z, radius: Math.max(s.x, s.z) * 0.95, height: s.y * 1.6 });
    b.addHull(boulderGeometry(seed++, r < 1.5 ? 0 : 1), place(x, terrainHeight(x, z) + s.y * 0.3, z, range(0, 6.28), 0, 0, s), rockTone(x, z), range(0.75, 1.1), floor);
  };

  // Sitios libres: ni la zona de defensa ni el cráter ni el surco de la nave.
  const clear = (x: number, z: number) => Math.hypot(x + 2.5, z - 3.2) > 15 && crashFieldOriginal(x, z).h > -0.25;

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
  // Muros en ruinas: coberturas de roca en capas (las mismas de las paredes del cañón) y, de cada cinco, dos muros de chapa de metal retorcido
  METAL_WALL_SPOTS.length = 0;
  for (let n = 0; n < 30; ) {
    const x = range(-HW, HW), z = range(-HL, HL);
    if (!clear(x, z) || Math.hypot(x, z) < 19) continue;
    const w = range(3, 6.5), h = range(1.3, 2.3);
    const yaw = range(-0.6, 0.6);
    // (se gasta el mismo azar que antes para que el resto del mapa no cambie)
    range(-0.06, 0.06);
    if (rng() < 0.5) { const x2 = x + w / 2 + 1.2, z2 = z + range(-1, 1); if (onFloor(x2, z2)) { range(1.2, 2.2); range(0, 3); range(-0.2, 0.2); } }
    if (n % 5 < 2) METAL_WALL_SPOTS.push({ x, z, w, h: 1.2, yaw });
    else b.addStrataHull(layeredWall(w, h, seed++), place(x, terrainHeight(x, z) - 0.15, z, yaw), STRATA, 0.6);
    OBSTACLES.push({ x, z, radius: w * 0.5, height: h });
    n++;
  }
  // Restos metálicos: ya no hay cajas sueltas por el mapa (se gasta el mismo azar para que el resto no cambie)
  for (let n = 0; n < 24; ) {
    const x = range(-HW, HW), z = range(-HL, HL);
    if (!clear(x, z) || Math.hypot(x, z) < 17) continue;
    const sx = range(1, 2.6), sy = range(0.8, 1.6), sz = range(0.8, 1.8);
    const yaw = range(0, 6.28);
    range(-0.3, 0.3); range(-0.3, 0.3);
    void sx; void sy; void sz; void yaw; // (las cajas grandes repartidas por el mapa se han quitado)
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
    if (Math.hypot(x + 2.5, z - 3.2) < 3 || crashFieldOriginal(x, z).h < -0.4) continue;
    const sz = range(0.07, 0.24);
    b.addDecor(new THREE.OctahedronGeometry(sz).scale(1.15, 0.6, 0.95), place(x, terrainHeight(x, z) + sz * 0.25, z, range(0, 6.28), range(0, 3), range(0, 3)), PEBBLES[Math.floor(rng() * PEBBLES.length)], range(0.75, 1.15), 1);
    n++;
  }

  // --- Más allá de las grietas: el cañón sigue y se abre por los lados (solo para mirar, sin cuerpo sólido). Se reparte lo mismo que antes por la zona
  // más ancha (queda poco poblada) y se quitan unas pocas agujas ---
  for (const side of [-1, 1]) {
    const wide = (u: number, z: number) => u * Math.max(HW, floorHalfWidth(u < 0 ? -1 : 1, z) - 5);
    for (let i = 0; i < 70; i++) { const u = range(-1, 1), z = side * range(CANYON_HALF_L + 20, 270); boulder(wide(u, z), z, range(1.2, 3.4)); }
    for (let i = 0; i < 12; i++) {
      const u = range(-1, 1) * 0.9, z = side * range(CANYON_HALF_L + 24, 250), r = range(4, 9), h = range(5, 12);
      const x = wide(u, z);
      b.addStrataHull(mesaGeometry(r, h, seed++), place(x, terrainHeight(x, z) - 1, z, range(0, 6.28)), STRATA, 1.9, false);
    }
    for (let i = 0; i < 18; i++) { const u = range(-1, 1), z = side * range(CANYON_HALF_L + 22, 260); spireCluster(wide(u, z), z, range(0.8, 1.5), true, i % 4 === 3); } // se quitan 4 de 18
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
  // las piezas que tapaban la cueva no se pusieron (Builder.overCave): fuera también de la lista de obstáculos
  for (let i = OBSTACLES.length - 1; i >= 0; i--) if (caveKeepOut(OBSTACLES[i].x, OBSTACLES[i].z, 0)) OBSTACLES.splice(i, 1);
}
