import * as THREE from 'three';
import type { CommandoRig } from '../player/commandoModel';

// ============================================================================
//  ANIMACIONES DE MIXAMO EN EL CLON COMANDO
// ============================================================================
// Víctor descarga las animaciones de Mixamo (solo movimiento, sin personaje, 30 fps) en assets/animaciones/mixamo/*.fbx.
// Esas animaciones mueven el esqueleto estándar de Mixamo (65 huesos, «mixamorigHips»…), que no es el del comando (76 huesos, «Hips_01»…).
// Aquí se «traducen» una vez (tools/anim-preview, botón «Guardar») a public/animations/<nombre>.json: para cada imagen de la animación,
// el giro de cada hueso del comando. En el juego solo se leen esos números y se ponen en los huesos (applyClip): no hace falta Mixamo
// ni el lector de FBX, y pesan poco.
//
// Cómo se traduce: Mixamo está en postura en T y el comando en su postura de origen (brazos algo bajados). Primero se coloca cada hueso
// del comando apuntando como el de Mixamo en reposo; luego se le aplica el mismo giro que hace el de Mixamo en cada imagen
// (giros «en el mundo», así no importa que los ejes de los huesos de los dos esqueletos sean distintos).
// ============================================================================

/** Hueso de Mixamo → hueso del comando (nombre «limpio», ver `key` en commandoModel.ts) y el hijo que marca hacia dónde apunta. */
type Pair = [mixamo: string, rig: string, mixamoChild: string | null, rigChild: string | null];

const FINGERS: Array<[string, string]> = [['Thumb', 'thumb'], ['Index', 'indexfinger'], ['Middle', 'middlefinger'], ['Ring', 'ringfinger'], ['Pinky', 'littlefinger']];

function pairs(): Pair[] {
  const p: Pair[] = [
    ['Hips', 'hips', 'Spine2', 'chest'],
    ['Spine', 'spine', 'Spine2', 'chest'],
    ['Spine2', 'chest', 'Neck', 'neck'],
    ['Neck', 'neck', 'Head', 'head'],
    ['Head', 'head', null, null], // la cabeza no tiene un hijo fiable en el comando: hereda el ajuste del cuello
  ];
  for (const [S, s] of [['Left', 'left'], ['Right', 'right']]) {
    const l = s[0]; // 'l' / 'r' (sufijo de los dedos del comando)
    p.push(
      [`${S}Shoulder`, `${s}shoulder`, `${S}Arm`, `${s}arm`],
      [`${S}Arm`, `${s}arm`, `${S}ForeArm`, `${s}elbow`],
      [`${S}ForeArm`, `${s}elbow`, `${S}Hand`, `${s}wrist`],
      [`${S}Hand`, `${s}wrist`, `${S}HandMiddle1`, `middlefinger1${l}`],
      [`${S}UpLeg`, `${s}leg`, `${S}Leg`, `${s}knee`],
      [`${S}Leg`, `${s}knee`, `${S}Foot`, `${s}ankle`],
      [`${S}Foot`, `${s}ankle`, `${S}ToeBase`, `${s}toe`],
      [`${S}ToeBase`, `${s}toe`, `${S}Toe_End`, `${s}toeend`],
    );
    for (const [F, f] of FINGERS) for (let i = 1; i <= 3; i++) {
      p.push([`${S}Hand${F}${i}`, `${f}${i}${l}`, `${S}Hand${F}${i + 1}`, i < 3 ? `${f}${i + 1}${l}` : `${f}3${l}end`]);
    }
  }
  return p;
}

/** Animación ya traducida al comando. `q`: giro local de cada hueso (x, y, z, w) imagen a imagen; `hp`: posición local de la cadera. */
export interface BakedClip {
  name: string;
  fps: number;
  frames: number;
  bones: string[];
  q: number[];
  hp: number[];
}

/**
 * Traduce una animación de Mixamo al comando. `src`: lo que devuelve FBXLoader (esqueleto de Mixamo, en centímetros, mirando a +Z).
 * `rootMotion`: conservar el avance de la cadera por el suelo (si no, corre «en el sitio» y el avance lo pone la cinemática).
 */
