import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { clone as cloneSkinned } from 'three/addons/utils/SkeletonUtils.js';
import { withLightFloor } from '../world/lightFill';

// Modelo del clon comando: «Republic Commando» de Abel (https://sketchfab.com/abel76), licencia CC-BY-NC 4.0 (ver CRÉDITOS.md).
// public/models/commando.glb se genera con tools/convert-commando.py (solo cambian sus imágenes, a JPG, para que pese menos).
// Trae esqueleto (76 huesos) pero ninguna animación: las posturas se hacen girando huesos por código, con ayuda de un «IK de dos huesos»
// (se dice dónde tiene que quedar la mano o el pie y se calculan solos el hombro y el codo, o la cadera y la rodilla).

// También carga el clon normal de fase I (public/models/clone/: «Clone Trooper Phase1 (Shiny) [Updated]» de Admiral Tributon, CC-BY 4.0).
// Se usa su versión .fbx (la .gltf trae el esqueleto descolocado) con sus texturas en JPG (color, relieve y brillo del visor, sacadas del .usdz).
// Mismo sistema, otro esqueleto (nombres de huesos tipo Mixamo).

export type TrooperModel = 'commando' | 'clone';
const models: Partial<Record<TrooperModel, { scene: THREE.Object3D; restHeight: number }>> = {};

/** Descarga un modelo. Si falla, la cinemática usa las figuras provisionales de formas sencillas (y el jugador, los brazos de antes). */
export async function loadTrooperModel(id: TrooperModel, url: string): Promise<boolean> {
  try {
    const scene = url.endsWith('.fbx') ? await loadFbxWithTextures(url) : (await new GLTFLoader().loadAsync(url)).scene;
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
    models[id] = { scene, restHeight: new THREE.Box3().setFromObject(scene, true).getSize(new THREE.Vector3()).y };
    return true;
  } catch (e) {
    console.warn(`No se pudo cargar el modelo «${id}»; se usa el provisional.`, e);
    delete models[id];
    return false;
  }
}

/** Carga un .fbx y le pone las texturas JPG que hay junto a él (<material>_baseColor/_normal/_emissive.jpg). */
async function loadFbxWithTextures(url: string): Promise<THREE.Object3D> {
  const { FBXLoader } = await import('three/addons/loaders/FBXLoader.js');
  const obj = await new FBXLoader().loadAsync(url);
  const dir = url.replace(/[^/]*$/, '');
  const tl = new THREE.TextureLoader();
  const tex = async (name: string, srgb: boolean) => {
    try {
      const t = await tl.loadAsync(dir + name);
      t.flipY = false; // las texturas vienen del .usdz (origen arriba a la izquierda, como en glTF)
      if (srgb) t.colorSpace = THREE.SRGBColorSpace;
      return t;
    } catch { return null; }
  };
  const jobs: Promise<void>[] = [];
  obj.traverse((o) => {
    const m = o as THREE.SkinnedMesh;
    if (!m.isMesh) return;
    const name = (Array.isArray(m.material) ? m.material[0] : m.material).name;
    jobs.push((async () => {
      const [map, normalMap, emissiveMap] = await Promise.all([tex(`${name}_baseColor.jpg`, true), tex(`${name}_normal.jpg`, false), tex(`${name}_emissive.jpg`, true)]);
      m.material = new THREE.MeshStandardMaterial({ map, normalMap, emissiveMap, color: 0xffffff });
    })());
  });
  await Promise.all(jobs);
  return obj;
}

export const loadCommandoModel = (url: string) => loadTrooperModel('commando', url);
export const commandoModelReady = () => !!models.commando;
export const trooperModelReady = (id: TrooperModel) => !!models[id];

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

