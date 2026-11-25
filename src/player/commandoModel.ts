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
// Cada mano se coloca en un punto de agarre del arma (posición y giro en el sistema del arma), así se mueve siempre con ella.
// El antebrazo sale de la mano hacia su esquina de abajo con un ángulo fijo (el codo, donde se corta el brazo, queda fuera de la vista)
// y los dedos se cierran alrededor del arma hasta tocarla (se calcula una vez, cuando cambian los ajustes).

/** Huesos cuyos vértices se ven: antebrazo, muñeca y dedos (ni la parte de arriba del brazo ni los hombros). */
const ARM_BONE = /^(left|right)(elbow|wrist)$|finger|thumb/;

export interface HandSetup {
  /** Centro de la palma en el arma (unidades del arma: x derecha, y arriba, z hacia atrás; la boca del cañón está en z = −0,45). */
  pos: [number, number, number];
  /** Giro extra de la mano sobre su postura de partida (grados, en ejes del arma). */
  rot: [number, number, number];
  /** Cuánto se cierran los dedos (0 = estirados, 1 = puño) y el pulgar. Se paran al tocar el arma. */
  dedos: number;
  pulgar: number;
  /** Índice (mano derecha): cierre aparte, para dejarlo junto al gatillo. */
  indice: number;
  /** De dónde viene el antebrazo (grados): `lado` 0 = desde atrás, + derecha / − izquierda; `abajo` 0 = horizontal, 90 = desde abajo. */
  lado: number;
  abajo: number;
}

/** Ajustes de los brazos en primera persona (los cambia en directo el panel de ajuste del modo de pruebas). */
export const FP_HANDS = {
  /** Tamaño de los brazos (1 = el real del comando). */
  tamano: 1.13,
  /** Largo del antebrazo (1 = el real). Como en los juegos de disparos, se alarga para que entre en diagonal desde la esquina; la mano no se deforma. */
  largo: 1.63,
  // valores de Víctor (panel de ajuste)
  derecha: { pos: [0.058, -0.154, 0.216], rot: [29, 2, -6], dedos: 0.32, pulgar: 0.21, indice: 0.08, lado: 55, abajo: 37 } as HandSetup,
  izquierda: { pos: [0.002, -0.192, -0.13], rot: [3, 6, 24], dedos: 0.2, pulgar: 0.18, indice: 0.85, lado: -64, abajo: 29 } as HandSetup,
};
/** Sube cada vez que cambian los ajustes (los dedos se recalculan). */
export const FP_STATE = { version: 0, corteVisible: false, debug: [] as string[] };

export interface FirstPersonArms {
  root: THREE.Group;
  /**
   * Coloca las dos manos en sus agarres. `gun` = el arma (su sistema define los agarres); `camera` = la cámara de los brazos;
   * `hits` dice si un tramo (de a a b, en el mundo) toca el arma.
   */
  solve(gun: THREE.Object3D, camera: THREE.Camera, hits: (a: THREE.Vector3, b: THREE.Vector3) => boolean): void;
}

/** Postura de partida de cada mano en el sistema del arma: hacia dónde apuntan los dedos (f) y hacia dónde mira la palma (n). */
const BASE = {
  r: { f: new THREE.Vector3(0, -0.3, -1).normalize(), n: new THREE.Vector3(-1, 0, 0) }, // mano derecha: palma hacia la empuñadura, dedos hacia delante
  l: { f: new THREE.Vector3(1, 0, -0.3).normalize(), n: new THREE.Vector3(0, 1, 0) }, // mano izquierda: palma arriba bajo el cañón, dedos hacia la derecha
};

