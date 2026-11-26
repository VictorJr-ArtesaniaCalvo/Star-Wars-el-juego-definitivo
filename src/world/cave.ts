import * as THREE from 'three';
import type RAPIER from '@dimforge/rapier3d-compat';
import { mergeGeometries, mergeVertices } from 'three/addons/utils/BufferGeometryUtils.js';
import { rockGeometry } from './arena/greybox';
import { applyWorldTextures, groundExtraTexture, groundTexture, pitsTexture, rockJointsTexture, rockTexture, slabsTexture, strataTexture } from './materials';
import { floorHalfWidth, makeRng, terrainHeight, wallDetailOn, wallOffset } from './terrain';

// ============================================================================
//  ENTRADA DE LA CUEVA (pared oeste del cañón, sitio C elegido por Víctor; fachada con relieve y textura de roca)
// ============================================================================
// Por aquí huye el comando en la cinemática de paso a la arena. Una portada de roca que sale del pie de la pared, con el hueco en arco
// (como las puertas de la arena), un marco grueso y abultado, rocas al pie y unos metros de túnel que se pierden en la oscuridad.
// Se ve en las rondas del cañón; se puede pasar bajo el arco un par de metros, no más (`pasa`).
// Las rocas, bloques de pared y repisas que caerían encima o delante se quitan (caveKeepOut) sin cambiar el resto del mapa.
// Todo ajustable aquí (metros).
// ============================================================================

export const CUEVA = {
  /** Pared (−1 = oeste, la del sitio C) y a qué altura del cañón (z: − = norte). */
  lado: -1 as -1 | 1,
  z: -24,
  /** Hueco: ancho, alto total y forma de arriba (0 = arco redondo como las puertas de la arena · 1 = en punta). */
  ancho: 4.6,
  alto: 6.2,
  punta: 0,
  /** Portada de roca alrededor del hueco: ancho, alto y cuánto sale por delante del pie de la pared. */
  portada: { ancho: 14, alto: 10.5, sale: 1.6 }, // sale: la mitad que antes (Víctor)
  /** Fondo del túnel que se ve (luego, oscuridad). */
  fondo: 9,
  /** Color de la roca: rojiza como el muro, un tono algo más claro (pedido por Víctor). Se multiplica por la textura de roca de las paredes. */
  color: 0xd27a4c,
  /** Relieve de la fachada (m): cuánto salen los abultamientos, las capas y las grietas. */
  relieve: 1,
  /** Hasta dónde se puede entrar andando (m desde la boca): luego, una pared invisible. */
  pasa: 2.5,
};

/** Distancia desde el pie de la pared hacia el centro del cañón (+) o hacia dentro de la pared (−). */
function fromFoot(x: number) { return (x - wallFootX(CUEVA.lado, CUEVA.z)) * -CUEVA.lado; }

/**
 * ¿Queda este punto (con un radio `r`) encima de la cueva o delante de su boca? Lo usan las rocas, los bloques de pared y las repisas
 * para no taparla. `y` (opcional): la altura más baja de la pieza; lo que está más alto que la portada (en lo alto de la pared) se deja.
 */
export function caveKeepOut(x: number, z: number, r = 0, y?: number) {
  const C = CUEVA;
  const u = fromFoot(x), dz = Math.abs(z - C.z);
  if (y !== undefined && y > terrainHeight(wallFootX(C.lado, C.z) - C.lado * C.portada.sale, C.z) + C.portada.alto + 1) return false;
  const portada = u > -14 - r && u < C.portada.sale + 1.5 + r && dz < C.portada.ancho / 2 + 1 + r;
  const pasillo = u > C.portada.sale - r && u < C.portada.sale + 9 + r && dz < 3 + r; // camino libre delante de la boca (la carrera de la cinemática)
  return portada || pasillo;
}

/** Dónde queda el pie de la pared en esa z (con el detalle de pared de las calidades media y alta, sus entrantes). */
function wallFootX(side: number, z: number) {
  return side * (floorHalfWidth(side, z) + (wallDetailOn() ? wallOffset(side, z) : 0));
}

