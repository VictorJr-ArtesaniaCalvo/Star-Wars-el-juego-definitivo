import * as THREE from 'three';
import { COBERTURA } from '../cinematic/script';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import type RAPIER from '@dimforge/rapier3d-compat';
import { CRASH, crashFieldOriginal, makeRng, terrainHeight } from './terrain';
import { laatData } from './laat';
import { slabRockTexture } from './materials';
import { bakeSunShadow } from './sunShadow';
import { withLightFloor } from './lightFill';

// Restos del accidente y cajas de suministros, sin cajas planas de color:
//  · Trozos del propio casco de la LAAT (alas, cubierta, cofia, panza, costados), cortados del modelo con su misma textura,
//    ennegrecidos y con quemaduras, medio enterrados alrededor de la nave y a lo largo del surco.
//  · Chapas de metal dobladas y retorcidas, hechas por código con trozos de la textura de la LAAT.
//  · Muros de chapa con puntales (coberturas) y cajas y barriles de la República (blanco y gris con franja roja, con polvo y quemaduras),
//    hechos por código (provisionales: más adelante se pueden cambiar por modelos).
// Todo se reúne en solo dos mallas (una con la textura de la LAAT y otra con el resto): dos llamadas de dibujo en total.

const h1 = (n: number) => { const x = Math.sin(n * 127.1 + 311.7) * 43758.5453; return x - Math.floor(x); };
const noise3 = (x: number, y: number, z: number) => h1(x * 12.9898 + y * 78.233 + z * 37.719);
const smooth = (a: number, b: number, v: number) => { const t = Math.min(1, Math.max(0, (v - a) / (b - a))); return t * t * (3 - 2 * t); };

// ---------- Trozos del casco ----------
interface Piece { geo: THREE.BufferGeometry; radius: number }

/** Se queda con los triángulos cuyo centro cumple la condición y los centra en el origen. */
function cut(src: THREE.BufferGeometry, test: (x: number, y: number, z: number) => boolean): Piece | null {
  const idx = src.index!, p = src.attributes.position, n = src.attributes.normal, uv = src.attributes.uv;
  const P: number[] = [], N: number[] = [], U: number[] = [];
  for (let t = 0; t < idx.count; t += 3) {
    const a = idx.getX(t), b = idx.getX(t + 1), c = idx.getX(t + 2);
    // se descartan los triángulos diminutos (tornillos, rejillas): conservan casi toda la superficie con una décima parte de los triángulos
    const ux = p.getX(b) - p.getX(a), uy = p.getY(b) - p.getY(a), uz = p.getZ(b) - p.getZ(a), vx = p.getX(c) - p.getX(a), vy = p.getY(c) - p.getY(a), vz = p.getZ(c) - p.getZ(a);
    if (0.5 * Math.hypot(uy * vz - uz * vy, uz * vx - ux * vz, ux * vy - uy * vx) < 0.04) continue;
    if (!test((p.getX(a) + p.getX(b) + p.getX(c)) / 3, (p.getY(a) + p.getY(b) + p.getY(c)) / 3, (p.getZ(a) + p.getZ(b) + p.getZ(c)) / 3)) continue;
    for (const v of [a, b, c]) { P.push(p.getX(v), p.getY(v), p.getZ(v)); N.push(n.getX(v), n.getY(v), n.getZ(v)); U.push(uv.getX(v), uv.getY(v)); }
  }
  if (P.length < 9 * 12) return null;
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(P, 3));
  g.setAttribute('normal', new THREE.Float32BufferAttribute(N, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(U, 2));
  g.computeBoundingBox();
  const c = g.boundingBox!.getCenter(new THREE.Vector3());
  g.translate(-c.x, -c.y, -c.z);
  g.computeBoundingSphere();
  return { geo: g, radius: g.boundingSphere!.radius };
}

