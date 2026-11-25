import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { laatData } from '../world/laat';
import { withLightFloor } from '../world/lightFill';
import { createB1, poseB1, type B1Bones } from '../enemies/B1Rig';
import { withDroidWear } from '../enemies/droidWear';
import { terrainHeight } from '../world/terrain';
import { createCommandoRig, createTrooperRig, reach, turnWorld, aimBone, trooperModelReady, type CommandoRig, type TrooperModel } from '../player/commandoModel';
import { blasterModelData } from '../weapons/ViewModel';

// «Actores» de la cinemática: solo se ven durante ella y no son parte de la partida (no chocan, no disparan, no piensan).
//  - La cañonera LAAT en vuelo (el mismo modelo que la estrellada, pero entera y limpia).
//  - Las piernas de dos clones junto a la puerta abierta de la cañonera.
//  - El clon comando protagonista (PROVISIONAL, hecho con formas sencillas hasta tener su modelo).
//  - Unos droides B1 que avanzan entre la neblina.

const lambert = (color: number, extra: THREE.MeshLambertMaterialParameters = {}) => withLightFloor(new THREE.MeshLambertMaterial({ color, ...extra }));

/** Un solo material para todas las figuras hechas con formas: el color va en cada vértice. */
const BAKED = withLightFloor(new THREE.MeshLambertMaterial({ vertexColors: true }));

/**
 * Junta las piezas sueltas de cada articulación en una sola malla con el color en los vértices (las articulaciones siguen moviéndose).
 * Así una figura de 40 piezas se dibuja con una docena de llamadas en vez de 40 (y la mitad con sombras): importante para los 60 FPS.
 */
function bake(root: THREE.Object3D, shadow = false) {
  const nodes: THREE.Object3D[] = [];
  root.traverse((o) => { if (!(o as THREE.Mesh).isMesh) nodes.push(o); });
  for (const node of nodes) {
    const meshes = node.children.filter((c) => (c as THREE.Mesh).isMesh) as THREE.Mesh[];
    if (!meshes.length) continue;
    const geos = meshes.map((m) => {
      m.updateMatrix();
      const g = m.geometry.index ? m.geometry.toNonIndexed() : m.geometry.clone();
      g.applyMatrix4(m.matrix);
      for (const k of Object.keys(g.attributes)) if (k !== 'position' && k !== 'normal') g.deleteAttribute(k);
      const mat = m.material as THREE.MeshLambertMaterial;
      const c = mat.color.clone().add(mat.emissive ?? new THREE.Color(0));
      const n = g.attributes.position.count, arr = new Float32Array(n * 3);
      for (let i = 0; i < n; i++) arr.set([c.r, c.g, c.b], i * 3);
      g.setAttribute('color', new THREE.BufferAttribute(arr, 3));
      return g;
    });
    const merged = new THREE.Mesh(mergeGeometries(geos, false)!, BAKED);
    for (const g of geos) g.dispose();
    merged.castShadow = shadow;
    merged.frustumCulled = false;
    for (const m of meshes) node.remove(m);
    node.add(merged);
  }
}

// ---------- Cañonera LAAT en vuelo ----------
// Marco del modelo: +X = morro, +Y = arriba, ±Z = lados. La bahía de tropas va de x = −2,8 a 4,3 y su suelo está hacia y = −2,6.
// La puerta lateral que usa la cinemática es la del lado −Z.
// Medidas de la LAAT real: 17,69 m de largo, 6,1–6,94 m de alto, 17–28,8 m de envergadura. El modelo mide 15,84 × 6,2 × 17,4 m:
// ampliado por igual (sin deformarlo) hasta los 17,69 m de largo queda en 6,93 m de alto y 19,4 m de envergadura.
export const FLY_SCALE = 17.69 / 15.84;

/**
 * Abertura lateral de la bahía de tropas (la puerta abierta), a los dos lados: un rectángulo exacto justo detrás de la torreta de bola
 * y de la ventanita en arco, hasta donde empieza la parte trasera inclinada (medido sobre la foto de referencia).
 * El modelo no se toca: al dibujar el casco, lo que cae dentro del rectángulo en las paredes laterales no se pinta, así los bordes salen rectos.
 * Medidas del modelo sin ampliar (para pasar a metros reales, ×1,117): x hacia el morro, y hacia arriba; `lado` = distancia mínima al centro de la nave.
 */
export const APERTURA = { x0: 0.02, x1: 2.53, y0: -2.94, y1: -0.08, lado: 0.35 };

/** Material del casco con la abertura rectangular recortada (solo en las paredes que miran a un lado, no en techo ni suelo). */
function withOpening<T extends THREE.Material>(mat: T): T {
  const prev = mat.onBeforeCompile, prevKey = mat.customProgramCacheKey;
  const A = APERTURA;
  mat.onBeforeCompile = (sh, r) => {
    prev.call(mat, sh, r);
    sh.uniforms.uOpen = { value: new THREE.Vector4(A.x0, A.x1, A.y0, A.y1) };
    sh.uniforms.uSide = { value: A.lado };
    sh.vertexShader = sh.vertexShader
      .replace('#include <common>', '#include <common>\nvarying vec3 vOpP;\nvarying vec3 vOpN;')
      .replace('#include <begin_vertex>', '#include <begin_vertex>\nvOpP = position;\nvOpN = normal;');
    sh.fragmentShader = sh.fragmentShader
      .replace('#include <common>', '#include <common>\nvarying vec3 vOpP;\nvarying vec3 vOpN;\nuniform vec4 uOpen;\nuniform float uSide;')
      .replace('void main() {', `void main() {
  if (vOpP.x > uOpen.x && vOpP.x < uOpen.y && vOpP.y > uOpen.z && vOpP.y < uOpen.w && abs(vOpP.z) > uSide && abs(normalize(vOpN).z) > 0.45) discard;`);
  };
  mat.customProgramCacheKey = () => prevKey.call(mat) + '+open';
  return mat;
}

