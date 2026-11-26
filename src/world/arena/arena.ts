import * as THREE from 'three';
import { mergeGeometries, mergeVertices } from 'three/addons/utils/BufferGeometryUtils.js';
import { makeRng } from '../terrain';
import { box, doorHalfAngle, rockGeometry, tierFront, tierTop } from './greybox';
import {
  ARENA_A, ARENA_B, ARENA_SUN, CLIFF, COVERS, DOOR, DOORS, FURROW, PALCO, PILLAR, PILLARS, POSTS, TIERS, WALL,
  doorAngle, floorHeight, ovalAngle, ovalDist, ovalPoint, type Door,
} from './layout';
import { DECAL_UV, arenaMaterial, decalMaterial, dustMaterial, lookBase, type Look } from './look';

// ARENA DE GEONOSIS — versión con materiales, luz y profundidad (en pruebas).
// La arquitectura geonosiana parece excavada y modelada en la roca: bordes redondeados, sin juntas de ladrillo; torre del palco de formas
// orgánicas apiladas; columnas de roca con abultamientos que nacen de las gradas; puertas en arco con túnel, reja y polvo; un surco de
// impacto en la arena y restos de chapa de la batalla. Todo el oscurecimiento (huecos, rincones, bases) y las sombras del sol
// se calculan UNA vez al cargar y quedan pintados en el color de cada vértice: al jugar no cuestan nada.

const TAU = Math.PI * 2;
const WALKWAY = 2.5;
const DOOR_TIERS = 2;
const smooth = (a: number, b: number, v: number) => { const t = Math.min(1, Math.max(0, (v - a) / (b - a))); return t * t * (3 - 2 * t); };
const lerp = (a: number, b: number, t: number) => a + (b - a) * t;
const wrap = (a: number) => Math.atan2(Math.sin(a), Math.cos(a));

/** Qué pieza es cada cosa: su aspecto (material) y su color. */
type Part = 'floor' | 'pebbles' | 'seats' | 'risers' | 'wall' | 'steps' | 'frame' | 'tunnel' | 'tunnelEnd' | 'cliff' | 'column' | 'rock' | 'rubble'
  | 'pillar' | 'palco' | 'post' | 'gate' | 'scrap' | 'plates' | 'dark';
const PARTS: Record<Part, { look: Look; side?: THREE.Side; noSun?: boolean }> = {
  floor: { look: 'sand' },
  pebbles: { look: 'rock' },
  seats: { look: 'seats', side: THREE.DoubleSide },
  risers: { look: 'seats', side: THREE.DoubleSide },
  wall: { look: 'sculpt', side: THREE.DoubleSide },
  steps: { look: 'sculpt' },
  frame: { look: 'sculpt', side: THREE.DoubleSide },
  tunnel: { look: 'sculpt', side: THREE.DoubleSide, noSun: true },
  tunnelEnd: { look: 'sculpt', side: THREE.DoubleSide, noSun: true },
  cliff: { look: 'cliff', side: THREE.DoubleSide },
  column: { look: 'column' },
  rock: { look: 'rock' },
  rubble: { look: 'rock' },
  pillar: { look: 'column' },
  palco: { look: 'sculpt' },
  post: { look: 'sculpt' },
  gate: { look: 'plain' },
  scrap: { look: 'plain' },
  plates: { look: 'plain', side: THREE.DoubleSide },
  dark: { look: 'plain', noSun: true },
};

// ── Colores (todo ajustable) ────────────────────────────────────────────────
export const ARENA_COLORS = {
  sand: 0xd6bc9a, // arena clara del centro
  sandEdge: 0x9e7a5a, // arena más oscura y rojiza junto al muro
  sandTrodden: 0xbb9c7c, // caminos pisados de las puertas al centro
  soot: 0x3a2a20, // hollín en el surco de impacto
  seats: 0xc79a6a, // gradas: ocre arenoso cálido (algo más claro que la pared de roca)
  risers: 0xb3855a, // muros de cada anillo
  seatsDirt: 0x8a6142, // suciedad de los anillos de abajo
  dust: 0xd8b88e, // polvo acumulado en los rincones de los escalones
  stone: 0xae9274, // piedra modelada (muro, puertas, escaleras): algo más gris
  steps: 0xa4825e,
  tunnel: 0x8a7058,
  tunnelEnd: 0xd9b080, // pared del fondo del túnel, iluminada por la luz que entra de lado
  cliffLow: 0x7a3820, // pared alta: abajo, oscura y rojiza…
  cliffHigh: 0xb4643c, // …y arriba, donde da el sol, más clara
  columnLow: 0x6a341e,
  columnHigh: 0xbc7c50,
  rock: 0x8a4a30,
  pebbles: 0xa48466, // piedrecitas: casi del color de la arena
  pillar: 0x8a5a3a,
  palco: 0xc09a70,
  post: 0x8a6a4c,
  gate: 0x3a312a, // reja de metal oscuro
  scrap: 0x6e665c, // chatarra quemada en el montón del surco
  plates: 0x77726a, // restos de chapa de las coberturas (metal gris sucio y quemado)
  dark: 0x140c08,
};
/** Tono de las zonas a la sombra del sol: oscuro y algo frío (violáceo). */
const SHADE = new THREE.Color(0.5, 0.5, 0.63);

// ── Geometría con datos extra por vértice ──────────────────────────────────
// ao: oscurecimiento por huecos y rincones (1 = nada; más de 1 = desgaste más claro); dust: polvo acumulado (0–1);
// aOval: posición a lo largo del óvalo y distancia al borde (para dibujar filas y grietas sin saltos)

function setAttr(g: THREE.BufferGeometry, name: string, fill: (i: number) => number[] | number) {
  const size = name === 'aOval' ? 2 : 1;
  const n = g.attributes.position.count;
  const a = new Float32Array(n * size);
  for (let i = 0; i < n; i++) {
    const v = fill(i);
    if (typeof v === 'number') a[i] = v; else a.set(v, i * size);
  }
  g.setAttribute(name, new THREE.BufferAttribute(a, size));
}

/** Posición en el óvalo de cada vértice de una pieza pequeña (sin saltos en la costura del óvalo: se mide desde su centro). */
function ovalAttr(g: THREE.BufferGeometry) {
  if (g.attributes.aOval) return;
  const p = g.attributes.position;
  g.computeBoundingSphere();
  const c = g.boundingSphere!.center;
  const dc = ovalDist(c.x, c.z), tc = ovalAngle(c.x, c.z, dc);
  setAttr(g, 'aOval', (i) => {
    const x = p.getX(i), z = p.getZ(i), d = ovalDist(x, z);
    const t = tc + wrap(ovalAngle(x, z, d) - tc);
    return [t * (ARENA_A + ARENA_B + 2 * d) / 2, d];
  });
}

/** Oscurece la base de una pieza que toca el suelo (a la altura `baseY`). */
function contactAO(g: THREE.BufferGeometry, baseY = 0, k = 0.5, h = 0.9) {
  const p = g.attributes.position;
  const old = g.attributes.ao as THREE.BufferAttribute | undefined;
  setAttr(g, 'ao', (i) => (old ? old.getX(i) : 1) * (1 - k * (1 - smooth(0, h, p.getY(i) - baseY))));
}

/** Desplaza cada vértice hacia fuera o hacia dentro según un ruido suave (para que nada parezca hecho a máquina). */
function lumpy(src: THREE.BufferGeometry, amp: number, freq: number, seed: number) {
  // se juntan los vértices repetidos (costuras) para que al deformar no se abran grietas
  for (const k of Object.keys(src.attributes)) if (k !== 'position') src.deleteAttribute(k);
  const g = mergeVertices(src, 1e-4);
  const p = g.attributes.position;
  g.computeVertexNormals();
  const n = g.attributes.normal;
  const ph = [seed * 1.7, seed * 2.3, seed * 3.1];
  for (let i = 0; i < p.count; i++) {
    const x = p.getX(i), y = p.getY(i), z = p.getZ(i);
    const k = amp * (Math.sin(x * freq + ph[0]) * Math.sin(y * freq * 1.3 + ph[1]) + 0.6 * Math.sin(z * freq * 0.9 + y * freq * 0.5 + ph[2]));
    p.setXYZ(i, x + n.getX(i) * k, y + n.getY(i) * k, z + n.getZ(i) * k);
  }
  g.computeVertexNormals();
  return g;
}