/** Una copia del modelo, lista para posar. `facing`: hacia dónde mira el modelo original (+1 = +Z, −1 = −Z). */
export function createTrooperRig(id: TrooperModel, height: number, facing = 1): CommandoRig {
  const src = models[id]!;
  const model = cloneSkinned(src.scene) as THREE.Object3D;
  const root = new THREE.Group();
  const inner = new THREE.Group();
  inner.add(model);
  if (facing > 0) inner.rotation.y = Math.PI; // el modelo mira a +Z: se gira para que mire a −Z, como todo en el juego
  inner.scale.setScalar(height / src.restHeight);
  root.add(inner);
  root.updateMatrixWorld(true);
  const box = new THREE.Box3().setFromObject(root, true);
  inner.position.y = -box.min.y; // pies en el suelo
  const bones: Record<string, THREE.Bone> = {};
  const meshes: THREE.SkinnedMesh[] = [];
  model.traverse((o) => { if ((o as THREE.SkinnedMesh).isSkinnedMesh) meshes.push(o as THREE.SkinnedMesh); });
  // los huesos que mueven la malla (en el .fbx hay además nudos con el mismo nombre que no mueven nada)
  for (const m of meshes) for (const bn of m.skeleton.bones) if (!bones[key(bn.name)]) bones[key(bn.name)] = bn;
  model.traverse((o) => { if ((o as THREE.Bone).isBone && !bones[key(o.name)]) bones[key(o.name)] = o as THREE.Bone; });
  const rest = new Map<THREE.Bone, { q: THREE.Quaternion; p: THREE.Vector3 }>();
  for (const b of Object.values(bones)) rest.set(b, { q: b.quaternion.clone(), p: b.position.clone() });
  // centrado: la cadera sobre el origen (la caja de la postura en T no es simétrica en todos los modelos)
  const hips = bones.hips;
  if (hips) {
    root.updateMatrixWorld(true);
    const hp = root.worldToLocal(hips.getWorldPosition(new THREE.Vector3()));
    inner.position.x -= hp.x;
    inner.position.z -= hp.z;
  }
  root.updateMatrixWorld(true);
  return {
    root, bones, meshes,
    reset() { for (const [b, r] of rest) { b.quaternion.copy(r.q); b.position.copy(r.p); } root.updateMatrixWorld(true); },
  };
}

export const createCommandoRig = (height: number) => createTrooperRig('commando', height);

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

/** Postura de la mano izquierda que no está en el rifle (sujetando la granada, cogiéndola del cinturón, lanzando),
 *  en el sistema de la CÁMARA: `pos` = centro de la palma (m; x derecha, y arriba, z hacia atrás); `rot` = giro extra (grados)
 *  sobre la postura de partida de sujetar (palma hacia el centro de la pantalla, dedos hacia delante); `lado`/`abajo` como en HandSetup. */
export interface FreePose { pos: [number, number, number]; rot: [number, number, number]; lado: number; abajo: number }

/** Ajustes de la mano izquierda con la granada (los cambia en directo la sección «Granada» del panel de ajuste). */
// valores de Víctor (panel de ajuste, sección «Granada»)
export const FP_GRENADE = {
  /** La mano que la sujeta (en el sistema de la cámara). */
  mano: { pos: [-0.186, -0.224, -0.51], rot: [39, -39, 71], lado: -35, abajo: 23 } as FreePose,
  /** La granada dentro de la mano (en el sistema de la mano: x hacia el pulgar, y saliendo de la palma, z hacia los dedos; m y grados). */
  granada: { pos: [-0.006, 0.062, 0.025], rot: [-66, 42, 135] as [number, number, number] },
  /** Cuánto se cierran los dedos y el pulgar alrededor de la granada (se paran al tocarla). */
  dedos: 1,
  pulgar: 0,
  /** El rifle mientras sujetas la granada: cuánto baja (m), se aparta a la derecha (m) y se inclina (grados). */
  rifle: { baja: 0.186, aparta: 0.116, gira: 30 },
};
/** Radio de la granada para que los dedos se paren al tocarla (10 cm de diámetro). */
export const GRENADE_RADIUS = 0.05;

/** La mano izquierda fuera del rifle: dónde está (`pose`), cuánto pesa frente al agarre del rifle (`w`: 0 = en el rifle, 1 = en `pose`)
 *  y cómo están los dedos (`open`: 0 = cerrados en el rifle, 1 = abiertos; `grip`: 0..1 = cerrados en la granada). */
export interface LeftFree { w: number; pose: FreePose; open: number; grip: number }

export interface FirstPersonArms {
  root: THREE.Group;
  /**
   * Coloca las dos manos en sus agarres. `gun` = el arma (su sistema define los agarres); `camera` = la cámara de los brazos;
   * `hits` dice si un tramo (de a a b, en el mundo) toca el arma. `left` = la mano izquierda fuera del rifle (granada).
   */
  solve(gun: THREE.Object3D, camera: THREE.Camera, hits: (a: THREE.Vector3, b: THREE.Vector3) => boolean, left?: LeftFree): void;
  /** Centro de la palma de la mano izquierda y su giro (ejes: x pulgar, y fuera de la palma, z dedos), tras `solve`. */
  leftPalm: { pos: THREE.Vector3; q: THREE.Quaternion };
}

