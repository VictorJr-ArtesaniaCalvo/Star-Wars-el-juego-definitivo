import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { clone as cloneSkinned } from 'three/addons/utils/SkeletonUtils.js';
import { withLightFloor } from '../world/lightFill';

// Modelo del clon comando: «Republic Commando» de Abel (https://sketchfab.com/abel76), licencia CC-BY-NC 4.0 (ver CRÉDITOS.md).
// public/models/commando.glb se genera con tools/convert-commando.py (solo cambian sus imágenes, a JPG, para que pese menos).
// Trae esqueleto (76 huesos) pero ninguna animación: las posturas se hacen girando huesos por código, con ayuda de un «IK de dos huesos»
// (se dice dónde tiene que quedar la mano o el pie y se calculan solos el hombro y el codo, o la cadera y la rodilla).

let source: THREE.Object3D | null = null;
let restHeight = 1;

/** Descarga el modelo. Si falla, la cinemática usa el comando provisional de formas sencillas y el jugador los brazos de antes. */
export async function loadCommandoModel(url: string): Promise<boolean> {
  try {
    const gltf = await new GLTFLoader().loadAsync(url);
    const scene = gltf.scene;
    scene.traverse((o) => {
      const m = o as THREE.SkinnedMesh;
      if (!m.isMesh) return;
      // material ligero (como el resto del juego): color, relieve y brillo propio (visor y emblema); sin metal/rugosidad
      const s = m.material as THREE.MeshStandardMaterial;
      const lam = withLightFloor(new THREE.MeshLambertMaterial({
        map: s.map ?? null, color: s.color.clone(), normalMap: s.normalMap ?? null,
        emissiveMap: s.emissiveMap ?? null, emissive: s.emissiveMap ? new THREE.Color(1.6, 1.6, 1.6) : new THREE.Color(0),
        side: THREE.DoubleSide,
      }));
      if (lam.map) lam.map.anisotropy = 4;
      m.material = lam;
      m.frustumCulled = false;
    });
    scene.updateMatrixWorld(true);
    restHeight = new THREE.Box3().setFromObject(scene, true).getSize(new THREE.Vector3()).y;
    source = scene;
    return true;
  } catch (e) {
    console.warn('No se pudo cargar el modelo del clon comando; se usa el provisional.', e);
    source = null;
    return false;
  }
}

export const commandoModelReady = () => source !== null;

/** Nombre «limpio» de un hueso: «Left_elbow_06» → «leftelbow». */
const key = (n: string) => n.replace(/_\d+$/, '').replace(/[\s_.]/g, '').toLowerCase();

export interface CommandoRig {
  /** Grupo exterior: pies en y = 0, mirando a −Z, con la estatura pedida. */
  root: THREE.Group;
  bones: Record<string, THREE.Bone>;
  meshes: THREE.SkinnedMesh[];
  /** Vuelve a la postura de origen (brazos abiertos). */
  reset(): void;
}

/** Una copia del modelo, lista para posar. */
export function createCommandoRig(height: number): CommandoRig {
  const model = cloneSkinned(source!) as THREE.Object3D;
  const root = new THREE.Group();
  const inner = new THREE.Group();
  inner.add(model);
  inner.rotation.y = Math.PI; // el modelo mira a +Z: se gira para que mire a −Z, como todo en el juego
  inner.scale.setScalar(height / restHeight);
  root.add(inner);
  root.updateMatrixWorld(true);
  const box = new THREE.Box3().setFromObject(root, true);
  inner.position.y = -box.min.y; // pies en el suelo
  const bones: Record<string, THREE.Bone> = {};
  const meshes: THREE.SkinnedMesh[] = [];
  model.traverse((o) => {
    if ((o as THREE.Bone).isBone) bones[key(o.name)] = o as THREE.Bone;
    if ((o as THREE.SkinnedMesh).isSkinnedMesh) meshes.push(o as THREE.SkinnedMesh);
  });
  const rest = new Map<THREE.Bone, { q: THREE.Quaternion; p: THREE.Vector3 }>();
  for (const b of Object.values(bones)) rest.set(b, { q: b.quaternion.clone(), p: b.position.clone() });
  root.updateMatrixWorld(true);
  return {
    root, bones, meshes,
    reset() { for (const [b, r] of rest) { b.quaternion.copy(r.q); b.position.copy(r.p); } root.updateMatrixWorld(true); },
  };
}

