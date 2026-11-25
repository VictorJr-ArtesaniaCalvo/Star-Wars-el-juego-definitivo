import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { makeRng } from '../terrain';
import { applyWorldTextures, groundExtraTexture, groundTexture, pitsTexture, rockJointsTexture, rockTexture, slabsTexture, strataTexture } from '../materials';
import {
  ARENA_A, ARENA_B, CLIFF, COVERS, DOOR, DOORS, PALCO, PILLAR, PILLARS, POSTS, TIERS, WALL, doorAngle, ovalPoint, type Cover,
} from './layout';

// FASE 1 — MAQUETA EN GRIS de la arena: solo formas, sin texturas. Cada grupo de piezas lleva un gris distinto
// para distinguirlas. Todo sale de las medidas de layout.ts.

const TAU = Math.PI * 2;
const WALKWAY = 2.5; // pasillo entre el muro bajo y el primer anillo de gradas (distancia desde el borde del suelo)
/** Hasta qué anillo de gradas atraviesan las puertas (los de abajo se cortan para dejar el túnel). */
const DOOR_TIERS = 2;

/** Distancia desde el borde del suelo a la que empieza cada anillo de gradas. */
export const tierFront = (k: number) => WALKWAY + k * TIERS.depth;
/** Altura de la parte de arriba de cada anillo. */
export const tierTop = (k: number) => WALL.height + (k + 1) * TIERS.rise;

export const GREY = {
  floor: 0xd9d1c3,
  ground: 0xb9b0a2,
  wall: 0x9c948a,
  tiers: 0xb3aca2,
  tierWall: 0x8d857b,
  cliff: 0x8a837b,
  column: 0x7d766f,
  door: 0x262220,
  frame: 0x8f877e,
  pillar: 0x6e655c,
  rock: 0x857d74,
  crate: 0xc8c8c8,
  debris: 0x5f6067,
  palco: 0xbcae9c,
  post: 0x5a524a,
};

type Part = keyof typeof GREY;

/**
 * PRUEBA DE COLOR: color de cada pieza con las texturas que ya usa el cañón.
 * tex = cuánta textura de roca lleva (0 = color liso: metal, cajas, huecos oscuros); kind 1 = arenisca con grietas y juntas (agujas del cañón);
 * bands = franjas de color por altura (estratos); ground = textura de suelo (arena) en lugar de roca.
 */
export const COLOR: Record<Part, { c: number; tex: number; kind?: number; bands?: number; ground?: boolean }> = {
  floor: { c: 0xcdb49e, tex: 1, ground: true }, // arena clara como en la película (la textura de arena ya la amarillea)
  ground: { c: 0xb98a62, tex: 1, ground: true },
  wall: { c: 0xa0623c, tex: 1, kind: 1 },
  tiers: { c: 0xb97c50, tex: 1, bands: 0.08 },
  tierWall: { c: 0x8f5434, tex: 1, bands: 0.1 },
  cliff: { c: 0x9a5534, tex: 1, bands: 0.16 },
  column: { c: 0x96502f, tex: 1, kind: 1, bands: 0.1 },
  door: { c: 0x150d08, tex: 0 },
  frame: { c: 0x9c5e38, tex: 1, kind: 1 },
  pillar: { c: 0x7c4a2e, tex: 1, kind: 1 },
  rock: { c: 0x8a4a30, tex: 1 },
  crate: { c: 0xb4b1a8, tex: 0 },
  debris: { c: 0x56575d, tex: 0 },
  palco: { c: 0xc08c60, tex: 1, kind: 1 },
  post: { c: 0x6a3e26, tex: 1, kind: 1 },
};

/** Junta las piezas por color para dibujar pocas mallas. */
class Parts {
  private geos = new Map<Part, THREE.BufferGeometry[]>();
  add(part: Part, g: THREE.BufferGeometry) {
    const ng = g.index ? g.toNonIndexed() : g;
    for (const k of Object.keys(ng.attributes)) if (k !== 'position' && k !== 'normal') ng.deleteAttribute(k);
    if (!ng.attributes.normal) ng.computeVertexNormals();
    if (!this.geos.has(part)) this.geos.set(part, []);
    this.geos.get(part)!.push(ng);
  }
  build(group: THREE.Group, color: boolean) {
    for (const [part, list] of this.geos) {
      const g = mergeGeometries(list);
      const m = new THREE.Mesh(g, color ? colorMaterial(part, g) : new THREE.MeshLambertMaterial({ color: GREY[part], side: part === 'floor' || part === 'ground' ? THREE.FrontSide : THREE.DoubleSide }));
      m.name = part;
      m.receiveShadow = true;
      m.castShadow = part !== 'floor' && part !== 'ground'; // el suelo no hace sombra sobre nada
      group.add(m);
    }
  }
}

