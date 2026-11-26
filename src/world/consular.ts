import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { Builder, place } from './builder';
import { boulderGeometry } from './rocks';
import { SoftPoints, SPRITES } from './crashFx';
import { CRUISER, CRUISER_ENGINE, CRUISER_FURROW, cruiserFurrowX, cruiserFurrowZ, makeRng, terrainHeight } from './terrain';
import { cruiserSiteOn } from './materials';
import type { Quality } from '../core/Settings';

// Crucero consular de la República estrellado al fondo norte del valle (donde estaba la imitación de la Lucrehulk, pasada la grieta). Solo para mirar: no tiene cuerpo sólido.
// Modelo real: «Consular cruiser» de Cpt.Kirk (CC-BY 4.0), aligerado con tools/convert-ship.mjs → public/models/consular.glb.
//  · Postura (morro hundido, inclinada, tumbada) y huella en el suelo (surco, arena amontonada): CRUISER en terrain.ts.
//  · Un motor se ha desprendido y está tirado en el surco (CRUISER_ENGINE). Lo enterrado no se dibuja.
//  · El casco lleva por encima (en el dibujo, sin tocar el modelo): pintura apagada, polvo ocre, manchas de quemado y brechas negras
//    con el borde al rojo. Se ve a través de la neblina (como una silueta pálida), igual que su surco, restos y rocas.
//  · Humo negro de los motores y de las brechas, fuegos pequeños, chispas y polvo en la base: CruiserFx.

let model: THREE.Object3D | null = null;
/** Descarga el modelo del crucero. Si falla, no se pone (el surco y la arena sí). */
export async function loadConsular(base: string) {
  try {
    model = (await new GLTFLoader().loadAsync(`${base}models/consular.glb`)).scene;
  } catch (e) {
    console.warn('No se pudo cargar el crucero consular.', e);
    model = null;
  }
}

/**
 * Vista de revisión (pedida por Víctor): desde el borde norte de la zona de juego, a la altura de los ojos, mirando al crucero
 * (la equivalente a su captura del sur). Posición [x, altura sobre el suelo, z] y hacia dónde mira (grados: 0 = norte, + = hacia el oeste).
 */
export const CRUISER_REVIEW_VIEW = { pos: [20, 1.7, -93] as [number, number, number], rumbo: -1, inclina: 2 };

/** Neblina máxima sobre el crucero (0 a 1): así se ve siempre, como una silueta pálida al fondo. */
export const CRUISER_FOG_CAP = 0.5;

/** Puntos de fuego (los destellos los dibuja Atmosphere). */
export const CRUISER_FIRES: Array<{ x: number; y: number; z: number; size: number }> = [];
/** Dónde sale humo, arde fuego, saltan chispas y se levanta polvo (se rellena al montar el escenario). */
const FX = {
  smoke: [] as Array<{ p: THREE.Vector3; rate: number; size: number }>,
  flames: [] as Array<{ p: THREE.Vector3; size: number }>,
  sparks: [] as Array<{ p: THREE.Vector3; every: [number, number] }>,
  dust: [] as Array<{ p: THREE.Vector3; size: number }>,
};

// ---------- Medidas del modelo (m, proa hacia +z) ----------
/** Motor izquierdo (el que se desprende): todo lo que cae en esta caja. */
const ENGINE_BOX = new THREE.Box3(new THREE.Vector3(-45, -12, -60), new THREE.Vector3(-23, 12, -33));
const ENGINE_CENTER = new THREE.Vector3(-32.6, -0.5, -46);
const ENGINE_R = 9.3;
/** Brechas del casco (en el sistema de la nave): centro y radio. La última se coloca en el motor caído. */
const HOLES_SHIP: Array<[number, number, number, number]> = [
  [1.5, 6.0, 12, 3.6], // cubierta, en medio del casco
  [-2.5, 5.0, 31, 3.0], // cubierta, hacia el morro
  [-22, 0.5, -45, 5.5], // donde estaba el motor arrancado
  [9, 4.5, -24, 3.2], // cubierta, hacia los motores
];
const HOLE_ENGINE: [number, number, number, number] = [9.5, 2, 2, 5]; // en el motor caído (sistema del motor, centrado), por donde se partió

