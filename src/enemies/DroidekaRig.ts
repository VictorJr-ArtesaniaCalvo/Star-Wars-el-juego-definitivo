import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';

// Droideka con esqueleto, según las referencias:
//  - Rodando es una esfera de coraza bronce con las tres patas plegadas formando un aro alrededor.
//  - Al desplegarse: la mitad inferior de la esfera queda como «cuenco» pélvico (más pequeño), de él sube una columna
//    con costillas, la mitad superior se levanta y se coloca detrás como una capucha curvada, salen tres patas largas
//    (rodilla alta y hacia fuera, luego bajan en vertical hasta una garra) y dos brazos con cañones dobles.
// La animación de plegar es la de desplegar al revés.

export interface DekaBones {
  roll: THREE.Bone; // centro de la rueda: gira al rodar
  pelvis: THREE.Bone; // mitad inferior de la esfera
  shell: THREE.Bone; // mitad superior (capucha al desplegarse)
  column: THREE.Bone;
  armL: THREE.Bone;
  armR: THREE.Bone;
  hips: THREE.Bone[];
  knees: THREE.Bone[];
}

const R = 0.62; // radio del aro de patas (= altura del centro de la rueda)
const SEG = R; // largo de cada tramo de pata (lado del hexágono)
const SHELL_R = 0.55; // radio de la esfera
const BRONZE = 0x9a5a42, BRONZE_DARK = 0x6e3c2c, METAL = 0x555960, METAL_LIGHT = 0x7a7e86, GUNM = 0x3a3c42;
const PELVIS_Y = 0.7; // altura del cuenco al desplegarse
const BODY_UP = PELVIS_Y - R;
const ARM_UP = 0.45; // altura del hombro sobre el cuenco

let shared: THREE.BufferGeometry | null = null;