class Parts {
  readonly geos = new Map<Part, THREE.BufferGeometry[]>();
  add(part: Part, g: THREE.BufferGeometry) {
    if (!g.index) {
      const idx: number[] = [];
      for (let i = 0; i < g.attributes.position.count; i++) idx.push(i);
      g.setIndex(idx);
    }
    for (const k of Object.keys(g.attributes)) if (!['position', 'normal', 'ao', 'aOval', 'dust'].includes(k)) g.deleteAttribute(k);
    if (!g.attributes.normal) g.computeVertexNormals();
    if (!g.attributes.ao) setAttr(g, 'ao', () => 1);
    if (!g.attributes.dust) setAttr(g, 'dust', () => 0);
    ovalAttr(g);
    if (!this.geos.has(part)) this.geos.set(part, []);
    this.geos.get(part)!.push(g);
  }
}

// ── Barrido de perfiles alrededor del óvalo ────────────────────────────────

/** Punto de un perfil: distancia al borde del suelo, altura, oscurecimiento, polvo y si es una esquina viva (no se suaviza). */
interface PP { d: number; y: number; ao: number; dust?: number; sharp?: boolean }

/**
 * Barre un perfil alrededor del óvalo y lo convierte en una superficie continua: las curvas (bordes redondeados) se ven suaves y solo
 * las esquinas marcadas como vivas hacen arista. Con `gaps` deja libres las puertas con un corte recto.
 */
