import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { createB1, poseB1, type B1Bones } from '../../enemies/B1Rig';
import { createB2, poseB2, type B2Bones } from '../../enemies/B2Rig';
import { createDroideka, poseDroideka, type DekaBones } from '../../enemies/DroidekaRig';
import { withDroidWear } from '../../enemies/droidWear';
import { DROID_SCALE } from '../../enemies/sizes';
import { withLightFloor } from '../lightFill';
import { makeRng } from '../terrain';
import { floorHeight } from './layout';

// ARENA — RESTOS DE LA BATALLA: droides destruidos con los mismos modelos del juego. Se colocan en posturas de caídos (brazos y piernas
// sueltos), a veces sin cabeza, sin piernas o sin un brazo (la pieza queda tirada al lado), y se «congelan» como piezas fijas: no se
// mueven ni cuestan como un droide vivo. Se usa la versión ligera de cada modelo. Van quemados y sucios.

type Kind = 'b1' | 'b2' | 'droideka';

/** Material de los droides (el mismo aspecto que en la partida: metal sutil, desgaste y polvo rojizo). */
function droidMaterial() {
  return withDroidWear(withLightFloor(new THREE.MeshPhongMaterial({ vertexColors: true, shininess: 22, specular: 0x2a2622 })));
}

interface Rig { mesh: THREE.SkinnedMesh; kind: Kind; lod: THREE.BufferGeometry; index: (b: THREE.Bone) => number }
let rigs: Record<Kind, Rig & { bones: B1Bones | B2Bones | DekaBones }> | null = null;
const mats: Partial<Record<Kind, THREE.MeshPhongMaterial>> = {};

function getRigs() {
  if (rigs) return rigs;
  const mk = <B>(kind: Kind, r: { mesh: THREE.SkinnedMesh; bones: B }, lods: THREE.BufferGeometry[] | undefined) => {
    const sk = r.mesh.skeleton;
    return { mesh: r.mesh, bones: r.bones, kind, lod: lods?.[1] ?? r.mesh.geometry, index: (b: THREE.Bone) => sk.bones.indexOf(b) };
  };
  mats.b1 = droidMaterial(); mats.b2 = droidMaterial(); mats.droideka = droidMaterial();
  const b1 = createB1(mats.b1), b2 = createB2(mats.b2), dk = createDroideka(mats.droideka);
  mats.b2.color.multiply(new THREE.Color(0.66, 0.76, 0.95)); // gris azulado, como en la partida
  rigs = {
    b1: mk('b1', b1, b1.bones.lods) as never,
    b2: mk('b2', b2, b2.bones.lods) as never,
    droideka: mk('droideka', dk, (dk.bones as DekaBones & { lods?: THREE.BufferGeometry[] }).lods) as never,
  };
  return rigs;
}

/** Hueso que más mueve cada vértice. */
function mainBone(si: THREE.BufferAttribute, sw: THREE.BufferAttribute, i: number) {
  let best = 0, bw = -1;
  for (let k = 0; k < 4; k++) { const w = sw.getComponent(i, k); if (w > bw) { bw = w; best = si.getComponent(i, k); } }
  return best;
}

/**
 * «Congela» la postura actual del modelo en una pieza fija. `keep`: qué huesos se quedan (los demás se quitan: cabeza arrancada, etc.).
 * Devuelve la pieza en el sistema del modelo (de pie, sin escalar).
 */