export function createFirstPersonArms(height: number, eye: number): FirstPersonArms {
  const rig = createCommandoRig(height);
  for (const m of rig.meshes) {
    const mat = m.material as THREE.MeshLambertMaterial;
    mat.fog = false;
    const bones = m.skeleton.bones;
    const keepBone = bones.map((bn) => ARM_BONE.test(key(bn.name)));
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
  rig.root.position.set(0, -eye, 0);
  const b = rig.bones;

  // --- Sistema propio de cada mano (en el sistema de su hueso de muñeca, en la postura de origen): dedos (f), pulgar (t) y palma (n) ---
  rig.reset();
  type Hand = {
    side: 'r' | 'l'; arm: THREE.Bone; elbow: THREE.Bone; wrist: THREE.Bone;
    basisInv: THREE.Quaternion; palm: THREE.Vector3;
    fingers: THREE.Bone[][]; thumb: THREE.Bone[]; index: THREE.Bone[];
    cache: Map<THREE.Bone, THREE.Quaternion> | null; version: number;
  };
  const chain = (name: string, s: string) => [1, 2, 3].map((i) => b[`${name}${i}${s}`]).concat([b[`${name}3${s}end`]]).filter(Boolean);
  const makeHand = (s: 'r' | 'l'): Hand => {
    const side = s === 'r' ? 'right' : 'left';
    const wrist = b[`${side}wrist`];
    const inv = new THREE.Matrix4().copy(wrist.matrixWorld).invert();
    const loc = (bn: THREE.Bone) => bn.getWorldPosition(new THREE.Vector3()).applyMatrix4(inv);
    const mid = loc(b[`middlefinger1${s}`]), tip = loc(b[`middlefinger3${s}end`] ?? b[`middlefinger3${s}`]);
    const f = mid.clone().normalize(); // hacia los nudillos
    // La palma: el lado contrario a la placa de armadura del dorso del guante (las piezas blancas, con textura, que mueve la muñeca).
    // Si no se encontrara la placa, se usa hacia dónde se doblan los dedos en reposo.
    const plate = new THREE.Vector3(), pv = new THREE.Vector3();
    let count = 0;
    for (const m of rig.meshes) {
      if (!(m.material as THREE.MeshLambertMaterial).map || !m.geometry.index) continue;
      const si = m.geometry.attributes.skinIndex as THREE.BufferAttribute, sw = m.geometry.attributes.skinWeight as THREE.BufferAttribute;
      const wi = m.skeleton.bones.indexOf(wrist);
      if (wi < 0) continue;
      for (const i of new Set(m.geometry.index.array as ArrayLike<number> as number[])) {
        let best = 0, bw = -1;
        for (let k = 0; k < 4; k++) { const w = sw.getComponent(i, k); if (w > bw) { bw = w; best = si.getComponent(i, k); } }
        if (best !== wi) continue;
        m.getVertexPosition(i, pv);
        plate.add(pv.applyMatrix4(m.matrixWorld).applyMatrix4(inv));
        count++;
      }
    }
    const n = new THREE.Vector3();
    if (count > 10) n.copy(plate.divideScalar(count)).negate();
    else n.copy(tip).sub(mid);
    n.addScaledVector(f, -n.dot(f)).normalize();
    const t = new THREE.Vector3().crossVectors(n, f); // tercer eje (sistema de ejes bien orientado; el pulgar cae donde le toca)
    const basis = new THREE.Matrix4().makeBasis(t, n, f);
    const basisInv = new THREE.Quaternion().setFromRotationMatrix(basis).invert();
    const palm = mid.clone().multiplyScalar(0.55); // centro de la palma
    return {
      side: s, arm: b[`${side}arm`], elbow: b[`${side}elbow`], wrist, basisInv, palm,
      fingers: ['indexfinger', 'middlefinger', 'ringfinger', 'littlefinger'].map((nm) => chain(nm, s)),
      thumb: chain('thumb', s), index: chain('indexfinger', s), cache: null, version: -1,
    };
  };
  const hands = [makeHand('r'), makeHand('l')];

  const _m = new THREE.Matrix4();
  const _v = new THREE.Vector3(), _s = new THREE.Vector3();


  /** Cierra los dedos de una mano alrededor del arma: cada falange gira hacia la palma hasta tocar el arma (o hasta su máximo). */
  const curl = (h: Hand, setup: HandSetup, hits: (a: THREE.Vector3, b: THREE.Vector3) => boolean) => {
    if (h.side === 'r') FP_STATE.debug.length = 0;
    const palmN = new THREE.Vector3(0, 1, 0);
    const wq = h.wrist.getWorldQuaternion(new THREE.Quaternion());
    // palma en el mundo: el eje n del sistema de la mano
    palmN.set(0, 1, 0).applyQuaternion(new THREE.Quaternion().copy(h.basisInv).invert()).applyQuaternion(wq).normalize();
    const MAX = [1.25, 1.5, 1.1];
    const pos = (bn: THREE.Bone) => bn.getWorldPosition(new THREE.Vector3());
    const bend = (ch: THREE.Bone[], amount: number, contact: boolean, thumb = false) => {
      const log: string[] = [];
      for (let i = 0; i < Math.min(3, ch.length - 1); i++) {
        const max = amount * (thumb ? [0.6, 0.9, 0.8][i] : MAX[i]);
        let a = 0, why = 'max';
        for (a = 0; a < max; a += 0.06) {
          const dir = pos(ch[i + 1]).sub(pos(ch[i])).normalize();
          const axis = new THREE.Vector3().crossVectors(dir, palmN); // los dedos se cierran hacia donde mira la palma
          if (axis.lengthSq() < 1e-6) break;
          axis.normalize();
          turnWorld(ch[i], axis, 0.06);
          if (contact) {
            let touch = false;
            for (let k = i; k < ch.length - 1 && !touch; k++) touch = hits(pos(ch[k]), pos(ch[k + 1]));
            if (touch) { turnWorld(ch[i], axis, -0.06); why = 'toca'; break; }
          }
        }
        log.push(`${a.toFixed(2)}${why === 'toca' ? '*' : ''}`);
      }
      FP_STATE.debug.push(`${h.side} ${ch[0].name}: ${log.join(' ')}`);
    };
    for (const ch of h.fingers) {
      const isIndex = ch[0] === h.index[0];
      bend(ch, isIndex && h.side === 'r' ? setup.indice : setup.dedos, !(isIndex && h.side === 'r'));
    }
    bend(h.thumb, setup.pulgar, true, true);
    const cache = new Map<THREE.Bone, THREE.Quaternion>();
    for (const ch of [...h.fingers, h.thumb]) for (const bn of ch) cache.set(bn, bn.quaternion.clone());
    h.cache = cache;
  };

  return {
    root: rig.root,
    solve(gun, camera, hits) {
      rig.reset();
      rig.root.scale.setScalar(FP_HANDS.tamano);
      rig.root.updateMatrixWorld(true);
      gun.updateMatrixWorld(true);
      const gunQ = gun.getWorldQuaternion(new THREE.Quaternion());
      FP_STATE.corteVisible = false;
      for (const h of hands) {
        const setup = h.side === 'r' ? FP_HANDS.derecha : FP_HANDS.izquierda;
        // antebrazo alargado (a lo largo de su hueso); la muñeca vuelve a su sitio de origen dentro del antebrazo
        h.elbow.scale.set(1, FP_HANDS.largo, 1);
        h.wrist.matrixAutoUpdate = false;
        h.wrist.matrix.compose(h.wrist.position, h.wrist.quaternion, h.wrist.scale);
        h.arm.updateMatrixWorld(true);
        const base = BASE[h.side];
        // 1) giro de la mano: postura de partida (dedos f, palma n en el arma) + giro extra, todo en el sistema del arma
        const nD = base.n.clone(), fD = base.f.clone();
        fD.addScaledVector(nD, -fD.dot(nD)).normalize(); // dedos perpendiculares a la palma
        const t = new THREE.Vector3().crossVectors(nD, fD);
        _m.makeBasis(t, nD, fD);
        const qBase = new THREE.Quaternion().setFromRotationMatrix(_m);
        const qExtra = new THREE.Quaternion().setFromEuler(new THREE.Euler(...setup.rot.map((d) => THREE.MathUtils.degToRad(d)) as [number, number, number], 'XYZ'));
        const qWrist = gunQ.clone().multiply(qExtra).multiply(qBase).multiply(h.basisInv);
        // 2) dónde va la muñeca: el centro de la palma en el agarre
        const grip = gun.localToWorld(_v.set(...setup.pos)).clone();
        h.arm.getWorldScale(_s); // escala del brazo sin el alargamiento (la mano mantiene su tamaño)
        const wristPos = grip.clone().sub(h.palm.clone().multiply(_s).applyQuaternion(qWrist));
        // 3) codo: sale de la muñeca hacia su esquina de abajo, con el largo real del antebrazo
        const L2 = h.elbow.getWorldPosition(new THREE.Vector3()).distanceTo(h.wrist.getWorldPosition(new THREE.Vector3()));
        const L1 = h.arm.getWorldPosition(new THREE.Vector3()).distanceTo(h.elbow.getWorldPosition(new THREE.Vector3()));
        const lado = THREE.MathUtils.degToRad(setup.lado), abajo = THREE.MathUtils.degToRad(setup.abajo);
        const back = new THREE.Vector3(Math.sin(lado) * Math.cos(abajo), -Math.sin(abajo), Math.cos(lado) * Math.cos(abajo)).transformDirection(camera.matrixWorld);
        const elbowPos = wristPos.clone().addScaledVector(back, L2);
        // hombro (no se ve): en la misma línea, algo doblado, para que el codo quede justo donde queremos
        const shoulder = elbowPos.clone().addScaledVector(back, L1 * 0.98).addScaledVector(new THREE.Vector3(0, -1, 0).transformDirection(camera.matrixWorld), L1 * 0.2);
        h.arm.position.copy(h.arm.parent!.worldToLocal(shoulder.clone()));
        h.arm.updateMatrixWorld(true);
        reach(h.arm, h.elbow, h.wrist, wristPos, elbowPos);
        // 4) giro del antebrazo sobre su eje para acompañar a la mano (evita que la muñeca se retuerza)
        const axis = h.wrist.getWorldPosition(new THREE.Vector3()).sub(h.elbow.getWorldPosition(new THREE.Vector3())).normalize();
        const wrNow = h.wrist.getWorldQuaternion(new THREE.Quaternion());
        const delta = qWrist.clone().multiply(wrNow.invert()); // giro que le falta a la muñeca
        const proj = axis.x * delta.x + axis.y * delta.y + axis.z * delta.z; // la parte de ese giro alrededor del antebrazo
        const ang = 2 * Math.atan2(proj, delta.w);
        turnWorld(h.elbow, axis, Math.atan2(Math.sin(ang), Math.cos(ang)) * 0.6);
        // muñeca: en su sitio, con su giro y su tamaño normal (se anula el alargamiento del antebrazo para que la mano no se deforme)
        const wp = h.wrist.getWorldPosition(new THREE.Vector3());
        const want = new THREE.Matrix4().compose(wp, qWrist, _s);
        h.wrist.matrix.copy(new THREE.Matrix4().copy(h.elbow.matrixWorld).invert().multiply(want));
        h.wrist.updateMatrixWorld(true);
        // 5) dedos: se recalculan solo si cambiaron los ajustes; si no, se reponen los de antes
        if (h.version !== FP_STATE.version || !h.cache) { curl(h, setup, hits); h.version = FP_STATE.version; }
        else for (const [bn, q] of h.cache) bn.quaternion.copy(q);
        // ¿se ve el corte del brazo? (el codo dentro de la imagen)
        const ndc = elbowPos.clone().project(camera);
        if (ndc.z < 1 && ndc.z > -1 && Math.abs(ndc.x) < 1 && Math.abs(ndc.y) < 1) FP_STATE.corteVisible = true;
      }
      rig.root.updateMatrixWorld(true);
    },
  };
}

// Para pruebas: ajustes y estado de los brazos accesibles desde la consola del navegador
(globalThis as unknown as { __fp: unknown }).__fp = { FP_HANDS, FP_STATE };