function sweep(profile: PP[], segs: number, gaps: boolean): THREE.BufferGeometry[] {
  const out: THREE.BufferGeometry[] = [];
  const doorTs = DOORS.map((d) => ((doorAngle(d) % TAU) + TAU) % TAU).sort((a, b) => a - b);
  const ranges: Array<(d: number) => [number, number]> = gaps
    ? doorTs.map((ta, i) => {
        const tb = i + 1 < doorTs.length ? doorTs[i + 1] : doorTs[0] + TAU;
        const ax0 = Math.abs(Math.cos(ta)) > 0.5, ax1 = Math.abs(Math.cos(tb)) > 0.5;
        return (d: number) => [ta + doorHalfAngle(ax0, d), tb - doorHalfAngle(ax1, d)];
      })
    : [() => [0, TAU]];
  // columnas del perfil: las esquinas vivas se duplican para que cada lado tenga su propia normal
  const cols: Array<{ p: PP; id: number }> = [];
  profile.forEach((p, i) => {
    cols.push({ p, id: i });
    if (p.sharp && i > 0 && i < profile.length - 1) cols.push({ p, id: i });
  });
  for (const range of ranges) {
    const [a0, a1] = range(0);
    const n = Math.max(4, Math.round((segs * (a1 - a0)) / TAU));
    const pos: number[] = [], ao: number[] = [], du: number[] = [], ov: number[] = [], idx: number[] = [];
    const C = cols.length;
    for (let i = 0; i <= n; i++) {
      const s = i / n;
      for (const { p } of cols) {
        const r = range(p.d);
        const t = r[0] + (r[1] - r[0]) * s;
        const [x, z] = ovalPoint(t, p.d);
        pos.push(x, p.y, z);
        ao.push(p.ao); du.push(p.dust ?? 0);
        ov.push(t * (ARENA_A + ARENA_B + 2 * p.d) / 2, p.d);
      }
    }
    for (let i = 0; i < n; i++) for (let c = 0; c < C - 1; c++) {
      if (cols[c].id === cols[c + 1].id) continue; // las dos copias de una esquina viva no se unen
      const a = i * C + c, b = a + 1, e = a + C, f = e + 1;
      idx.push(a, e, b, b, e, f);
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    g.setAttribute('ao', new THREE.Float32BufferAttribute(ao, 1));
    g.setAttribute('dust', new THREE.Float32BufferAttribute(du, 1));
    g.setAttribute('aOval', new THREE.Float32BufferAttribute(ov, 2));
    g.setIndex(idx);
    g.computeVertexNormals();
    out.push(g);
  }
  return out;
}

// ── Medidas derivadas ──────────────────────────────────────────────────────

const H_MAIN = 0.45 * TIERS.rise; // muro principal de cada anillo (bajo el borde)
const LIP_T = 0.14; // grosor del borde que vuela
const STEP_RISE = (TIERS.rise - H_MAIN - LIP_T) / 3; // tres filas de asientos
const CLIFF_BASE = tierFront(TIERS.count);
const CLIFF_Y0 = tierTop(TIERS.count - 1);
const ROOF_TOP = tierTop(DOOR_TIERS - 1);

/** Altura de las gradas a una distancia `d` del borde del suelo (para colocar cosas y para las sombras). */
export function standsHeight(d: number): number {
  if (d < 0) return 0;
  if (d < WALKWAY) return WALL.height;
  const k = Math.floor((d - WALKWAY) / TIERS.depth);
  if (k >= TIERS.count) return CLIFF_Y0;
  const y0 = k === 0 ? WALL.height : tierTop(k - 1);
  const l = d - tierFront(k);
  const base = y0 + H_MAIN + LIP_T;
  if (l < 0.9) return base;
  if (l < 1.7) return base + STEP_RISE;
  if (l < 2.5) return base + 2 * STEP_RISE;
  return y0 + TIERS.rise;
}

// ── Suelo (con el surco de impacto) y piedrecitas ──────────────────────────

function buildFloor(parts: Parts) {
  const NR = 40, NT = 160;
  const pos: number[] = [], idx: number[] = [];
  pos.push(0, floorHeight(0, 0), 0);
  for (let r = 1; r <= NR; r++) {
    const s = r / NR;
    for (let i = 0; i < NT; i++) {
      const t = (i / NT) * TAU;
      const x = Math.cos(t) * (ARENA_A + 0.6) * s, z = Math.sin(t) * (ARENA_B + 0.6) * s;
      pos.push(x, floorHeight(x, z), z);
    }
  }
  for (let i = 0; i < NT; i++) idx.push(0, 1 + ((i + 1) % NT), 1 + i);
  for (let r = 1; r < NR; r++) {
    const a0 = 1 + (r - 1) * NT, b0 = 1 + r * NT;
    for (let i = 0; i < NT; i++) {
      const i1 = (i + 1) % NT;
      idx.push(a0 + i, a0 + i1, b0 + i, b0 + i, a0 + i1, b0 + i1);
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setIndex(idx);
  g.computeVertexNormals();
  setAttr(g, 'aOval', () => [0, 0]);
  parts.add('floor', g);
}

function buildPebbles(parts: Parts) {
  const rng = makeRng(8088);
  const base = new THREE.OctahedronGeometry(1, 0);
  for (let i = 0; i < 650; i++) {
    // la mitad, en la franja junto al muro (donde se acumulan); el resto, sueltas por toda la arena
    let x: number, z: number;
    if (i < 330) { const [px, pz] = ovalPoint(rng() * TAU, -0.6 - Math.pow(rng(), 1.6) * 6); x = px; z = pz; }
    else { const a = rng() * TAU, r = Math.sqrt(rng()) * 0.95; x = Math.cos(a) * r * ARENA_A; z = Math.sin(a) * r * ARENA_B; }
    if (DOORS.some((d) => Math.hypot(x - d.x, z - d.z) < 4)) continue;
    const s = 0.035 + Math.pow(rng(), 2.4) * 0.13;
    const g = base.clone();
    g.scale(s * (0.8 + rng() * 0.6), s * (0.45 + rng() * 0.3), s * (0.8 + rng() * 0.6));
    g.rotateY(rng() * TAU);
    g.translate(x, floorHeight(x, z) + s * 0.15, z);
    contactAO(g, floorHeight(x, z), 0.45, s * 0.6);
    parts.add('pebbles', g);
  }
}

// ── Muro bajo, pasillo y gradas (bordes redondeados) ──────────────────────

function buildWallAndTiers(parts: Parts) {
  const h = WALL.height;
  // muro bajo con la parte de arriba redondeada
  const wallProf: PP[] = [
    { d: 0, y: 0, ao: 0.5, dust: 0.6, sharp: true }, { d: 0, y: h * 0.5, ao: 0.95 }, { d: 0, y: h - 0.32, ao: 0.92 },
    { d: -0.06, y: h - 0.14, ao: 1.0 }, { d: 0.12, y: h + 0.02, ao: 1.1 }, { d: 0.5, y: h + 0.07, ao: 1.08 },
    { d: 0.88, y: h + 0.02, ao: 1.0 }, { d: WALL.thick, y: h, ao: 0.85, sharp: true }, { d: WALKWAY, y: h, ao: 0.55, dust: 0.8 },
  ];
  for (const g of sweep(wallProf, 168, true)) parts.add('wall', g);
  for (let k = 0; k < TIERS.count; k++) {
    const d = tierFront(k), y0 = k === 0 ? h : tierTop(k - 1), top = y0 + H_MAIN;
    // muro del anillo, oscuro en el rincón de abajo (con polvo) y justo bajo el borde
    const prof: PP[] = [
      { d, y: y0, ao: 0.5, dust: 0.85, sharp: true }, { d, y: y0 + H_MAIN * 0.45, ao: 0.92 }, { d, y: top - 0.2, ao: 0.62 },
      // borde redondeado que vuela (bocel), con el canto desgastado más claro
      { d: d - 0.1, y: top - 0.12, ao: 0.6 }, { d: d - 0.2, y: top - 0.02, ao: 0.82 }, { d: d - 0.2, y: top + LIP_T * 0.6, ao: 1.08 },
      { d: d - 0.08, y: top + LIP_T, ao: 1.12 }, { d: d + 0.15, y: top + LIP_T, ao: 1.0 },
    ];
    let yy = top + LIP_T;
    for (const e of [0.9, 1.7, 2.5]) {
      prof.push({ d: d + e, y: yy, ao: 0.72, dust: 0.9, sharp: true });
      yy += STEP_RISE;
      prof.push({ d: d + e, y: yy - 0.07, ao: 1.0 }, { d: d + e + 0.08, y: yy, ao: 1.1 });
    }
    prof.push({ d: d + TIERS.depth, y: yy, ao: 0.6, dust: 0.7 });
    // los anillos de arriba se ven de lejos: menos detalle a lo largo
    const segs = k < 3 ? 128 : 92;
    for (const g of sweep(prof, segs, k < DOOR_TIERS)) parts.add('seats', g);
  }
}

/** Ángulos de las escaleras (las grandes encima de las puertas, menos la este, que tiene el palco). */
const STAIRS: Array<{ t: number; big: boolean }> = [];
for (let q = 0; q < 4; q++) {
  const t0 = (q * Math.PI) / 2;
  if (q !== 0) STAIRS.push({ t: t0, big: true });
  for (let k = 1; k <= 3; k++) STAIRS.push({ t: t0 + (k * Math.PI) / 8, big: false });
}
const nearAngle = (t: number, list: number[], tol: number) => list.some((u) => Math.abs(wrap(t - u)) < tol);

/** Escaleras: tres peldaños ante el muro de cada anillo (las filas de asientos ya hacen de peldaños). */
function buildStairs(parts: Parts) {
  for (const s of STAIRS) {
    if (Math.abs(wrap(s.t)) < 0.35) continue;
    const W = s.big ? 4.2 : 2.4;
    const yaw = Math.atan2(Math.cos(s.t), Math.sin(s.t));
    for (let k = s.big ? DOOR_TIERS : 0; k < TIERS.count; k++) {
      const y0 = k === 0 ? WALL.height : tierTop(k - 1);
      const rise = (H_MAIN + LIP_T) / 3;
      for (let i = 0; i < 3; i++) {
        const [x, z] = ovalPoint(s.t, tierFront(k) - 0.8 + (i + 0.5) * 0.27);
        const top = y0 + rise * (i + 1);
        const g = box(W, top - y0 + 0.2, 0.29, x, (top + y0 - 0.2) / 2, z, yaw);
        contactAO(g, y0, 0.35, 0.5);
        parts.add('steps', g);
      }
    }
  }
}

function buildPosts(parts: Parts) {
  const N = 720;
  const pts: Array<[number, number, number]> = [];
  let len = 0, px = 0, pz = 0;
  for (let i = 0; i <= N; i++) {
    const [x, z] = ovalPoint((i / N) * TAU, WALL.thick / 2);
    if (i > 0) len += Math.hypot(x - px, z - pz);
    pts.push([x, z, len]);
    px = x; pz = z;
  }
  const count = Math.round(len / POSTS.spacing), step = len / count;
  for (let k = 0; k < count; k++) {
    const p = pts.find((q) => q[2] >= (k + 0.5) * step)!;
    if (DOORS.some((d) => Math.hypot(p[0] - d.x, p[1] - d.z) < DOOR.width / 2 + 3.5)) continue;
    // poste modelado: base ancha, cuerpo que se estrecha y remate redondeado
    const g = new THREE.LatheGeometry([
      new THREE.Vector2(0.42, 0), new THREE.Vector2(0.36, 0.25), new THREE.Vector2(0.26, 0.6), new THREE.Vector2(0.24, 1.1),
      new THREE.Vector2(0.3, 1.4), new THREE.Vector2(0.24, 1.6), new THREE.Vector2(0.001, 1.72),
    ], 9);
    g.translate(p[0], WALL.height, p[1]);
    contactAO(g, WALL.height, 0.4, 0.5);
    parts.add('post', g);
  }
}

// ── Puertas: arco de roca, túnel con luz al fondo, polvo y reja ────────────

const TUNNEL_L = 16;
const LEG_H = DOOR.height - DOOR.width / 2; // altura recta antes de empezar el arco

/** Matriz del sistema de una puerta: X = de lado, Y = arriba, Z = hacia fuera (hacia el túnel). */
function doorFrame(d: Door, s0 = 0) {
  const ox = d.out[0], oz = d.out[1];
  return new THREE.Matrix4().makeBasis(new THREE.Vector3(-oz, 0, ox), new THREE.Vector3(0, 1, 0), new THREE.Vector3(ox, 0, oz))
    .setPosition(d.x + ox * s0, 0, d.z + oz * s0);
}

/** Silueta del hueco de la puerta (patas rectas y arco de medio punto), de abajo a la izquierda a abajo a la derecha. */
function archPoints(halfW: number, legH: number, nArc = 14) {
  const pts: THREE.Vector2[] = [new THREE.Vector2(-halfW, 0), new THREE.Vector2(-halfW, legH)];
  for (let i = 1; i < nArc; i++) { const a = Math.PI - (i / nArc) * Math.PI; pts.push(new THREE.Vector2(Math.cos(a) * halfW, legH + Math.sin(a) * halfW)); }
  pts.push(new THREE.Vector2(halfW, legH), new THREE.Vector2(halfW, 0));
  return pts;
}

function buildDoors(parts: Parts, extras: THREE.Group) {
  const W = DOOR.width, hw = W / 2;
  const dust = dustMaterial();
  for (const d of DOORS) {
    const east = d.name === 'este';
    // frente: una placa gruesa con el hueco en arco (tapa el corte recto de las gradas)
    const face = new THREE.Shape();
    const fw = hw + (east ? 2.4 : 1.8);
    face.moveTo(-fw, 0); face.lineTo(fw, 0); face.lineTo(fw, ROOF_TOP + 0.25); face.lineTo(-fw, ROOF_TOP + 0.25); face.closePath();
    face.holes.push(new THREE.Path(archPoints(hw, LEG_H, 16)));
    const fg = new THREE.ExtrudeGeometry(face, { depth: 1.2, bevelEnabled: false, curveSegments: 4 });
    fg.applyMatrix4(doorFrame(d, -0.5));
    contactAO(fg, 0, 0.45, 1);
    parts.add('frame', fg);
    // marco: un lomo de roca grueso y abultado que rodea el arco
    const frameR = east ? 1.0 : 0.8;
    const path = new THREE.CatmullRomCurve3(archPoints(hw + frameR * 0.55, LEG_H, 10).map((p) => new THREE.Vector3(p.x, p.y, 0)));
    const tube = lumpy(new THREE.TubeGeometry(path, 40, frameR, 9, false), 0.16, 1.1, d.x + d.z);
    tube.applyMatrix4(doorFrame(d, -0.55));
    contactAO(tube, 0, 0.45, 1.1);
    parts.add('frame', tube);
    // dos abultamientos al pie del arco
    for (const side of [-1, 1]) {
      const b0 = new THREE.SphereGeometry(1, 12, 8);
      b0.scale(1.3 * frameR, 1.5, 1.1 * frameR);
      const b = lumpy(b0, 0.12, 1.6, side + d.x);
      b.translate(side * (hw + frameR * 0.6), 0.6, -0.6);
      b.applyMatrix4(doorFrame(d));
      contactAO(b, 0, 0.5, 1);
      parts.add('frame', b);
    }
    // túnel: bóveda en arco, oscura a la entrada, más oscura en medio y aclarándose hacia el fondo, donde entra la luz de lado
    const sec = archPoints(hw, LEG_H, 12);
    const NS = 10;
    const pos: number[] = [], ao: number[] = [], idx: number[] = [];
    for (let j = 0; j <= NS; j++) {
      const s = 0.7 + (j / NS) * (TUNNEL_L - 0.7);
      const light = s < TUNNEL_L * 0.55 ? lerp(0.55, 0.26, smooth(0.7, TUNNEL_L * 0.55, s)) : lerp(0.26, 0.95, smooth(TUNNEL_L * 0.55, TUNNEL_L, s));
      for (const p of sec) { pos.push(p.x, p.y, s); ao.push(light * (1 - 0.3 * (1 - smooth(0, 0.7, p.y)))); }
    }
    const M = sec.length;
    for (let j = 0; j < NS; j++) for (let i = 0; i < M - 1; i++) { const a = j * M + i; idx.push(a, a + 1, a + M, a + 1, a + M + 1, a + M); }
    // suelo del túnel
    const fb = pos.length / 3;
    for (let j = 0; j <= NS; j++) {
      const s = 0.7 + (j / NS) * (TUNNEL_L - 0.7);
      const light = s < TUNNEL_L * 0.55 ? lerp(0.5, 0.24, smooth(0.7, TUNNEL_L * 0.55, s)) : lerp(0.24, 1.0, smooth(TUNNEL_L * 0.55, TUNNEL_L, s));
      pos.push(-hw, 0.02, s, hw, 0.02, s); ao.push(light, light);
    }
    for (let j = 0; j < NS; j++) { const a = fb + j * 2; idx.push(a, a + 2, a + 1, a + 1, a + 2, a + 3); }
    const tg = new THREE.BufferGeometry();
    tg.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    tg.setAttribute('ao', new THREE.Float32BufferAttribute(ao, 1));
    tg.setIndex(idx);
    tg.computeVertexNormals();
    tg.applyMatrix4(doorFrame(d));
    parts.add('tunnel', tg);
    // pared del fondo, iluminada de lado (no un rectángulo brillante): más clara por un lado que por el otro
    const end = new THREE.ShapeGeometry(new THREE.Shape(archPoints(hw, LEG_H, 12)), 4);
    const ep = end.attributes.position;
    setAttr(end, 'ao', (i) => lerp(0.45, 1.0, smooth(-hw, hw * 0.8, ep.getX(i))) * lerp(1.0, 0.7, ep.getY(i) / DOOR.height));
    end.translate(0, 0, TUNNEL_L);
    end.applyMatrix4(doorFrame(d));
    parts.add('tunnelEnd', end);
    // polvo flotando en la luz del fondo y a lo largo del túnel
    for (let k = 0; k < 4; k++) {
      const pl = new THREE.Mesh(new THREE.PlaneGeometry(W * 0.8, DOOR.height * 0.7), dust);
      const s = 2.5 + k * 3.6;
      pl.position.set(d.x + d.out[0] * s, DOOR.height * 0.38, d.z + d.out[1] * s);
      pl.rotation.y = Math.atan2(-d.out[0], -d.out[1]) + (k % 2 ? 0.25 : -0.25);
      pl.renderOrder = 2;
      extras.add(pl);
    }
    // reja geonosiana medio subida: barrotes que cuelgan del arco con puntas abajo, y dos travesaños
    const bottom = 4.9;
    for (let bx = -hw + 0.55; bx <= hw - 0.5; bx += 0.62) {
      const top = LEG_H + Math.sqrt(Math.max(0, hw * hw - bx * bx));
      if (top - bottom < 0.4) continue;
      const bar = new THREE.CylinderGeometry(0.055, 0.07, top - bottom, 6);
      bar.translate(bx, (top + bottom) / 2, 0.9);
      const tip = new THREE.ConeGeometry(0.08, 0.32, 6);
      tip.rotateX(Math.PI);
      tip.translate(bx, bottom - 0.16, 0.9);
      for (const g of [bar, tip]) { g.applyMatrix4(doorFrame(d)); parts.add('gate', g); }
    }
    for (const y of [5.25, 6.25]) {
      const halfAt = Math.sqrt(Math.max(0, hw * hw - (y - LEG_H) ** 2)) - 0.1;
      const g = box(halfAt * 2, 0.12, 0.12, 0, y, 0.9);
      g.applyMatrix4(doorFrame(d));
      parts.add('gate', g);
    }
    // repisa de roca por encima de la puerta (sobre el hueco cortado de las gradas)
    const reach = tierFront(DOOR_TIERS) + 0.5;
    const ledge = new THREE.CapsuleGeometry(0.9, W + 2.2, 3, 8);
    ledge.rotateZ(Math.PI / 2);
    ledge.scale(1, 0.55, 1);
    ledge.translate(0, ROOF_TOP + 0.05, 0.4);
    ledge.applyMatrix4(doorFrame(d));
    parts.add('frame', ledge);
    const roof = box(W + 2.4, 0.5, reach, 0, ROOF_TOP - 0.1, reach / 2 + 0.3);
    roof.applyMatrix4(doorFrame(d));
    parts.add('frame', roof);
  }
}

// ── Pared de roca con borde irregular ──────────────────────────────────────

function buildCliff(parts: Parts) {
  const rng = makeRng(4242);
  const NT = 330, NY = 18;
  const waves = [7, 13, 29, 61, 113].map((f, i) => ({ f, a: [2.4, 1.6, 1.0, 0.6, 0.35][i], ph: rng() * TAU }));
  const topWaves = [3, 5, 11, 19, 31].map((f, i) => ({ f, a: [6, 4, 2.8, 1.6, 1.0][i], ph: rng() * TAU }));
  const bumps = Array.from({ length: 34 }, () => ({ t: rng() * TAU, w: 0.012 + rng() * 0.035, h: (rng() < 0.6 ? 1 : -0.8) * (3 + rng() * 7) }));
  const groove = (t: number) => waves.reduce((s, w) => s + w.a * Math.sin(w.f * t + w.ph), 0);
  const topH = (t: number) => CLIFF.height + topWaves.reduce((s, w) => s + w.a * Math.sin(w.f * t + w.ph), 0)
    + bumps.reduce((sum, b) => sum + b.h * Math.max(0, 1 - Math.abs(wrap(t - b.t)) / b.w), 0);
  const pos: number[] = [], ao: number[] = [], ov: number[] = [], idx: number[] = [];
  const cols = NY + 2;
  for (let i = 0; i <= NT; i++) {
    const t = (i / NT) * TAU;
    const g = groove(t), top = topH(t);
    for (let j = 0; j <= NY; j++) {
      const h = j / NY;
      const y = CLIFF_Y0 + (top - CLIFF_Y0) * h;
      const strata = 0.7 * Math.sin(y * 0.9) + 0.5 * Math.sign(Math.sin(y * 0.35));
      const d = j === 0 ? CLIFF_BASE : CLIFF_BASE + 1.5 + 5 * h - 8 * h * h * h + g * (0.6 + 0.4 * h) + strata;
      const [x, z] = ovalPoint(t, d);
      pos.push(x, y, z);
      ao.push((j === 0 ? 0.55 : 1) * (0.7 + 0.3 * smooth(-2.5, 1.8, g)) * (0.85 + 0.15 * smooth(-1, 1, strata)));
      ov.push(t * (ARENA_A + ARENA_B + 2 * d) / 2, d);
    }
    const [bx, bz] = ovalPoint(t, CLIFF_BASE + CLIFF.thick + 6);
    pos.push(bx, top + 1.5, bz);
    ao.push(1);
    ov.push(t * (ARENA_A + ARENA_B) / 2, CLIFF_BASE + CLIFF.thick + 6);
  }
  for (let i = 0; i < NT; i++) for (let j = 0; j < cols - 1; j++) {
    const a = i * cols + j, b = a + 1, c = a + cols, e = c + 1;
    idx.push(a, c, b, b, c, e);
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  geo.setAttribute('ao', new THREE.Float32BufferAttribute(ao, 1));
  geo.setAttribute('aOval', new THREE.Float32BufferAttribute(ov, 2));
  geo.setIndex(idx);
  geo.computeVertexNormals();
  parts.add('cliff', geo);
  return topH;
}

// ── Columnas de roca orgánicas ─────────────────────────────────────────────

/**
 * Columna de roca modelada: grosor irregular con abultamientos y estrechamientos, más fina arriba, y una raíz que se ensancha mucho
 * abajo y baja por las gradas (así se ve dónde se apoya). `root`: cuántos metros baja la raíz por debajo de su base.
 */
function organicColumn(r: number, h: number, root: number, rng: () => number, radial = 16, rows = 24) {
  const bulges = Array.from({ length: 5 }, () => ({ y: rng() * h, w: 2.5 + rng() * 5, a: (rng() - 0.35) * 0.45 }));
  const lob = [rng() * TAU, rng() * TAU, rng() * TAU];
  const leanX = (rng() - 0.5) * 0.06, leanZ = (rng() - 0.5) * 0.06;
  const pos: number[] = [], ao: number[] = [], idx: number[] = [];
  const radiusAt = (y: number) => {
    const v = Math.max(0, y) / h;
    let k = 1 - 0.38 * v;
    for (const b of bulges) k *= 1 + b.a * Math.exp(-(((y - b.y) / b.w) ** 2));
    // raíz: se ensancha mucho al bajar
    k *= 1 + 0.8 * Math.exp(-(((y + root * 0.2) / (root * 0.6 + 1.5)) ** 2)) + (y < 0 ? 0.9 * Math.min(1, -y / root) : 0);
    return r * k;
  };
  for (let j = 0; j <= rows; j++) {
    const u = j / rows;
    const y = -root + (h + root) * Math.pow(u, 1.15);
    const rr = radiusAt(y), dr = radiusAt(y + 0.6) - radiusAt(y - 0.6);
    // debajo de cada abultamiento queda más oscuro; arriba del todo, redondeado
    const a = (1 - 0.35 * smooth(0, 0.5, dr)) * (y < 1 ? lerp(0.6, 1, smooth(-root, 1, y)) : 1);
    for (let i = 0; i <= radial; i++) {
      const t = (i / radial) * TAU;
      const lobe = 1 + 0.12 * Math.sin(2 * t + lob[0] + y * 0.06) + 0.08 * Math.sin(3 * t + lob[1] - y * 0.09) + 0.05 * Math.sin(5 * t + lob[2] + y * 0.2);
      const taperTop = u > 0.97 ? Math.sqrt(Math.max(0, (1 - u) / 0.03)) * 0.6 + 0.4 : 1;
      pos.push(Math.cos(t) * rr * lobe * taperTop + leanX * y, y, Math.sin(t) * rr * lobe * taperTop + leanZ * y);
      ao.push(a);
    }
  }
  for (let j = 0; j < rows; j++) for (let i = 0; i < radial; i++) {
    const a = j * (radial + 1) + i, b = a + 1, c = a + radial + 1, e = c + 1;
    idx.push(a, c, b, b, c, e);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('ao', new THREE.Float32BufferAttribute(ao, 1));
  g.setIndex(idx);
  g.computeVertexNormals();
  const top = radiusAt(h) * 0.4;
  const cap = new THREE.SphereGeometry(Math.max(0.6, top), radial, 5, 0, TAU, 0, Math.PI / 2);
  cap.scale(1, 0.6, 1);
  cap.translate(leanX * h, h - 0.1, leanZ * h);
  return [g, cap];
}

interface ColumnInfo { x: number; z: number; r: number; top: number }

function buildColumns(parts: Parts, topH: (t: number) => number): ColumnInfo[] {
  const rng = makeRng(777);
  const out: ColumnInfo[] = [];
  const stairTs = STAIRS.map((s) => s.t);
  const place = (t: number, d: number, r: number, top: number, root: number, skirt = true) => {
    const [x, z] = ovalPoint(t, d);
    const base = standsHeight(d);
    for (const g of organicColumn(r, top - base, root, rng)) {
      g.translate(x, base, z);
      // la raíz se derrama sobre las gradas como una masa de roca con grosor: cerca de la columna, dos metros y pico por encima de los
      // escalones; en el borde, a ras. Así desde la arena se ve la roca bajando por los escalones hasta la columna (no «cuelga»).
      const p = g.attributes.position;
      let rsk = 0;
      for (let i = 0; i < p.count; i++) if (p.getY(i) < base - root + 0.01) rsk = Math.max(rsk, Math.hypot(p.getX(i) - x, p.getZ(i) - z));
      for (let i = 0; i < p.count; i++) {
        const py = p.getY(i);
        if (py > base + 3) continue;
        const dist = Math.hypot(p.getX(i) - x, p.getZ(i) - z);
        const ground = standsHeight(ovalDist(p.getX(i), p.getZ(i)));
        const mound = skirt ? ground - 0.15 + 2.6 * smooth(rsk, r * 1.1, dist) : Math.min(py, ground - 0.3);
        const w = 1 - smooth(base - root * 0.5, base + 3, py);
        p.setY(i, lerp(py, mound, w));
      }
      g.computeVertexNormals();
      parts.add('column', g);
    }
    out.push({ x, z, r: r * 0.85, top });
  };
  // columnas que nacen de los primeros anillos de gradas, justo detrás del muro bajo: desde la arena se ve bien su base
  const N1 = 8;
  for (let i = 0; i < N1; i++) {
    let t = ((i + 0.5 + (rng() - 0.5) * 0.3) / N1) * TAU;
    if (Math.abs(wrap(t)) < 0.55) t += 0.6;
    for (let k = 0; k < 40 && (nearAngle(t, stairTs, 0.1) || DOORS.some((dr) => Math.abs(wrap(t - doorAngle(dr))) < 0.32)); k++) t += 0.03; // ni encima de una puerta ni sobre una escalera
    const d = tierFront(1) + 0.9 + rng() * 0.6;
    place(t, d, 2.0 + rng() * 0.6, topH(t) + 4 + rng() * 10, 3);
  }
  // columnas fundidas con la pared, medio metidas en la roca (como un relieve de la propia pared)
  const N2 = 9;
  for (let i = 0; i < N2; i++) {
    const t = ((i + (rng() - 0.5) * 0.5) / N2) * TAU;
    if (Math.abs(wrap(t)) < 0.35) continue;
    place(t, CLIFF_BASE + 2.4 + rng() * 1.2, 2.8 + rng() * 1.3, topH(t) + 2 + rng() * 14, 4, false);
  }
  return out;
}

// ── Escombros y rocas caídas ───────────────────────────────────────────────

function buildRubble(parts: Parts) {
  const rng = makeRng(31337);
  const piece = (x: number, y: number, z: number, s: number, flat: number, detail: 0 | 1) => {
    const g = new THREE.IcosahedronGeometry(1, detail);
    if (detail) { const q = g.attributes.position; for (let i = 0; i < q.count; i++) q.setXYZ(i, q.getX(i) * (0.85 + rng() * 0.3), Math.max(-0.35, q.getY(i)), q.getZ(i) * (0.85 + rng() * 0.3)); g.computeVertexNormals(); }
    g.scale(s * (0.8 + rng() * 0.6), s * flat, s * (0.8 + rng() * 0.6));
    g.rotateY(rng() * TAU);
    g.translate(x, y + s * flat * 0.3, z);
    contactAO(g, y, 0.5, s * flat);
    parts.add('rubble', g);
  };
  for (let i = 0; i < 46; i++) {
    const t = rng() * TAU;
    if (Math.abs(wrap(t)) < 0.3) continue;
    const d = CLIFF_BASE - 0.5 - rng() * 2.5;
    const [x, z] = ovalPoint(t, d);
    piece(x, standsHeight(d), z, 1.2 + rng() * 1.8, 0.7, 1);
    for (let k = 0; k < 3; k++) {
      const [x2, z2] = ovalPoint(t + (rng() - 0.5) * 0.05, d + (rng() - 0.5) * 2.5);
      piece(x2, standsHeight(ovalDist(x2, z2)), z2, 0.3 + rng() * 0.6, 0.6, 0);
    }
  }
  for (let i = 0; i < 70; i++) {
    const t = rng() * TAU;
    const [x, z] = ovalPoint(t, -0.35 - rng() * 1.0);
    if (DOORS.some((d) => Math.hypot(x - d.x, z - d.z) < DOOR.width / 2 + 4)) continue;
    piece(x, 0, z, 0.15 + rng() * 0.3, 0.55, 0);
  }
}

// ── Centro: pilares, rocas y el montón del surco ───────────────────────────

function buildPillars(parts: Parts) {
  for (const p of PILLARS) {
    const g = new THREE.LatheGeometry([
      new THREE.Vector2(PILLAR.baseRadius, 0), new THREE.Vector2(PILLAR.baseRadius * 0.92, 0.5), new THREE.Vector2(PILLAR.radius * 1.15, 0.9),
      new THREE.Vector2(PILLAR.radius, 2.5), new THREE.Vector2(PILLAR.radius * 1.08, 4.2), new THREE.Vector2(PILLAR.radius * 0.88, 6.3),
      new THREE.Vector2(PILLAR.radius * 1.35, PILLAR.height), new THREE.Vector2(PILLAR.radius * 1.2, PILLAR.height + 0.45), new THREE.Vector2(0.001, PILLAR.height + 0.55),
    ], 14);
    g.translate(p.x, 0, p.z);
    contactAO(g, 0, 0.5, 0.7);
    parts.add('pillar', g);
  }
}

function buildRocks(parts: Parts) {
  const rng = makeRng(99);
  for (const c of COVERS) {
    if (c.kind === 'roca') {
      const place = (g: THREE.BufferGeometry) => {
        g.applyMatrix4(new THREE.Matrix4().makeRotationY(c.rot).setPosition(c.x, floorHeight(c.x, c.z), c.z));
        contactAO(g, 0, 0.5, 0.7);
        parts.add('rock', g);
      };
      const a = rockGeometry(rng); a.scale(2.3, 1.7, 1.8); a.translate(0, 0.55, 0); place(a);
      const b = rockGeometry(rng); b.scale(1.2, 1.0, 1.1); b.translate(1.9, 0.3, 1.1); place(b);
    } else if (c.kind === 'chapa') {
      // restos de chapa de la batalla: dos planchas grandes dobladas y clavadas en la arena, una tumbada encima y un tubo
      const place = (g: THREE.BufferGeometry) => {
        g.applyMatrix4(new THREE.Matrix4().makeRotationY(c.rot).setPosition(c.x, floorHeight(c.x, c.z), c.z));
        contactAO(g, floorHeight(c.x, c.z), 0.5, 0.6);
        parts.add('plates', g);
      };
      const bent = (w: number, h: number, bend: number) => {
        const g = new THREE.BoxGeometry(w, h, 0.12, 6, 3, 1);
        const p = g.attributes.position;
        for (let i = 0; i < p.count; i++) { const x = p.getX(i); p.setZ(i, p.getZ(i) + bend * (x / w) ** 2 * 2 + (rng() - 0.5) * 0.05); }
        g.computeVertexNormals();
        return g;
      };
      const a = bent(2.6, 1.5, 0.5); a.rotateX(-0.25); a.translate(-0.3, 0.6, 0); place(a);
      const b = bent(1.8, 1.2, -0.4); b.rotateY(1.2); b.rotateZ(0.2); b.translate(1.2, 0.45, 0.5); place(b);
      const top = bent(2.0, 1.3, 0.3); top.rotateX(-Math.PI / 2 + 0.15); top.rotateY(0.4); top.translate(0.1, 1.15, 0.45); place(top);
      const tube = new THREE.CylinderGeometry(0.35, 0.35, 2.2, 10, 1, true); tube.rotateZ(Math.PI / 2); tube.rotateY(-0.6); tube.translate(-0.9, 0.3, 1.0); place(tube);
    } else if (c.kind === 'monticulo') {
      // chatarra clavada en el montón de arena del final del surco
      for (let i = 0; i < 6; i++) {
        const x = c.x + (rng() - 0.5) * 3.5, z = c.z + (rng() - 0.5) * 3;
        const g = box(0.25 + rng() * 0.9, 0.06 + rng() * 0.08, 0.3 + rng() * 0.8, 0, 0, 0, rng() * 6, (rng() - 0.5) * 1.6, (rng() - 0.5) * 1.6);
        g.translate(x, floorHeight(x, z) + 0.05, z);
        parts.add('scrap', g);
      }
    }
  }
}

/** Huella de cada obstáculo bajo (pilares, rocas, restos de chapa) para las sombras del sol y el oscurecimiento del suelo. */
function blockers() {
  const out: Array<{ x: number; z: number; r: number; h: number }> = [];
  for (const p of PILLARS) out.push({ x: p.x, z: p.z, r: PILLAR.radius, h: PILLAR.height + 0.5 });
  for (const c of COVERS) {
    if (c.kind === 'roca') out.push({ x: c.x, z: c.z, r: 1.9, h: 1.9 }, { x: c.x + Math.cos(c.rot) * 1.9 + Math.sin(c.rot) * 1.1, z: c.z - Math.sin(c.rot) * 1.9 + Math.cos(c.rot) * 1.1, r: 1.0, h: 1.1 });
    else if (c.kind === 'chapa') out.push({ x: c.x, z: c.z, r: 1.5, h: 1.4 });
  }
  return out;
}

// ── Palco: formas orgánicas apiladas ───────────────────────────────────────

function buildPalco(parts: Parts) {
  const { x, z, height } = PALCO;
  // bulbos apilados, cada uno más estrecho y algo desplazado; se funden entre sí
  const stack = [
    { y: ROOF_TOP + 2.2, rx: 6.0, ry: 3.0, off: 0.2 }, { y: ROOF_TOP + 6.4, rx: 5.4, ry: 2.8, off: -0.3 }, { y: ROOF_TOP + 10.4, rx: 4.8, ry: 2.6, off: 0.25 },
    { y: ROOF_TOP + 14.2, rx: 4.2, ry: 2.5, off: -0.2 }, { y: ROOF_TOP + 17.8, rx: 3.6, ry: 2.3, off: 0.15 }, { y: ROOF_TOP + 21.2, rx: 2.9, ry: 2.2, off: -0.1 },
    { y: height + 0.8, rx: 2.1, ry: 2.6, off: 0 },
  ];
  stack.forEach((b, i) => {
    const g0 = new THREE.SphereGeometry(1, 26, 14);
    g0.scale(b.rx * 0.9, b.ry, b.rx * 1.1);
    const g = lumpy(g0, 0.18, 0.9, i + 3);
    g.translate(x + b.off, b.y, z);
    parts.add('palco', g);
    // un cuello más estrecho entre bulbo y bulbo
    if (i > 0) {
      const n = new THREE.CylinderGeometry(b.rx * 0.75, stack[i - 1].rx * 0.75, b.y - stack[i - 1].y, 20, 1, true);
      n.scale(0.9, 1, 1.1);
      n.translate(x, (b.y + stack[i - 1].y) / 2, z);
      parts.add('palco', n);
    }
    // aberturas de borde suave mirando a la arena (huecos oscuros con un reborde redondeado)
    if (i >= 1 && i <= 4) {
      const hx = x + b.off - b.rx * 0.88, hy = b.y + 0.1;
      const hole = new THREE.SphereGeometry(1, 14, 10);
      hole.scale(0.45, b.ry * 0.42, b.rx * 0.34);
      hole.translate(hx, hy, z);
      parts.add('dark', hole);
      const rim = new THREE.TorusGeometry(1, 0.22, 6, 16);
      rim.scale(b.rx * 0.38, b.ry * 0.47, 1);
      rim.rotateY(Math.PI / 2);
      rim.translate(hx - 0.05, hy, z);
      parts.add('palco', rim);
    }
  });
  // remate puntiagudo y orgánico
  const spire = lumpy(new THREE.ConeGeometry(0.9, 5.5, 10, 4), 0.08, 2, 7);
  spire.translate(x, height + 5, z);
  parts.add('palco', spire);
}

// ── Marcas en el suelo ─────────────────────────────────────────────────────

function buildDecals(group: THREE.Group) {
  const rng = makeRng(2024);
  const pos: number[] = [], uv: number[] = [], idx: number[] = [];
  const inFurrow = (x: number, z: number) => Math.abs(floorHeight(x, z)) > 0.04;
  const quad = (cx: number, cz: number, ang: number, w: number, l: number, u: readonly [number, number], v0 = 0, v1 = 1) => {
    if (inFurrow(cx, cz)) return;
    const c = Math.cos(ang), s = Math.sin(ang), b = pos.length / 3;
    for (const [a, bb, uu, vv] of [[-w / 2, -l / 2, u[0], v0], [w / 2, -l / 2, u[1], v0], [w / 2, l / 2, u[1], v1], [-w / 2, l / 2, u[0], v1]]) {
      pos.push(cx + a * c + bb * s, 0.02, cz - a * s + bb * c);
      uv.push(uu, vv);
    }
    idx.push(b, b + 2, b + 1, b, b + 3, b + 2);
  };
  // arena pisada y removida a manchas irregulares en los caminos de las puertas, con alguna huella suelta
  for (const d of DOORS) {
    for (let k = 0; k < 7; k++) {
      const s = 3 + k * 3.6 + rng() * 2, lat = (rng() - 0.5) * 5;
      const x = d.x - d.out[0] * s - d.out[1] * lat, z = d.z - d.out[1] * s + d.out[0] * lat;
      const w = 2.5 + rng() * 3;
      quad(x, z, rng() * TAU, w, w * (1.2 + rng() * 0.6), DECAL_UV.trample, 0, 1);
      if (rng() < 0.6) quad(x + (rng() - 0.5) * 3, z + (rng() - 0.5) * 3, rng() * TAU, 1.0, 2.0, DECAL_UV.prints, 0, 1);
    }
  }
  // arrastres anchos y suaves
  for (let i = 0; i < 5; i++) {
    const a = rng() * TAU, r = 7 + rng() * 16;
    quad(Math.cos(a) * r * 0.85, Math.sin(a) * r, rng() * TAU, 2.4, 6 + rng() * 5, DECAL_UV.drag);
  }
  // quemaduras de disparos y explosiones, más junto a las coberturas
  for (let i = 0; i < 14; i++) {
    let x: number, z: number;
    if (i < 9) { const c = COVERS[Math.floor(rng() * COVERS.length)]; x = c.x + (rng() - 0.5) * 7; z = c.z + (rng() - 0.5) * 7; }
    else { const a = rng() * TAU, r = rng() * 0.8; x = Math.cos(a) * r * ARENA_A; z = Math.sin(a) * r * ARENA_B; }
    const s = 1.2 + rng() * 3;
    quad(x, z, rng() * TAU, s, s, DECAL_UV.scorch, 0.25, 0.75);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  g.setIndex(idx);
  const m = new THREE.Mesh(g, decalMaterial());
  m.renderOrder = 1;
  m.name = 'marcas';
  group.add(m);
}

// ── Sombras del sol calculadas al cargar ───────────────────────────────────

/** Rejilla de alturas de todo lo que rodea la arena (gradas, pared, columnas, palco, puertas y el surco) para mirar hacia el sol. */
class SunBake {
  private readonly step = 0.6;
  private readonly x0 = -(ARENA_A + 42);
  private readonly z0 = -(ARENA_B + 42);
  private readonly nx: number;
  private readonly nz: number;
  private readonly h: Float32Array;
  private readonly dir: THREE.Vector3;
  private readonly hx: number; private readonly hz: number; private readonly tan: number;

  constructor(private small: Array<{ x: number; z: number; r: number; h: number }>) {
    this.nx = Math.ceil((-2 * this.x0) / this.step) + 1;
    this.nz = Math.ceil((-2 * this.z0) / this.step) + 1;
    this.h = new Float32Array(this.nx * this.nz);
    this.dir = new THREE.Vector3(ARENA_SUN.x, ARENA_SUN.y, ARENA_SUN.z).normalize();
    const hl = Math.hypot(this.dir.x, this.dir.z);
    this.hx = this.dir.x / hl; this.hz = this.dir.z / hl; this.tan = this.dir.y / hl;
  }

  /** Rellena el mapa de alturas (a trozos: cada `yield` es una pausa posible, para prepararlo durante la cinemática). */
  *fill(topH: (t: number) => number, columns: ColumnInfo[]): Generator<void, void, void> {
    for (let j = 0; j < this.nz; j++) {
      if (j % 24 === 23) yield;
      for (let i = 0; i < this.nx; i++) {
      const x = this.x0 + i * this.step, z = this.z0 + j * this.step;
      const d = ovalDist(x, z);
      let y = d < 0 ? floorHeight(x, z) : standsHeight(d);
      if (d >= CLIFF_BASE + 1) y = topH(((ovalAngle(x, z, d) % TAU) + TAU) % TAU);
      for (const door of DOORS) {
        const s = (x - door.x) * door.out[0] + (z - door.z) * door.out[1];
        const lat = Math.abs(-(x - door.x) * door.out[1] + (z - door.z) * door.out[0]);
        if (s > -1.4 && s < tierFront(DOOR_TIERS) + 0.5 && lat < DOOR.width / 2 + 2.4) y = Math.max(y, ROOF_TOP);
      }
      this.h[j * this.nx + i] = y;
      }
    }
    const disc = (cx: number, cz: number, r: number, top: number) => {
      for (let j = Math.floor((cz - r - this.z0) / this.step); j <= Math.ceil((cz + r - this.z0) / this.step); j++) {
        for (let i = Math.floor((cx - r - this.x0) / this.step); i <= Math.ceil((cx + r - this.x0) / this.step); i++) {
          if (i < 0 || j < 0 || i >= this.nx || j >= this.nz) continue;
          if (Math.hypot(this.x0 + i * this.step - cx, this.z0 + j * this.step - cz) <= r) this.h[j * this.nx + i] = Math.max(this.h[j * this.nx + i], top);
        }
      }
    };
    for (const c of columns) disc(c.x, c.z, c.r, c.top);
    disc(PALCO.x, PALCO.z, 4.6, PALCO.height + 3);
  }

  private height(x: number, z: number): number | null {
    const fx = (x - this.x0) / this.step, fz = (z - this.z0) / this.step;
    if (fx < 0 || fz < 0 || fx >= this.nx - 1 || fz >= this.nz - 1) return null;
    const i = Math.floor(fx), j = Math.floor(fz), u = fx - i, v = fz - j, g = this.h, n = this.nx;
    const a = g[j * n + i], b = g[j * n + i + 1], c = g[(j + 1) * n + i], d = g[(j + 1) * n + i + 1];
    return a + (b - a) * u + (c - a) * v + (a - b - c + d) * u * v;
  }

  /** 0 = al sol, 1 = a la sombra. Las caras que no miran al sol no se oscurecen aquí (ya las oscurece la luz). */
  shadow(x: number, y: number, z: number, nx: number, ny: number, nz: number): number {
    const D = this.dir;
    if (nx * D.x + ny * D.y + nz * D.z < 0.06) return 0;
    const ox = x + nx * 0.35, oy = y + ny * 0.35 + 0.1, oz = z + nz * 0.35;
    let worst = -1e9;
    for (let t = 0.6; t < 190; t += t < 12 ? 0.5 : t < 45 ? 1.1 : 2.4) {
      const h = this.height(ox + this.hx * t, oz + this.hz * t);
      if (h === null) break;
      const e = h - (oy + this.tan * t);
      if (e > worst) worst = e;
      if (worst > 1.2) break;
    }
    let s = smooth(-0.25, 1.0, worst);
    for (const b of this.small) {
      if (s >= 1) break;
      const px = ox - b.x, pz = oz - b.z;
      const proj = px * this.hx + pz * this.hz;
      if (proj > 0) continue;
      const t = -proj;
      const miss = Math.hypot(px + this.hx * t, pz + this.hz * t);
      if (miss > b.r + 0.3 || oy + this.tan * t > b.h) continue;
      s = Math.max(s, 1 - smooth(b.r - 0.3, b.r + 0.3, miss));
    }
    return s;
  }
}

/** Color de cada pieza según su altura y posición (antes de oscurecer). */
function partColor(part: Part, x: number, y: number, z: number, out: THREE.Color) {
  const C = ARENA_COLORS;
  switch (part) {
    case 'floor': {
      const d = ovalDist(x, z);
      out.set(C.sand);
      out.lerp(new THREE.Color(C.sandEdge), 0.85 * smooth(-10, -0.4, d));
      let tr = 0;
      for (const door of DOORS) {
        const s = -((x - door.x) * door.out[0] + (z - door.z) * door.out[1]);
        const lat = Math.abs(-(x - door.x) * door.out[1] + (z - door.z) * door.out[0]);
        if (s > 0) tr = Math.max(tr, (1 - smooth(1.5, 4.5, lat)) * (1 - smooth(18, 30, s)));
      }
      out.lerp(new THREE.Color(C.sandTrodden), 0.5 * tr);
      // hollín y arena removida en el surco de impacto
      const fh = floorHeight(x, z);
      if (fh < -0.02) out.lerp(new THREE.Color(C.soot), Math.min(0.4, -fh * 0.9)); // suave: arena quemada, no una franja negra
      return;
    }
    case 'pebbles': out.set(C.pebbles).multiplyScalar(0.8 + 0.4 * ((Math.sin(x * 12.9 + z * 78.2) * 43758.5) % 1 + 1) % 1); return;
    case 'rock': case 'rubble': out.set(C.rock); return;
    case 'seats': case 'risers': {
      out.set(C.seats);
      // los anillos de abajo, más sucios y oscuros
      out.lerp(new THREE.Color(C.seatsDirt), 0.55 * (1 - smooth(WALL.height, 11, y)));
      return;
    }
    case 'wall': out.set(C.stone).lerp(new THREE.Color(C.seatsDirt), 0.35 * (1 - smooth(0, 1.6, y))); return;
    case 'frame': out.set(C.stone); return;
    case 'steps': out.set(C.steps); return;
    case 'tunnel': out.set(C.tunnel); return;
    case 'tunnelEnd': out.set(C.tunnelEnd); return;
    case 'cliff': {
      out.set(C.cliffLow).lerp(new THREE.Color(C.cliffHigh), smooth(CLIFF_Y0, CLIFF.height + 6, y));
      out.multiplyScalar(1 + 0.08 * Math.sin(y * 0.55 + Math.sin(x * 0.05 + z * 0.04) * 1.2));
      return;
    }
    case 'column': out.set(C.columnLow).lerp(new THREE.Color(C.columnHigh), smooth(6, CLIFF.height + 10, y)); return;
    case 'pillar': out.set(C.pillar).multiplyScalar(0.8 + 0.2 * smooth(0, PILLAR.height, y)); return;
    case 'palco': out.set(C.palco).multiplyScalar(0.85 + 0.15 * smooth(ROOF_TOP, PALCO.height, y)); return;
    case 'post': out.set(C.post); return;
    case 'gate': out.set(C.gate); return;
    case 'scrap': out.set(C.scrap); return;
    case 'plates': {
      // metal sucio: más oscuro y pardo abajo (arena pegada), con manchas de quemado
      out.set(C.plates).multiplyScalar(0.75 + 0.25 * smooth(0, 1.2, y));
      const burn = Math.max(0, Math.sin(x * 2.3 + z * 1.7) * Math.sin(z * 2.9 - x * 0.8));
      out.multiplyScalar(1 - 0.5 * burn);
      return;
    }
    case 'dark': out.set(C.dark); return;
  }
}

/** Oscurecimiento del suelo alrededor de lo que se apoya en él (pie del muro, coberturas, pilares, marcos de las puertas). */
function floorAO(x: number, z: number, small: Array<{ x: number; z: number; r: number }>) {
  const d = ovalDist(x, z);
  let ao = 1 - 0.45 * smooth(-2.0, 0, d);
  for (const b of small) ao *= 1 - 0.42 * (1 - smooth(b.r * 0.7, b.r + 1.4, Math.hypot(x - b.x, z - b.z)));
  for (const door of DOORS) {
    const s = (x - door.x) * door.out[0] + (z - door.z) * door.out[1];
    const lat = Math.abs(-(x - door.x) * door.out[1] + (z - door.z) * door.out[0]);
    const e = Math.abs(lat - (DOOR.width / 2 + 0.9));
    if (e < 2.4 && s > -3.5) ao *= 1 - 0.38 * (1 - smooth(0.8, 2.4, e)) * (1 - smooth(-3.5, -1.2, -s));
  }
  // el fondo del surco, algo más oscuro
  ao *= 1 - 0.3 * smooth(0, 0.5, -floorHeight(x, z));
  return Math.max(0.35, ao);
}

export interface ArenaBuild { group: THREE.Group; triangles: number; bakeMs: number }

/** Monta la arena con materiales, luz y profundidad (de una vez). */
export function buildArena(): ArenaBuild {
  const it = buildArenaSteps();
  for (;;) { const r = it.next(); if (r.done) return r.value; }
}

/**
 * Lo mismo, pero a trozos: cada `yield` es un buen momento para parar y seguir en la imagen siguiente.
 * Así la arena se puede preparar durante la cinemática de paso sin que el juego se trabe (ver ArenaPrep en ArenaWorld.ts).
 */
export function* buildArenaSteps(): Generator<void, ArenaBuild, void> {
  let busy = 0; // tiempo de trabajo de verdad (sin contar las pausas)
  let mark = performance.now();
  const pause = function* () { busy += performance.now() - mark; yield; mark = performance.now(); };
  const group = new THREE.Group();
  group.name = 'arena';
  const extras = new THREE.Group();
  const parts = new Parts();
  buildFloor(parts); yield* pause();
  buildPebbles(parts); yield* pause();
  buildWallAndTiers(parts); yield* pause();
  buildStairs(parts); yield* pause();
  buildPosts(parts); yield* pause();
  buildDoors(parts, extras); yield* pause();
  const topH = buildCliff(parts); yield* pause();
  const columns = buildColumns(parts, topH); yield* pause();
  buildRubble(parts); yield* pause();
  buildPillars(parts); yield* pause();
  buildRocks(parts); yield* pause();
  buildPalco(parts); yield* pause();

  const small = blockers();
  const sun = new SunBake(small);
  for (const _ of sun.fill(topH, columns)) yield* pause();
  yield* pause();
  const col = new THREE.Color();
  const dustC = new THREE.Color(ARENA_COLORS.dust);
  let triangles = 0;
  for (const [part, list] of parts.geos) {
    const cfg = PARTS[part];
    const g = mergeGeometries(list);
    yield* pause();
    const p = g.attributes.position, n = g.attributes.normal, ao = g.attributes.ao, du = g.attributes.dust;
    const colors = new Float32Array(p.count * 3);
    for (let i = 0; i < p.count; i++) {
      if (i % 2500 === 2499) yield* pause();
      const x = p.getX(i), y = p.getY(i), z = p.getZ(i);
      partColor(part, x, y, z, col);
      const dust = du.getX(i);
      if (dust > 0) col.lerp(dustC, 0.45 * dust);
      let k = ao.getX(i);
      if (part === 'floor') k *= floorAO(x, z, small);
      col.multiplyScalar(k);
      if (!cfg.noSun) {
        const s = sun.shadow(x, y, z, n.getX(i), n.getY(i), n.getZ(i));
        if (s > 0) { col.r *= 1 + (SHADE.r - 1) * s; col.g *= 1 + (SHADE.g - 1) * s; col.b *= 1 + (SHADE.b - 1) * s; }
      }
      colors.set([col.r, col.g, col.b], i * 3);
    }
    g.setAttribute('color', new THREE.BufferAttribute(colors, 3));
    g.deleteAttribute('ao');
    g.deleteAttribute('dust');
    const base = lookBase(cfg.look);
    g.setAttribute('texAmt', new THREE.BufferAttribute(new Float32Array(p.count).fill(base.tex), 1));
    g.setAttribute('texKind', new THREE.BufferAttribute(new Float32Array(p.count).fill(base.kind), 1));
    const m = new THREE.Mesh(g, arenaMaterial(cfg.look, cfg.side));
    m.name = part;
    m.receiveShadow = true;
    m.castShadow = part !== 'floor';
    group.add(m);
    triangles += (g.index ? g.index.count : p.count) / 3;
  }

  buildDecals(group);
  // suelo de debajo de todo (tapa las juntas entre la arena, el muro y los túneles)
  const under = new THREE.Mesh(new THREE.PlaneGeometry((ARENA_A + 40) * 2, (ARENA_B + 40) * 2), new THREE.MeshLambertMaterial({ color: 0x4a3426 }));
  under.rotation.x = -Math.PI / 2;
  under.position.y = -0.04;
  under.name = 'under';
  group.add(under);
  group.add(extras);
  void FURROW;
  busy += performance.now() - mark;
  return { group, triangles, bakeMs: busy };
}