/** Silueta del hueco: de abajo a la izquierda a abajo a la derecha (patas rectas y arco redondo o apuntado). */
function archPoints(hw: number, alto: number, punta: number, n = 16) {
  const roundTop = alto - hw; // altura de las patas con el arco redondo
  const legH = roundTop - punta * hw * 0.5;
  const rise = alto - legH;
  const pts: THREE.Vector2[] = [new THREE.Vector2(-hw, 0), new THREE.Vector2(-hw, legH)];
  for (let i = 1; i < n; i++) {
    const u = -1 + (2 * i) / n; // −1..1 a lo ancho
    const round = Math.sqrt(Math.max(0, 1 - u * u));
    const pointed = Math.pow(Math.max(0, 1 - Math.abs(u)), 0.62) * (1 - 0.25 * u * u);
    pts.push(new THREE.Vector2(u * hw, legH + rise * (round * (1 - punta) + pointed * punta)));
  }
  pts.push(new THREE.Vector2(hw, legH), new THREE.Vector2(hw, 0));
  return pts;
}

/** Abolla una forma con un ruido suave (para que parezca roca y no algo hecho a máquina). */
function lumpy(src: THREE.BufferGeometry, amp: number, freq: number, seed: number) {
  for (const k of Object.keys(src.attributes)) if (k !== 'position') src.deleteAttribute(k);
  const g = mergeVertices(src, 1e-4);
  g.computeVertexNormals();
  const p = g.attributes.position, n = g.attributes.normal;
  for (let i = 0; i < p.count; i++) {
    const x = p.getX(i), y = p.getY(i), z = p.getZ(i);
    const k = amp * (Math.sin(x * freq + seed * 1.7) * Math.sin(y * freq * 1.3 + seed * 2.3) + 0.6 * Math.sin(z * freq * 0.9 + y * freq * 0.5 + seed * 3.1));
    p.setXYZ(i, x + n.getX(i) * k, y + n.getY(i) * k, z + n.getZ(i) * k);
  }
  g.computeVertexNormals();
  return g;
}

/** Pone color a una pieza: el de la roca con manchas, más oscuro abajo (contacto con el suelo) y `dark(x,y,z)` para el interior. */
function paint(g: THREE.BufferGeometry, base: THREE.Color, dark?: (x: number, y: number, z: number) => number) {
  const g2 = g.index ? g.toNonIndexed() : g;
  for (const k of Object.keys(g2.attributes)) if (k !== 'position' && k !== 'normal') g2.deleteAttribute(k);
  if (!g2.attributes.normal) g2.computeVertexNormals();
  const p = g2.attributes.position;
  const col = new Float32Array(p.count * 3);
  const c = new THREE.Color();
  for (let i = 0; i < p.count; i++) {
    const x = p.getX(i), y = p.getY(i), z = p.getZ(i);
    const spot = 0.88 + 0.12 * Math.sin(x * 0.9 + y * 1.3) * Math.sin(z * 1.1 - y * 0.7);
    const foot = 0.7 + 0.3 * Math.min(1, Math.max(0, (y + 0.3) / 1.2));
    c.copy(base).multiplyScalar(spot * foot * (dark ? dark(x, y, z) : 1));
    col.set([c.r, c.g, c.b], i * 3);
  }
  g2.setAttribute('color', new THREE.BufferAttribute(col, 3));
  g2.setAttribute('texAmt', new THREE.BufferAttribute(new Float32Array(p.count).fill(1), 1)); // textura de roca de las paredes
  g2.setAttribute('texKind', new THREE.BufferAttribute(new Float32Array(p.count), 1));
  return g2;
}

/** Ruido suave repetible (0..1) para el relieve de la roca. */
function vnoise(x: number, y: number) {
  const h = (i: number, j: number) => { const n = Math.sin(i * 127.1 + j * 311.7) * 43758.5453; return n - Math.floor(n); };
  const i = Math.floor(x), j = Math.floor(y), fx = x - i, fy = y - j;
  const u = fx * fx * (3 - 2 * fx), v = fy * fy * (3 - 2 * fy);
  return (h(i, j) * (1 - u) + h(i + 1, j) * u) * (1 - v) + (h(i, j + 1) * (1 - u) + h(i + 1, j + 1) * u) * v;
}
const fbm = (x: number, y: number) => 0.55 * vnoise(x, y) + 0.3 * vnoise(x * 2.1 + 5.2, y * 2.1 + 1.3) + 0.15 * vnoise(x * 4.3 + 9.7, y * 4.3 + 3.1);
const sstep = (a: number, b: number, v: number) => { const t = Math.min(1, Math.max(0, (v - a) / (b - a))); return t * t * (3 - 2 * t); };

