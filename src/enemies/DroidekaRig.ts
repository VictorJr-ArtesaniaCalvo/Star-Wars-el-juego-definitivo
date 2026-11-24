import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { parseModelFile, type ModelBone } from './ModelFile';

// El modelo 3D real (public/models/droideka.bin) viene del glTF de PokCat (CC-BY 4.0, ver CRÉDITOS.md) y se genera con tools/convert-droideka.mjs:
// una sola pieza dibujable con los mismos 12 huesos de siempre, en postura desplegada. La postura de rueda (capucha detrás y arriba, patas en arco
// por delante, columna y brazos recogidos dentro, según las fotos de referencia) se calcula al cargar (más abajo, `ROLL`).
// Si el archivo no se pudiera cargar, se usa el droideka de formas sencillas de abajo.

// Droideka con esqueleto, según las referencias:
//  - Rodando es una esfera de coraza bronce con las tres patas plegadas formando un aro alrededor (este es el droideka de respaldo, sin modelo).
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
  /** Solo con el modelo real: postura de rueda y de reposo de cada hueso, y geometrías de cada nivel de detalle (0 = cerca, 1 = lejos). */
  real?: RealData;
  lods?: THREE.BufferGeometry[];
}

interface Xform { p: THREE.Vector3; q: THREE.Quaternion; s: THREE.Vector3 }
interface RealData { list: THREE.Bone[]; rest: Xform[]; folded: Xform[]; restRollY: number; ringR: number; center: THREE.Vector3; lift?: number[] }
interface RealModel { bones: ModelBone[]; lods: THREE.BufferGeometry[]; legs: Array<{ hip: number[]; knee: number[]; foot: number[] }> }
let real: RealModel | null = null;
const DEKA_BRIGHT = 1.0;