// Índices de hueso: 0 roll, 1 pelvis, 2 shell, 3 column, 4 armL, 5 armR, luego (cadera, rodilla) × 3 patas
const B = { roll: 0, pelvis: 1, shell: 2, column: 3, armL: 4, armR: 5 };
// Posición de cada hueso en la postura de montaje (la geometría se dibuja respecto al droide, no al hueso)
const BIND: Array<[number, number, number]> = [
  [0, R, 0], [0, R, 0], [0, R, 0], [0, R, 0], [-0.28, R + 0.1, 0], [0.28, R + 0.1, 0],
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
const domeTop = (r: number) => new THREE.SphereGeometry(r, 14, 6, 0, Math.PI * 2, 0, Math.PI / 2);
const domeBottom = (r: number) => new THREE.SphereGeometry(r, 14, 6, 0, Math.PI * 2, Math.PI / 2, Math.PI / 2);

const geometry = () => {
  if (shared) return shared;
  const p: THREE.BufferGeometry[] = [];
  // Mitades de la esfera de coraza
  p.push(part(domeBottom(SHELL_R), 0, 0, 0, BRONZE, B.pelvis));
  p.push(part(domeTop(SHELL_R), 0, 0, 0, BRONZE, B.shell));
  p.push(part(box(0.3, 0.05, 0.12), 0, 0.5, -0.1, BRONZE_DARK, B.shell)); // placa con rendijas
  p.push(part(box(0.05, 0.07, 0.05), -0.07, 0.04, -0.5, 0xc23a2a, B.shell)); // sensores (rojos)
  p.push(part(box(0.05, 0.07, 0.05), 0.07, 0.04, -0.5, 0xc23a2a, B.shell));
  // Columna con costillas y bloque de los hombros
  p.push(part(box(0.2, 1.0, 0.18), 0, 0.5, 0, METAL, B.column));
  for (const y of [0.22, 0.38, 0.54, 0.7, 0.86]) p.push(part(box(0.25, 0.045, 0.21), 0, y, 0, GUNM, B.column));
  p.push(part(box(0.4, 0.2, 0.26), 0, 1.0, 0, METAL_LIGHT, B.column));
  // Brazos: hombro, antebrazo y mano con cañón doble
  for (const [bone, sx] of [[B.armL, -1], [B.armR, 1]] as const) {
    p.push(part(box(0.07, 0.07, 0.36), 0.02 * sx, 0, -0.17, METAL, bone));
    p.push(part(new THREE.SphereGeometry(0.06, 8, 6), 0.02 * sx, 0, -0.36, METAL_LIGHT, bone)); // codo
    p.push(part(box(0.06, 0.06, 0.38), 0.05 * sx, 0, -0.56, METAL, bone));
    p.push(part(box(0.1, 0.1, 0.16), 0.05 * sx, 0, -0.78, GUNM, bone)); // mano
    for (const bx of [-0.035, 0.035]) p.push(part(box(0.035, 0.035, 0.34), 0.05 * sx + bx, 0, -0.98, GUNM, bone)); // cañones
  }
  // Patas: muslo, pierna y garra
  for (let i = 0; i < 3; i++) {
    const hip = 6 + i * 2, knee = 7 + i * 2;
    p.push(part(box(0.09, SEG, 0.09), 0, -SEG / 2, 0, METAL, hip));
    p.push(part(new THREE.SphereGeometry(0.075, 8, 6), 0, 0, 0, METAL_LIGHT, hip)); // cadera
    p.push(part(box(0.08, SEG, 0.08), 0, -SEG / 2, 0, GUNM, knee));
    p.push(part(new THREE.SphereGeometry(0.07, 8, 6), 0, 0, 0, METAL_LIGHT, knee)); // rodilla
    p.push(part(box(0.06, 0.12, 0.2), 0, -SEG + 0.02, -0.07, GUNM, knee)); // garra
  }
  shared = mergeGeometries(p, false)!;
  for (const g of p) g.dispose();
  return shared;
};

const mk = (x: number, y: number, z: number) => { const b = new THREE.Bone(); b.position.set(x, y, z); b.rotation.order = 'YXZ'; return b; };

export function createDroideka(material: THREE.Material): { mesh: THREE.SkinnedMesh; bones: DekaBones } {
  const mesh = new THREE.SkinnedMesh(geometry(), material);
  const roll = mk(0, R, 0), pelvis = mk(0, 0, 0), shell = mk(0, 0, 0), column = mk(0, 0, 0);
  const armL = mk(-0.28, 0.1, 0), armR = mk(0.28, 0.1, 0);
  const hips: THREE.Bone[] = [], knees: THREE.Bone[] = [];
  roll.add(pelvis, shell, column, armL, armR);
  for (let i = 0; i < 3; i++) { const h = mk(0, 0, 0), k = mk(0, -SEG, 0); h.add(k); roll.add(h); hips.push(h); knees.push(k); }
  mesh.add(roll);
  mesh.updateMatrixWorld(true);
  mesh.bind(new THREE.Skeleton([roll, pelvis, shell, column, armL, armR, ...hips.flatMap((h, i) => [h, knees[i]])]));
  mesh.frustumCulled = false;
  return { mesh, bones: { roll, pelvis, shell, column, armL, armR, hips, knees } };
}

const lerp = (a: number, b: number, t: number) => a + (b - a) * t;
const sm = (a: number, b: number, v: number) => { const t = Math.min(1, Math.max(0, (v - a) / (b - a))); return t * t * (3 - 2 * t); };
const wrapPi = (a: number) => Math.atan2(Math.sin(a), Math.cos(a));

// Aro: vértices del hexágono en el plano YZ; la pata i usa los lados 2i y 2i+1.
const ringVertex = (k: number) => { const a = (k * Math.PI) / 3; return new THREE.Vector3(0, R * Math.cos(a), R * Math.sin(a)); };
const ringTilt = (k: number) => { const b = (k * Math.PI) / 3 + Math.PI / 6; return Math.atan2(-Math.cos(b), Math.sin(b)); };

// Patas desplegadas: 0 = trasera, 1 = delantera izquierda, 2 = delantera derecha
const DEP_HIP = [new THREE.Vector3(0, -0.05, 0.1), new THREE.Vector3(-0.12, -0.05, -0.06), new THREE.Vector3(0.12, -0.05, -0.06)];
const DEP_YAW = [Math.PI, 0.75, -0.75];
const DEP_TILT = 1.75; // el muslo sale hacia fuera y algo hacia arriba
const SHIN_STRETCH = 1.2; // la pierna es más larga que el muslo al desplegarse

/**
 * `deploy`: 0 = rueda · 1 = desplegado. `roll`: giro acumulado de la rueda (rad). `t`: tiempo (balanceo suave).
 * El giro se detiene suavemente al desplegarse y, al plegar, retoma desde ese ángulo.
 */
export function poseDroideka(b: DekaBones, deploy: number, roll: number, t = 0) {
  const legs = sm(0.0, 0.55, deploy);
  const rise = sm(0.2, 0.6, deploy);
  const col = sm(0.35, 0.8, deploy);
  const hood = sm(0.4, 0.9, deploy);
  const arms = sm(0.65, 1.0, deploy);
  const settle = sm(0.0, 0.35, deploy);
  const py = BODY_UP * rise;

  b.roll.rotation.x = -wrapPi(roll) * (1 - settle);

  b.pelvis.position.set(0, py, 0);
  b.pelvis.scale.setScalar(lerp(1, 0.55, sm(0.2, 0.7, deploy)));
  b.column.position.set(0, py, 0);
  b.column.scale.set(1, lerp(0.02, 1, col), 1);

  // La mitad superior de la esfera se levanta y se coloca detrás como una capucha curvada
  b.shell.position.set(0, py + lerp(0, 0.62, hood), lerp(0, 0.2, hood));
  b.shell.rotation.set(lerp(0, -Math.PI / 2, hood), 0, 0);
  b.shell.scale.set(lerp(1, 0.8, hood), lerp(1, 0.4, hood), lerp(1, 0.8, hood));

  for (let i = 0; i < 3; i++) {
    const hip = b.hips[i], knee = b.knees[i];
    const hp = ringVertex(2 * i);
    hip.position.set(lerp(hp.x, DEP_HIP[i].x, legs), lerp(hp.y, py + DEP_HIP[i].y, legs), lerp(hp.z, DEP_HIP[i].z, legs));
    const t0 = ringTilt(2 * i), t1 = ringTilt(2 * i + 1) - t0;
    hip.rotation.set(lerp(t0, DEP_TILT, legs), lerp(0, DEP_YAW[i], legs), 0);
    knee.rotation.set(lerp(t1, -DEP_TILT, legs), 0, 0);
    knee.scale.set(1, lerp(1, SHIN_STRETCH, legs), 1);
  }

  const sway = Math.sin(t * 1.7) * 0.03 * arms;
  for (const [arm, sx, s] of [[b.armL, -1, 1], [b.armR, 1, -1]] as const) {
    arm.position.set(0.28 * sx, py + lerp(0.1, ARM_UP, col), 0);
    arm.scale.setScalar(lerp(0.02, 1, arms));
    arm.rotation.set(lerp(1.3, 0, arms) + sway * s, lerp(0.5 * -sx, 0.1 * -sx, arms), 0);
  }
}
