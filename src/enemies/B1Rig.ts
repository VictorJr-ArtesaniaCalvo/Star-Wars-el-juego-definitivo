import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';

// Droide B1 con esqueleto (huesos): una sola pieza dibujable por droide, pero con articulaciones.
// Sirve para el despliegue (agachado y plegado → de pie con la cabeza plegada → cabeza arriba → postura de combate)
// y para andar. El modelo en reposo es la postura de combate.

export interface B1Bones {
  root: THREE.Bone; // cadera
  spine: THREE.Bone; // torso
  neck: THREE.Bone; // cuello y cabeza
  armL: THREE.Bone;
  armR: THREE.Bone;
  thighL: THREE.Bone;
  thighR: THREE.Bone;
  shinL: THREE.Bone;
  shinR: THREE.Bone;
}

const ORDER = ['root', 'spine', 'neck', 'armL', 'armR', 'thighL', 'thighR', 'shinL', 'shinR'] as const;
const IDX: Record<(typeof ORDER)[number], number> = { root: 0, spine: 1, neck: 2, armL: 3, armR: 4, thighL: 5, thighR: 6, shinL: 7, shinR: 8 };

const TAN = 0xc9b48c, DARK = 0x4a4540, GUN = 0x2d2d30;
const HIP_Y = 0.9;

let sharedGeometry: THREE.BufferGeometry | null = null;

function part(w: number, h: number, d: number, x: number, y: number, z: number, color: number, bone: number, rx = 0): THREE.BufferGeometry {
  const g = new THREE.BoxGeometry(w, h, d).toNonIndexed();
  g.deleteAttribute('uv');
  if (rx) g.rotateX(rx);
  g.translate(x, y, z);
  const n = g.attributes.position.count;
  const c = new THREE.Color(color);
  const col = new Float32Array(n * 3);
  const si = new Uint16Array(n * 4);
  const sw = new Float32Array(n * 4);
  for (let i = 0; i < n; i++) {
    col[i * 3] = c.r; col[i * 3 + 1] = c.g; col[i * 3 + 2] = c.b;
    si[i * 4] = bone;
    sw[i * 4] = 1;
  }
  g.setAttribute('color', new THREE.BufferAttribute(col, 3));
  g.setAttribute('skinIndex', new THREE.Uint16BufferAttribute(si, 4));
  g.setAttribute('skinWeight', new THREE.Float32BufferAttribute(sw, 4));
  return g;
}

function geometry() {
  if (sharedGeometry) return sharedGeometry;
  const parts: THREE.BufferGeometry[] = [];
  const side = [-1, 1];
  parts.push(part(0.34, 0.14, 0.16, 0, HIP_Y, 0, DARK, IDX.root)); // cadera
  parts.push(part(0.3, 0.5, 0.18, 0, 1.2, 0, TAN, IDX.spine)); // torso
  parts.push(part(0.26, 0.4, 0.12, 0, 1.25, 0.14, DARK, IDX.spine)); // mochila
  parts.push(part(0.06, 0.06, 0.5, 0.12, 1.0, -0.42, GUN, IDX.spine)); // bláster
  parts.push(part(0.06, 0.22, 0.06, 0, 1.55, 0, TAN, IDX.neck)); // cuello
  parts.push(part(0.13, 0.13, 0.42, 0, 1.72, -0.1, TAN, IDX.neck, 0.35)); // cabeza alargada
  for (const s of side) {
    const armBone = s < 0 ? IDX.armL : IDX.armR, thigh = s < 0 ? IDX.thighL : IDX.thighR, shin = s < 0 ? IDX.shinL : IDX.shinR;
    parts.push(part(0.07, 0.6, 0.07, 0.23 * s, 1.08, 0, TAN, armBone)); // brazo (cuelga del hombro)
    parts.push(part(0.09, 0.43, 0.09, 0.13 * s, HIP_Y - 0.215, 0, TAN, thigh)); // muslo
    parts.push(part(0.09, 0.43, 0.09, 0.13 * s, HIP_Y - 0.43 - 0.215, 0, TAN, shin)); // pierna
    parts.push(part(0.1, 0.05, 0.2, 0.13 * s, 0.03, -0.04, DARK, shin)); // pie
  }
  sharedGeometry = mergeGeometries(parts, false)!;
  for (const p of parts) p.dispose();
  return sharedGeometry;
}