// ---------- Dibujo del casco: pintura apagada, polvo, quemado y brechas ----------
const holeUniform = { value: [0, 1, 2, 3, 4].map(() => new THREE.Vector4(0, -1000, 0, 1)) };
const timeUniform = { value: 0 };
const groundUniform = { value: 0 };

function hullMaterial(src: THREE.MeshStandardMaterial): THREE.MeshLambertMaterial {
  const m = new THREE.MeshLambertMaterial({ map: src.map ?? null, color: src.color.clone(), side: THREE.DoubleSide, emissive: 0x2a2219 });
  m.onBeforeCompile = (sh) => {
    sh.uniforms.uCrHole = holeUniform;
    sh.uniforms.uCrTime = timeUniform;
    sh.uniforms.uCrGround = groundUniform;
    sh.vertexShader = sh.vertexShader
      .replace('#include <common>', '#include <common>\nvarying vec3 vCrW;\nvarying vec3 vCrN;')
      .replace('#include <begin_vertex>', '#include <begin_vertex>\nvCrW = (modelMatrix * vec4(transformed, 1.0)).xyz;\nvCrN = normalize(mat3(modelMatrix) * objectNormal);');
    sh.fragmentShader = sh.fragmentShader
      .replace('#include <common>', `#include <common>
varying vec3 vCrW;
varying vec3 vCrN;
uniform vec4 uCrHole[5];
uniform float uCrTime;
uniform float uCrGround;
float crHash(vec3 p) { p = fract(p * 0.3183099 + 0.1); p *= 17.0; return fract(p.x * p.y * p.z * (p.x + p.y + p.z)); }
float crNoise(vec3 x) {
  vec3 i = floor(x), f = fract(x); f = f * f * (3.0 - 2.0 * f);
  return mix(mix(mix(crHash(i), crHash(i + vec3(1, 0, 0)), f.x), mix(crHash(i + vec3(0, 1, 0)), crHash(i + vec3(1, 1, 0)), f.x), f.y),
             mix(mix(crHash(i + vec3(0, 0, 1)), crHash(i + vec3(1, 0, 1)), f.x), mix(crHash(i + vec3(0, 1, 1)), crHash(i + vec3(1, 1, 1)), f.x), f.y), f.z);
}`)
      .replace('#include <map_fragment>', `#include <map_fragment>
float crRim = 0.0, crHoleV = 0.0;
{
  vec3 n = normalize(vCrN);
  // pintura apagada: menos color y algo más oscura y cálida
  float lum = dot(diffuseColor.rgb, vec3(0.299, 0.587, 0.114));
  diffuseColor.rgb = mix(vec3(lum), diffuseColor.rgb, 0.78) * vec3(0.92, 0.85, 0.78);
  // polvo ocre: más en lo que mira hacia arriba y en lo que está cerca del suelo
  float n1 = crNoise(vCrW * 0.21), n2 = crNoise(vCrW * 0.06 + 7.0);
  float dust = 0.12 + 0.3 * smoothstep(0.35, 0.95, n.y) + 0.35 * (n1 - 0.5) + 0.25 * (n2 - 0.5);
  dust = max(dust, 0.7 * (1.0 - smoothstep(uCrGround + 1.0, uCrGround + 7.0, vCrW.y)));
  diffuseColor.rgb = mix(diffuseColor.rgb, vec3(0.62, 0.46, 0.32), clamp(dust, 0.0, 0.6));
  // manchas de quemado
  float s = n2 * 0.6 + crNoise(vCrW * 0.17 + 3.0) * 0.4;
  float soot = smoothstep(0.6, 0.76, s) * 0.75;
  // brechas: negras por dentro, con el borde al rojo y quemado alrededor
  for (int i = 0; i < 5; i++) {
    float d = length(vCrW - uCrHole[i].xyz) / uCrHole[i].w + 0.22 * (n1 - 0.5);
    crHoleV = max(crHoleV, 1.0 - smoothstep(0.78, 0.88, d));
    crRim = max(crRim, smoothstep(0.72, 0.86, d) * (1.0 - smoothstep(0.9, 1.15, d)));
    soot = max(soot, 1.0 - smoothstep(0.95, 2.4, d));
  }
  diffuseColor.rgb = mix(diffuseColor.rgb, vec3(0.06, 0.05, 0.045), soot);
  diffuseColor.rgb = mix(diffuseColor.rgb, vec3(0.012, 0.01, 0.009), crHoleV);
}`)
      .replace('#include <emissivemap_fragment>', `#include <emissivemap_fragment>
totalEmissiveRadiance *= 1.0 - crHoleV;
totalEmissiveRadiance += vec3(0.85, 0.26, 0.05) * crRim * (0.7 + 0.3 * sin(uCrTime * 6.0 + vCrW.x * 0.7));`)
      .replace('#include <fog_fragment>', `#ifdef USE_FOG
  float crF = smoothstep(fogNear, fogFar, vFogDepth);
  gl_FragColor.rgb = mix(gl_FragColor.rgb, fogColor, min(crF, ${CRUISER_FOG_CAP.toFixed(2)}));
#endif`);
  };
  m.customProgramCacheKey = () => 'cruiser' + (src.map ? 'm' : '');
  return m;
}