/** Distancia de un punto (x, y) al borde de un polígono cerrado. */
function edgeDist(pts: Array<[number, number]>, x: number, y: number) {
  let d = Infinity;
  for (let i = 0; i < pts.length; i++) {
    const [ax, ay] = pts[i], [bx, by] = pts[(i + 1) % pts.length];
    const dx = bx - ax, dy = by - ay, l2 = dx * dx + dy * dy;
    const t = l2 > 0 ? Math.min(1, Math.max(0, ((x - ax) * dx + (y - ay) * dy) / l2)) : 0;
    d = Math.min(d, Math.hypot(x - ax - t * dx, y - ay - t * dy));
  }
  return d;
}
function insidePoly(pts: Array<[number, number]>, x: number, y: number) {
  let c = false;
  for (let i = 0, j = pts.length - 1; i < pts.length; j = i++) {
    const [xi, yi] = pts[i], [xj, yj] = pts[j];
    if ((yi > y) !== (yj > y) && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) c = !c;
  }
  return c;
}

/** Boca de la cueva: centro del hueco a ras de suelo y hacia dónde mira (hacia el centro del cañón). Para la cinemática de paso a la arena. */
export function caveMouth() {
  const foot = wallFootX(CUEVA.lado, CUEVA.z);
  const ox = -CUEVA.lado;
  const x = foot + ox * CUEVA.portada.sale;
  return { x, y: terrainHeight(x + ox * 0.5, CUEVA.z), z: CUEVA.z, out: [ox, 0] as [number, number] };
}

export interface CaveBuild { group: THREE.Group; triangles: number; mouth: THREE.Vector3; out: THREE.Vector3 }