export function buildFlyingLaat(): THREE.Group {
  const g = new THREE.Group(); // marco de la nave en metros reales (la cámara y los clones se colocan aquí)
  const hull = new THREE.Group(); // el modelo, ampliado a su tamaño real
  hull.scale.setScalar(FLY_SCALE);
  g.add(hull);
  const d = laatData();
  if (d) {
    const mats = d.textures.map((t) => lambert(0xffffff, { map: t, side: THREE.DoubleSide }));
    const hullMats = d.textures.map((t) => withOpening(lambert(0xffffff, { map: t, side: THREE.DoubleSide }))); // casco y marcos, con la abertura
    // el ala que el escenario corta para tirarla al suelo vuelve a su sitio: en el modelo ya está en su posición original
    for (const n of ['casco', 'ala', 'cabina', 'bahia', 'marco']) {
      const p = d.parts[n];
      if (!p) continue;
      const m = new THREE.Mesh(p.geo, (n === 'casco' || n === 'marco' ? hullMats : mats)[p.material]);
      m.name = n;
      m.frustumCulled = false; // la cámara va dentro: que no desaparezca ninguna pieza por estar «detrás»
      hull.add(m);
    }
  } else {
    // Respaldo si el modelo no cargó: un casco de cajas con los colores de la República
    const white = lambert(0xcfc7b6), red = lambert(0x8e2a22), dark = lambert(0x2d2a27, { side: THREE.DoubleSide });
    const box = (w: number, h: number, dd: number, x: number, y: number, z: number, m: THREE.Material) => {
      const mesh = new THREE.Mesh(new THREE.BoxGeometry(w, h, dd), m);
      mesh.position.set(x, y, z);
      hull.add(mesh);
    };
    box(14, 0.2, 3.2, 0, -3, 0, white); // panza
    box(14, 0.2, 3.2, 0, 0.2, 0, white); // techo de la bahía
    box(14, 3.2, 0.15, 0, -1.4, 1.6, dark); // pared del otro lado (la del lado −Z está abierta)
    box(4, 2, 3.4, 6.5, -1.6, 0, white); // morro
    box(3, 1, 0.3, 0, 0.6, -1.6, red);
    box(0.8, 0.6, 16, -2, 1.2, 0, white); // alas
  }
  return g;
}

// ---------- Piernas de dos clones (armadura blanca de fase I) ----------
/** Dos clones de pie junto a la puerta, agarrados al techo: solo se modela de la cintura para abajo. Devuelve también una función para balancearlos. */
export function buildCloneLegs(height: number, gap: number) {
  const white = lambert(0xe4e0d6), black = lambert(0x1f1f22), grey = lambert(0x8d8a84);
  const g = new THREE.Group();
  const clones: THREE.Group[] = [];
  const leg = (side: number) => {
    const l = new THREE.Group();
    l.position.set(0, 0.95, side * 0.12);
    const thigh = new THREE.Mesh(new THREE.CylinderGeometry(0.085, 0.075, 0.42, 10), white);
    thigh.position.y = -0.22;
    const knee = new THREE.Mesh(new THREE.SphereGeometry(0.07, 10, 8), black);
    knee.position.y = -0.46;
    const shin = new THREE.Mesh(new THREE.CylinderGeometry(0.075, 0.06, 0.4, 10), white);
    shin.position.y = -0.68;
    const boot = new THREE.Mesh(new THREE.BoxGeometry(0.26, 0.1, 0.12), white);
    boot.position.set(0.05, -0.9, 0);
    const sole = new THREE.Mesh(new THREE.BoxGeometry(0.27, 0.03, 0.13), black);
    sole.position.set(0.05, -0.94, 0);
    l.add(thigh, knee, shin, boot, sole);
    return l;
  };
  for (const [x, z, yaw] of [[0, 0, 0.25], [gap, 0.15, -0.2]] as const) {
    const c = new THREE.Group();
    c.position.set(x, 0, z);
    c.rotation.y = Math.PI / 2 + yaw; // miran hacia la puerta (lado −Z de la nave)
    const hips = new THREE.Mesh(new THREE.BoxGeometry(0.26, 0.2, 0.36), white);
    hips.position.y = 1.02;
    const belt = new THREE.Mesh(new THREE.BoxGeometry(0.27, 0.06, 0.37), black);
    belt.position.y = 1.12;
    const pouch = new THREE.Mesh(new THREE.BoxGeometry(0.08, 0.08, 0.1), grey);
    pouch.position.set(-0.12, 1.08, 0.12);
    const torso = new THREE.Mesh(new THREE.BoxGeometry(0.28, 0.5, 0.42), white); // solo asoma por arriba si la cámara sube
    torso.position.y = 1.4;
    c.add(hips, belt, pouch, torso, leg(-1), leg(1));
    g.add(c);
    clones.push(c);
  }
  const sway = (t: number) => {
    // los clones se balancean un poco con el vuelo (cada uno a su ritmo)
    clones.forEach((c, i) => { c.rotation.x = 0.03 * Math.sin(t * 1.3 + i * 2.1); c.rotation.z = 0.025 * Math.sin(t * 0.9 + i); });
  };
  bake(g);
  // las piernas están hechas para un clon de 1,80 m (cadera a 0,95 m): se ajustan a la estatura pedida sin deformarlas
  for (const c of clones) c.scale.setScalar(height / 1.8);
  return { group: g, sway };
}