/** Copia la geometría de una pieza en coordenadas del modelo y la reparte: lo que cae en la caja del motor va aparte. */
function splitPiece(mesh: THREE.Mesh): { hull: THREE.BufferGeometry | null; engine: THREE.BufferGeometry | null } {
  const g = mesh.geometry.clone();
  mesh.updateWorldMatrix(true, false);
  g.applyMatrix4(mesh.matrixWorld);
  const idx = g.index!.array, p = g.attributes.position;
  const a: number[] = [], b: number[] = [];
  const c = new THREE.Vector3();
  for (let t = 0; t < idx.length; t += 3) {
    c.set(0, 0, 0);
    for (let k = 0; k < 3; k++) c.add(new THREE.Vector3(p.getX(idx[t + k]), p.getY(idx[t + k]), p.getZ(idx[t + k])));
    c.multiplyScalar(1 / 3);
    (ENGINE_BOX.containsPoint(c) ? b : a).push(idx[t], idx[t + 1], idx[t + 2]);
  }
  const make = (list: number[]) => { if (!list.length) return null; const o = g.clone(); o.setIndex(list); return o; };
  return { hull: make(a), engine: make(b) };
}

/** Pasa la geometría al mundo con la matriz y quita los triángulos enterrados del todo (nunca se ven). */
function placeAndCull(g: THREE.BufferGeometry, m: THREE.Matrix4): THREE.BufferGeometry | null {
  g.applyMatrix4(m);
  const idx = g.index!.array, p = g.attributes.position;
  const keep: number[] = [];
  const below = (i: number) => p.getY(i) < terrainHeight(p.getX(i), p.getZ(i)) - 0.5;
  for (let t = 0; t < idx.length; t += 3) if (!(below(idx[t]) && below(idx[t + 1]) && below(idx[t + 2]))) keep.push(idx[t], idx[t + 1], idx[t + 2]);
  if (!keep.length) return null;
  g.setIndex(keep);
  g.computeBoundingSphere();
  return g;
}

/** Matriz que coloca la nave: girada, inclinada, tumbada y con la punta del morro hundida `entierro` m. */
export function cruiserMatrix(): THREE.Matrix4 {
  const q = new THREE.Quaternion().setFromEuler(new THREE.Euler(CRUISER.pitch, CRUISER.yaw, CRUISER.roll, 'YXZ'));
  const m = new THREE.Matrix4().compose(new THREE.Vector3(CRUISER.x, 0, CRUISER.z), q, new THREE.Vector3(1, 1, 1));
  const nose = new THREE.Vector3(0, -5, 55).applyMatrix4(m); // panza junto a la punta del morro
  const y = terrainHeight(nose.x, nose.z) - nose.y - CRUISER.entierro;
  m.compose(new THREE.Vector3(CRUISER.x, y, CRUISER.z), q, new THREE.Vector3(1, 1, 1));
  return m;
}

/** Matriz del motor caído (su geometría va centrada en su eje). */
function engineMatrix(): THREE.Matrix4 {
  const E = CRUISER_ENGINE;
  const x = cruiserFurrowX(E.s) + E.dx, z = cruiserFurrowZ(E.s);
  const y = terrainHeight(x, z) + ENGINE_R - E.hunde;
  return new THREE.Matrix4().compose(new THREE.Vector3(x, y, z), new THREE.Quaternion().setFromEuler(new THREE.Euler(0.12, E.yaw, E.roll, 'YXZ')), new THREE.Vector3(1, 1, 1));
}

