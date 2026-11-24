import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';

// Droideka con esqueleto. Rodando: las tres patas forman un aro (rueda) alrededor del cuerpo.
// Desplegado: trípode, cuerpo en alto y los dos brazos con cañones hacia delante.
// La animación de plegar es la de desplegar al revés.

export interface DekaBones {
  roll: THREE.Bone; // centro de la rueda: gira al rodar
  body: THREE.Bone;
  armL: THREE.Bone;
  armR: THREE.Bone;
  hips: THREE.Bone[];
  knees: THREE.Bone[];
}

const R = 0.5; // radio de la rueda
const SEG = 0.5; // largo de cada tramo de pata (= lado del hexágono)
const BODY = 0x7a6a50, DARK = 0x3a3228, GUN = 0x2b2b2e;
const BODY_UP = 0.55; // cuánto sube el cuerpo al desplegarse

let shared: THREE.BufferGeometry | null = null;

// Posición de cada hueso en la postura de montaje (la geometría se dibuja respecto al droide, no al hueso):
// 0 roll, 1 cuerpo, 2-3 brazos, y por pata (cadera, rodilla)
const BIND: Array<[number, number, number]> = [
  [0, R, 0], [0, R, 0], [-0.28, R + 0.02, -0.08], [0.28, R + 0.02, -0.08],
  [0, R, 0], [0, R - SEG, 0], [0, R, 0], [0, R - SEG, 0], [0, R, 0], [0, R - SEG, 0],
];

function part(geo: THREE.BufferGeometry, x: number, y: number, z: number, color: number, bone: number): THREE.BufferGeometry {
  const g = geo.index ? geo.toNonIndexed() : geo;
  g.deleteAttribute('uv');
  g.translate(x + BIND[bone][0], y + BIND[bone][1], z + BIND[bone][2]);
  const n = g.attributes.position.count;
  const c = new THREE.Color(color);
  const col = new Float32Array(n * 3), si = new Uint16Array(n * 4), sw = new Float32Array(n * 4);
  for (let i = 0; i < n; i++) { col[i * 3] = c.r; col[i * 3 + 1] = c.g; col[i * 3 + 2] = c.b; si[i * 4] = bone; sw[i * 4] = 1; }
  g.setAttribute('color', new THREE.BufferAttribute(col, 3));
  g.setAttribute('skinIndex', new THREE.Uint16BufferAttribute(si, 4));
  g.setAttribute('skinWeight', new THREE.Float32BufferAttribute(sw, 4));
  return g;
}
const box = (w: number, h: number, d: number) => new THREE.BoxGeometry(w, h, d);

// Índices de hueso: 0 roll, 1 body, 2 armL, 3 armR, 4..9 = (hip, knee) × 3 patas
const geometry = () => {
  if (shared) return shared;
  const p: THREE.BufferGeometry[] = [];
  p.push(part(new THREE.SphereGeometry(0.3, 10, 8), 0, 0, 0, BODY, 1));
  p.push(part(box(0.34, 0.3, 0.34), 0, 0, 0, BODY, 1));
  p.push(part(box(0.2, 0.14, 0.2), 0, 0.2, -0.04, DARK, 1)); // sensor
  for (const bone of [2, 3]) {
    p.push(part(box(0.11, 0.11, 0.7), 0, 0, -0.35, GUN, bone)); // brazo-cañón
    p.push(part(box(0.05, 0.05, 0.3), 0, 0, -0.84, DARK, bone)); // boca
  }
  for (let i = 0; i < 3; i++) {
    const hip = 4 + i * 2, knee = 5 + i * 2;
    p.push(part(box(0.1, SEG, 0.1), 0, -SEG / 2, 0, BODY, hip)); // muslo
    p.push(part(box(0.09, SEG, 0.09), 0, -SEG / 2, 0, DARK, knee)); // pierna
    p.push(part(box(0.16, 0.05, 0.22), 0, -SEG, -0.03, DARK, knee)); // pie
  }
  shared = mergeGeometries(p, false)!;
  for (const g of p) g.dispose();
  return shared;
};

const mk = (x: number, y: number, z: number) => { const b = new THREE.Bone(); b.position.set(x, y, z); b.rotation.order = 'YXZ'; return b; };