/** Desplazamiento de la granada respecto al centro de la palma, en el mundo (`pos` en ejes de la mano: x pulgar, y fuera de la palma, z dedos). */
export function grenadeOffset(pos: readonly number[], palmQ: THREE.Quaternion) {
  return new THREE.Vector3(pos[0], pos[1], pos[2]).applyQuaternion(palmQ);
}

/** Postura de partida de la mano izquierda sujetando la granada, en el sistema de la cámara: dedos hacia delante, palma hacia la derecha. */
const FREE_BASE = { f: new THREE.Vector3(0.15, 0.1, -1).normalize(), n: new THREE.Vector3(1, 0.25, 0).normalize() };

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
    /** dedos cerrados en el rifle y en la granada (giros locales de cada falange), y con qué versión de los ajustes se calcularon */
    cache: Map<THREE.Bone, THREE.Quaternion> | null; version: number;
    nade: Map<THREE.Bone, THREE.Quaternion> | null; nadeVersion: number;
    /** dedos estirados (postura de origen) */
    rest: Map<THREE.Bone, THREE.Quaternion>;
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
    const fingers = ['indexfinger', 'middlefinger', 'ringfinger', 'littlefinger'].map((nm) => chain(nm, s));
    const thumb = chain('thumb', s);
    const rest = new Map<THREE.Bone, THREE.Quaternion>();
    for (const ch of [...fingers, thumb]) for (const bn of ch) rest.set(bn, bn.quaternion.clone());
    return {
      side: s, arm: b[`${side}arm`], elbow: b[`${side}elbow`], wrist, basisInv, palm,
      fingers, thumb, index: chain('indexfinger', s), cache: null, version: -1, nade: null, nadeVersion: -1, rest,
    };
  };
  const hands = [makeHand('r'), makeHand('l')];

  const _m = new THREE.Matrix4();
  const _v = new THREE.Vector3(), _s = new THREE.Vector3();


  /** Cierra los dedos de una mano alrededor de lo que sujeta (el arma o la granada): cada falange gira hacia la palma hasta tocarlo
   *  (o hasta su máximo). Empieza con los dedos estirados y devuelve los giros resultantes de cada falange. */
  const curl = (h: Hand, setup: Pick<HandSetup, 'dedos' | 'pulgar' | 'indice'>, hits: (a: THREE.Vector3, b: THREE.Vector3) => boolean) => {
    for (const [bn, q] of h.rest) bn.quaternion.copy(q);
    h.wrist.updateMatrixWorld(true);
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
    return cache;
  };
  /** ¿Toca un tramo (de a a b) la granada? (una esfera de su tamaño, en `ball`) */
  const ball = new THREE.Vector3();
  const _seg = new THREE.Line3(), _cp = new THREE.Vector3();
  const hitsBall = (a: THREE.Vector3, bq: THREE.Vector3) => _seg.set(a, bq).closestPointToPoint(ball, true, _cp).distanceTo(ball) < GRENADE_RADIUS;
  const leftPalm = { pos: new THREE.Vector3(), q: new THREE.Quaternion() };
  const _q1 = new THREE.Quaternion(), _q2 = new THREE.Quaternion();

  return {
    root: rig.root,
    leftPalm,
    solve(gun, camera, hits, left) {
      rig.reset();
      rig.root.scale.setScalar(FP_HANDS.tamano);
      rig.root.updateMatrixWorld(true);
      gun.updateMatrixWorld(true);
      camera.updateMatrixWorld();
      const gunQ = gun.getWorldQuaternion(new THREE.Quaternion());
      const camQ = camera.getWorldQuaternion(new THREE.Quaternion());
      const fromAngles = (ladoDeg: number, abajoDeg: number) => {
        const lado = THREE.MathUtils.degToRad(ladoDeg), abajo = THREE.MathUtils.degToRad(abajoDeg);
        return new THREE.Vector3(Math.sin(lado) * Math.cos(abajo), -Math.sin(abajo), Math.cos(lado) * Math.cos(abajo)).transformDirection(camera.matrixWorld);
      };
      /** giro de una postura de partida (dedos f, palma n) con un giro extra en grados, todo dentro del sistema `sysQ` */
      const handQ = (sysQ: THREE.Quaternion, f0: THREE.Vector3, n0: THREE.Vector3, rot: number[]) => {
        const nD = n0.clone(), fD = f0.clone();
        fD.addScaledVector(nD, -fD.dot(nD)).normalize(); // dedos perpendiculares a la palma
        _m.makeBasis(new THREE.Vector3().crossVectors(nD, fD), nD, fD);
        const qExtra = new THREE.Quaternion().setFromEuler(new THREE.Euler(...rot.map((d) => THREE.MathUtils.degToRad(d)) as [number, number, number], 'XYZ'));
        return sysQ.clone().multiply(qExtra).multiply(new THREE.Quaternion().setFromRotationMatrix(_m));
      };
      FP_STATE.corteVisible = false;
      for (const h of hands) {
        const setup = h.side === 'r' ? FP_HANDS.derecha : FP_HANDS.izquierda;
        const free = h.side === 'l' && left && left.w > 0 ? left : null;
        // antebrazo alargado (a lo largo de su hueso); la muñeca vuelve a su sitio de origen dentro del antebrazo
        h.elbow.scale.set(1, FP_HANDS.largo, 1);
        h.wrist.matrixAutoUpdate = false;
        h.wrist.matrix.compose(h.wrist.position, h.wrist.quaternion, h.wrist.scale);
        h.arm.updateMatrixWorld(true);
        const base = BASE[h.side];
        // 1) giro de la mano (ejes: x pulgar, y palma, z dedos): postura de partida + giro extra, en el sistema del arma.
        //    Si la mano izquierda está fuera del rifle (granada), se mezcla con su postura libre (en el sistema de la cámara).
        const qHand = handQ(gunQ, base.f, base.n, setup.rot);
        // 2) dónde va la muñeca: el centro de la palma en el agarre (o en la postura libre)
        const grip = gun.localToWorld(_v.set(...setup.pos)).clone();
        let back = fromAngles(setup.lado, setup.abajo);
        if (free) {
          qHand.slerp(handQ(camQ, FREE_BASE.f, FREE_BASE.n, free.pose.rot), free.w);
          grip.lerp(camera.localToWorld(_v.set(...free.pose.pos)), free.w);
          back.lerp(fromAngles(free.pose.lado, free.pose.abajo), free.w).normalize();
        }
        const qWrist = qHand.clone().multiply(h.basisInv);
        if (h.side === 'l') { leftPalm.pos.copy(grip); leftPalm.q.copy(qHand); }
        h.arm.getWorldScale(_s); // escala del brazo sin el alargamiento (la mano mantiene su tamaño)
        const wristPos = grip.clone().sub(h.palm.clone().multiply(_s).applyQuaternion(qWrist));
        // 3) codo: sale de la muñeca hacia su esquina de abajo, con el largo real del antebrazo
        const L2 = h.elbow.getWorldPosition(new THREE.Vector3()).distanceTo(h.wrist.getWorldPosition(new THREE.Vector3()));
        const L1 = h.arm.getWorldPosition(new THREE.Vector3()).distanceTo(h.elbow.getWorldPosition(new THREE.Vector3()));
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
        // 5) dedos: se recalculan solo si cambiaron los ajustes; si no, se reponen los de antes.
        //    Los del rifle solo con la mano en el rifle (se cierran hasta tocarlo); los de la granada, en cualquier sitio (la granada va con la mano).
        if (!h.cache || (h.version !== FP_STATE.version && !free)) { h.cache = curl(h, setup, hits); h.version = FP_STATE.version; }
        if (h.side === 'l' && left && (left.grip > 0 || left.open > 0)) {
          if (!h.nade || h.nadeVersion !== FP_STATE.version) {
            ball.copy(grenadeOffset(FP_GRENADE.granada.pos, leftPalm.q)).add(leftPalm.pos);
            h.nade = curl(h, { dedos: FP_GRENADE.dedos, pulgar: FP_GRENADE.pulgar, indice: 0 }, hitsBall);
            h.nadeVersion = FP_STATE.version;
          }
          // rifle → abiertos (open) → alrededor de la granada (grip)
          for (const [bn, q] of h.cache) bn.quaternion.copy(_q1.copy(q).slerp(h.rest.get(bn)!, left.open).slerp(_q2.copy(h.nade.get(bn)!), left.grip));
        } else for (const [bn, q] of h.cache) bn.quaternion.copy(q);
        // ¿se ve el corte del brazo? (el codo dentro de la imagen)
        const ndc = elbowPos.clone().project(camera);
        if (ndc.z < 1 && ndc.z > -1 && Math.abs(ndc.x) < 1 && Math.abs(ndc.y) < 1) FP_STATE.corteVisible = true;
      }
      rig.root.updateMatrixWorld(true);
    },
  };
}

// Para pruebas: ajustes y estado de los brazos accesibles desde la consola del navegador
(globalThis as unknown as { __fp: unknown; __fpg: unknown }).__fp = { FP_HANDS, FP_STATE, FP_GRENADE };
(globalThis as unknown as { __fpg: unknown }).__fpg = FP_GRENADE;