// ---------- Clon comando (PROVISIONAL) ----------
// Armadura de comando (tipo Katarn): gris claro con zonas oscuras, visor en T ámbar y marcas naranjas. Se sustituirá por un modelo de verdad.
// Postura: `crouch` 1 = agachado (rodilla derecha en el suelo) → 0 = de pie; `peek` 0..1 = se asoma estirando el tronco;
// `tap` 0..1 = lleva la mano izquierda al lado del casco (golpe a la radio).
export class Commando {
  readonly group = new THREE.Group();
  private hips = new THREE.Group();
  private torso = new THREE.Group();
  private head = new THREE.Group();
  private armL = new THREE.Group(); private foreL = new THREE.Group();
  private armR = new THREE.Group(); private foreR = new THREE.Group();
  private thighL = new THREE.Group(); private shinL = new THREE.Group(); private footL = new THREE.Group();
  private thighR = new THREE.Group(); private shinR = new THREE.Group(); private footR = new THREE.Group();

  /** `height`: estatura de pie (m). */
  constructor(height: number) {
    const armor = lambert(0xb9b6ac), dark = lambert(0x3a3a3c), under = lambert(0x232325), orange = lambert(0xc0662a);
    const visor = new THREE.MeshLambertMaterial({ color: 0x2a1a08, emissive: 0x6a3a08 });
    const gun = lambert(0x2b2d30);
    const add = (parent: THREE.Object3D, geo: THREE.BufferGeometry, mat: THREE.Material, x = 0, y = 0, z = 0, rx = 0, ry = 0, rz = 0) => {
      const m = new THREE.Mesh(geo, mat);
      m.position.set(x, y, z);
      m.rotation.set(rx, ry, rz);
      m.castShadow = true;
      parent.add(m);
      return m;
    };
    const B = (w: number, h: number, d: number) => new THREE.BoxGeometry(w, h, d);
    const C = (r0: number, r1: number, h: number) => new THREE.CylinderGeometry(r0, r1, h, 10);

    // Marco del comando: mira hacia −Z, +X a su derecha. Las articulaciones son grupos colocados en su pivote.
    this.group.add(this.hips);
    this.hips.position.y = 0.95;
    add(this.hips, B(0.34, 0.2, 0.24), under);
    add(this.hips, B(0.36, 0.07, 0.26), dark, 0, 0.1, 0); // cinturón
    add(this.hips, B(0.3, 0.16, 0.05), armor, 0, -0.02, -0.13); // faldón delantero

    // Tronco y cabeza
    this.hips.add(this.torso);
    this.torso.position.y = 0.12;
    add(this.torso, B(0.4, 0.5, 0.26), armor, 0, 0.27, 0); // pecho
    add(this.torso, B(0.3, 0.3, 0.06), dark, 0, 0.3, -0.14); // placa central oscura
    add(this.torso, B(0.06, 0.32, 0.03), orange, 0.11, 0.3, -0.175); // marca naranja
    add(this.torso, B(0.36, 0.42, 0.16), dark, 0, 0.28, 0.2); // mochila
    add(this.torso, B(0.12, 0.1, 0.12), armor, -0.24, 0.47, 0); // hombreras
    add(this.torso, B(0.12, 0.1, 0.12), armor, 0.24, 0.47, 0);
    this.torso.add(this.head);
    this.head.position.y = 0.56;
    add(this.head, C(0.07, 0.08, 0.1), under, 0, 0.02, 0); // cuello
    add(this.head, new THREE.SphereGeometry(0.15, 14, 10), armor, 0, 0.17, 0.01).scale.set(1, 1.08, 1.12); // casco
    add(this.head, B(0.24, 0.1, 0.1), armor, 0, 0.08, -0.08); // mandíbula
    add(this.head, B(0.2, 0.045, 0.05), visor, 0, 0.2, -0.14); // visor en T: barra horizontal
    add(this.head, B(0.06, 0.12, 0.05), visor, 0, 0.13, -0.145); // y vertical
    add(this.head, B(0.24, 0.035, 0.06), dark, 0, 0.245, -0.135); // cresta sobre el visor
    add(this.head, B(0.04, 0.12, 0.04), dark, 0.16, 0.2, 0.02); // antena / radio del casco (lado izquierdo del jugador = +X del comando)
    add(this.head, B(0.03, 0.14, 0.12), orange, 0, 0.3, 0.02); // marca naranja en la cresta
    add(this.head, B(0.25, 0.12, 0.06), dark, 0, 0.12, 0.14); // nuca oscura
    add(this.head, C(0.06, 0.06, 0.04), dark, 0.155, 0.16, 0, 0, 0, Math.PI / 2); // «orejas» del casco
    add(this.head, C(0.06, 0.06, 0.04), dark, -0.155, 0.16, 0, 0, 0, Math.PI / 2);
    add(this.head, B(0.05, 0.05, 0.22), orange, -0.1, 0.27, 0.02); // franja naranja lateral

    // Brazos (pivote en el hombro; cuelgan hacia −Y)
    const arm = (g: THREE.Group, fore: THREE.Group, side: number) => {
      this.torso.add(g);
      g.position.set(side * 0.26, 0.44, 0);
      add(g, C(0.06, 0.055, 0.28), armor, 0, -0.14, 0);
      g.add(fore);
      fore.position.y = -0.29;
      add(fore, new THREE.SphereGeometry(0.055, 8, 6), under);
      add(fore, C(0.055, 0.05, 0.26), armor, 0, -0.14, 0);
      add(fore, B(0.08, 0.09, 0.09), dark, 0, -0.3, 0); // guante
    };
    arm(this.armL, this.foreL, 1);
    arm(this.armR, this.foreR, -1);
    // Bláster DC-17m en la mano derecha
    const rifle = new THREE.Group();
    rifle.position.set(0, -0.31, 0);
    add(rifle, B(0.06, 0.1, 0.55), gun, 0, 0, -0.14);
    add(rifle, B(0.035, 0.035, 0.3), gun, 0, 0.02, -0.55);
    add(rifle, B(0.04, 0.06, 0.09), dark, 0, 0.08, -0.1); // mira
    add(rifle, B(0.03, 0.05, 0.02), orange, 0.035, 0, -0.2);
    this.foreR.add(rifle);

    // Piernas (pivote en la cadera; cuelgan hacia −Y)
    const leg = (thigh: THREE.Group, shin: THREE.Group, foot: THREE.Group, side: number) => {
      this.hips.add(thigh);
      thigh.position.set(side * 0.11, -0.05, 0);
      add(thigh, C(0.08, 0.07, 0.44), armor, 0, -0.22, 0);
      thigh.add(shin);
      shin.position.y = -0.45;
      add(shin, new THREE.SphereGeometry(0.07, 8, 6), dark);
      add(shin, C(0.07, 0.06, 0.42), armor, 0, -0.21, 0);
      shin.add(foot);
      foot.position.y = -0.43;
      add(foot, B(0.12, 0.08, 0.26), dark, 0, -0.02, -0.05);
    };
    leg(this.thighL, this.shinL, this.footL, 1);
    leg(this.thighR, this.shinR, this.footR, -1);
    bake(this.group, true);
    // Estatura: se mide de pie y se escala la figura entera (sin deformarla)
    this.pose(0, 0, 0);
    this.group.updateMatrixWorld(true);
    const h = new THREE.Box3().setFromObject(this.group).getSize(new THREE.Vector3()).y;
    this.group.scale.setScalar(height / h);
    this.pose(1, 0, 0);
  }