/** Construye la entrada de la cueva (dibujo solo; los cuerpos sólidos se añadirán al meterla en el juego). */
export function buildCave(opts: Partial<typeof CUEVA> = {}): CaveBuild {
  const C = { ...CUEVA, ...opts, portada: { ...CUEVA.portada, ...(opts.portada ?? {}) } };
  const rng = makeRng(4242);
  const hw = C.ancho / 2;
  const base = new THREE.Color(C.color);
  const parts: THREE.BufferGeometry[] = [];
  const foot = wallFootX(C.lado, C.z);
  const out = new THREE.Vector3(-C.lado, 0, 0); // hacia el centro del cañón
  const front = foot + out.x * C.portada.sale; // plano de la portada
  const groundY = terrainHeight(front + out.x * 0.5, C.z);
  const back = C.portada.sale + 4; // la portada se mete en la pared para que no quede hueco detrás

  // 1) Portada: una masa de roca con el contorno irregular y el hueco en arco
  const W = C.portada.ancho / 2, H = C.portada.alto;
  const face = new THREE.Shape();
  face.moveTo(-W, -1.5);
  face.lineTo(W, -1.5);
  const edge: Array<[number, number]> = [];
  for (let i = 0; i <= 6; i++) edge.push([W * (0.92 + 0.1 * rng()), -1.5 + (i / 6) * (H * 0.72)]); // lado derecho, subiendo
  for (let i = 0; i <= 10; i++) { const u = 1 - (2 * i) / 10; edge.push([W * u * (0.95 - 0.12 * Math.abs(u) * Math.abs(u)), H * (0.8 + 0.2 * (1 - u * u)) + (rng() - 0.5) * 1.6]); } // arriba, con picos
  for (let i = 6; i >= 0; i--) edge.push([-W * (0.92 + 0.1 * rng()), -1.5 + (i / 6) * (H * 0.72)]); // lado izquierdo, bajando
  for (const [x, y] of edge) face.lineTo(x, y);
  face.closePath();
  face.holes.push(new THREE.Path(archPoints(hw, C.alto, C.punta, 18)));
  const fg = new THREE.ExtrudeGeometry(face, { depth: back, steps: 4, bevelEnabled: false, curveSegments: 6 });
  fg.translate(0, 0, -back - 0.3); // su cara queda algo por detrás: delante va la «piel» de roca con relieve
  // las paredes del hueco (dentro de la portada) se oscurecen igual que el túnel
  const holeTop = C.alto + 0.3;
  const inHole = (x: number, y: number, z: number) => (Math.abs(x) < hw + 0.35 && y < holeTop && z < -0.25 ? Math.max(0.04, Math.pow(1 - Math.min(1, -z / C.fondo), 2.2) * 0.5) : 1);
  parts.push(paint(lumpy(fg, 0.45, 0.5, 3), base, inHole));

  // 1b) Piel de roca de la fachada: una malla fina que sigue el contorno, con capas que sobresalen, abultamientos y grietas.
  //     Junto al arco el relieve se aplana (el marco tapa el borde y el arco conserva su forma); junto al contorno se mete por detrás.
  const outline: Array<[number, number]> = [[-W, -1.5], [W, -1.5], ...edge];
  const arch = archPoints(hw, C.alto, C.punta, 24).map((p) => [p.x, p.y] as [number, number]);
  const R = C.relieve;
  const relief = (x: number, y: number) => {
    const wob = 0.5 * vnoise(x * 0.3 + 3, y * 0.15);
    const band = (y + wob) / 1.35, bi = Math.floor(band), bf = band - bi;
    const layer = (vnoise(bi * 3.7, 1.3) - 0.35) * 0.55 + 0.35 * sstep(0.72, 0.95, bf) * (1 - sstep(0.95, 1, bf)); // capas que sobresalen con su repisa
    const bulge = 0.75 * (fbm(x * 0.22 + 7, y * 0.2) - 0.45); // abultamientos grandes
    const crack = -0.32 * (1 - sstep(0.02, 0.16, Math.abs(Math.sin(x * 0.75 + 2.2 * vnoise(x * 0.2, y * 0.35) + 1.1)))); // grietas verticales
    const grain = 0.12 * (fbm(x * 1.1, y * 1.3) - 0.5);
    return R * (0.35 + layer + bulge + crack + grain);
  };
  const NX = 60, NY = 46;
  const skin = new THREE.PlaneGeometry(2 * W + 1, H + 3.2, NX, NY);
  skin.translate(0, (H + 3.2) / 2 - 1.6, 0);
  const sp = skin.attributes.position;
  const keep: boolean[] = [];
  for (let i = 0; i < sp.count; i++) {
    const x = sp.getX(i), y = sp.getY(i);
    const inArch = insidePoly(arch, x, y) && y > -0.5;
    const inOut = insidePoly(outline, x, y);
    keep.push(inOut && !inArch);
    const dArch = edgeDist(arch, x, y), dOut = edgeDist(outline, x, y);
    let z = relief(x, y);
    z = z * sstep(0.35, 1.9, inArch ? 0 : dArch); // junto al arco, plano
    z = -0.4 + (z + 0.4) * sstep(0.15, 1.3, inOut ? dOut : 0); // junto al contorno, se mete por detrás de la masa
    sp.setZ(i, z);
  }
  const si = skin.index!.array, kept: number[] = [];
  for (let t = 0; t < si.length; t += 3) if (keep[si[t]] && keep[si[t + 1]] && keep[si[t + 2]]) kept.push(si[t], si[t + 1], si[t + 2]);
  skin.setIndex(kept);
  skin.computeVertexNormals();
  parts.push(paint(skin, base, (x, y) => 0.88 + 0.12 * vnoise(x * 0.5, y * 0.8)));

  // 2) Marco: un lomo de roca grueso y abultado alrededor del arco, algo más claro (le da el sol)
  const frameR = 0.62;
  const path = new THREE.CatmullRomCurve3(archPoints(hw + frameR * 0.5, C.alto + frameR * 0.5, C.punta, 12).map((p) => new THREE.Vector3(p.x, p.y, 0.15)));
  parts.push(paint(lumpy(new THREE.TubeGeometry(path, 48, frameR, 9, false), 0.16, 1.2, 7), base.clone().multiplyScalar(1.12)));
  for (const s of [-1, 1]) {
    const b = new THREE.SphereGeometry(1, 12, 8);
    b.scale(0.95, 1.5, 0.85);
    b.translate(s * (hw + 0.55), 0.55, 0.1);
    parts.push(paint(lumpy(b, 0.12, 1.6, s + 2), base));
  }

  // 3) Túnel: bóveda con la misma silueta, cada vez más oscura hacia dentro; suelo y fondo negro
  const sec = archPoints(hw, C.alto, C.punta, 14);
  const NS = 8, pos: number[] = [], idx: number[] = [];
  for (let j = 0; j <= NS; j++) {
    const z = -0.05 - (j / NS) * C.fondo;
    for (const p of sec) pos.push(p.x * (1 - 0.06 * j / NS), p.y * (1 - 0.08 * j / NS), z); // se estrecha un poco
  }
  const M = sec.length;
  for (let j = 0; j < NS; j++) for (let i = 0; i < M - 1; i++) { const a = j * M + i; idx.push(a, a + M, a + 1, a + 1, a + M, a + M + 1); }
  const tg = new THREE.BufferGeometry();
  tg.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  tg.setIndex(idx);
  const inside = (_x: number, _y: number, z: number) => Math.max(0.04, Math.pow(1 - Math.min(1, -z / C.fondo), 2.2) * 0.5);
  parts.push(paint(lumpy(tg, 0.12, 1.4, 5), base, inside));
  const floor = new THREE.PlaneGeometry(C.ancho * 1.02, C.fondo, 4, 8);
  floor.rotateX(-Math.PI / 2);
  floor.translate(0, 0.15, -C.fondo / 2); // algo elevado: el terreno sube un poco hacia la pared y no debe asomar
  parts.push(paint(floor, base.clone().multiplyScalar(0.9), inside));
  const end = new THREE.ShapeGeometry(new THREE.Shape(sec), 4);
  end.translate(0, 0, -C.fondo + 0.05);
  parts.push(paint(end, new THREE.Color(0x060302)));

  // 4) Rocas caídas al pie de la portada y alguna encima
  const rock = (x: number, y: number, z: number, s: number, sy = 0.8) => {
    const g = rockGeometry(rng);
    g.scale(s * (0.8 + 0.4 * rng()), s * sy, s * (0.8 + 0.4 * rng()));
    g.rotateY(rng() * Math.PI * 2);
    g.translate(x, y, z);
    parts.push(paint(g, base.clone().multiplyScalar(0.85 + 0.25 * rng())));
  };
  rock(-hw - 2.4, 0.2, 0.9, 1.5); rock(hw + 2.6, 0.2, 0.7, 1.3); rock(-hw - 4.6, 0.1, 0.2, 1.1); rock(hw + 4.4, 0.1, 1.4, 0.9);
  rock(-hw - 1.6, 0.05, 2.2, 0.55); rock(hw + 1.7, 0.05, 2.6, 0.45); rock(-0.6, H - 0.8, -1.2, 1.6, 0.7); rock(2.6, H - 1.6, -0.8, 1.2, 0.7);

  const geo = mergeGeometries(parts.map((g) => { for (const k of Object.keys(g.attributes)) if (!['position', 'normal', 'color', 'texAmt', 'texKind'].includes(k)) g.deleteAttribute(k); return g.index ? g.toNonIndexed() : g; }))!;
  geo.computeVertexNormals();
  // la misma textura de roca que los bloques de las paredes (arenisca en capas), por encima del color
  const mat = applyWorldTextures(new THREE.MeshLambertMaterial({ vertexColors: true, side: THREE.DoubleSide }), { ground: groundTexture(), groundX: groundExtraTexture(), slabs: slabsTexture(), strata: strataTexture(), pits: pitsTexture(), spire: { rock: rockTexture(), joints: rockJointsTexture() }, rockOnly: true, strataScale: 0.2 });
  const mesh = new THREE.Mesh(geo, mat);
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  const group = new THREE.Group();
  group.add(mesh);
  group.position.set(front, groundY, C.z);
  group.rotation.y = C.lado < 0 ? Math.PI / 2 : -Math.PI / 2; // la cara (+Z del modelo) mira al centro del cañón
  group.updateMatrixWorld(true);
  return { group, triangles: geo.attributes.position.count / 3, mouth: new THREE.Vector3(front, groundY, C.z), out };
}