/** Material de la prueba de color: color por vértice (con franjas por altura) y las texturas del cañón proyectadas en el mundo. */
function colorMaterial(part: Part, g: THREE.BufferGeometry) {
  const cfg = COLOR[part];
  const p = g.attributes.position, n = p.count;
  const col = new Float32Array(n * 3);
  const base = new THREE.Color(cfg.c), tmp = new THREE.Color();
  for (let i = 0; i < n; i++) {
    tmp.copy(base);
    if (cfg.bands) {
      const y = p.getY(i), x = p.getX(i), z = p.getZ(i);
      const band = Math.sin(y * 0.55 + Math.sin(x * 0.05 + z * 0.04) * 1.2) + 0.5 * Math.sin(y * 1.7 + 1.3);
      tmp.multiplyScalar(1 + cfg.bands * band);
    }
    col.set([tmp.r, tmp.g, tmp.b], i * 3);
  }
  g.setAttribute('color', new THREE.BufferAttribute(col, 3));
  g.setAttribute('texAmt', new THREE.BufferAttribute(new Float32Array(n).fill(cfg.tex), 1));
  g.setAttribute('texKind', new THREE.BufferAttribute(new Float32Array(n).fill(cfg.kind ?? 0), 1));
  // el suelo solo se ve por arriba
  const mat = new THREE.MeshLambertMaterial({ vertexColors: true, side: cfg.ground ? THREE.FrontSide : THREE.DoubleSide });
  const tex = { ground: groundTexture(), groundX: groundExtraTexture(), slabs: slabsTexture(), strata: strataTexture(), pits: pitsTexture() };
  if (cfg.ground) return applyWorldTextures(mat, { ...tex, groundScale: 0.4 });
  if (cfg.tex === 0) return mat;
  return applyWorldTextures(mat, { ...tex, spire: { rock: rockTexture(), joints: rockJointsTexture() }, rockOnly: true, strataScale: 0.2 });
}

/** Medio ángulo que ocupa una puerta sobre el óvalo agrandado `d` metros (para cortar muros y gradas en recto). */
export function doorHalfAngle(axisX: boolean, d: number) {
  const half = DOOR.width / 2;
  return Math.asin(Math.min(1, half / (axisX ? ARENA_B + d : ARENA_A + d)));
}

/**
 * Barre un perfil (pares distancia-desde-el-borde, altura) alrededor del óvalo. Si `gaps`, deja libres las 4 puertas
 * con un corte recto (cada punto del perfil calcula su propio borde, así el hueco tiene paredes rectas).
 */
function sweep(profile: Array<[number, number]>, segs: number, gaps: boolean): THREE.BufferGeometry[] {
  const out: THREE.BufferGeometry[] = [];
  const doorTs = DOORS.map((d) => ((doorAngle(d) % TAU) + TAU) % TAU).sort((a, b) => a - b); // 0, π/2, π, 3π/2
  const ranges: Array<(d: number) => [number, number]> = gaps
    ? doorTs.map((t0, i) => {
        const t1 = i + 1 < doorTs.length ? doorTs[i + 1] : doorTs[0] + TAU;
        const ax0 = Math.abs(Math.cos(t0)) > 0.5, ax1 = Math.abs(Math.cos(t1)) > 0.5;
        return (d: number) => [t0 + doorHalfAngle(ax0, d), t1 - doorHalfAngle(ax1, d)];
      })
    : [() => [0, TAU]];
  for (const range of ranges) {
    const [a0] = range(0);
    const [, a1] = range(0);
    const n = Math.max(4, Math.round((segs * (a1 - a0)) / TAU));
    for (let p = 0; p < profile.length - 1; p++) {
      const [dA, yA] = profile[p], [dB, yB] = profile[p + 1];
      const rA = range(dA), rB = range(dB);
      const pos: number[] = [];
      for (let i = 0; i <= n; i++) {
        const s = i / n;
        const tA = rA[0] + (rA[1] - rA[0]) * s, tB = rB[0] + (rB[1] - rB[0]) * s;
        const [xA, zA] = ovalPoint(tA, dA), [xB, zB] = ovalPoint(tB, dB);
        pos.push(xA, yA, zA, xB, yB, zB);
      }
      const idx: number[] = [];
      for (let i = 0; i < n; i++) {
        const a = i * 2, b = a + 1, c = a + 2, d = a + 3;
        idx.push(a, c, b, b, c, d);
      }
      const g = new THREE.BufferGeometry();
      g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
      g.setIndex(idx);
      g.computeVertexNormals();
      out.push(g);
    }
  }
  return out;
}