export function retargetMixamo(src: THREE.Object3D, clip: THREE.AnimationClip, rig: CommandoRig, name: string, fps = 30, rootMotion = true): BakedClip {
  const R = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), Math.PI); // Mixamo mira a +Z; el comando (su grupo exterior) a −Z
  const sb: Record<string, THREE.Object3D> = {};
  src.traverse((o) => { if ((o as THREE.Bone).isBone) sb[o.name.replace(/^mixamorig:?/, '')] = o; });
  const list = pairs().filter(([m, r]) => sb[m] && rig.bones[r]);
  const root = rig.root;
  const savedMatrix = root.matrix.clone();
  const savedParent = root.parent;
  savedParent?.remove(root);
  root.position.set(0, 0, 0); root.quaternion.identity(); root.scale.set(1, 1, 1);

  // reposo de los dos esqueletos, en el espacio del comando (pies en el suelo, mirando a −Z)
  src.position.set(0, 0, 0); src.quaternion.identity(); src.scale.set(1, 1, 1);
  const mixer = new THREE.AnimationMixer(src);
  src.updateMatrixWorld(true);
  const sq = (b: THREE.Object3D) => R.clone().multiply(b.getWorldQuaternion(new THREE.Quaternion()));
  const sp = (b: THREE.Object3D) => b.getWorldPosition(new THREE.Vector3()).applyQuaternion(R);
  const srcRestQ = new Map<string, THREE.Quaternion>();
  const srcRestP = new Map<string, THREE.Vector3>();
  for (const k of Object.keys(sb)) { srcRestQ.set(k, sq(sb[k])); srcRestP.set(k, sp(sb[k])); }
  rig.reset();
  root.updateMatrixWorld(true);
  const tq = (b: THREE.Object3D) => b.getWorldQuaternion(new THREE.Quaternion());
  const tp = (b: THREE.Object3D) => b.getWorldPosition(new THREE.Vector3());

  // ajuste de reposo: el giro que pone cada hueso del comando apuntando como el de Mixamo (los que no tienen hijo heredan el del padre)
  const align = new Map<string, THREE.Quaternion>();
  for (const [m, r, mc, rc] of list) {
    let a: THREE.Quaternion;
    if (mc && rc && sb[mc] && rig.bones[rc]) {
      const ds = srcRestP.get(mc)!.clone().sub(srcRestP.get(m)!).normalize();
      const dt = tp(rig.bones[rc]).sub(tp(rig.bones[r])).normalize();
      a = new THREE.Quaternion().setFromUnitVectors(dt, ds);
    } else {
      const parent = list.find(([, rr]) => rig.bones[r].parent === rig.bones[rr]);
      a = parent ? align.get(parent[1])!.clone() : new THREE.Quaternion();
    }
    align.set(r, a);
  }
  const restWorld = new Map<string, THREE.Quaternion>();
  for (const [, r] of list) restWorld.set(r, align.get(r)!.clone().multiply(tq(rig.bones[r])));

  // altura: la cadera del comando en reposo frente a la de Mixamo en reposo
  const hipsT = rig.bones.hips;
  const k = tp(hipsT).y / srcRestP.get('Hips')!.y;
  const action = mixer.clipAction(clip);
  action.play();
  const frames = Math.max(2, Math.round(clip.duration * fps) + 1);
  const out: BakedClip = { name, fps, frames, bones: list.map(([, r]) => r), q: [], hp: [] };
  let hip0: THREE.Vector3 | null = null;
  const qw = new THREE.Quaternion(), qp = new THREE.Quaternion();
  for (let f = 0; f < frames; f++) {
    mixer.setTime(Math.min(f / fps, clip.duration));
    src.updateMatrixWorld(true);
    rig.reset();
    // cadera: altura escalada; por el suelo, lo que avance desde la primera imagen (o nada)
    const hs = sp(sb.Hips);
    hip0 ??= hs.clone();
    const target = new THREE.Vector3(rootMotion ? (hs.x - hip0.x) * k : 0, hs.y * k, rootMotion ? (hs.z - hip0.z) * k : 0);
    const restHip = tp(hipsT);
    target.x += restHip.x; target.z += restHip.z;
    hipsT.position.copy(hipsT.parent!.worldToLocal(target));
    // giros, de padres a hijos
    for (const [m, r] of list) {
      const b = rig.bones[r];
      qw.copy(sq(sb[m])).multiply(srcRestQ.get(m)!.clone().invert()).multiply(restWorld.get(r)!); // giro de Mixamo aplicado al reposo ajustado
      b.parent!.getWorldQuaternion(qp);
      b.quaternion.copy(qp.invert().multiply(qw));
      b.updateMatrixWorld(true);
      out.q.push(...b.quaternion.toArray().map(round));
    }
    out.hp.push(...hipsT.position.toArray().map(round));
  }
  mixer.stopAllAction();
  rig.reset();
  root.matrix.copy(savedMatrix);
  root.matrix.decompose(root.position, root.quaternion, root.scale);
  savedParent?.add(root);
  root.updateMatrixWorld(true);
  return out;
}
const round = (v: number) => Math.round(v * 1e4) / 1e4;