/** Pone la cueva en el cañón: dibujo y cuerpo sólido (la portada y las rocas), con una pared invisible a `pasa` metros dentro del túnel. */
export function buildCaveWorld(scene: THREE.Scene, rapier: typeof RAPIER, physics: RAPIER.World) {
  const c = buildCave();
  scene.add(c.group);
  const mesh = c.group.children[0] as THREE.Mesh;
  const g = mesh.geometry.clone().applyMatrix4(c.group.matrixWorld);
  const verts = new Float32Array(g.attributes.position.array);
  const idx = new Uint32Array(verts.length / 3).map((_, i) => i);
  physics.createCollider(rapier.ColliderDesc.trimesh(verts, idx));
  g.dispose();
  // pared invisible dentro del túnel (no se puede pasar)
  const q = new THREE.Quaternion().setFromEuler(c.group.rotation);
  const p = new THREE.Vector3(0, CUEVA.alto / 2, -CUEVA.pasa - 0.5).applyMatrix4(c.group.matrixWorld);
  physics.createCollider(rapier.ColliderDesc.cuboid(CUEVA.ancho / 2 + 0.5, CUEVA.alto / 2 + 0.5, 0.5).setTranslation(p.x, p.y, p.z).setRotation({ x: q.x, y: q.y, z: q.z, w: q.w }));
  return c;
}