/**
 * Monta el crucero (si cargó), su motor caído, los restos y rocas del surco y los puntos de humo y fuego.
 * Los restos y rocas van con el resto del escenario (`b`). Devuelve si se puso la nave.
 */
export function buildCruiserSite(scene: THREE.Scene, b: Builder): boolean {
  CRUISER_FIRES.length = 0;
  FX.smoke.length = FX.flames.length = FX.sparks.length = FX.dust.length = 0;
  cruiserSiteOn.value = 1;
  buildFurrowDebris(b);
  if (!model) return false;

  const M = cruiserMatrix();
  const EM = engineMatrix();
  const toEngine = new THREE.Matrix4().makeTranslation(-ENGINE_CENTER.x, -ENGINE_CENTER.y, -ENGINE_CENTER.z);
  const shipW = (x: number, y: number, z: number) => new THREE.Vector3(x, y, z).applyMatrix4(M);
  const engW = (x: number, y: number, z: number) => new THREE.Vector3(x, y, z).applyMatrix4(EM);
  groundUniform.value = terrainHeight(CRUISER.x, CRUISER.z);

  // brechas en el mundo
  HOLES_SHIP.forEach(([x, y, z, r], i) => { const w = shipW(x, y, z); holeUniform.value[i].set(w.x, w.y, w.z, r); });
  { const [x, y, z, r] = HOLE_ENGINE; const w = engW(x, y, z); holeUniform.value[4].set(w.x, w.y, w.z, r); }

  const group = new THREE.Group();
  group.name = 'crucero';
  const mats = new Map<THREE.Material, THREE.MeshLambertMaterial>();
  model.updateMatrixWorld(true);
  model.traverse((o) => {
    const mesh = o as THREE.Mesh;
    if (!mesh.isMesh) return;
    const src = mesh.material as THREE.MeshStandardMaterial;
    if (!mats.has(src)) mats.set(src, hullMaterial(src));
    const mat = mats.get(src)!;
    const { hull, engine } = splitPiece(mesh);
    for (const [geo, mtx] of [[hull, M], [engine, engine ? EM.clone().multiply(toEngine) : null]] as const) {
      if (!geo || !mtx) continue;
      const placed = placeAndCull(geo, mtx);
      if (!placed) continue;
      const part = new THREE.Mesh(placed, mat);
      part.renderOrder = 1;
      group.add(part);
    }
  });
  scene.add(group);

  // humo negro: los dos motores que quedan, la brecha de arriba y el motor caído
  for (const [x, y, z] of [[32.6, 2, -56], [0, 2, -56]] as const) FX.smoke.push({ p: shipW(x, y, z), rate: 2.0, size: 8 });
  FX.smoke.push({ p: shipW(HOLES_SHIP[0][0], HOLES_SHIP[0][1] + 1, HOLES_SHIP[0][2]), rate: 2.2, size: 9 });
  FX.smoke.push({ p: shipW(-22, 2, -45), rate: 1.6, size: 8 });
  FX.smoke.push({ p: engW(HOLE_ENGINE[0], HOLE_ENGINE[1] + 2, HOLE_ENGINE[2]), rate: 1.0, size: 6 });
  // fuegos pequeños en las brechas y en las toberas
  for (const [x, y, z, r] of HOLES_SHIP) FX.flames.push({ p: shipW(x, y + 0.5, z), size: r * 1.6 });
  FX.flames.push({ p: shipW(32.6, 0, -57), size: 5 }, { p: engW(HOLE_ENGINE[0], HOLE_ENGINE[1], HOLE_ENGINE[2]), size: 5 });
  // chispas: en las brechas de los motores
  FX.sparks.push({ p: shipW(-22, 1, -45), every: [1.2, 3] }, { p: shipW(9, 5, -24), every: [2, 4.5] }, { p: engW(HOLE_ENGINE[0], HOLE_ENGINE[1], HOLE_ENGINE[2]), every: [1.8, 4] });
  // polvo en la base: alrededor del morro hundido y a lo largo del casco
  for (const z of [56, 40, 20, 0, -25]) { const w = shipW(0, -6, z); w.y = terrainHeight(w.x, w.z) + 1; FX.dust.push({ p: w, size: 12 }); }
  { const w = engW(0, 0, 0); w.y = terrainHeight(w.x, w.z) + 1; FX.dust.push({ p: w, size: 10 }); }
  // destellos de fuego (Atmosphere)
  for (const f of FX.flames) CRUISER_FIRES.push({ x: f.p.x, y: f.p.y + 0.6, z: f.p.z, size: f.size * 1.1 });
  return true;
}

