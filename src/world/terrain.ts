import * as THREE from 'three';
import type RAPIER from '@dimforge/rapier3d-compat';

export const WORLD_SEED = 1138;
// La malla del terreno es mucho más larga que la zona jugable: el cañón sigue a lo lejos.
const GRID_STEP = 1.7; // detalle (m) en la zona cercana
const X_FINE = 74, X_MAX = 260; // medio ancho: zona detallada y total
const Z_FINE = 116, Z_MAX = 330; // medio largo: zona detallada y total

// El campo de batalla es un cañón: suelo de 80 m de ancho (de la columna E a la H del mapa)
// y 192 m de largo, con paredes altas en terrazas y los dos extremos cerrados.
export const CANYON_HALF_W = 40;
export const CANYON_HALF_L = 96; // hasta aquí se puede caminar
const VIS_L = 320; // el cañón sigue (sin poder llegar) hasta aquí
// Grieta que corta el cañón en cada extremo: el final de la zona jugable.
const CHASM_Z = 105; // centro, medido desde tu posición
const CHASM_HALF = 6.5; // medio ancho
const CHASM_DEPTH = 34;

/** Dónde quedó la nave droide estrellada (al fondo del cañón, por delante, tras la grieta). */
export const WRECK = { x: -7, z: -142, yaw: 0.28 };
const WALL_H = 34; // altura de las paredes
const WALL_SPAN = 16; // grosor de la pared (de la base a la cima)

/** Dónde se estrelló la cañonera: centro, giro y hacia dónde apunta el morro. */
export const CRASH = { x: 0.3, z: -1.9, yaw: 0.16 };
const CY = Math.cos(CRASH.yaw);
const SY = Math.sin(CRASH.yaw);

export const smoothstep = (a: number, b: number, v: number) => {
  const t = Math.min(1, Math.max(0, (v - a) / (b - a)));
  return t * t * (3 - 2 * t);
};