/** Caja orientada: centro, medidas y giro en vertical. */
export function box(w: number, h: number, d: number, x: number, y: number, z: number, yaw = 0, pitch = 0, roll = 0) {
  const g = new THREE.BoxGeometry(w, h, d);
  g.applyMatrix4(new THREE.Matrix4().makeRotationFromEuler(new THREE.Euler(pitch, yaw, roll, 'YXZ')).setPosition(x, y, z));
  return g;
}

// ── Suelo, muro, postes y gradas ────────────────────────────────────────────

function buildFloor(parts: Parts) {
  const g = new THREE.CircleGeometry(1, 96);
  g.rotateX(-Math.PI / 2);
  g.scale(ARENA_A + 0.5, 1, ARENA_B + 0.5);
  parts.add('floor', g);
  // suelo de alrededor (bajo las gradas y los túneles)
  const r = new THREE.CircleGeometry(1, 64);
  r.rotateX(-Math.PI / 2);
  r.scale(ARENA_A + 70, 1, ARENA_B + 70);
  r.translate(0, -0.4, 0); // algo por debajo: si estuviera casi a la misma altura que la arena, desde lejos se mezclarían en abanico
  parts.add('ground', r);
}

function buildWallAndTiers(parts: Parts) {
  const SEGS = 192;
  // muro bajo: cara interior y parte de arriba
  for (const g of sweep([[0, 0], [0, WALL.height], [WALL.thick, WALL.height]], SEGS, true)) parts.add('wall', g);
  // pasillo detrás del muro
  for (const g of sweep([[WALL.thick, WALL.height], [WALKWAY, WALL.height]], SEGS, true)) parts.add('wall', g);
  // gradas: cada anillo es un muro alto y dos filas de asientos
  for (let k = 0; k < TIERS.count; k++) {
    const d = tierFront(k), D = TIERS.depth, r = TIERS.rise;
    const y0 = k === 0 ? WALL.height : tierTop(k - 1);
    const prof: Array<[number, number]> = [
      [d, y0], [d, y0 + 0.6 * r],
      [d + D * 0.4, y0 + 0.6 * r], [d + D * 0.4, y0 + 0.8 * r],
      [d + D * 0.7, y0 + 0.8 * r], [d + D * 0.7, y0 + r],
      [d + D, y0 + r],
    ];
    // muros de cada anillo algo más oscuros que los asientos, para que se lean los escalones
    for (let i = 0; i < prof.length - 1; i++) {
      const vertical = prof[i][0] === prof[i + 1][0];
      for (const g of sweep([prof[i], prof[i + 1]], SEGS, k < DOOR_TIERS)) parts.add(vertical ? 'tierWall' : 'tiers', g);
    }
  }
}

function buildPosts(parts: Parts) {
  // perímetro aproximado del óvalo para repartirlos a la misma distancia
  const N = 720;
  const pts: Array<[number, number, number]> = [];
  let len = 0, px = 0, pz = 0;
  for (let i = 0; i <= N; i++) {
    const t = (i / N) * TAU;
    const [x, z] = ovalPoint(t, WALL.thick / 2);
    if (i > 0) len += Math.hypot(x - px, z - pz);
    pts.push([x, z, len]);
    px = x; pz = z;
  }
  const count = Math.round(len / POSTS.spacing);
  const step = len / count;
  for (let k = 0; k < count; k++) {
    const target = (k + 0.5) * step;
    const p = pts.find((q) => q[2] >= target)!;
    // fuera de los huecos de las puertas
    if (DOORS.some((d) => Math.hypot(p[0] - d.x, p[1] - d.z) < DOOR.width / 2 + 2.5)) continue;
    const g = new THREE.CylinderGeometry(POSTS.radius * 0.8, POSTS.radius, POSTS.height, 10);
    g.translate(p[0], POSTS.height / 2, p[1]);
    parts.add('post', g);
    const cap = new THREE.CylinderGeometry(POSTS.radius * 1.3, POSTS.radius * 1.1, 0.35, 10);
    cap.translate(p[0], POSTS.height + 0.1, p[1]);
    parts.add('post', cap);
  }
}