/** Los trozos que se sacan del casco, por zonas (coordenadas del modelo: +X morro, +Y arriba, Z lados). */
function hullPieces(): Piece[] {
  const d = laatData();
  if (!d) return [];
  const hull = d.parts.casco.geo, wing = d.parts.ala.geo;
  const tests: Array<[THREE.BufferGeometry, (x: number, y: number, z: number) => boolean]> = [
    [hull, (_x, _y, z) => z < -5.8], // punta del ala
    [hull, (_x, _y, z) => z < -2.4 && z > -5.8], // ala
    [hull, (x, y, z) => y > 1.4 && Math.abs(z) < 2.3 && x > -5 && x < 3.5], // cubierta
    [hull, (x, _y, z) => x < -5.4 && Math.abs(z) < 2.3], // carenado de los motores
    [hull, (x, y, z) => y < -1.9 && Math.abs(z) < 2.3 && x > -5 && x < 5], // panza
    [hull, (x, y, z) => z > 0.9 && z < 2.3 && y > -1.5 && y < 1.8 && x > -4 && x < 3.5], // costado
    [wing, (_x, _y, z) => z > 5.6], // punta del ala arrancada
  ];
  const out: Piece[] = [];
  for (const [g, t] of tests) { const c = cut(g, t); if (c) out.push(c); }
  return out;
}

// ---------- Chapas de metal retorcidas ----------
/** Rectángulos de la textura de la LAAT que parecen chapa pintada (blanco, gris, crema, rojo y blanco): [u0, v0, u1, v1]. */
const SHEET_UV: Array<[number, number, number, number]> = [[0.29, 0.55, 0.5, 0.63], [0.02, 0.8, 0.27, 0.97], [0.58, 0.7, 0.78, 0.93], [0.78, 0.3, 0.98, 0.45]];