  /** Coloca la postura (ver arriba). `t` = tiempo, para la respiración. */
  pose(crouch: number, peek: number, tap: number, t = 0) {
    const c = crouch, s = 1 - crouch;
    const L = (a: number, b: number, k: number) => a + (b - a) * k;
    // Piernas: de pie → rodilla derecha en el suelo y pie izquierdo plantado delante
    this.thighL.rotation.x = L(0, 1.45, c);   // muslo izquierdo hacia delante (casi horizontal)
    this.shinL.rotation.x = L(0, -1.5, c);    // espinilla vertical
    this.footL.rotation.x = L(0, 0.05, c);
    this.thighR.rotation.x = L(0, -0.05, c);  // muslo derecho casi vertical...
    this.shinR.rotation.x = L(0, -1.45, c);   // ...con la espinilla apoyada en el suelo hacia atrás
    this.footR.rotation.x = L(0, 0.9, c);
    this.hips.position.y = L(0.95, 0.5, c) + peek * 0.34 * c;
    this.hips.position.z = L(0, 0.08, c);
    // Tronco: inclinado hacia delante al estar agachado; al asomarse se endereza un poco
    this.torso.rotation.x = L(-0.05, -0.38, c) + peek * 0.3 * c + Math.sin(t * 1.6) * 0.015;
    this.head.rotation.x = L(0, 0.25, c) - peek * 0.18 * c;
    this.head.rotation.z = tap > 0.85 ? (tap - 0.85) * -0.6 : 0; // el golpe le ladea la cabeza
    // Brazo derecho con el rifle (apuntando al frente, algo bajado)
    this.armR.rotation.set(L(-0.9, -1.05, c), 0, L(0.25, 0.15, c));
    this.foreR.rotation.set(L(-0.6, -0.5, c), 0, 0);
    // Brazo izquierdo: sujeta el guardamanos o sube al casco
    const rest = { sx: L(-1.2, -1.3, c), sz: L(-0.35, -0.3, c), e: L(-0.9, -0.8, c) };
    this.armL.rotation.set(L(rest.sx, -0.4, tap), 0, L(rest.sz, -2.2, tap));
    this.foreL.rotation.set(L(rest.e, 0.1, tap), 0, L(0, -1.9, tap));
    void s;
  }
}

// ---------- Soldados de pie en la puerta de la cañonera en vuelo (modelos de verdad) ----------
// El SOLDADO (clon normal de fase I, sin arma) y el COMANDANTE (clon comando, con el DC-17m), mirando hacia fuera por la puerta abierta.
// Pies a la anchura de los hombros, uno adelantado, rodillas algo dobladas y el peso cargado en una pierna; con una mano se agarran a un asa
// del techo (por delante y por encima de la cabeza) y el torso y la cabeza miran abajo, al cañón. Se balancean con el vuelo y, mientras habla
// cada uno, hace un gesto (el soldado señala abajo; el comandante asiente).

/** Nombres de los huesos en cada modelo (el comando y el clon tienen esqueletos distintos). `l`/`r` = lado. */
const BONES: Record<TrooperModel, {
  spine: string; chest: string; neck: string; head: string;
  arm: (s: 'l' | 'r') => string; fore: (s: 'l' | 'r') => string; hand: (s: 'l' | 'r') => string;
  thigh: (s: 'l' | 'r') => string; knee: (s: 'l' | 'r') => string; foot: (s: 'l' | 'r') => string; toe: (s: 'l' | 'r') => string;
  finger: (s: 'l' | 'r', f: string, i: number) => string; thumb: (s: 'l' | 'r', i: number) => string;
}> = {
  commando: {
    spine: 'spine', chest: 'chest', neck: 'neck', head: 'head',
    arm: (s) => `${S(s)}arm`, fore: (s) => `${S(s)}elbow`, hand: (s) => `${S(s)}wrist`,
    thigh: (s) => `${S(s)}leg`, knee: (s) => `${S(s)}knee`, foot: (s) => `${S(s)}ankle`, toe: (s) => `${S(s)}toe`,
    finger: (s, f, i) => `${f}finger${i}${s}`, thumb: (s, i) => `thumb${i}${s}`,
  },
  clone: {
    spine: 'spine', chest: 'spine2', neck: 'neck', head: 'head',
    arm: (s) => `${S(s)}arm`, fore: (s) => `${S(s)}forearm`, hand: (s) => `${S(s)}hand`,
    thigh: (s) => `${S(s)}upleg`, knee: (s) => `${S(s)}leg`, foot: (s) => `${S(s)}foot`, toe: (s) => `${S(s)}toebase`,
    finger: (s, f, i) => `${S(s)}hand${f === 'little' ? 'pinky' : f}${i}`, thumb: (s, i) => `${S(s)}handthumb${i}`,
  },
};
function S(s: 'l' | 'r') { return s === 'l' ? 'left' : 'right'; }