/** Descarga y prepara el modelo. Si falla, se usa el droideka de formas sencillas. Hay que llamarlo antes de crear droides. */
export async function loadDekaModel(url: string): Promise<'archivo' | 'respaldo'> {
  try {
    const res = await fetch(url);
    if (!res.ok) throw new Error('HTTP ' + res.status);
    const m = parseModelFile(await res.arrayBuffer(), 'DKA1');
    real = { bones: m.bones, lods: m.lods, legs: m.meta.legs as RealModel['legs'] };
    return 'archivo';
  } catch (e) {
    console.warn('No se pudo cargar el modelo del droideka; se usa el de respaldo.', e);
    real = null;
    return 'respaldo';
  }
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
  if (real) return createReal(material);
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
  if (b.real) { poseReal(b, deploy, roll); return; }
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


// ---------- Modelo real ----------
const V = (a: ArrayLike<number>) => new THREE.Vector3(a[0], a[1], a[2]);
const ONE = () => new THREE.Vector3(1, 1, 1);
const basisQ = (t: THREE.Vector3, o: THREE.Vector3) => {
  const x = t.clone().normalize();
  const y = o.clone().sub(x.clone().multiplyScalar(o.dot(x))).normalize();
  const z = new THREE.Vector3().crossVectors(x, y);
  return new THREE.Quaternion().setFromRotationMatrix(new THREE.Matrix4().makeBasis(x, y, z));
};

// Postura de la bola (rueda), según las fotos de referencia (figura de Hot Toys): el centro de la rueda es el hueso `roll`.
//  · La capucha queda como está (un arco de unos 200° abierto hacia delante): es el borde de la rueda por detrás y por arriba.
//  · La bola de abajo (cuenco) queda en el fondo, con su tamaño real. La columna y los brazos se encogen y se recogen dentro, apuntando los cañones al frente.
//  · Las patas se pliegan en arco por el borde: las dos delanteras suben por el frente a cada lado y la trasera se esconde por detrás, dentro de la capucha.
// Medidas en metros respecto al centro de la rueda (−Z = delante, +Y = arriba). Se pueden cambiar en caliente con `refoldDeka` (solo para pruebas).
export const ROLL = {
  ring: 0.62, // radio de la rueda = altura del centro sobre el suelo
  legR: 0.48, // radio del arco que forman las patas
  legX: [0, -0.3, 0.3], // a qué lado va cada pata (0 = trasera, 1 = delantera izquierda, 2 = delantera derecha)
  legStart: [188, 172, 172], // dónde empieza cada pata, en grados desde arriba (0 = arriba, 180 = abajo, 270 = delante)
  pelvis: [0, -0.4, 0.0],
  hood: [0, 0, 0],
  hoodRx: 0.4, // giro de la capucha hacia atrás (rad)
  hoodS: 0.9,
  column: { p: [0, -0.36, 0.14], rx: 0.2, s: [0.9, 0.85, 0.55] }, // s: ancho, alto, fondo
  arm: { p: [0.14, 0.28, 0.02], rx: 0, ry: 0.05, s: [0.45, 0.6, 0.42] }, // s: ancho, alto, largo
};
type RollTuning = typeof ROLL;

function buildFolded(m: RealModel, rest: Xform[], T: RollTuning = ROLL): { folded: Xform[]; ringR: number } {
  const folded: Xform[] = rest.map((r) => ({ p: r.p.clone(), q: r.q.clone(), s: r.s.clone() }));
  // lados del arco: muslo (cadera→rodilla) y pierna (rodilla→pie), medidos en el modelo
  const a = (m.legs.reduce((n, l) => n + V(l.hip).distanceTo(V(l.knee)), 0)) / 3;
  const bl = (m.legs.reduce((n, l) => n + V(l.knee).distanceTo(V(l.foot)), 0)) / 3;
  const R = T.legR;
  const dA = 2 * Math.asin(Math.min(1, a / (2 * R))), dB = 2 * Math.asin(Math.min(1, bl / (2 * R)));
  const P = (th: number, x: number) => new THREE.Vector3(x, R * Math.cos(th), R * Math.sin(th));
  const radial = (th: number) => new THREE.Vector3(0, Math.cos(th), Math.sin(th));
  for (let i = 0; i < 3; i++) {
    const hip = V(m.legs[i].hip), knee = V(m.legs[i].knee), foot = V(m.legs[i].foot);
    const dir = i === 0 ? -1 : 1; // la pata trasera se curva hacia atrás, las delanteras hacia delante
    const th0 = (T.legStart[i] * Math.PI) / 180, th1 = th0 + dir * dA, th2 = th1 + dir * dB;
    const x = T.legX[i];
    const p0 = P(th0, x), p1 = P(th1, x), p2 = P(th2, x);
    // posición de reposo respecto al centro (para orientar «hacia fuera» en reposo)
    const out = new THREE.Vector3(knee.x, 0, knee.z).normalize();
    const tRest = knee.clone().sub(hip), sRest = foot.clone().sub(knee);
    const qThighRest = basisQ(tRest, out), qShinRest = basisQ(sRest, out);
    const qThigh = basisQ(p1.clone().sub(p0), radial((th0 + th1) / 2)).multiply(qThighRest.clone().invert());
    const qShinW = basisQ(p2.clone().sub(p1), radial((th1 + th2) / 2)).multiply(qShinRest.clone().invert());
    const hipI = 6 + 2 * i, kneeI = 7 + 2 * i;
    folded[hipI] = { p: p0, q: qThigh, s: ONE() };
    const qInv = qThigh.clone().invert();
    folded[kneeI] = { p: p1.clone().sub(p0).applyQuaternion(qInv), q: qInv.clone().multiply(qShinW), s: ONE() };
  }
  const v3 = (u: number[]) => new THREE.Vector3(u[0], u[1], u[2]);
  const rot = (rx: number, ry: number) => new THREE.Quaternion().setFromEuler(new THREE.Euler(rx, ry, 0, 'YXZ'));
  folded[1] = { p: v3(T.pelvis), q: new THREE.Quaternion(), s: ONE() }; // cuenco: la bola del fondo
  folded[2] = { p: v3(T.hood), q: rot(T.hoodRx, 0), s: new THREE.Vector3().setScalar(T.hoodS) }; // capucha: el borde de la rueda por detrás y por arriba
  folded[3] = { p: v3(T.column.p), q: rot(T.column.rx, 0), s: v3(T.column.s) }; // columna encogida
  for (const [i, sx] of [[4, -1], [5, 1]] as const) {
    folded[i] = { p: new THREE.Vector3(T.arm.p[0] * sx, T.arm.p[1], T.arm.p[2]), q: rot(T.arm.rx, -T.arm.ry * sx), s: v3(T.arm.s) };
  }
  return { folded, ringR: T.ring };
}

/** Solo para pruebas: cambia las medidas de la postura de bola y la vuelve a calcular. */
export function refoldDeka(b: DekaBones, patch: Partial<RollTuning>) {
  if (!b.real || !real) return;
  Object.assign(ROLL, patch);
  const { folded, ringR } = buildFolded(real, b.real.rest);
  b.real.folded = folded; b.real.ringR = ringR;
  b.real.lift = undefined; liftCache = null;
  const mesh = b.roll.parent as THREE.SkinnedMesh;
  b.real.lift = liftCache = computeLift(mesh, b, b.lods![1]);
}

function createReal(material: THREE.Material): { mesh: THREE.SkinnedMesh; bones: DekaBones } {
  const m = real!;
  const list = m.bones.map((d) => { const b = new THREE.Bone(); b.name = d.name; b.rotation.order = 'YXZ'; return b; });
  const rest: Xform[] = m.bones.map((d) => {
    const par = d.parent < 0 ? new THREE.Vector3() : V(m.bones[d.parent].pivot);
    return { p: V(d.pivot).sub(par), q: new THREE.Quaternion(), s: ONE() };
  });
  list.forEach((b, i) => { b.position.copy(rest[i].p); if (m.bones[i].parent >= 0) list[m.bones[i].parent].add(b); });
  const mesh = new THREE.SkinnedMesh(m.lods[0], material);
  mesh.add(list[0]);
  mesh.updateMatrixWorld(true);
  mesh.bind(new THREE.Skeleton(list));
  mesh.frustumCulled = false;
  const { folded, ringR } = buildFolded(m, rest);
  const data: RealData = { list, rest, folded, restRollY: rest[0].p.y, ringR, center: V(m.bones[0].pivot) };
  const bones: DekaBones = {
    roll: list[0], pelvis: list[1], shell: list[2], column: list[3], armL: list[4], armR: list[5],
    hips: [list[6], list[8], list[10]], knees: [list[7], list[9], list[11]], real: data, lods: m.lods,
  };
  void DEKA_BRIGHT;
  data.lift = liftCache ?? (liftCache = computeLift(mesh, bones, m.lods[1]));
  return { mesh, bones };
}

// Mientras se pliega o se despliega, las patas pasan por posturas intermedias que podrían hundirse en el suelo.
// Al cargar se mide, para cada punto del despliegue, cuánto hay que subir al droide para que nada atraviese el suelo.
const LIFT_STEPS = 20;
let liftCache: number[] | null = null;
function computeLift(mesh: THREE.SkinnedMesh, b: DekaBones, geo: THREE.BufferGeometry): number[] {
  const keep = mesh.geometry;
  mesh.geometry = geo; // el nivel de detalle lejano basta para medir
  const v = new THREE.Vector3(), out: number[] = [];
  b.real!.lift = undefined;
  for (let k = 0; k <= LIFT_STEPS; k++) {
    poseReal(b, k / LIFT_STEPS, 0);
    mesh.updateMatrixWorld(true);
    mesh.skeleton.update();
    let minY = Infinity;
    for (let i = 0, n = geo.attributes.position.count; i < n; i++) { mesh.getVertexPosition(i, v); v.applyMatrix4(mesh.matrixWorld); if (v.y < minY) minY = v.y; }
    out.push(Math.max(0, -minY));
  }
  mesh.geometry = keep;
  return out;
}

function poseReal(b: DekaBones, deploy: number, roll: number) {
  const r = b.real!;
  const legs = sm(0.0, 0.55, deploy);
  const settle = sm(0.0, 0.35, deploy);
  const u = [0, sm(0.2, 0.7, deploy), sm(0.4, 0.9, deploy), sm(0.3, 0.8, deploy), sm(0.65, 1.0, deploy), sm(0.65, 1.0, deploy), legs, legs, legs, legs, legs, legs];
  for (let i = 1; i < r.list.length; i++) {
    const f = r.folded[i], t = r.rest[i], bone = r.list[i];
    bone.position.lerpVectors(f.p, t.p, u[i]);
    bone.quaternion.slerpQuaternions(f.q, t.q, u[i]);
    bone.scale.lerpVectors(f.s, t.s, u[i]);
  }
  // el centro de la bola baja o sube hasta apoyar el aro en el suelo; la rueda gira y se detiene al desplegarse
  let lift = 0;
  if (r.lift) { const f = Math.min(1, Math.max(0, deploy)) * LIFT_STEPS, i = Math.min(LIFT_STEPS - 1, Math.floor(f)); lift = lerp(r.lift[i], r.lift[i + 1], f - i); }
  r.list[0].position.set(r.center.x, lerp(r.ringR, r.restRollY, legs) + lift, r.center.z);
  r.list[0].rotation.x = -wrapPi(roll) * (1 - settle);
}