// Generador de números "aleatorios" repetibles: misma semilla → mismo escenario siempre.
export function makeRng(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Terrazas: sube a escalones (tramos casi verticales con repisas llanas entre medias). */
function terrace(t: number) {
  if (t >= 1) return 1;
  const k = t * 4;
  const i = Math.floor(k);
  return (i + smoothstep(0.55, 1, k - i)) / 4;
}

/**
 * El hueco que dejó la nave al estrellarse: un cráter con borde de tierra levantada,
 * y un surco largo por donde vino arrastrándose. `scorch` marca el suelo quemado.
 */
export function crashField(x: number, z: number) {
  const dx = x - CRASH.x;
  const dz = z - CRASH.z;
  const u = dx * CY - dz * SY; // a lo largo de la nave (+ hacia el morro)
  const v = dx * SY + dz * CY; // de lado
  const e = Math.hypot(u / 11, v / 7);
  let h = -1.2 * (1 - smoothstep(0.35, 1.0, e));
  h += 0.85 * Math.exp(-(((e - 1.12) / 0.2) ** 2));
  let scorch = 1 - smoothstep(0.6, 1.5, e);
  const back = -u;
  if (back > 0 && back < 36) {
    const m = smoothstep(0, 5, back) * (1 - smoothstep(24, 36, back));
    const w = 1.9;
    const av = Math.abs(v);
    const depth = 0.95 * (1 - back / 36) + 0.15;
    h += m * (-depth * (1 - smoothstep(0.55, 1.0, av / w)) + 0.4 * Math.exp(-(((av - w * 1.3) / 0.5) ** 2)));
    scorch = Math.max(scorch, 0.55 * m * (1 - smoothstep(0.8, 1.6, av / w)));
  }
  return { h, scorch };
}

/** Grieta de cada extremo: 1 dentro, 0 fuera, bordes casi verticales. */
function chasm(x: number, z: number) {
  const edge = smoothstep(0, 2.2, CHASM_HALF - Math.abs(Math.abs(z) - CHASM_Z));
  return edge * (1 - smoothstep(41, 46, Math.abs(x)));
}

/** Distancia al suelo del cañón (0 = dentro). Crece al adentrarse en las paredes. */
function wallDistance(x: number, z: number) {
  return Math.hypot(Math.max(Math.abs(x) - CANYON_HALF_W, 0), Math.max(Math.abs(z) - VIS_L, 0));
}

// Altura del suelo en cualquier punto.
// - Llano alrededor de tu posición; las dunas y el relieve crecen poco a poco al alejarse.
// - El suelo del cañón sube suavemente hacia los dos extremos.
// - Paredes en terrazas y una meseta alta alrededor.
export function terrainHeight(x: number, z: number): number {
  const ax = Math.abs(x);
  const az = Math.abs(z);
  const flat = smoothstep(8, 26, Math.hypot(x, z));
  const prog = 0.15 + 0.85 * smoothstep(8, 90, az);
  const dunes =
    2.6 * Math.sin(x * 0.031 + 1.3) * Math.cos(z * 0.027 - 0.4) +
    1.3 * Math.sin(x * 0.071 + z * 0.053 + 2.1) +
    0.55 * Math.sin(x * 0.16 - z * 0.19 + 0.7) +
    0.25 * Math.sin(x * 0.37 + 1.1) * Math.sin(z * 0.41);
  let h = dunes * prog * flat;
  h += 9 * Math.pow(smoothstep(30, 100, az), 1.3) * flat; // el suelo sube hacia los extremos
  h += 3 * smoothstep(18, 40, ax) * flat; // y se levanta un poco junto a las paredes
  h += 0.05 * Math.max(az - 112, 0); // pasada la grieta, el cañón sigue subiendo despacio
  h -= chasm(x, z) * CHASM_DEPTH;
  const wd = wallDistance(x, z);
  if (wd > 0) h += terrace(wd / WALL_SPAN) * WALL_H;
  return h + crashField(x, z).h;
}

// Textura de arena hecha por código (grano fino). Provisional hasta la Fase 6.
function sandTexture(): THREE.Texture {
  const s = 256;
  const c = document.createElement('canvas');
  c.width = c.height = s;
  const g = c.getContext('2d')!;
  const img = g.createImageData(s, s);
  const rng = makeRng(7);
  for (let i = 0; i < s * s; i++) {
    const v = 205 + rng() * 50 - (rng() < 0.04 ? 45 : 0);
    img.data[i * 4] = v;
    img.data[i * 4 + 1] = v;
    img.data[i * 4 + 2] = v;
    img.data[i * 4 + 3] = 255;
  }
  g.putImageData(img, 0, 0);
  const t = new THREE.CanvasTexture(c);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.repeat.set(1, 1);
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 4;
  return t;
}

// Colores de las capas de roca de las paredes (como los estratos del Gran Cañón).
const STRATA = [0xa84a2a, 0xc2693c, 0x8a3a22, 0xb85a32, 0x74301c, 0xcf7a44].map((c) => new THREE.Color(c));

/** Coordenadas de una malla: fina cerca del centro y cada vez más gruesa hacia los bordes. */
function axis(fine: number, max: number): number[] {
  const half: number[] = [0];
  let v = 0;
  while (v < fine) { v += GRID_STEP; half.push(v); }
  let step = GRID_STEP;
  while (v < max) { step *= 1.16; v = Math.min(max, v + step); half.push(v); }
  return [...half.slice(1).reverse().map((c) => -c), ...half];
}

export function buildTerrain(scene: THREE.Scene, rapier: typeof RAPIER, physics: RAPIER.World) {
  const xs = axis(X_FINE, X_MAX);
  const zs = axis(Z_FINE, Z_MAX);
  const nx = xs.length, nz = zs.length;
  const positions = new Float32Array(nx * nz * 3);
  const uvs = new Float32Array(nx * nz * 2);
  for (let j = 0; j < nz; j++) {
    for (let i = 0; i < nx; i++) {
      const k = j * nx + i;
      positions[k * 3] = xs[i];
      positions[k * 3 + 1] = terrainHeight(xs[i], zs[j]);
      positions[k * 3 + 2] = zs[j];
      uvs[k * 2] = xs[i] / 3.9;
      uvs[k * 2 + 1] = zs[j] / 3.9;
    }
  }
  const index: number[] = [];
  for (let j = 0; j < nz - 1; j++) {
    for (let i = 0; i < nx - 1; i++) {
      const a = j * nx + i, b = a + 1, c = a + nx, d = c + 1;
      index.push(a, c, b, b, c, d);
    }
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  geo.setAttribute('uv', new THREE.BufferAttribute(uvs, 2));
  geo.setIndex(index);
  const pos = geo.attributes.position as THREE.BufferAttribute;
  geo.computeVertexNormals();
  const nor = geo.attributes.normal as THREE.BufferAttribute;

  const colors = new Float32Array(pos.count * 3);
  const light = new THREE.Color(0xb8623c);
  const dark = new THREE.Color(0x7c3c26);
  const soot = new THREE.Color(0x24160f);
  const tmp = new THREE.Color();
  for (let i = 0; i < pos.count; i++) {
    const x = pos.getX(i);
    const z = pos.getZ(i);
    const h = pos.getY(i);
    const wd = wallDistance(x, z);
    if (wd > 0.3) {
      // Pared: franjas horizontales de distinto color; más oscuro cuanto más vertical.
      const band = Math.floor(h / 3.4 + Math.sin(x * 0.07 + z * 0.05) * 0.4);
      tmp.copy(STRATA[((band % STRATA.length) + STRATA.length) % STRATA.length]);
      // Surcos verticales (la roca erosionada cae en cortinas)
      const along = Math.abs(x) - CANYON_HALF_W > Math.abs(z) - CANYON_HALF_L ? z : x;
      const flute = 0.86 + 0.14 * Math.sin(along * 2.1 + Math.sin(along * 0.37) * 2.6);
      tmp.multiplyScalar((0.5 + 0.5 * nor.getY(i)) * flute);
    } else {
      const k = 0.5 + 0.5 * Math.sin(x * 0.05 + Math.sin(z * 0.08) * 2) * Math.cos(z * 0.043 + 1);
      tmp.copy(dark).lerp(light, Math.min(1, Math.max(0, k * 0.7 + h * 0.06 + 0.2)));
    }
    const sc = Math.max(crashField(x, z).scorch, 0.8 * (1 - smoothstep(10, 34, Math.hypot(x - WRECK.x, z - WRECK.z))));
    if (sc > 0.01) tmp.lerp(soot, Math.min(0.88, sc));
    // La grieta se oscurece con la profundidad.
    const cz = chasm(x, z);
    if (cz > 0.01) tmp.lerp(soot, Math.min(0.9, cz * (0.35 + (-Math.min(h, 0) + 4) / 30)));
    colors.set([tmp.r, tmp.g, tmp.b], i * 3);
  }
  geo.setAttribute('color', new THREE.BufferAttribute(colors, 3));

  const mesh = new THREE.Mesh(geo, new THREE.MeshLambertMaterial({ vertexColors: true, map: sandTexture() }));
  mesh.receiveShadow = true;
  scene.add(mesh);

  // Suelo "sólido" para la física.
  const verts = new Float32Array(pos.array);
  const idx = new Uint32Array(geo.index!.array);
  physics.createCollider(rapier.ColliderDesc.trimesh(verts, idx));
  return mesh;
}