export interface TrooperSetup {
  kind: TrooperModel;
  /** Mano con la que se agarra al asa y pierna que carga el peso (la otra, adelantada). */
  agarra: 'l' | 'r';
  apoyo: 'l' | 'r';
  /** Lleva el DC-17m en la mano libre (el comandante) o la tiene libre (el soldado). */
  arma: boolean;
  /** Gestos mientras habla, en segundos desde que empieza la pasada de la nave (toma 2A): señalar abajo / asentir / girar la cabeza al compañero. */
  gestos: Array<{ tipo: 'señala' | 'asiente' | 'mira'; desde: number; hasta: number }>;
}

/** Ajustes de los dos soldados (metros, en el sistema de cada soldado: x a su derecha, y arriba desde el suelo, z hacia atrás; −z = hacia la puerta). */
export const SHIP_TROOPERS = {
  soldado: { kind: 'clone', agarra: 'r', apoyo: 'r', arma: false, gestos: [{ tipo: 'mira', desde: 0.35, hasta: 1.15 }, { tipo: 'señala', desde: 1.55, hasta: 3.5 }] } as TrooperSetup, // «Comandante,» → mira al compañero; «…cañonera derribada…» → señala abajo
  comandante: { kind: 'commando', agarra: 'l', apoyo: 'l', arma: true, gestos: [{ tipo: 'mira', desde: 4.3, hasta: 5.2 }, { tipo: 'asiente', desde: 6.9, hasta: 7.6 }, { tipo: 'asiente', desde: 7.9, hasta: 8.6 }] } as TrooperSetup, // mira al soldado al empezar; asiente en «No podemos bajar» y «seguimos rumbo»
  /** Dónde queda la mano que agarra el asa (por delante y por encima de la cabeza). */
  asa: [0.15, 1.95, -0.25] as [number, number, number],
  /** Pies: separación entre ellos, cuánto se adelanta uno y cuánto se retrasa el otro. */
  pies: { separacion: 0.36, delante: 0.16, detras: 0.1 },
  /** Cuánto baja la cadera (rodillas dobladas) y cuánto se desplaza hacia la pierna de apoyo. */
  cadera: { baja: 0.05, lado: 0.05 },
  /** Inclinación del torso hacia la puerta y de la cabeza hacia abajo (grados). */
  torso: 8, cabeza: 24,
  /** Hacia dónde señala el soldado con la mano libre (x hacia el otro lado del cuerpo, altura, delante). */
  señala: [0.45, 0.8, -0.75] as [number, number, number],
  /** Largo del DC-17m en las manos del comandante (m). */
  largoArma: 0.5,
};

class ShipTrooper {
  readonly group = new THREE.Group();
  private rig: CommandoRig;
  private rifle: THREE.Group | null = null;
  private grip = new THREE.Vector3();
  private B: (typeof BONES)[TrooperModel];
  private fingerCache: Array<[THREE.Bone, THREE.Quaternion]> = [];
  constructor(private set: TrooperSetup, height: number) {
    this.rig = createTrooperRig(set.kind, height);
    this.B = BONES[set.kind];
    this.group.add(this.rig.root);
    const bm = set.arma ? blasterModelData() : null;
    if (bm) {
      bm.geo.computeBoundingBox();
      const bb = bm.geo.boundingBox!, s = SHIP_TROOPERS.largoArma / (bb.max.z - bb.min.z);
      const mat = withLightFloor(new THREE.MeshLambertMaterial({ map: bm.map, color: bm.map ? 0xffffff : 0x3b3f45 }));
      if (bm.map) mat.color.setScalar(bm.bright * 0.8);
      const mesh = new THREE.Mesh(bm.geo, mat);
      mesh.scale.setScalar(s);
      this.rifle = new THREE.Group();
      this.rifle.add(mesh);
      this.group.add(this.rifle);
      this.grip.set(0.02, -0.2, 0.15).multiplyScalar(s); // la empuñadura del DC-17m, en el sistema del arma
    }
  }

  private b(name: string) { return this.rig.bones[name]; }
  private W(x: number, y: number, z: number) { return this.group.localToWorld(new THREE.Vector3(x, y, z)); }