// ---------- Ayudas para posar ----------
const _a = new THREE.Vector3(), _b = new THREE.Vector3(), _c = new THREE.Vector3(), _d = new THREE.Vector3();
const _q = new THREE.Quaternion(), _q2 = new THREE.Quaternion(), _q3 = new THREE.Quaternion();

/** Gira un hueso (en el mundo) para que la dirección `from` pase a ser `to`. */
function rotateWorld(bone: THREE.Object3D, from: THREE.Vector3, to: THREE.Vector3) {
  _q.setFromUnitVectors(from.clone().normalize(), to.clone().normalize()); // giro en el mundo
  bone.getWorldQuaternion(_q2);
  bone.parent!.getWorldQuaternion(_q3);
  bone.quaternion.copy(_q3.invert().multiply(_q).multiply(_q2));
  bone.updateMatrixWorld(true);
}

/** Gira un hueso alrededor de un eje del mundo. */
export function turnWorld(bone: THREE.Object3D, axis: THREE.Vector3, angle: number) {
  _q.setFromAxisAngle(axis, angle);
  bone.getWorldQuaternion(_q2);
  bone.parent!.getWorldQuaternion(_q3);
  bone.quaternion.copy(_q3.invert().multiply(_q).multiply(_q2));
  bone.updateMatrixWorld(true);
}

/**
 * IK de dos huesos: `upper` (hombro o cadera) → `lower` (codo o rodilla) → `end` (muñeca o tobillo).
 * Lleva `end` a `target` (en el mundo); `pole` dice hacia dónde se dobla la articulación del medio.
 */
export function reach(upper: THREE.Object3D, lower: THREE.Object3D, end: THREE.Object3D, target: THREE.Vector3, pole: THREE.Vector3) {
  const S = upper.getWorldPosition(_a), E = lower.getWorldPosition(_b), W = end.getWorldPosition(_c);
  const L1 = S.distanceTo(E), L2 = E.distanceTo(W);
  const toT = target.clone().sub(S);
  const d = Math.min(Math.max(toT.length(), Math.abs(L1 - L2) + 1e-4), L1 + L2 - 1e-4);
  const dir = toT.normalize();
  const a = (L1 * L1 - L2 * L2 + d * d) / (2 * d), h = Math.sqrt(Math.max(0, L1 * L1 - a * a));
  const p = pole.clone().sub(S);
  p.addScaledVector(dir, -p.dot(dir));
  if (p.lengthSq() < 1e-8) p.set(0, -1, 0).addScaledVector(dir, -dir.y);
  p.normalize();
  const newE = S.clone().addScaledVector(dir, a).addScaledVector(p, h);
  rotateWorld(upper, E.clone().sub(S), newE.clone().sub(S));
  const E2 = lower.getWorldPosition(_b.clone()), W2 = end.getWorldPosition(_d);
  const goal = S.clone().addScaledVector(dir, d);
  rotateWorld(lower, W2.clone().sub(E2), goal.sub(E2));
}

/** Orienta un hueso para que su eje largo (hacia su hijo) apunte a `dir` (en el mundo). */
export function aimBone(bone: THREE.Object3D, child: THREE.Object3D, dir: THREE.Vector3) {
  const from = child.getWorldPosition(_a).sub(bone.getWorldPosition(_b));
  rotateWorld(bone, from, dir);
}

// ---------- Brazos en primera persona ----------
/** Huesos cuyos vértices se ven en primera persona: brazo, antebrazo, muñeca y dedos (no hombreras ni cuerpo). */
const ARM_BONE = /^(left|right)(arm|elbow|wrist)$|finger|thumb/;