function makeBones(): { list: THREE.Bone[]; set: B1Bones } {
  const mk = (x: number, y: number, z: number) => { const b = new THREE.Bone(); b.position.set(x, y, z); return b; };
  const set: B1Bones = {
    root: mk(0, HIP_Y, 0),
    spine: mk(0, 0, 0),
    neck: mk(0, 0.65, 0), // base del cuello: arriba del torso
    armL: mk(-0.23, 0.48, 0), // hombros
    armR: mk(0.23, 0.48, 0),
    thighL: mk(-0.13, 0, 0),
    thighR: mk(0.13, 0, 0),
    shinL: mk(0, -0.43, 0), // rodillas
    shinR: mk(0, -0.43, 0),
  };
  set.root.add(set.spine, set.thighL, set.thighR);
  set.spine.add(set.neck, set.armL, set.armR);
  set.thighL.add(set.shinL);
  set.thighR.add(set.shinR);
  return { list: ORDER.map((k) => set[k]), set };
}

/** Crea un B1 con esqueleto. */
export function createB1(material: THREE.Material): { mesh: THREE.SkinnedMesh; bones: B1Bones } {
  const mesh = new THREE.SkinnedMesh(geometry(), material);
  const { list, set } = makeBones();
  mesh.add(set.root);
  mesh.updateMatrixWorld(true);
  mesh.bind(new THREE.Skeleton(list));
  return { mesh, bones: set };
}

const lerp = (a: number, b: number, t: number) => a + (b - a) * t;
const smooth = (a: number, b: number, v: number) => {
  const t = Math.min(1, Math.max(0, (v - a) / (b - a)));
  return t * t * (3 - 2 * t);
};

/**
 * Coloca al droide en una postura.
 * `unfold`: 0 = agachado y plegado · ~0.4 = de pie con la cabeza aún plegada · ~0.7 = cabeza levantada · 1 = postura de combate.
 * `walk`: 0..1 cuánto está andando; `phase`: fase del paso.
 */
export function poseB1(b: B1Bones, unfold: number, walk = 0, phase = 0) {
  const stand = smooth(0.15, 0.55, unfold); // se pone de pie
  const head = smooth(0.58, 0.8, unfold); // levanta la cabeza
  const arms = smooth(0.8, 1, unfold); // levanta los brazos con el arma
  const w = walk * stand; // andar solo si ya está de pie
  const s = Math.sin(phase);

  b.root.position.y = HIP_Y + lerp(-0.5, 0, stand) + Math.abs(s) * 0.03 * w;
  b.spine.rotation.x = lerp(-1.0, -0.05, stand) - 0.05 * w;
  b.neck.rotation.x = lerp(2.6, 0, head);

  const armRot = lerp(lerp(0.6, 0.12, stand), 0.95, arms);
  const armIn = lerp(lerp(0.4, 0.05, stand), 0, arms);
  b.armL.rotation.set(armRot, 0, armIn);
  b.armR.rotation.set(armRot, 0, -armIn);

  b.thighL.rotation.x = lerp(1.45, 0, stand) + s * 0.5 * w;
  b.thighR.rotation.x = lerp(1.45, 0, stand) - s * 0.5 * w;
  b.shinL.rotation.x = lerp(-2.2, 0, stand) - Math.max(0, Math.sin(phase + 1.6)) * 0.75 * w;
  b.shinR.rotation.x = lerp(-2.2, 0, stand) - Math.max(0, Math.sin(phase + 1.6 + Math.PI)) * 0.75 * w;
}