  /** `t`: tiempo de la cinemática (balanceo); `ft`: segundos desde que empezó la pasada de la nave (gestos). */
  pose(t: number, ft: number, phase: number) {
    const st = this.set, B = this.B, T = SHIP_TROOPERS;
    const free: 'l' | 'r' = st.agarra === 'l' ? 'r' : 'l';
    const sgn = (s: 'l' | 'r') => (s === 'r' ? 1 : -1);
    const gesture = (tipo: string) => {
      let k = 0;
      for (const g of st.gestos) if (g.tipo === tipo) {
        const a = Math.min(1, (ft - g.desde) / 0.35), z = Math.min(1, (g.hasta - ft) / 0.35);
        k = Math.max(k, Math.max(0, Math.min(a, z)));
      }
      return k * k * (3 - 2 * k);
    };
    this.rig.reset();
    this.group.updateMatrixWorld(true);
    const right = new THREE.Vector3(1, 0, 0).transformDirection(this.group.matrixWorld);
    const fwd = new THREE.Vector3(0, 0, -1).transformDirection(this.group.matrixWorld);
    const up = new THREE.Vector3(0, 1, 0).transformDirection(this.group.matrixWorld);

    // 1) Cadera: algo más baja (rodillas dobladas), desplazada hacia la pierna de apoyo, inclinada y con un balanceo suave
    const swayX = Math.sin(t * 0.9 + phase) * 0.025, swayZ = Math.sin(t * 1.3 + phase) * 0.015;
    const hips = this.b('hips');
    const hp = this.group.worldToLocal(hips.getWorldPosition(new THREE.Vector3()));
    hp.y -= T.cadera.baja;
    hp.x += sgn(st.apoyo) * T.cadera.lado + swayX;
    hp.z += swayZ;
    hips.position.copy(hips.parent!.worldToLocal(this.group.localToWorld(hp.clone())));
    hips.updateMatrixWorld(true);
    turnWorld(hips, fwd, sgn(st.apoyo) * 0.05 + swayX * 0.8); // la cadera cae hacia el lado que no carga
    // 2) Piernas: pies a la anchura de los hombros, uno adelantado; rodillas hacia delante
    for (const s of ['l', 'r'] as const) {
      const front = s !== st.apoyo;
      const foot = this.W(sgn(s) * T.pies.separacion / 2, 0.1, front ? -T.pies.delante : T.pies.detras);
      reach(this.b(B.thigh(s)), this.b(B.knee(s)), this.b(B.foot(s)), foot, this.W(sgn(s) * 0.25, 0.55, -1.2));
      aimBone(this.b(B.foot(s)), this.b(B.toe(s)), fwd.clone().multiplyScalar(1).addScaledVector(up, -0.35).addScaledVector(right, sgn(s) * 0.15));
    }
    // 3) Torso hacia la puerta y algo girado hacia el lado del asa; cabeza mirando abajo, al cañón
    const lean = THREE.MathUtils.degToRad(T.torso);
    turnWorld(this.b(B.spine), right, -lean * 0.5 + swayZ * 0.6);
    turnWorld(this.b(B.chest), right, -lean * 0.5);
    turnWorld(this.b(B.chest), up, sgn(st.agarra) * -0.08);
    const nod = gesture('asiente') * Math.sin((ft % 0.7) / 0.7 * Math.PI * 2) * 0.18;
    const look = gesture('mira');
    turnWorld(this.b(B.neck), right, -THREE.MathUtils.degToRad(T.cabeza) * 0.4);
    turnWorld(this.b(B.head), right, -THREE.MathUtils.degToRad(T.cabeza) * 0.6 + nod + look * 0.25);
    turnWorld(this.b(B.head), up, look * sgn(st.agarra) * 0.6); // gira la cabeza hacia el compañero
    // 4) Brazo del asa: por delante y por encima de la cabeza, codo doblado hacia fuera
    const asa = this.W(sgn(st.agarra) * T.asa[0], T.asa[1], T.asa[2]);
    reach(this.b(B.arm(st.agarra)), this.b(B.fore(st.agarra)), this.b(B.hand(st.agarra)), asa, this.W(sgn(st.agarra) * 0.8, 1.3, -0.3));
    aimBone(this.b(B.hand(st.agarra)), this.b(B.finger(st.agarra, 'middle', 1)), up.clone().addScaledVector(fwd, 0.3)); // dedos hacia arriba, rodeando el asa
    // 5) Mano libre: con el arma (el comandante) o colgando relajada / señalando abajo (el soldado)
    const point = gesture('señala');
    if (this.rifle) {
      const hand = this.W(sgn(free) * 0.2, 0.98, -0.2);
      reach(this.b(B.arm(free)), this.b(B.fore(free)), this.b(B.hand(free)), hand, this.W(sgn(free) * 0.6, 1.0, 0.4));
    } else {
      const rest = this.W(sgn(free) * 0.26, 0.88, -0.06), aim = this.W(-sgn(free) * T.señala[0], T.señala[1], T.señala[2]); // señala hacia delante y abajo, cruzando por delante del cuerpo (hacia donde está la cañonera estrellada)
      const target = rest.lerp(aim, point);
      reach(this.b(B.arm(free)), this.b(B.fore(free)), this.b(B.hand(free)), target, this.W(sgn(free) * 0.6, 1.0, 0.3));
      if (point > 0) aimBone(this.b(B.hand(free)), this.b(B.finger(free, 'middle', 1)), target.clone().sub(this.b(B.arm(free)).getWorldPosition(new THREE.Vector3())).normalize());
    }
    // 6) Dedos: puño en el asa y en la empuñadura; el soldado, al señalar, estira el índice
    this.fist(st.agarra, 1);
    this.fist(free, this.rifle ? 1 : 0.45, !this.rifle && point > 0.5);
    // 7) El arma pegada a la mano libre por la empuñadura, apuntando abajo y en diagonal por delante del cuerpo
    if (this.rifle) {
      const hand = this.b(B.hand(free)).getWorldPosition(new THREE.Vector3());
      const dir = fwd.clone().multiplyScalar(0.55).addScaledVector(up, -0.75).addScaledVector(right, -sgn(free) * 0.35).normalize();
      const m = new THREE.Matrix4().lookAt(new THREE.Vector3(), dir.clone().negate(), up); // −Z del arma hacia `dir`
      const q = new THREE.Quaternion().setFromRotationMatrix(m);
      const gq = this.group.getWorldQuaternion(new THREE.Quaternion());
      this.rifle.quaternion.copy(gq.clone().invert().multiply(q));
      this.rifle.updateMatrixWorld(true);
      const off = this.grip.clone().applyQuaternion(q).multiplyScalar(this.group.getWorldScale(new THREE.Vector3()).x);
      this.rifle.position.copy(this.group.worldToLocal(hand.sub(off)));
    }
    this.rig.root.updateMatrixWorld(true);
  }

