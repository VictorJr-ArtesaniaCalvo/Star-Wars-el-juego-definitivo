import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';

// Droide B2 con esqueleto (mismo modelo de antes, ahora con articulaciones para andar).
// Caderas y rodillas se mueven, el torso se balancea un poco y el brazo izquierdo se columpia;
// el brazo derecho (con el cañón) se queda apuntando hacia delante.

export interface B2Bones {
  root: THREE.Bone; // cadera
  spine: THREE.Bone; // torso, hombros y cúpula
  armL: THREE.Bone;
  armR: THREE.Bone;
  thighL: THREE.Bone;
  thighR: THREE.Bone;
  shinL: THREE.Bone;
  shinR: THREE.Bone;
}

const IDX = { root: 0, spine: 1, armL: 2, armR: 3, thighL: 4, thighR: 5, shinL: 6, shinR: 7 };
const GUN = 0x6c737a, PLATE = 0xa2a9ae, DARK = 0x363a3f, EYE = 0xd8281a, CANNON = 0x1f2124;
const HIP_Y = 1.3, KNEE_Y = 0.72, SHOULDER_Y = 1.95;

let shared: THREE.BufferGeometry | null = null;

// La geometría se dibuja en coordenadas del droide (no del hueso), como el B1.
function part(geo: THREE.BufferGeometry, x: number, y: number, z: number, color: number, bone: number, rot?: [number, number, number]): THREE.BufferGeometry {
  const g = geo.index ? geo.toNonIndexed() : geo;
  g.deleteAttribute('uv');
  if (rot) g.applyMatrix4(new THREE.Matrix4().makeRotationFromEuler(new THREE.Euler(rot[0], rot[1], rot[2])));
  g.translate(x, y, z);
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
const cyl = (r: number, len: number, seg = 10) => new THREE.CylinderGeometry(r, r, len, seg);
const SIDE: [number, number, number] = [0, 0, Math.PI / 2]; // cilindro con el eje a lo largo de X

function geometry() {
  if (shared) return shared;
  const p: THREE.BufferGeometry[] = [];
  const I = IDX;
  for (const sd of [-1, 1]) {
    const thigh = sd < 0 ? I.thighL : I.thighR, shin = sd < 0 ? I.shinL : I.shinR, arm = sd < 0 ? I.armL : I.armR;
    p.push(part(box(0.2, 0.09, 0.34), 0.2 * sd, 0.045, -0.05, DARK, shin)); // pies
    p.push(part(box(0.12, 0.62, 0.15), 0.2 * sd, 0.4, 0, GUN, shin)); // piernas
    p.push(part(cyl(0.11, 0.05), 0.28 * sd, KNEE_Y, 0, PLATE, shin, SIDE)); // discos de las rodillas
    p.push(part(box(0.14, 0.58, 0.17), 0.2 * sd, 1.02, 0, GUN, thigh)); // muslos
    p.push(part(box(0.26, 0.3, 0.34), 0.52 * sd, SHOULDER_Y, 0, PLATE, I.spine)); // hombros blindados
    p.push(part(box(0.15, 0.5, 0.17), 0.56 * sd, 1.66, 0, GUN, arm)); // brazos
    p.push(part(cyl(0.1, 0.07), 0.62 * sd, 1.38, 0, DARK, arm, SIDE)); // codos
  }
  p.push(part(cyl(0.11, 0.74), 0, HIP_Y, 0, DARK, I.root, SIDE)); // eje de la cadera
  p.push(part(box(0.3, 0.2, 0.2), 0, 1.27, 0.02, GUN, I.root)); // cadera
  p.push(part(new THREE.CylinderGeometry(0.3, 0.16, 0.38, 10), 0, 1.52, 0, DARK, I.spine)); // cintura con láminas
  p.push(part(box(0.8, 0.5, 0.44), 0, 1.9, 0, GUN, I.spine)); // pecho ancho
  p.push(part(box(0.5, 0.32, 0.07), 0, 1.9, -0.24, PLATE, I.spine)); // placa en V
  p.push(part(box(0.3, 0.12, 0.08), 0, 1.74, -0.25, PLATE, I.spine));
  p.push(part(new THREE.SphereGeometry(0.17, 10, 8), 0, 2.2, -0.04, GUN, I.spine)); // cúpula
  p.push(part(box(0.06, 0.06, 0.05), 0.1, 2.2, -0.2, EYE, I.spine)); // ojo rojo
  p.push(part(box(0.36, 0.3, 0.14), 0, 1.95, 0.27, DARK, I.spine)); // espalda
  // Brazo izquierdo: antebrazo y mano colgando
  p.push(part(box(0.13, 0.5, 0.15), -0.62, 1.08, 0, GUN, I.armL));
  p.push(part(box(0.14, 0.14, 0.12), -0.62, 0.78, 0, DARK, I.armL));
  // Brazo derecho: el antebrazo apunta hacia delante con el cañón
  p.push(part(box(0.13, 0.13, 0.5), 0.62, 1.34, -0.3, GUN, I.armR));
  p.push(part(box(0.18, 0.18, 0.34), 0.62, 1.34, -0.7, CANNON, I.armR));
  p.push(part(box(0.05, 0.05, 0.22), 0.62, 1.34, -0.95, CANNON, I.armR));
  shared = mergeGeometries(p, false)!;
  for (const g of p) g.dispose();
  return shared;
}

const mk = (x: number, y: number, z: number) => { const b = new THREE.Bone(); b.position.set(x, y, z); return b; };

export function createB2(material: THREE.Material): { mesh: THREE.SkinnedMesh; bones: B2Bones } {
  const root = mk(0, HIP_Y, 0), spine = mk(0, 0, 0);
  const armL = mk(-0.52, SHOULDER_Y - HIP_Y, 0), armR = mk(0.52, SHOULDER_Y - HIP_Y, 0);
  const thighL = mk(-0.2, 0, 0), thighR = mk(0.2, 0, 0);
  const shinL = mk(0, KNEE_Y - HIP_Y, 0), shinR = mk(0, KNEE_Y - HIP_Y, 0);
  root.add(spine, thighL, thighR);
  spine.add(armL, armR);
  thighL.add(shinL);
  thighR.add(shinR);
  const mesh = new THREE.SkinnedMesh(geometry(), material);
  mesh.add(root);
  mesh.updateMatrixWorld(true);
  mesh.bind(new THREE.Skeleton([root, spine, armL, armR, thighL, thighR, shinL, shinR]));
  mesh.frustumCulled = false;
  return { mesh, bones: { root, spine, armL, armR, thighL, thighR, shinL, shinR } };
}

/** `walk`: 0..1 cuánto anda; `phase`: fase del paso. Paso largo y pesado: se apoya y se balancea. */
export function poseB2(b: B2Bones, walk: number, phase: number) {
  const s = Math.sin(phase);
  b.root.position.y = HIP_Y + Math.abs(s) * 0.05 * walk;
  b.root.rotation.z = s * 0.04 * walk; // la cadera se ladea con cada paso
  b.spine.rotation.y = s * 0.09 * walk; // el torso gira un poco contra las piernas
  b.spine.rotation.z = -s * 0.05 * walk;
  b.thighL.rotation.x = s * 0.42 * walk;
  b.thighR.rotation.x = -s * 0.42 * walk;
  b.shinL.rotation.x = -Math.max(0, Math.sin(phase + 1.6)) * 0.7 * walk;
  b.shinR.rotation.x = -Math.max(0, Math.sin(phase + 1.6 + Math.PI)) * 0.7 * walk;
  b.armL.rotation.x = -s * 0.35 * walk; // el brazo libre se columpia
  b.armR.rotation.x = Math.abs(s) * 0.03 * walk; // el del cañón casi no se mueve
}