/** Restos de metal a lo largo del surco y rocas apartadas a los lados (con el resto del escenario: un solo objeto). */
function buildFurrowDebris(b: Builder) {
  const rng = makeRng(4404);
  const range = (a: number, c: number) => a + rng() * (c - a);
  const W = CRUISER_FURROW.ancho;
  const WHITE = 0xa39b8f, RED = 0x6e3a30, GREY = 0x67625c, DARK = 0x2a2725; // con polvo encima
  b.cruiserPieces = true;
  // restos: chapas del casco (casi planas y medio enterradas, con polvo), bloques y tubos; más cerca de la nave
  for (let i = 0; i < 40; i++) {
    const s = CRUISER_FURROW.largo * 0.9 * Math.pow(range(0.03, 1), 1.4);
    const x = cruiserFurrowX(s) + range(-1.4, 1.4) * W, z = cruiserFurrowZ(s);
    const y = terrainHeight(x, z);
    const k = rng();
    if (k < 0.62) {
      const c = k < 0.3 ? WHITE : k < 0.42 ? RED : DARK;
      const w = range(1.5, 5.5), d = range(1.2, 3.5);
      b.addDecor(new THREE.BoxGeometry(w, range(0.15, 0.3), d), place(x, y + 0.02, z, range(0, 6.3), range(-0.22, 0.22), range(-0.22, 0.22)), c, range(0.65, 0.9));
    } else if (k < 0.85) {
      const sz = range(1, 2.6);
      b.addDecor(new THREE.BoxGeometry(sz, sz * range(0.4, 0.8), sz * range(0.7, 1.5)), place(x, y + sz * 0.1, z, range(0, 6.3), range(-0.4, 0.4), range(-0.3, 0.3)), rng() < 0.5 ? GREY : WHITE, range(0.55, 0.85));
    } else {
      b.addDecor(new THREE.CylinderGeometry(0.3, 0.3, range(3, 8), 6), place(x, y + 0.25, z, range(0, 6.3), 0, Math.PI / 2 + range(-0.15, 0.15)), DARK, 1);
    }
  }
  // rocas empujadas a los lados del surco, sobre los bordes de tierra
  for (let i = 0; i < 20; i++) {
    const s = range(4, CRUISER_FURROW.largo * 0.85);
    const side = rng() < 0.5 ? -1 : 1;
    const x = cruiserFurrowX(s) + side * (W * 1.3 + range(0, 7)), z = cruiserFurrowZ(s);
    const sc = range(1.2, 3.6) * (1 - 0.4 * (s / CRUISER_FURROW.largo));
    const y = terrainHeight(x, z) + sc * 0.25;
    b.addDecor(boulderGeometry(100 + i, 1), place(x, y, z, range(0, 6.3), range(-0.3, 0.3), range(-0.3, 0.3), new THREE.Vector3(sc * range(1, 1.5), sc * range(0.6, 0.9), sc)), rng() < 0.5 ? 0x8a4a30 : 0x6a4b3c, range(0.8, 1), 1);
  }
  b.cruiserPieces = false;
}

// ---------- Humo, fuego, chispas y polvo ----------
const rnd = (a: number, b: number) => a + Math.random() * (b - a);
const FX_SCALE: Record<Quality, number> = { low: 0.5, medium: 0.75, high: 1, ultra: 1 };

export class CruiserFx {
  private smoke: SoftPoints;
  private flames: SoftPoints;
  private sparks: SoftPoints;
  private dust: SoftPoints;
  private smokeAcc = FX.smoke.map(() => Math.random());
  private flameAcc = FX.flames.map(() => Math.random());
  private dustAcc = FX.dust.map(() => Math.random());
  private sparkT = FX.sparks.map((s) => rnd(...s.every));
  private k = 1;
  private sparksOn = true;
  private t = 0;