  /** Cierra los dedos de una mano (la palma es el lado donde queda el pulgar). `amount` 0..1; `index` = deja el índice estirado. */
  private fist(s: 'l' | 'r', amount: number, index = false) {
    const B = this.B;
    const p = (bn: THREE.Object3D) => bn.getWorldPosition(new THREE.Vector3());
    const mid = this.b(B.finger(s, 'middle', 1)), idx = this.b(B.finger(s, 'index', 1)), lit = this.b(B.finger(s, 'little', 1));
    const th = this.b(B.thumb(s, 2));
    if (!mid || !idx || !lit || !th) return;
    const hand = p(this.b(B.hand(s)));
    const f = p(mid).sub(hand).normalize();
    const side = p(idx).sub(p(lit)).normalize();
    const n = new THREE.Vector3().crossVectors(side, f).normalize();
    if (p(th).sub(hand).dot(n) < 0) n.negate(); // la palma, hacia el pulgar
    for (const fname of ['index', 'middle', 'ring', 'little']) {
      const k = fname === 'index' && index ? 0.05 : amount;
      for (let i = 1; i <= 3; i++) {
        const a = this.b(B.finger(s, fname, i));
        if (!a) continue;
        const c = this.b(B.finger(s, fname, i + 1)) ?? this.b(B.finger(s, fname, 3) + 'end');
        const dir = c ? p(c).sub(p(a)).normalize() : f;
        const axis = new THREE.Vector3().crossVectors(dir, n).normalize();
        turnWorld(a, axis, [1.1, 1.3, 0.9][i - 1] * k);
      }
    }
    const t1 = this.b(B.thumb(s, 1));
    if (t1) turnWorld(t1, f, 0.4 * amount * (s === 'r' ? 1 : -1));
    void this.fingerCache;
  }
}

/** Los dos soldados de la puerta: el soldado (clon normal) a la izquierda y el comandante (clon comando) a la derecha. */
export function buildShipTroopers(heights: { clon: number; comando: number }, gap: number) {
  const g = new THREE.Group();
  const list: Array<{ tr: ShipTrooper; phase: number }> = [];
  const add = (st: TrooperSetup, x: number, h: number, phase: number) => {
    if (!trooperModelReady(st.kind)) return;
    const tr = new ShipTrooper(st, h);
    tr.group.position.set(x, 0, 0);
    g.add(tr.group);
    list.push({ tr, phase });
  };
  add(SHIP_TROOPERS.soldado, 0, heights.clon, 0);
  add(SHIP_TROOPERS.comandante, gap, heights.comando, 2.1);
  const sway = (t: number, ft = 0) => {
    for (const { tr, phase } of list) {
      tr.group.rotation.set(0.015 * Math.sin(t * 1.3 + phase), 0, 0.02 * Math.sin(t * 0.9 + phase));
      tr.pose(t, ft, phase);
    }
  };
  sway(0, 0);
  return { group: g, sway, ready: list.length === 2 };
}

// ---------- Clon comando con el modelo de verdad ----------
// Mismas posturas que el provisional (agachado, asomarse, golpe al casco), pero girando los huesos del modelo:
// las manos van al bláster (o al casco) y los pies al suelo con IK; el tronco se inclina y la cabeza mira al frente.
/** Dónde lleva el bláster respecto al pecho (m, en su marco: x derecha, y arriba, z hacia atrás) y cuánto apunta hacia abajo (rad). */
export const RIFLE_HOLD = { x: 0.14, y: -0.16, z: -0.34, bajoAgachado: 0.35, bajoDePie: 0.12, largo: 0.85 };

export class CommandoModel {
  readonly group = new THREE.Group();
  private rig: CommandoRig;
  private rifle = new THREE.Group();
  private gripR = new THREE.Object3D();
  private gripL = new THREE.Object3D();
  private right = new THREE.Vector3();
  private v = new THREE.Vector3();

  constructor(height: number) {
    this.rig = createCommandoRig(height);
    this.group.add(this.rig.root);
    for (const m of this.rig.meshes) m.castShadow = true;
    // bláster en las manos: el mismo modelo que usa el jugador (si no cargó, una caja oscura)
    const bm = blasterModelData();
    if (bm) {
      bm.geo.computeBoundingBox();
      const bb = bm.geo.boundingBox!, len = bb.max.z - bb.min.z, s = RIFLE_HOLD.largo / len;
      const mat = withLightFloor(new THREE.MeshLambertMaterial({ map: bm.map, color: bm.map ? 0xffffff : 0x3b3f45 }));
      if (bm.map) mat.color.setScalar(bm.bright * 0.8);
      const mesh = new THREE.Mesh(bm.geo, mat);
      mesh.scale.setScalar(s);
      mesh.castShadow = true;
      this.rifle.add(mesh);
      // agarres: los mismos puntos que usan los brazos del jugador (mango y empuñadura delantera)
      this.gripR.position.set(0.02, -0.2, 0.15).multiplyScalar(s); // empuñadura del DC-17m
      this.gripL.position.set(-0.02, -0.21, -0.32).multiplyScalar(s); // bajo la parte delantera
    } else {
      const mesh = new THREE.Mesh(new THREE.BoxGeometry(0.07, 0.12, RIFLE_HOLD.largo), lambert(0x2b2d30));
      this.rifle.add(mesh);
      this.gripR.position.set(0, -0.08, 0.2);
      this.gripL.position.set(0, -0.06, -0.15);
    }
    this.rifle.add(this.gripR, this.gripL);
    this.group.add(this.rifle);
    this.pose(1, 0, 0);
  }