function bake(rig: Rig, keep: (bone: number) => boolean): THREE.BufferGeometry {
  const { mesh, lod } = rig;
  mesh.geometry = lod;
  mesh.position.set(0, 0, 0); mesh.rotation.set(0, 0, 0); mesh.scale.setScalar(1);
  mesh.updateMatrixWorld(true);
  const pos = lod.attributes.position, si = lod.attributes.skinIndex as THREE.BufferAttribute, sw = lod.attributes.skinWeight as THREE.BufferAttribute;
  const uv = lod.attributes.uv, col = lod.attributes.color, idx = lod.index;
  const P: number[] = [], U: number[] = [], C: number[] = [];
  const v = new THREE.Vector3();
  const n = idx ? idx.count : pos.count;
  for (let t = 0; t < n; t += 3) {
    const ids = [0, 1, 2].map((k) => (idx ? idx.getX(t + k) : t + k));
    if (!ids.every((i) => keep(mainBone(si, sw, i)))) continue;
    for (const i of ids) {
      mesh.getVertexPosition(i, v);
      P.push(v.x, v.y, v.z);
      if (uv) U.push(uv.getX(i), uv.getY(i));
      C.push(col ? col.getX(i) : 1, col ? col.getY(i) : 1, col ? col.getZ(i) : 1);
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(P, 3));
  if (uv) g.setAttribute('uv', new THREE.Float32BufferAttribute(U, 2));
  g.setAttribute('color', new THREE.Float32BufferAttribute(C, 3));
  g.computeVertexNormals();
  return g;
}

/** Coloca una pieza tumbada en el suelo: girada, a su tamaño real y apoyada (algo hundida en la arena). */
function lay(g: THREE.BufferGeometry, kind: Kind, x: number, z: number, yaw: number, tilt: THREE.Euler, lift = 0, sink = 0.06) {
  g.scale(DROID_SCALE[kind], DROID_SCALE[kind], DROID_SCALE[kind]);
  g.applyMatrix4(new THREE.Matrix4().makeRotationFromEuler(tilt));
  g.rotateY(yaw);
  g.computeBoundingBox();
  const bb = g.boundingBox!;
  g.translate(x, floorHeight(x, z) - bb.min.y - sink + lift, z);
  return g;
}

/** Quemado y suciedad: cada pieza más o menos chamuscada, con manchas negras. */
function scorch(g: THREE.BufferGeometry, rng: () => number, amount: number) {
  const c = g.attributes.color, p = g.attributes.position;
  const k = 0.55 + 0.35 * (1 - amount);
  const sx = p.getX(0) + (rng() - 0.5), sz = p.getZ(0) + (rng() - 0.5);
  for (let i = 0; i < c.count; i++) {
    const near = Math.exp(-((p.getX(i) - sx) ** 2 + (p.getZ(i) - sz) ** 2) / 0.6);
    const f = k * (1 - 0.7 * near * amount);
    c.setXYZ(i, c.getX(i) * f, c.getY(i) * f * 0.97, c.getZ(i) * f * 0.94);
  }
}

// ── Posturas de caído ───────────────────────────────────────────────────────

function poseFallenB1(b: B1Bones, rng: () => number) {
  poseB1(b, 1, 0, 0);
  const r = (a: number) => (rng() - 0.5) * 2 * a;
  b.armL.rotation.set(r(1.4), r(0.6), r(1.2));
  b.armR.rotation.set(r(1.4), r(0.6), r(1.2));
  b.forearmL.rotation.x = r(1.2); b.forearmR.rotation.x = r(1.2);
  b.thighL.rotation.set(r(0.7), 0, r(0.4)); b.thighR.rotation.set(r(0.7), 0, r(0.4));
  b.shinL.rotation.x = Math.abs(r(1.2)); b.shinR.rotation.x = Math.abs(r(1.2));
  b.neck.rotation.set(r(0.6), r(0.6), r(0.4));
  b.spine.rotation.x = r(0.4);
}

function poseFallenB2(b: B2Bones, rng: () => number) {
  poseB2(b, 0, 0);
  const r = (a: number) => (rng() - 0.5) * 2 * a;
  b.armL.rotation.set(r(1.0), r(0.4), r(0.9));
  b.armR.rotation.set(r(1.0), r(0.4), r(0.9));
  b.forearmL.rotation.x = r(1.0); b.forearmR.rotation.x = r(1.0);
  b.thighL.rotation.x = r(0.6); b.thighR.rotation.x = r(0.6);
  b.shinL.rotation.x = Math.abs(r(1.0)); b.shinR.rotation.x = Math.abs(r(1.0));
}

/** Tumbado boca arriba, boca abajo o de lado. */
const lyingTilt = (rng: () => number) => {
  const m = Math.floor(rng() * 3);
  const wob = (rng() - 0.5) * 0.25;
  return m === 0 ? new THREE.Euler(-Math.PI / 2 + wob, 0, wob) : m === 1 ? new THREE.Euler(Math.PI / 2 + wob, 0, wob) : new THREE.Euler(wob, 0, Math.PI / 2 + wob);
};

export interface WreckBuild { meshes: THREE.Mesh[]; triangles: number }

/**
 * Monta los restos: montones (`piles`), droides sueltos (`bodies`) y el droideka roto (`deka`).
 * Cada montón: dos o tres droides caídos uno encima de otro y alguna pieza suelta; en algunos hay un B2.
 */
export function buildWrecks(piles: Array<{ x: number; z: number; rot: number }>, bodies: Array<{ x: number; z: number; rot: number }>, deka: { x: number; z: number; rot: number } | null): WreckBuild {
  const R = getRigs();
  const rng = makeRng(6060);
  const out: Record<Kind, THREE.BufferGeometry[]> = { b1: [], b2: [], droideka: [] };
  const b1 = R.b1 as Rig & { bones: B1Bones }, b2 = R.b2 as Rig & { bones: B2Bones }, dk = R.droideka as Rig & { bones: DekaBones };
  const all = () => true;
  const without = (rig: Rig, bones: THREE.Bone[]) => { const set = new Set(bones.map((x) => rig.index(x))); return (i: number) => !set.has(i); };
  const only = (rig: Rig, bones: THREE.Bone[]) => { const set = new Set(bones.map((x) => rig.index(x))); return (i: number) => set.has(i); };
  const add = (kind: Kind, g: THREE.BufferGeometry, burn: number) => { scorch(g, rng, burn); out[kind].push(g); };
  const B = b1.bones;
  const headParts = [B.neck, B.head], legL = [B.thighL, B.shinL, B.footL], armR = [B.armR, B.forearmR, B.handR, B.gun];

  piles.forEach((p, i) => {
    const a = p.rot;
    // abajo: un droide tumbado
    poseFallenB1(B, rng);
    add('b1', lay(bake(b1, all), 'b1', p.x, p.z, a, lyingTilt(rng)), rng());
    // encima: otro (en dos montones, un B2), cruzado y algo levantado
    if (i % 4 === 1) {
      poseFallenB2(b2.bones, rng);
      add('b2', lay(bake(b2, all), 'b2', p.x + Math.cos(a) * 0.5, p.z - Math.sin(a) * 0.5, a + 1.4, lyingTilt(rng), 0.32), 0.25 * rng());
    } else {
      poseFallenB1(B, rng);
      add('b1', lay(bake(b1, without(b1, [...legL, B.thighR, B.shinR, B.footR])), 'b1', p.x + Math.cos(a) * 0.4, p.z - Math.sin(a) * 0.4, a + 1.2 + rng(), lyingTilt(rng), 0.3), rng());
    }
    // y una pieza suelta al lado: una cabeza, una pierna o un brazo con el fusil
    poseFallenB1(B, rng);
    const part = [headParts, legL, armR][i % 3];
    const ox = Math.cos(a + 2.2) * 1.6, oz = Math.sin(a + 2.2) * 1.6;
    add('b1', lay(bake(b1, only(b1, part)), 'b1', p.x + ox, p.z + oz, rng() * 6.28, lyingTilt(rng)), rng());
  });

  bodies.forEach((p, i) => {
    poseFallenB1(B, rng);
    // unos enteros y otros rotos: sin cabeza (tirada cerca) o partidos
    const broken = i % 3;
    const keep = broken === 0 ? all : broken === 1 ? without(b1, headParts) : without(b1, legL);
    add('b1', lay(bake(b1, keep), 'b1', p.x, p.z, p.rot, lyingTilt(rng)), rng());
    if (broken === 1) add('b1', lay(bake(b1, only(b1, headParts)), 'b1', p.x + 1.3, p.z - 0.6, rng() * 6.28, lyingTilt(rng)), rng());
  });

  if (deka) {
    // droideka roto: medio plegado, volcado de lado y hundido en la arena, sin un brazo (que queda tirado al lado)
    poseDroideka(dk.bones, 0.6, 0.3, 0);
    const tilt = new THREE.Euler(0.35, 0, 1.15);
    add('droideka', lay(bake(dk, without(dk, [dk.bones.armL])), 'droideka', deka.x, deka.z, deka.rot, tilt, 0, 0.22), 0.8);
    add('droideka', lay(bake(dk, only(dk, [dk.bones.armL])), 'droideka', deka.x - 1.6, deka.z + 0.9, deka.rot + 2, new THREE.Euler(1.4, 0, 0.3)), 0.6);
  }

  const meshes: THREE.Mesh[] = [];
  let triangles = 0;
  for (const kind of ['b1', 'b2', 'droideka'] as Kind[]) {
    if (!out[kind].length) continue;
    const g = mergeGeometries(out[kind]);
    const m = new THREE.Mesh(g, mats[kind]!);
    m.name = 'restos-' + kind;
    meshes.push(m);
    triangles += g.attributes.position.count / 3;
  }
  return { meshes, triangles };
}