/** Chapa doblada: curvada, algo retorcida y arrugada, con una esquina arrancada. Mide w × h (m). */
function sheetGeometry(seed: number, w: number, h: number, curl: number, twist: number, crumple: number, fold: number): THREE.BufferGeometry {
  const nx = 5, ny = 3;
  const r = SHEET_UV[seed % SHEET_UV.length];
  const pts: THREE.Vector3[][] = [], uvs: THREE.Vector2[][] = [];
  for (let j = 0; j <= ny; j++) {
    pts.push([]); uvs.push([]);
    for (let i = 0; i <= nx; i++) {
      const u = i / nx, v = j / ny;
      let x = (u - 0.5) * w, y = v * h, z = 0;
      const a = (u - 0.5) * curl;
      if (Math.abs(curl) > 0.01) { const R = w / curl; x = Math.sin(a) * R; z = (1 - Math.cos(a)) * R; }
      z += Math.max(0, v - 0.55) * fold * h; // el borde de arriba se dobla hacia delante
      y -= Math.max(0, v - 0.55) * fold * h * 0.5;
      const tw = twist * (v - 0.5);
      const xr = x * Math.cos(tw) - z * Math.sin(tw), zr = x * Math.sin(tw) + z * Math.cos(tw);
      z = zr + (noise3(i * 1.7, j * 2.3, seed) - 0.5) * crumple * w;
      pts[j].push(new THREE.Vector3(xr, y, z));
      uvs[j].push(new THREE.Vector2(r[0] + u * (r[2] - r[0]), r[1] + (1 - v) * (r[3] - r[1])));
    }
  }
  const P: number[] = [], U: number[] = [];
  const tornU = 0.55 + 0.3 * h1(seed * 3.1), tornV = 0.6 + 0.25 * h1(seed * 5.3);
  for (let j = 0; j < ny; j++) {
    for (let i = 0; i < nx; i++) {
      const cu = (i + 0.5) / nx, cv = (j + 0.5) / ny;
      // esquina arrancada, con el borde roto
      if (cu > tornU && cv > tornV + (noise3(i, j, seed) - 0.5) * 0.3) continue;
      for (const [a, b, c] of [[[i, j], [i + 1, j], [i + 1, j + 1]], [[i, j], [i + 1, j + 1], [i, j + 1]]] as const) {
        for (const [ii, jj] of [a, b, c]) { const q = pts[jj][ii]; P.push(q.x, q.y, q.z); U.push(uvs[jj][ii].x, uvs[jj][ii].y); }
      }
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(P, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(U, 2));
  g.computeVertexNormals();
  return g;
}

/** Ennegrece y quema un trozo: tono oscuro de base, manchas casi negras y más suciedad por abajo. */
function burn(g: THREE.BufferGeometry, seed: number, base = 0.5) {
  const p = g.attributes.position;
  const col = new Float32Array(p.count * 3);
  g.computeBoundingBox();
  const y0 = g.boundingBox!.min.y, y1 = g.boundingBox!.max.y;
  for (let i = 0; i < p.count; i++) {
    const x = p.getX(i), y = p.getY(i), z = p.getZ(i);
    const n = noise3(Math.floor(x * 2) + seed, Math.floor(y * 2), Math.floor(z * 2));
    const smoothN = 0.5 * noise3(x * 0.9 + seed, y * 0.9, z * 0.9) + 0.5 * n;
    let k = base * (0.8 + 0.4 * smoothN) * (1 - 0.65 * smooth(0.55, 0.8, smoothN));
    k *= 1 - 0.25 * (1 - smooth(y0, y1, y));
    col[i * 3] = k * 1.06; col[i * 3 + 1] = k; col[i * 3 + 2] = k * 0.94;
  }
  g.setAttribute('color', new THREE.BufferAttribute(col, 3));
}

// ---------- Cajas, barriles y muros de chapa de la República ----------
// versión oscura (gris y negro) de las cajas y barriles, para variar el aspecto
const DK_BODY = new THREE.Color(0x55585d), DK_TRIM = new THREE.Color(0x24262a), DK_STRIPE = new THREE.Color(0x303338);
const WHITE = new THREE.Color(0xcdcec8), GREY = new THREE.Color(0x8b8e92), DGREY = new THREE.Color(0x474a4f), RED = new THREE.Color(0x8e2c2c), DARK = new THREE.Color(0x2b3039);

function boxPart(w: number, h: number, d: number, x: number, y: number, z: number, c: THREE.Color, rx = 0, rz = 0): THREE.BufferGeometry {
  const g = new THREE.BoxGeometry(w, h, d).toNonIndexed();
  if (rx || rz) g.applyMatrix4(new THREE.Matrix4().makeRotationFromEuler(new THREE.Euler(rx, 0, rz)));
  g.translate(x, y, z);
  const n = g.attributes.position.count, col = new Float32Array(n * 3);
  for (let i = 0; i < n; i++) col.set([c.r, c.g, c.b], i * 3);
  g.setAttribute('color', new THREE.BufferAttribute(col, 3));
  g.deleteAttribute('uv');
  return g;
}

/** Suciedad y quemaduras de una pieza ya coloreada: polvo claro hacia abajo y manchas negras irregulares. */
function weather(g: THREE.BufferGeometry, seed: number, soot = 0.5) {
  g.computeBoundingBox();
  const bb = g.boundingBox!;
  const p = g.attributes.position, c = g.attributes.color;
  const dust = new THREE.Color(0xa98a68);
  for (let i = 0; i < p.count; i++) {
    const x = p.getX(i), y = p.getY(i), z = p.getZ(i);
    const t = (y - bb.min.y) / Math.max(0.01, bb.max.y - bb.min.y);
    let r = c.getX(i), gg = c.getY(i), b = c.getZ(i);
    const dk = 0.18 * (1 - smooth(0, 0.5, t));
    r += (dust.r - r) * dk; gg += (dust.g - gg) * dk; b += (dust.b - b) * dk;
    const sn = 0.6 * noise3(x * 1.3 + seed, y * 1.3, z * 1.3) + 0.4 * noise3(Math.floor(x * 4) + seed, Math.floor(y * 4), Math.floor(z * 4));
    const k = 1 - soot * smooth(0.62, 0.85, sn);
    c.setXYZ(i, r * k, gg * k, b * k);
  }
}

type CrateKind = 'big' | 'long' | 'small';
/** Caja de suministros: cuerpo claro, tapa y base grises, postes en las esquinas, franja roja y asa. `open`: con la tapa entreabierta. */
function crateGeometry(kind: CrateKind, open: boolean, seed: number, dark = false): THREE.BufferGeometry {
  const [cW, cG, cR] = dark ? [DK_BODY, DK_TRIM, DK_STRIPE] : [WHITE, GREY, RED];
  const [w, h, d] = kind === 'big' ? [1.2, 1.15, 1.2] : kind === 'long' ? [1.8, 0.8, 0.7] : [0.7, 0.6, 0.6];
  const parts: THREE.BufferGeometry[] = [];
  const t = 0.07;
  parts.push(boxPart(w, h - t, d, 0, (h - t) / 2, 0, cW)); // cuerpo
  if (!open) parts.push(boxPart(w + 0.06, t, d + 0.06, 0, h - t / 2, 0, cG)); // tapa
  else {
    parts.push(boxPart(w - 0.1, 0.04, d - 0.1, 0, h - t - 0.03, 0, DARK)); // interior
    parts.push(boxPart(w + 0.06, t, d + 0.06, 0, h + d * 0.28, -d * 0.62, cG, -1.1, 0)); // tapa levantada
  }
  const sy = h * 0.5, o = 0.012;
  const stripe = (sw: number, sh: number, x: number, y: number, z: number, ry: number) => {
    const g = new THREE.PlaneGeometry(sw, sh).toNonIndexed();
    g.rotateY(ry); g.translate(x, y, z);
    const n = g.attributes.position.count, col = new Float32Array(n * 3);
    for (let i = 0; i < n; i++) col.set([cR.r, cR.g, cR.b], i * 3);
    g.setAttribute('color', new THREE.BufferAttribute(col, 3)); g.deleteAttribute('uv');
    return g;
  };
  parts.push(stripe(w, 0.14, 0, sy, d / 2 + o, 0), stripe(w, 0.14, 0, sy, -d / 2 - o, Math.PI), stripe(d, 0.14, w / 2 + o, sy, 0, Math.PI / 2), stripe(d, 0.14, -w / 2 - o, sy, 0, -Math.PI / 2));
  parts.push(boxPart(w + 0.06, t, d + 0.06, 0, t / 2, 0, cG)); // base
  const g = mergeGeometries(parts, false)!;
  for (const q of parts) q.dispose();
  weather(g, seed);
  return g;
}

/** Barril de la República: cilindro blanco con aros grises y una franja roja. */
function barrelGeometry(seed: number, tall = 0.95, dark = false): THREE.BufferGeometry {
  const [cW, cG, cR] = dark ? [DK_BODY, DK_TRIM, DK_STRIPE] : [WHITE, GREY, RED];
  const parts: THREE.BufferGeometry[] = [];
  const cyl = (r: number, hh: number, y: number, c: THREE.Color) => {
    const g = new THREE.CylinderGeometry(r, r, hh, 8).toNonIndexed();
    g.translate(0, y, 0);
    const n = g.attributes.position.count, col = new Float32Array(n * 3);
    for (let i = 0; i < n; i++) col.set([c.r, c.g, c.b], i * 3);
    g.setAttribute('color', new THREE.BufferAttribute(col, 3)); g.deleteAttribute('uv');
    return g;
  };
  parts.push(cyl(0.34, tall, tall / 2, cW), cyl(0.37, 0.07, 0.04, cG), cyl(0.37, 0.07, tall - 0.04, cG), cyl(0.345, 0.16, tall * 0.5, cR));
  const g = mergeGeometries(parts, false)!;
  for (const q of parts) q.dispose();
  weather(g, seed);
  return g;
}

/** Muro de chapa: una chapa curvada de metal pintado sobre dos puntales oscuros, inclinada hacia atrás. Mide w × h. */
function metalWallGeometry(seed: number, w: number, h: number): THREE.BufferGeometry {
  const sheet = sheetGeometry(seed, w, h, 0.5 + 0.3 * h1(seed), 0.08, 0.05, 0.0);
  sheet.rotateX(-0.28);
  sheet.translate(0, 0.12, 0);
  burn(sheet, seed, 0.78);
  const struts: THREE.BufferGeometry[] = [];
  for (const sx of [-0.32, 0.32]) struts.push(boxPart(0.08, h * 1.05, 0.08, sx * w, h * 0.5, -0.32, DARK, 0.5, 0)); // puntales traseros
  struts.push(boxPart(w * 0.9, 0.07, 0.07, 0, h * 0.62, -0.27, DGREY)); // travesaño
  const sg = mergeGeometries(struts, false)!;
  for (const q of struts) q.dispose();
  weather(sg, seed, 0.3);
  return mergeToLaat(sheet, sg);
}
/** Une una pieza con textura (chapa) y otra sin ella dándole coordenadas de textura vacías: se dibujan juntas con el material de la LAAT. */
function mergeToLaat(a: THREE.BufferGeometry, b: THREE.BufferGeometry): THREE.BufferGeometry {
  // las piezas sin textura toman un punto gris oscuro de la textura (el borde vacío del atlas)
  const n = b.attributes.position.count, uv = new Float32Array(n * 2);
  for (let i = 0; i < n; i++) { uv[i * 2] = 0.5; uv[i * 2 + 1] = 0.005; }
  b.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
  b.computeVertexNormals();
  a.computeVertexNormals();
  return mergeGeometries([a, b], false)!;
}

// ---------- Colocación ----------
export interface CoverSpot { x: number; z: number; w: number; h: number; yaw: number }
/** Muros de chapa que sustituyen a muros en ruinas (los rellena `buildRocks`). */
export const METAL_WALL_SPOTS: CoverSpot[] = [];
const SPAWN = { x: -2.5, z: 3.2 };

export class Wreckage {
  constructor(scene: THREE.Scene, rapier: typeof RAPIER, physics: RAPIER.World) {
    const rng = makeRng(60606);
    const range = (a: number, b: number) => a + rng() * (b - a);
    const laat: THREE.BufferGeometry[] = []; // con la textura de la LAAT
    const props: THREE.BufferGeometry[] = []; // cajas y barriles
    const up = new THREE.Vector3(0, 1, 0);
    const q = new THREE.Quaternion(), e = new THREE.Euler(), m = new THREE.Matrix4(), one = new THREE.Vector3(1, 1, 1);
    const free = (x: number, z: number) => Math.hypot(x - SPAWN.x, z - SPAWN.z) > 2.8 && crashFieldOriginal(x, z).h > -1.0;

    /** Coloca una copia de la geometría y, si se pide, un cuerpo sólido. */
    const place = (list: THREE.BufferGeometry[], src: THREE.BufferGeometry, x: number, y: number, z: number, yaw: number, rx: number, rz: number, s: number, solid?: 'hull' | { hx: number; hy: number; hz: number; oy: number; tilt?: number }) => {
      e.set(rx, yaw, rz, 'YXZ');
      q.setFromEuler(e);
      m.compose(new THREE.Vector3(x, y, z), q, new THREE.Vector3(s, s, s));
      const g = src.clone();
      g.applyMatrix4(m);
      list.push(g);
      if (solid === 'hull') {
        const desc = rapier.ColliderDesc.convexHull(new Float32Array(g.attributes.position.array));
        if (desc) physics.createCollider(desc);
      } else if (solid) {
        // el muro de chapa está inclinado hacia atrás: el cuerpo sólido se inclina igual (desde su base)
        const qf = solid.tilt ? q.clone().multiply(new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(1, 0, 0), solid.tilt)) : q;
        const c = new THREE.Vector3(0, solid.oy * s, 0).applyQuaternion(qf);
        physics.createCollider(rapier.ColliderDesc.cuboid(solid.hx * s, solid.hy * s, solid.hz * s).setTranslation(x + c.x, y + c.y, z + c.z).setRotation({ x: qf.x, y: qf.y, z: qf.z, w: qf.w }));
      }
    };

    // --- 1. Trozos del casco de la LAAT, quemados, medio enterrados ---
    const pieces = hullPieces();
    const SC = 0.7; // la misma escala con la que se colocó la nave
    const cos = Math.cos(CRASH.yaw), sin = Math.sin(CRASH.yaw);
    const pieceSpots: Array<[number, number]> = [];
    for (let n = 0; n < 9 && pieces.length; n++) pieceSpots.push([CRASH.x + range(-13, 13), CRASH.z + range(-8, 8)]); // alrededor de la nave
    for (let n = 0; n < 5 && pieces.length; n++) { const back = range(8, 34), lat = range(-3, 3) + 0.9 * Math.sin(back * 0.11); pieceSpots.push([CRASH.x - back * cos + lat * sin, CRASH.z + back * sin + lat * cos]); } // por el surco
    let solidHull = 0;
    pieceSpots.forEach(([x, z], k) => {
      if (!free(x, z) || k % 3 === 2) return; // se quita un tercio de los trozos
      const pc = pieces[k % pieces.length];
      const s = SC * range(0.45, 0.8) * (pc.radius > 5 ? 0.6 : 1);
      const g = pc.geo.clone();
      burn(g, k + 1, 0.55);
      const sink = pc.radius * s * range(0.25, 0.55);
      const big = pc.radius * s > 1.0 && solidHull < 6 && Math.hypot(x - SPAWN.x, z - SPAWN.z) > 6;
      if (big) solidHull++;
      place(laat, g, x, terrainHeight(x, z) - sink + pc.radius * s * 0.2, z, range(0, 6.28), range(-0.5, 0.5), range(-0.5, 0.5), s, big ? 'hull' : undefined);
      g.dispose();
    });

    // --- 2. Chapas retorcidas, de varios tamaños y medio enterradas (surco y alrededores) ---
    const sheets = Array.from({ length: 6 }, (_, i) => { const w = range(1.0, 2.6), h = range(0.8, 1.8); const g = sheetGeometry(i, w, h, range(-1.2, 1.2), range(-0.6, 0.6), 0.12, range(0, 0.7)); burn(g, 20 + i, 0.6); return g; });
    for (let n = 0; n < 24; n++) {
      let x: number, z: number;
      if (n < 18) { const back = range(5, 36), lat = range(-3.2, 3.2) + 0.9 * Math.sin(back * 0.11); x = CRASH.x - back * cos + lat * sin; z = CRASH.z + back * sin + lat * cos; }
      else { const a = range(0, 6.28), r = range(5, 14); x = CRASH.x + Math.cos(a) * r * 1.2; z = CRASH.z + Math.sin(a) * r * 0.8; }
      if (!free(x, z) || n % 3 === 2) continue; // se quita un tercio de las chapas
      const g = sheets[n % sheets.length];
      place(laat, g, x, terrainHeight(x, z) + range(-0.15, 0.1), z, range(0, 6.28), range(-1.0, 1.0), range(-0.6, 0.6), range(0.8, 1.3));
    }

    // --- 3. Coberturas junto a la nave: dos tipos de muro de chapa y cajas de la República (donde estaban las barricadas y las cajas) ---
    const wall = [metalWallGeometry(1, 2.6, 1.2), metalWallGeometry(2, 2.2, 1.2), metalWallGeometry(3, 3.2, 1.3)];
    const wallAt = (gi: number, x: number, z: number, yaw: number, w: number, h: number) =>
      place(laat, wall[gi], x, terrainHeight(x, z) - 0.05, z, yaw, 0, 0, 1, { hx: w / 2, hy: h / 2, hz: 0.3, oy: h / 2, tilt: -0.28 });
    wallAt(0, -8.8, -2.9, 0.28, 2.6, 1.2); wallAt(1, 9.8, -2.2, -0.3, 2.2, 1.2); wallAt(2, -10.2, 0.8, 1.15, 3.2, 1.3);
    // Cajas y barriles de la zona del impacto: las de cobertura junto a la nave y otras despedidas por el choque (decoración, algunas volcadas o abiertas).
    // Se juntan primero todas para quitar la mitad (primero las de decoración) y pintar de gris y negro un tercio de las que quedan.
    const mk = (kind: CrateKind, open: boolean, seed: number) => [crateGeometry(kind, open, seed), crateGeometry(kind, open, seed, true)] as const;
    const big = mk('big', false, 1), bigOpen = mk('big', true, 2), long = mk('long', false, 3), small = mk('small', false, 4), smallOpen = mk('small', true, 5);
    type Item = { cover: boolean; put: (dark: boolean) => void };
    const items: Item[] = [];
    const crateAt = (g: readonly [THREE.BufferGeometry, THREE.BufferGeometry], k: CrateKind, x: number, z: number, yaw: number, rx = 0, rz = 0, solid = true, sink = 0.05) => {
      const [w, h, d] = k === 'big' ? [1.2, 1.15, 1.2] : k === 'long' ? [1.8, 0.8, 0.7] : [0.7, 0.6, 0.6];
      items.push({ cover: solid, put: (dark) => place(props, g[dark ? 1 : 0], x, terrainHeight(x, z) - sink, z, yaw, rx, rz, 1, solid ? { hx: w / 2, hy: h / 2, hz: d / 2, oy: h / 2 } : undefined) });
    };
    crateAt(big, 'big', -4.6, 0.7, 0.2); crateAt(long, 'long', 6.4, 1.6, -0.15); crateAt(small, 'small', 6.5, 2.8, 0.4);
    crateAt(bigOpen, 'big', 0.8, 4.6, 0.1); crateAt(small, 'small', -0.5, 4.9, 0.7);
    for (let n = 0; n < 18; n++) {
      const a = range(0, 6.28), r = range(5, 16);
      const x = CRASH.x + Math.cos(a) * r * 1.25, z = CRASH.z + Math.sin(a) * r * 0.85;
      if (!free(x, z)) continue;
      const kind = rng();
      const tip = rng() < 0.4 ? range(1.2, 1.7) : 0; // volcada
      if (kind < 0.3) crateAt(rng() < 0.5 ? small : smallOpen, 'small', x, z, range(0, 6.28), tip, range(-0.2, 0.2), false, 0.08);
      else if (kind < 0.55) crateAt(long, 'long', x, z, range(0, 6.28), 0, tip, false, 0.06);
      else if (kind < 0.7) crateAt(rng() < 0.5 ? big : bigOpen, 'big', x, z, range(0, 6.28), 0, tip, false, 0.1);
      else {
        const yaw = range(0, 6.28), rz = range(-0.2, 0.2), ge = [barrelGeometry(n), barrelGeometry(n, 0.95, true)] as const;
        items.push({ cover: false, put: (dark) => place(props, ge[dark ? 1 : 0], x, terrainHeight(x, z) - 0.04, z, yaw, tip ? 1.5 : 0, rz, 1, undefined) });
      }
    }
    const covers = items.filter((i) => i.cover), decor = items.filter((i) => !i.cover);
    const keepTotal = Math.ceil((covers.length + decor.length) / 2); // se queda la mitad
    const keepDecor = Math.max(0, Math.min(decor.length, keepTotal - covers.length));
    const kept = [...covers, ...decor.filter((_, i) => Math.floor(((i + 1) * keepDecor) / Math.max(1, decor.length)) > Math.floor((i * keepDecor) / Math.max(1, decor.length)))];
    const order = kept.map((_, i) => i).sort(() => rng() - 0.5);
    const darkSet = new Set(order.slice(0, Math.floor(kept.length / 3))); // un tercio, al azar, en gris y negro
    kept.forEach((it, i) => it.put(darkSet.has(i)));
    // Caja tras la que se cubre el comando en la cinemática inicial (y donde empieza la partida tras verla): cobertura sólida como las demás
    place(props, big[0], COBERTURA.x, terrainHeight(COBERTURA.x, COBERTURA.z) - 0.12, COBERTURA.z, COBERTURA.giro, 0, 0, 1, { hx: 0.6, hy: 0.575, hz: 0.6, oy: 0.575 });
    // (las cajas grandes repartidas por el resto del mapa se han quitado: CRATE_SPOTS ya no se usa)

    METAL_WALL_SPOTS.forEach((c, i) => wallAt(i % 3, c.x, c.z, c.yaw, [2.6, 2.2, 3.2][i % 3], [1.2, 1.2, 1.3][i % 3]));

    const grunge = (() => {
      const mat = new THREE.MeshLambertMaterial({ vertexColors: true });
      const tex = slabRockTexture();
      if (!tex) return mat;
      mat.onBeforeCompile = (sh) => {
        sh.uniforms.gMap = { value: tex };
        sh.vertexShader = sh.vertexShader.replace('#include <common>', '#include <common>\nvarying vec3 vWp;\nvarying vec3 vWn;').replace('#include <begin_vertex>', '#include <begin_vertex>\nvWp = (modelMatrix * vec4(position, 1.0)).xyz;\nvWn = normalize(mat3(modelMatrix) * objectNormal);');
        sh.fragmentShader = sh.fragmentShader.replace('#include <common>', '#include <common>\nvarying vec3 vWp;\nvarying vec3 vWn;\nuniform sampler2D gMap;').replace('#include <map_fragment>', `
  vec3 an = abs(normalize(vWn)); an = an * an;
  float gl = (texture2D(gMap, vWp.zy * 0.7).b * an.x + texture2D(gMap, vWp.xy * 0.7).b * an.z + texture2D(gMap, vWp.xz * 0.7).b * an.y) / max(an.x + an.y + an.z, 0.001);
  diffuseColor.rgb *= mix(1.0, gl * 1.25, 0.55); // mugre y desgaste`);
      };
      mat.customProgramCacheKey = () => 'grunge1';
      return withLightFloor(mat);
    })();
    const add = (list: THREE.BufferGeometry[], mat: THREE.Material, cast = true) => {
      if (!list.length) return;
      const g = mergeGeometries(list, false)!;
      for (const x of list) x.dispose();
      g.computeBoundingSphere();
      bakeSunShadow(g);
      const mesh = new THREE.Mesh(g, mat);
      mesh.castShadow = cast; mesh.receiveShadow = true;
      scene.add(mesh);
    };
    const d = laatData();
    const laatMat = withLightFloor(new THREE.MeshLambertMaterial({ map: d?.textures[0] ?? null, vertexColors: true, side: THREE.DoubleSide }));
    add(laat, laatMat);
    add(props, grunge);
    void up; void one;
  }
}