/** Túnel de cada puerta: paredes a los lados, techo, fondo oscuro y marco. */
function buildDoors(parts: Parts) {
  const W = DOOR.width, H = DOOR.height, L = DOOR.depth;
  const roofTop = tierTop(DOOR_TIERS - 1);
  for (const d of DOORS) {
    const yaw = Math.atan2(d.out[0], d.out[1]); // la caja mira hacia fuera
    const along = (s: number, side: number) => [d.x + d.out[0] * s + -d.out[1] * side, d.z + d.out[1] * s + d.out[0] * side] as const;
    const reach = tierFront(DOOR_TIERS) + 0.5; // el techo llega hasta la primera grada sin cortar
    // paredes del túnel (desde dentro del suelo hasta el fondo)
    for (const side of [-1, 1]) {
      const [x, z] = along(L / 2 - 0.5, side * (W / 2 + 0.6));
      parts.add('frame', box(1.2, roofTop, L + 1, x, roofTop / 2, z, yaw));
    }
    // techo sobre el hueco de las gradas cortadas
    const [rx, rz] = along(reach / 2 - 0.3, 0);
    parts.add('frame', box(W + 2.4, roofTop - H, reach + 0.6, rx, (roofTop + H) / 2, rz, yaw));
    // techo interior hasta el fondo
    const [ix, iz] = along(L / 2, 0);
    parts.add('door', box(W, 0.3, L, ix, H + 0.15, iz, yaw));
    // fondo oscuro y suelo del túnel
    const [bx, bz] = along(L, 0);
    parts.add('door', box(W, H, 0.4, bx, H / 2, bz, yaw));
    parts.add('door', box(W, 0.06, L, ix, 0.03, iz, yaw));
  }
}

// ── Pared de roca y columnas ────────────────────────────────────────────────