// ---------- En el juego ----------
/** Animaciones que descarga el juego al cargar (public/animations/<nombre>.json). */
export const ANIM_CLIPS = ['Rifle_Run', 'Rifle_Run_To_Stop', 'Crouch_Rapid_Fire', 'Rifle_Kneel_To_Stand', 'Rifle_Idle', 'Rifle_Aiming_Idle'];
const clips = new Map<string, BakedClip>();

/** Descarga las animaciones ya traducidas (public/animations/<nombre>.json). Si alguna falla, se usan las posturas por código. */
export async function loadClips(base: string, names: string[]) {
  await Promise.all(names.map(async (n) => {
    try {
      const r = await fetch(`${base}animations/${n}.json`);
      if (!r.ok) throw new Error(String(r.status));
      clips.set(n, (await r.json()) as BakedClip);
    } catch (e) { console.warn(`No se pudo cargar la animación «${n}»`, e); }
  }));
}
export const getClip = (n: string) => clips.get(n);
export const registerClip = (c: BakedClip) => clips.set(c.name, c);
/** Duración en segundos. */
export const clipDuration = (c: BakedClip) => (c.frames - 1) / c.fps;

const _qa = new THREE.Quaternion(), _qb = new THREE.Quaternion(), _va = new THREE.Vector3(), _vb = new THREE.Vector3();

/**
 * Pone el comando en la postura de la animación en el segundo `t` (con `loop`, se repite; si no, se queda en la última imagen).
 * `weight` < 1 mezcla con la postura que ya tenga (para pasar suavemente de una animación a otra); `moveHips` = false deja la cadera donde está.
 */
export function applyClip(rig: CommandoRig, c: BakedClip, t: number, loop = false, weight = 1, moveHips = true) {
  const dur = clipDuration(c);
  let ft = (loop ? ((t % dur) + dur) % dur : Math.min(Math.max(t, 0), dur)) * c.fps;
  const f0 = Math.min(Math.floor(ft), c.frames - 1), f1 = Math.min(f0 + 1, c.frames - 1);
  ft -= f0;
  const nb = c.bones.length;
  for (let i = 0; i < nb; i++) {
    const b = rig.bones[c.bones[i]];
    if (!b) continue;
    _qa.fromArray(c.q, (f0 * nb + i) * 4);
    _qb.fromArray(c.q, (f1 * nb + i) * 4);
    _qa.slerp(_qb, ft);
    if (weight >= 1) b.quaternion.copy(_qa); else b.quaternion.slerp(_qa, weight);
  }
  if (moveHips) {
    _va.fromArray(c.hp, f0 * 3).lerp(_vb.fromArray(c.hp, f1 * 3), ft);
    if (weight >= 1) rig.bones.hips.position.copy(_va); else rig.bones.hips.position.lerp(_va, weight);
  }
  rig.root.updateMatrixWorld(true);
}