export function createDroideka(material: THREE.Material): { mesh: THREE.SkinnedMesh; bones: DekaBones } {
  const mesh = new THREE.SkinnedMesh(geometry(), material);
  const roll = mk(0, R, 0), body = mk(0, 0, 0), armL = mk(-0.28, 0.02, -0.08), armR = mk(0.28, 0.02, -0.08);
  const hips: THREE.Bone[] = [], knees: THREE.Bone[] = [];
  roll.add(body); body.add(armL, armR);
  for (let i = 0; i < 3; i++) { const h = mk(0, 0, 0), k = mk(0, -SEG, 0); h.add(k); body.add(h); hips.push(h); knees.push(k); }
  mesh.add(roll);
  mesh.updateMatrixWorld(true);
  mesh.bind(new THREE.Skeleton([roll, body, armL, armR, ...hips.flatMap((h, i) => [h, knees[i]])]));
  mesh.frustumCulled = false;
  return { mesh, bones: { roll, body, armL, armR, hips, knees } };
}

const lerp = (a: number, b: number, t: number) => a + (b - a) * t;
const sm = (a: number, b: number, v: number) => { const t = Math.min(1, Math.max(0, (v - a) / (b - a))); return t * t * (3 - 2 * t); };
const wrapPi = (a: number) => Math.atan2(Math.sin(a), Math.cos(a));

// Ring: vértices del hexágono en el plano YZ; la pata i usa los lados 2i y 2i+1.
const ringVertex = (k: number) => { const a = (k * Math.PI) / 3; return new THREE.Vector3(0, R * Math.cos(a), R * Math.sin(a)); };
const ringTilt = (k: number) => { const b = (k * Math.PI) / 3 + Math.PI / 6; return Math.atan2(-Math.cos(b), Math.sin(b)); };

// Patas desplegadas: 0 = trasera, 1 = delantera izquierda, 2 = delantera derecha
const DEP_HIP = [new THREE.Vector3(0, -0.2, 0.2), new THREE.Vector3(-0.22, -0.2, -0.12), new THREE.Vector3(0.22, -0.2, -0.12)];
const DEP_YAW = [Math.PI, 0.6, -0.6];
const DEP_TILT = 0.95;

/**
 * `deploy`: 0 = rueda · 1 = desplegado en combate. `roll`: giro acumulado de la rueda (rad). `t`: tiempo (balanceo suave).
 * El giro se detiene suavemente (al ángulo más cercano) al desplegarse, y al plegar retoma desde ahí.
 */
export function poseDroideka(b: DekaBones, deploy: number, roll: number, t = 0) {
  const legs = sm(0.0, 0.62, deploy);
  const rise = sm(0.3, 0.8, deploy);
  const arms = sm(0.62, 1.0, deploy);
  const settle = sm(0.0, 0.35, deploy);

  b.roll.rotation.x = -wrapPi(roll) * (1 - settle) - (roll - wrapPi(roll)) * (1 - settle) * 0; // solo el resto del giro
  b.body.position.y = BODY_UP * rise;

  for (let i = 0; i < 3; i++) {
    const hip = b.hips[i], knee = b.knees[i];
    const hp = ringVertex(2 * i);
    hip.position.set(lerp(hp.x, DEP_HIP[i].x, legs), lerp(hp.y, DEP_HIP[i].y, legs), lerp(hp.z, DEP_HIP[i].z, legs));
    const t0 = ringTilt(2 * i), t1 = ringTilt(2 * i + 1) - t0;
    hip.rotation.set(lerp(t0, DEP_TILT, legs), lerp(0, DEP_YAW[i], legs), 0);
    knee.rotation.set(lerp(t1, -DEP_TILT, legs), 0, 0);
  }
  b.armL.scale.setScalar(lerp(0.02, 1, arms));
  b.armR.scale.setScalar(lerp(0.02, 1, arms));
  const sway = Math.sin(t * 1.7) * 0.03 * arms;
  b.armL.rotation.set(lerp(1.3, 0, arms) + sway, lerp(0.5, 0.06, arms), 0);
  b.armR.rotation.set(lerp(1.3, 0, arms) - sway, lerp(-0.5, -0.06, arms), 0);
}