/** Brazos en primera persona: tamaño (1 = real) y desplazamiento respecto a los ojos (m: x derecha, y arriba, z hacia atrás). */
export const FP_ARMS = {
  escala: 1.3, x: 0.06, y: 0, z: -0.16,
  /** Hacia dónde apunta cada mano (de la muñeca a los nudillos), vista desde la cámara: x derecha, y arriba, z hacia atrás. */
  manoDerecha: [-0.55, -0.35, -0.75] as [number, number, number],
  manoIzquierda: [0.45, 0.05, -0.9] as [number, number, number],
  /** Cuánto se cierran los dedos sobre el arma (rad por falange) y el pulgar. */
  dedos: 0.95, pulgar: 0.5, ejeDedos: 'x' as 'x' | 'z',
};

export interface FirstPersonArms {
  root: THREE.Group;
  /** Lleva las manos a los dos agarres del arma (puntos en el mundo). */
  solve(gripR: THREE.Vector3, gripL: THREE.Vector3): void;
}

/**
 * Los brazos del comando para la vista en primera persona: una copia del modelo de la que solo se dibujan brazos y guantes,
 * colocada para que sus ojos coincidan con la cámara (`eye` = altura de los ojos). Las manos se llevan al arma con IK.
 */
export function createFirstPersonArms(height: number, eye: number): FirstPersonArms {
  const rig = createCommandoRig(height);
  for (const m of rig.meshes) {
    const mat = m.material as THREE.MeshLambertMaterial;
    mat.fog = false;
    const bones = m.skeleton.bones;
    const keepBone = bones.map((b) => ARM_BONE.test(key(b.name)));
    const si = m.geometry.attributes.skinIndex as THREE.BufferAttribute, sw = m.geometry.attributes.skinWeight as THREE.BufferAttribute;
    const main = (v: number) => {
      let best = 0, w = -1;
      for (let k = 0; k < 4; k++) { const wk = sw.getComponent(v, k); if (wk > w) { w = wk; best = si.getComponent(v, k); } }
      return best;
    };
    const idx = m.geometry.index!;
    const keep: number[] = [];
    for (let t = 0; t < idx.count; t += 3) {
      const a = idx.getX(t), b = idx.getX(t + 1), c = idx.getX(t + 2);
      if (keepBone[main(a)] && keepBone[main(b)] && keepBone[main(c)]) keep.push(a, b, c);
    }
    const g = m.geometry.clone();
    g.setIndex(keep);
    m.geometry = g;
    m.visible = keep.length > 0;
    m.castShadow = false;
  }
  // Como en todos los juegos en primera persona, los brazos se colocan para la vista y no donde irían en el cuerpo:
  // algo más grandes y adelantados, para que las manos lleguen al arma que se ve en pantalla.
  const F = FP_ARMS;
  rig.root.scale.setScalar(F.escala);
  rig.root.position.set(F.x, -eye * F.escala + F.y, F.z);
  const b = rig.bones;
  const _p = new THREE.Vector3();
  const fingers = Object.keys(b).filter((k) => /finger[123][lr]$/.test(k));
  const thumbs = Object.keys(b).filter((k) => /thumb[123][lr]$/.test(k));
  const camDir = (v: [number, number, number]) => new THREE.Vector3(...v).normalize().transformDirection(rig.root.parent!.matrixWorld);
  return {
    root: rig.root,
    solve(gripR, gripL) {
      rig.reset();
      const W = (x: number, y: number, z: number) => rig.root.localToWorld(_p.set(x, y, z)).clone();
      reach(b.rightarm, b.rightelbow, b.rightwrist, gripR, W(0.6, eye - 0.7, 0.2)); // codo derecho abajo y afuera
      reach(b.leftarm, b.leftelbow, b.leftwrist, gripL, W(-0.3, eye - 0.8, -0.2)); // codo izquierdo abajo
      // manos: orientadas sobre el arma y con los dedos cerrados
      if (b.middlefinger1r) aimBone(b.rightwrist, b.middlefinger1r, camDir(F.manoDerecha));
      if (b.middlefinger1l) aimBone(b.leftwrist, b.middlefinger1l, camDir(F.manoIzquierda));
      for (const k of fingers) { const bn = b[k]; if (F.ejeDedos === 'x') bn.rotateX(F.dedos); else bn.rotateZ(k.endsWith('r') ? -F.dedos : F.dedos); }
      for (const k of thumbs) b[k].rotateX(F.pulgar);
      rig.root.updateMatrixWorld(true);
    },
  };
}