  constructor(scene: THREE.Scene) {
    // columnas de humo negro: suben despacio durante más de 20 s, se ensanchan, se aclaran y se inclinan con el viento (del oeste al este)
    this.smoke = new SoftPoints(scene, { n: 260, additive: false, gravity: 0, drag: 0.05, wind: [0.12, 0.12, 0.03], colorA: [0.045, 0.04, 0.037], colorB: [0.36, 0.3, 0.25], alpha: 0.62, sprites: SPRITES.smoke, spin: 0.08 });
    this.flames = new SoftPoints(scene, { n: 70, additive: true, gravity: -3, drag: 1, wind: [0.6, 0, 0], colorA: [1, 0.95, 0.75], colorB: [0.95, 0.5, 0.15], alpha: 0.9, sprites: SPRITES.fire, tilt: 0.3, spin: 0.3 });
    this.sparks = new SoftPoints(scene, { n: 50, additive: true, gravity: 9, drag: 0.4, wind: [0, 0, 0], colorA: [1, 0.96, 0.78], colorB: [0.95, 0.45, 0.1], alpha: 1, sprites: SPRITES.sparks, spin: 3 });
    this.dust = new SoftPoints(scene, { n: 45, additive: false, gravity: -0.1, drag: 0.4, wind: [0.9, 0.05, 0.15], colorA: [0.66, 0.5, 0.36], colorB: [0.72, 0.58, 0.44], alpha: 0.3, sprites: SPRITES.dust, spin: 0.15 });
    // el humo ya está formado al empezar (si no, tardaría más de 20 s en subir)
    for (let t = 0; t < 26; t += 0.25) this.tickSmoke(0.25);
  }

  setQuality(q: Quality) { this.k = FX_SCALE[q]; this.sparksOn = q !== 'low'; }

  private tickSmoke(dt: number) {
    FX.smoke.forEach((s, i) => {
      this.smokeAcc[i] += s.rate * this.k * dt;
      while (this.smokeAcc[i] >= 1) {
        this.smokeAcc[i] -= 1;
        this.smoke.emit(s.p.x + rnd(-1, 1), s.p.y + rnd(0, 1), s.p.z + rnd(-1, 1), rnd(-0.5, 0.5), rnd(3.6, 5.0), rnd(-0.5, 0.5), rnd(22, 28), s.size, s.size * rnd(6, 8));
      }
    });
    this.smoke.update(dt);
  }

  tick(dt: number) {
    if (dt <= 0) return;
    dt = Math.min(dt, 0.1);
    this.t += dt;
    timeUniform.value = this.t;
    this.tickSmoke(dt);
    FX.flames.forEach((f, i) => {
      this.flameAcc[i] += 9 * this.k * dt;
      while (this.flameAcc[i] >= 1) {
        this.flameAcc[i] -= 1;
        this.flames.emit(f.p.x + rnd(-0.25, 0.25) * f.size, f.p.y, f.p.z + rnd(-0.25, 0.25) * f.size, rnd(-0.3, 0.3), rnd(1.5, 2.6), rnd(-0.3, 0.3), rnd(0.6, 1.0), f.size * 0.45, f.size * 0.1);
      }
    });
    if (this.sparksOn) FX.sparks.forEach((s, i) => {
      this.sparkT[i] -= dt;
      if (this.sparkT[i] > 0) return;
      this.sparkT[i] = rnd(...s.every);
      for (let k = 0; k < 10; k++) {
        const a = Math.random() * Math.PI * 2, v = rnd(3, 9);
        this.sparks.emit(s.p.x, s.p.y, s.p.z, Math.cos(a) * v, rnd(3, 8), Math.sin(a) * v, rnd(0.6, 1.2), 1.1, 0.3);
      }
    });
    FX.dust.forEach((d, i) => {
      this.dustAcc[i] += 0.45 * this.k * dt;
      while (this.dustAcc[i] >= 1) {
        this.dustAcc[i] -= 1;
        this.dust.emit(d.p.x + rnd(-6, 6), d.p.y + rnd(0, 1), d.p.z + rnd(-6, 6), rnd(-0.2, 0.4), rnd(0.2, 0.5), rnd(-0.3, 0.3), rnd(8, 12), d.size * 0.6, d.size * rnd(1.8, 2.4));
      }
    });
    this.flames.update(dt);
    this.sparks.update(dt);
    this.dust.update(dt);
  }
}