  /** Igual que el provisional: `crouch` 1 = agachado → 0 = de pie; `peek` = se asoma; `tap` = mano izquierda al casco. */
  pose(crouch: number, peek: number, tap: number, t = 0) {
    const b = this.rig.bones, c = crouch;
    const L = (a: number, z: number, k: number) => a + (z - a) * k;
    const W = (x: number, y: number, z: number) => this.group.localToWorld(new THREE.Vector3(x, y, z)); // punto del marco del comando → mundo
    this.rig.reset();
    this.group.updateMatrixWorld(true);
    this.right.set(1, 0, 0).transformDirection(this.group.matrixWorld);
    // 1) Cadera: baja al agacharse y sube un poco al asomarse
    const hipY = L(0.99, 0.56, c) + peek * 0.22 * c + Math.sin(t * 1.6) * 0.008;
    b.hips.position.copy(b.hips.parent!.worldToLocal(W(0, hipY, L(-0.03, 0.06, c))));
    b.hips.updateMatrixWorld(true);
    // 2) Tronco inclinado hacia delante (menos al asomarse); la cabeza compensa para mirar al frente
    const lean = c * (0.42 - 0.32 * peek);
    turnWorld(b.spine, this.right, -lean * 0.5);
    turnWorld(b.chest, this.right, -lean * 0.5);
    turnWorld(b.neck, this.right, lean * 0.6);
    turnWorld(b.head, this.right, lean * 0.3 - peek * 0.1 * c);
    if (tap > 0.85) turnWorld(b.head, new THREE.Vector3(0, 0, 1).transformDirection(this.group.matrixWorld), -(tap - 0.85) * 0.8);
    // 3) Piernas: el pie izquierdo plantado delante y la rodilla derecha en el suelo (de pie: los pies bajo la cadera)
    reach(b.leftleg, b.leftknee, b.leftankle, W(-0.12, 0.1, L(0.03, -0.38, c)), W(-0.12, 0.6, -2));
    reach(b.rightleg, b.rightknee, b.rightankle, W(0.12, L(0.1, 0.14, c), L(0.03, 0.42, c)), W(0.12, L(0.6, -0.3, c), -2));
    aimBone(b.leftankle, b.lefttoe, W(0, -0.35, -1).sub(W(0, 0, 0)));
    aimBone(b.rightankle, b.righttoe, W(0, L(-0.35, -0.9, c), L(-1, 0.4, c)).sub(W(0, 0, 0)));
    // 4) Bláster delante del pecho, algo bajado
    const chest = b.chest.getWorldPosition(this.v);
    const lc = this.group.worldToLocal(chest.clone());
    this.rifle.position.set(lc.x + RIFLE_HOLD.x, lc.y + RIFLE_HOLD.y, lc.z + RIFLE_HOLD.z);
    this.rifle.rotation.set(-L(RIFLE_HOLD.bajoDePie, RIFLE_HOLD.bajoAgachado, c) - lean * 0.3, 0, 0);
    this.rifle.updateMatrixWorld(true);
    // 5) Brazos: la derecha al mango; la izquierda a la empuñadura… o al casco (golpe a la radio)
    reach(b.rightarm, b.rightelbow, b.rightwrist, this.gripR.getWorldPosition(new THREE.Vector3()), W(0.55, 0.6, 0.3));
    const head = b.head.getWorldPosition(new THREE.Vector3());
    const lh = this.group.worldToLocal(head.clone());
    const helmet = W(lh.x - 0.2, lh.y + 0.08, lh.z - 0.02);
    const fore = this.gripL.getWorldPosition(new THREE.Vector3());
    reach(b.leftarm, b.leftelbow, b.leftwrist, fore.lerp(helmet, tap), L(0, 1, tap) > 0.5 ? W(-0.8, lh.y + 0.2, 0.2) : W(-0.55, 0.6, 0.3));
  }
}

// ---------- Droides B1 de la toma de la neblina ----------
/** Cuánto se oscurecen (1 = como en la partida, 0 = negros). */
export const SILUETA = 0.2;
export class B1Walkers {
  readonly group = new THREE.Group();
  private list: Array<{ mesh: THREE.SkinnedMesh; bones: B1Bones; x: number; z: number; phase: number; speed: number }> = [];

  /** `spots`: posiciones de salida [x, z]; todos avanzan hacia +Z (hacia el jugador). */
  constructor(spots: Array<[number, number]>) {
    const mat = withDroidWear(withLightFloor(new THREE.MeshPhongMaterial({ vertexColors: true, shininess: 28, specular: 0x3a342e })));
    for (const [x, z] of spots) {
      const { mesh, bones } = createB1(mat);
      mesh.geometry = bones.lods[1]; // se ven lejos: la versión ligera
      mesh.rotation.y = Math.PI; // el modelo mira a −Z: se gira para que avance hacia +Z
      this.group.add(mesh);
      this.list.push({ mesh, bones, x, z, phase: Math.random() * 6, speed: 1.1 + Math.random() * 0.25 });
    }
    mat.color.multiplyScalar(SILUETA); // más oscuros que en la partida: se leen como siluetas contra la neblina clara
  }

  /** Los coloca `t` segundos después de echar a andar. */
  update(t: number) {
    for (const w of this.list) {
      const z = w.z + t * w.speed;
      w.mesh.position.set(w.x, terrainHeight(w.x, z), z);
      poseB1(w.bones, 1, 1, w.phase + t * w.speed * 2.2); // mismo ritmo de paso que en la partida
    }
  }
}