function buildCliff(parts: Parts) {
  const rng = makeRng(4242);
  const base = tierFront(TIERS.count);
  const y0 = tierTop(TIERS.count - 1);
  const NT = 360, NY = 18;
  // surcos verticales de erosión: suma de ondas a lo largo del borde
  const waves = [7, 13, 29, 61, 113].map((f, i) => ({ f, a: [2.4, 1.6, 1.0, 0.6, 0.35][i], ph: rng() * TAU }));
  const topWaves = [3, 5, 11].map((f, i) => ({ f, a: [6, 4, 2.5][i], ph: rng() * TAU }));
  const groove = (t: number) => waves.reduce((s, w) => s + w.a * Math.sin(w.f * t + w.ph), 0);
  const topH = (t: number) => CLIFF.height + topWaves.reduce((s, w) => s + w.a * Math.sin(w.f * t + w.ph), 0);
  const pos: number[] = [];
  const idx: number[] = [];
  const cols = NY + 2; // filas de la pared + borde de arriba hacia atrás
  for (let i = 0; i <= NT; i++) {
    const t = (i / NT) * TAU;
    const g = groove(t);
    const top = topH(t);
    for (let j = 0; j <= NY; j++) {
      const h = j / NY;
      const y = y0 + (top - y0) * h;
      // se inclina hacia atrás abajo y hace un voladizo arriba; franjas horizontales de estratos
      const strata = 0.7 * Math.sin(y * 0.9) + 0.5 * Math.sign(Math.sin(y * 0.35)) ;
      const d = base + 1.5 + 5 * h - 8 * h * h * h + g * (0.6 + 0.4 * h) + strata;
      const [x, z] = ovalPoint(t, j === 0 ? base : d);
      pos.push(x, j === 0 ? y0 : y, z);
    }
    const [bx, bz] = ovalPoint(t, base + CLIFF.thick + 6);
    pos.push(bx, top + 1.5, bz);
  }
  for (let i = 0; i < NT; i++) {
    for (let j = 0; j < cols - 1; j++) {
      const a = i * cols + j, b = a + 1, c = a + cols, d = c + 1;
      idx.push(a, c, b, b, c, d);
    }
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  geo.setIndex(idx);
  geo.computeVertexNormals();
  parts.add('cliff', geo);
}

/** Columna alta de roca con surcos verticales y anillos de estratos. */
function columnGeometry(r: number, h: number, rng: () => number) {
  const g = new THREE.CylinderGeometry(r, r, h, 36, 24, true);
  const p = g.attributes.position;
  const flutes = 8 + Math.floor(rng() * 6);
  const ph = rng() * TAU;
  const lean = (rng() - 0.5) * 0.08;
  for (let i = 0; i < p.count; i++) {
    const x = p.getX(i), y = p.getY(i), z = p.getZ(i);
    const a = Math.atan2(z, x);
    const v = (y + h / 2) / h; // 0 abajo, 1 arriba
    const taper = 1 - 0.25 * v + 0.15 * Math.sin(v * 9 + ph) * 0.4;
    const flute = 1 - 0.13 * Math.pow(Math.abs(Math.cos((a * flutes) / 2 + ph)), 3);
    const ring = 1 + 0.06 * Math.max(0, Math.sin(v * 40 + ph));
    const s = taper * flute * ring;
    p.setXYZ(i, x * s + lean * y, y, z * s);
  }
  g.computeVertexNormals();
  // tapa de arriba redondeada
  const cap = new THREE.SphereGeometry(r * 0.75, 18, 8, 0, TAU, 0, Math.PI / 2);
  cap.scale(1, 0.5, 1);
  cap.translate(lean * h / 2, h / 2 - 0.2, 0);
  return [g, cap];
}

function buildColumns(parts: Parts) {
  const rng = makeRng(777);
  const n = CLIFF.columns;
  for (let i = 0; i < n; i++) {
    const t = ((i + 0.5 + (rng() - 0.5) * 0.5) / n) * TAU;
    // ni delante del palco (este) ni justo encima de las puertas
    const dist = Math.min(...DOORS.map((d) => Math.abs(Math.atan2(Math.sin(t - doorAngle(d)), Math.cos(t - doorAngle(d))))));
    if (Math.abs(Math.atan2(Math.sin(t), Math.cos(t))) < 0.4 || dist < 0.12) continue;
    const r = 2.6 + rng() * 1.6;
    const d = tierFront(TIERS.count) - 2.5 - rng() * 3;
    const [x, z] = ovalPoint(t, d);
    const h = CLIFF.height + 4 + rng() * 16;
    for (const g of columnGeometry(r, h, rng)) {
      g.translate(x, h / 2 - 1, z);
      parts.add('column', g);
    }
  }
}

// ── Centro: pilares y coberturas ────────────────────────────────────────────

function buildPillars(parts: Parts) {
  for (const p of PILLARS) {
    const base = new THREE.CylinderGeometry(PILLAR.baseRadius * 0.9, PILLAR.baseRadius, 0.7, 16);
    base.translate(p.x, 0.35, p.z);
    parts.add('pillar', base);
    const shaft = new THREE.CylinderGeometry(PILLAR.radius * 0.85, PILLAR.radius, PILLAR.height, 16);
    shaft.translate(p.x, PILLAR.height / 2, p.z);
    parts.add('pillar', shaft);
    const top = new THREE.CylinderGeometry(PILLAR.radius * 1.4, PILLAR.radius * 0.9, 0.6, 16);
    top.translate(p.x, PILLAR.height + 0.2, p.z);
    parts.add('pillar', top);
  }
}

export function rockGeometry(rng: () => number) {
  const g = new THREE.IcosahedronGeometry(1, 2);
  const p = g.attributes.position;
  const seen = new Map<string, number>();
  for (let i = 0; i < p.count; i++) {
    const key = `${p.getX(i).toFixed(3)},${p.getY(i).toFixed(3)},${p.getZ(i).toFixed(3)}`;
    let k = seen.get(key);
    if (k === undefined) { k = 0.82 + rng() * 0.3; seen.set(key, k); }
    const y = p.getY(i);
    p.setXYZ(i, p.getX(i) * k, Math.max(-0.35, y * k), p.getZ(i) * k);
  }
  g.computeVertexNormals();
  return g;
}

function buildCover(parts: Parts, c: Cover, rng: () => number) {
  const place = (g: THREE.BufferGeometry, part: Part) => {
    g.applyMatrix4(new THREE.Matrix4().makeRotationY(c.rot).setPosition(c.x, 0, c.z));
    parts.add(part, g);
  };
  if (c.kind === 'roca') {
    const a = rockGeometry(rng);
    a.scale(2.3, 1.7, 1.8);
    a.translate(0, 0.55, 0);
    place(a, 'rock');
    const b = rockGeometry(rng);
    b.scale(1.2, 1.0, 1.1);
    b.translate(1.9, 0.3, 1.1);
    place(b, 'rock');
  } else if (c.kind === 'pila') {
    const s = 1.2;
    place(box(s, s, s, -0.65, s / 2, 0), 'crate');
    place(box(s, s, s, 0.65, s / 2, 0.05, 0.12), 'crate');
    place(box(s, s, s, -0.6, s * 1.5, 0.05, -0.15), 'crate');
    place(box(s, s * 0.8, s * 1.3, 0.2, s * 0.4, 1.4, 0.3), 'crate');
  } else {
    // restos: chapa grande inclinada clavada en la arena y un trozo de cilindro
    place(box(4.2, 0.35, 2.4, 0, 0.75, 0, 0, 0.1, 0.42), 'debris');
    const cyl = new THREE.CylinderGeometry(0.7, 0.7, 2.6, 12);
    cyl.rotateZ(Math.PI / 2);
    cyl.rotateY(0.5);
    cyl.translate(-0.8, 0.6, 1.3);
    place(cyl, 'debris');
  }
}

// ── Palco (torre) encima de la puerta este ──────────────────────────────────

function buildPalco(parts: Parts) {
  const { x, z, height } = PALCO;
  const baseY = tierTop(DOOR_TIERS - 1);
  // cuerpo: torre ovalada que sube desde encima del túnel
  const body = new THREE.CylinderGeometry(3.6, 4.6, height - baseY, 20);
  body.scale(0.9, 1, 1.15);
  body.translate(x, baseY + (height - baseY) / 2, z);
  parts.add('palco', body);
  // balcones redondeados a varias alturas, cada uno algo menor
  [baseY + 1.2, 16, 23, 29].forEach((y, i) => {
    const r = 7 - i * 0.9;
    const disc = new THREE.CylinderGeometry(r, r * 0.92, 1.1, 28);
    disc.scale(0.85, 1, 1.1);
    disc.translate(x - 1.2, y, z);
    parts.add('palco', disc);
    const rail = new THREE.CylinderGeometry(r, r, 1.0, 28, 1, true);
    rail.scale(0.85, 1, 1.1);
    rail.translate(x - 1.2, y + 1.05, z);
    parts.add('palco', rail);
    // hueco oscuro (la ventana del palco) mirando a la arena
    if (i > 0) parts.add('door', box(0.4, 2.2, 3.6, x - 3.4, y + 1.9, z));
  });
  // remate de arriba
  const dome = new THREE.SphereGeometry(4.2, 20, 10, 0, TAU, 0, Math.PI / 2);
  dome.scale(0.9, 0.7, 1.1);
  dome.translate(x, height, z);
  parts.add('palco', dome);
  const spire = new THREE.CylinderGeometry(0.2, 0.9, 5, 10);
  spire.translate(x, height + 4.5, z);
  parts.add('palco', spire);
  // marco grande de la puerta de abajo (la entrada al pie de la torre)
  const [dx, dz] = [ARENA_A + 0.2, 0];
  for (const side of [-1, 1]) parts.add('palco', box(1.6, DOOR.height + 2.5, 1.6, dx, (DOOR.height + 2.5) / 2, dz + side * (DOOR.width / 2 + 1.4)));
  parts.add('palco', box(1.8, 1.6, DOOR.width + 4.4, dx, DOOR.height + 1.3, dz));
}

/** Monta la maqueta completa (en gris, o con `color` la prueba de colores y texturas). Devuelve un grupo listo para añadir a la escena. */
export function buildArenaGreybox(color = false): THREE.Group {
  const group = new THREE.Group();
  group.name = 'arena';
  const parts = new Parts();
  buildFloor(parts);
  buildWallAndTiers(parts);
  buildPosts(parts);
  buildDoors(parts);
  buildCliff(parts);
  buildColumns(parts);
  buildPillars(parts);
  const rng = makeRng(99);
  for (const c of COVERS) buildCover(parts, c, rng);
  buildPalco(parts);
  parts.build(group, color);
  return group;
}
