import * as THREE from 'three';

// Droide B1 con esqueleto. El modelo 3D (public/models/b1.bin) se genera con tools/convert-b1.mjs a partir del OBJ original:
// una sola pieza dibujable por droide, con 17 huesos (cadera, torso, cuello, cabeza, brazos, piernas, pies y rifle)
// y dos niveles de detalle (cerca / lejos) que comparten el mismo esqueleto.
// Si el archivo no se pudiera cargar, se usa un modelo de cajas con el mismo esqueleto.

export interface B1Bones {
  root: THREE.Bone; spine: THREE.Bone; neck: THREE.Bone; head: THREE.Bone;
  armL: THREE.Bone; forearmL: THREE.Bone; handL: THREE.Bone;
  armR: THREE.Bone; forearmR: THREE.Bone; handR: THREE.Bone;
  thighL: THREE.Bone; shinL: THREE.Bone; footL: THREE.Bone;
  thighR: THREE.Bone; shinR: THREE.Bone; footR: THREE.Bone;
  gun: THREE.Bone;
  hipY: number;
  /** Geometrías de cada nivel de detalle (0 = cerca, 1 = lejos). */
  lods: THREE.BufferGeometry[];
}

interface BoneDef { name: keyof Omit<B1Bones, 'hipY' | 'lods'>; parent: number; pivot: [number, number, number] }
interface Model { bones: BoneDef[]; lods: THREE.BufferGeometry[]; source: 'archivo' | 'respaldo' }

let model: Model | null = null;

/** Descarga y prepara el modelo. Si falla, se usa el de respaldo (cajas). Hay que llamarlo antes de crear droides. */
export async function loadB1Model(url: string): Promise<'archivo' | 'respaldo'> {
  try {
    const res = await fetch(url);
    if (!res.ok) throw new Error('HTTP ' + res.status);
    model = parse(await res.arrayBuffer());
  } catch (e) {
    console.warn('No se pudo cargar el modelo del B1; se usa el de respaldo.', e);
    model = fallback();
  }
  return model.source;
}

function parse(buf: ArrayBuffer): Model {
  const dv = new DataView(buf);
  const magic = String.fromCharCode(dv.getUint8(0), dv.getUint8(1), dv.getUint8(2), dv.getUint8(3));
  if (magic !== 'B1M1') throw new Error('archivo de modelo no válido');
  const jsonLen = dv.getUint32(4, true);
  const meta = JSON.parse(new TextDecoder().decode(new Uint8Array(buf, 8, jsonLen)));
  const base = 8 + jsonLen + ((4 - ((8 + jsonLen) % 4)) % 4);
  const lods = meta.lods.map((l: { verts: number; indices: number; index: number; pos: number; nor: number; col: number; bone: number }) => {
    const g = new THREE.BufferGeometry();
    g.setIndex(new THREE.BufferAttribute(new Uint16Array(buf.slice(base + l.index, base + l.index + l.indices * 2)), 1));
    g.setAttribute('position', new THREE.BufferAttribute(new Float32Array(buf.slice(base + l.pos, base + l.pos + l.verts * 12)), 3));
    g.setAttribute('normal', new THREE.BufferAttribute(new Int8Array(buf.slice(base + l.nor, base + l.nor + l.verts * 3)), 3, true));
    g.setAttribute('color', new THREE.BufferAttribute(new Uint8Array(buf.slice(base + l.col, base + l.col + l.verts * 3)), 3, true));
    const bones = new Uint8Array(buf.slice(base + l.bone, base + l.bone + l.verts));
    const si = new Uint16Array(l.verts * 4), sw = new Float32Array(l.verts * 4);
    for (let i = 0; i < l.verts; i++) { si[i * 4] = bones[i]; sw[i * 4] = 1; }
    g.setAttribute('skinIndex', new THREE.BufferAttribute(si, 4));
    g.setAttribute('skinWeight', new THREE.BufferAttribute(sw, 4));
    g.computeBoundingSphere();
    return g;
  });
  return { bones: meta.bones, lods, source: 'archivo' };
}

// ---------- Modelo de respaldo: una caja por hueso ----------
const FALLBACK_BONES: BoneDef[] = [
  { name: 'root', parent: -1, pivot: [0, 1.0196, -0.0388] }, { name: 'spine', parent: 0, pivot: [0, 1.0196, -0.0388] },
  { name: 'neck', parent: 1, pivot: [0, 1.498, -0.005] }, { name: 'head', parent: 2, pivot: [0, 1.7918, 0.1128] },
  { name: 'armL', parent: 1, pivot: [-0.1794, 1.4728, -0.0013] }, { name: 'forearmL', parent: 4, pivot: [-0.1785, 1.14, -0.0004] }, { name: 'handL', parent: 5, pivot: [-0.1785, 0.9096, 0.0004] },
  { name: 'armR', parent: 1, pivot: [0.1794, 1.4728, -0.0013] }, { name: 'forearmR', parent: 7, pivot: [0.1785, 1.14, -0.0004] }, { name: 'handR', parent: 8, pivot: [0.1785, 0.9096, 0.0004] },
  { name: 'thighL', parent: 0, pivot: [-0.0902, 1.0196, -0.0388] }, { name: 'shinL', parent: 10, pivot: [-0.0936, 0.5952, -0.0849] }, { name: 'footL', parent: 11, pivot: [-0.1046, 0.1173, -0.0155] },
  { name: 'thighR', parent: 0, pivot: [0.0902, 1.0196, -0.0387] }, { name: 'shinR', parent: 13, pivot: [0.1044, 0.5954, -0.0846] }, { name: 'footR', parent: 14, pivot: [0.105, 0.1185, -0.0156] },
  { name: 'gun', parent: 1, pivot: [0, 1.0196, -0.0388] },
];

function fallback(): Model {
  const parts: THREE.BufferGeometry[] = [];
  const add = (bone: number, w: number, h: number, d: number, x: number, y: number, z: number, color: number) => {
    const g = new THREE.BoxGeometry(w, h, d).toNonIndexed();
    g.translate(x, y, z);
    const n = g.attributes.position.count, c = new THREE.Color(color);
    const col = new Float32Array(n * 3), si = new Uint16Array(n * 4), sw = new Float32Array(n * 4);
    for (let i = 0; i < n; i++) { col.set([c.r, c.g, c.b], i * 3); si[i * 4] = bone; sw[i * 4] = 1; }
    g.deleteAttribute('uv');
    g.setAttribute('color', new THREE.BufferAttribute(col, 3));
    g.setAttribute('skinIndex', new THREE.BufferAttribute(si, 4));
    g.setAttribute('skinWeight', new THREE.BufferAttribute(sw, 4));
    parts.push(g);
  };
  const T = 0xc69c6c, D = 0x3a3a3e;
  add(0, 0.34, 0.14, 0.16, 0, 1.02, 0, 0x9a7b55);
  add(1, 0.3, 0.5, 0.18, 0, 1.4, 0, T);
  add(2, 0.06, 0.22, 0.06, 0, 1.6, 0.05, T);
  add(3, 0.13, 0.13, 0.42, 0, 1.8, -0.1, T);
  for (const [s, a, f, h, t, sh, ft] of [[-1, 4, 5, 6, 10, 11, 12], [1, 7, 8, 9, 13, 14, 15]] as const) {
    add(a, 0.07, 0.33, 0.07, 0.179 * s, 1.31, 0, T);
    add(f, 0.07, 0.23, 0.07, 0.179 * s, 1.02, 0, T);
    add(h, 0.07, 0.12, 0.07, 0.179 * s, 0.84, 0, T);
    add(t, 0.09, 0.42, 0.09, 0.09 * s, 0.8, 0, T);
    add(sh, 0.09, 0.48, 0.09, 0.1 * s, 0.36, -0.05, T);
    add(ft, 0.1, 0.05, 0.22, 0.105 * s, 0.03, -0.08, D);
  }
  add(16, 0.06, 0.08, 0.5, 0, 1.15, -0.4, D);
  let total = 0; for (const g of parts) total += g.attributes.position.count;
  const pos = new Float32Array(total * 3), nor = new Float32Array(total * 3), col = new Float32Array(total * 3), si = new Uint16Array(total * 4), sw = new Float32Array(total * 4);
  let o = 0;
  for (const g of parts) {
    g.computeVertexNormals();
    const n = g.attributes.position.count;
    pos.set(g.attributes.position.array as Float32Array, o * 3); nor.set(g.attributes.normal.array as Float32Array, o * 3); col.set(g.attributes.color.array as Float32Array, o * 3);
    si.set(g.attributes.skinIndex.array as Uint16Array, o * 4); sw.set(g.attributes.skinWeight.array as Float32Array, o * 4);
    o += n;
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  geo.setAttribute('normal', new THREE.BufferAttribute(nor, 3));
  geo.setAttribute('color', new THREE.BufferAttribute(col, 3));
  geo.setAttribute('skinIndex', new THREE.BufferAttribute(si, 4));
  geo.setAttribute('skinWeight', new THREE.BufferAttribute(sw, 4));
  geo.computeBoundingSphere();
  return { bones: FALLBACK_BONES, lods: [geo, geo], source: 'respaldo' };
}

// ---------- Crear un droide ----------
export function createB1(material: THREE.Material): { mesh: THREE.SkinnedMesh; bones: B1Bones } {
  if (!model) model = fallback();
  const list: THREE.Bone[] = model.bones.map((d) => {
    const b = new THREE.Bone();
    b.name = d.name;
    return b;
  });
  model.bones.forEach((d, i) => {
    const parent = d.parent < 0 ? null : model!.bones[d.parent];
    list[i].position.set(d.pivot[0] - (parent ? parent.pivot[0] : 0), d.pivot[1] - (parent ? parent.pivot[1] : 0), d.pivot[2] - (parent ? parent.pivot[2] : 0));
    if (parent) list[d.parent].add(list[i]);
  });
  const mesh = new THREE.SkinnedMesh(model.lods[0], material);
  mesh.add(list[0]);
  mesh.updateMatrixWorld(true);
  mesh.bind(new THREE.Skeleton(list));
  mesh.frustumCulled = false;
  const by = Object.fromEntries(model.bones.map((d, i) => [d.name, list[i]])) as unknown as B1Bones;
  by.hipY = model.bones[0].pivot[1];
  by.lods = model.lods;
  return { mesh, bones: by };
}

const lerp = (a: number, b: number, t: number) => a + (b - a) * t;
const smooth = (a: number, b: number, v: number) => {
  const t = Math.min(1, Math.max(0, (v - a) / (b - a)));
  return t * t * (3 - 2 * t);
};

// Longitudes del esqueleto (m): muslo, pierna y altura del tobillo
const THIGH = 0.424, SHIN = 0.478;

/**
 * Coloca al droide en una postura.
 * `unfold`: 0 = agachado y plegado · ~0.4 = de pie con la cabeza aún plegada · ~0.7 = cabeza levantada · 1 = postura de combate.
 * `walk`: 0..1 cuánto está andando; `phase`: fase del paso.
 */
export function poseB1(b: B1Bones, unfold: number, walk = 0, phase = 0) {
  const stand = smooth(0.15, 0.55, unfold); // se pone de pie
  const head = smooth(0.58, 0.8, unfold); // levanta la cabeza
  const arms = smooth(0.8, 1, unfold); // sube los brazos con el arma
  const w = walk * stand;
  const s = Math.sin(phase);

  // Piernas (con los pies siempre planos en el suelo)
  const tL = lerp(1.45, 0, stand) + s * 0.5 * w, tR = lerp(1.45, 0, stand) - s * 0.5 * w;
  const sL = lerp(-2.2, 0, stand) - Math.max(0, Math.sin(phase + 1.6)) * 0.75 * w;
  const sR = lerp(-2.2, 0, stand) - Math.max(0, Math.sin(phase + 1.6 + Math.PI)) * 0.75 * w;
  b.thighL.rotation.x = tL; b.shinL.rotation.x = sL; b.footL.rotation.x = -(tL + sL);
  b.thighR.rotation.x = tR; b.shinR.rotation.x = sR; b.footR.rotation.x = -(tR + sR);
  // La cadera baja lo que las piernas se doblan (se apoya la pierna más estirada)
  const drop = (t: number, sh: number) => THIGH + SHIN - (THIGH * Math.cos(t) + SHIN * Math.cos(t + sh));
  b.root.position.y = b.hipY - Math.min(drop(tL, sL), drop(tR, sR)) + Math.abs(s) * 0.03 * w;

  // Torso, cuello y cabeza
  b.spine.rotation.x = lerp(-0.9, -0.05, stand) - 0.05 * w;
  b.spine.rotation.z = s * 0.03 * w;
  b.neck.rotation.x = lerp(2.2, 0, head);
  b.head.rotation.x = lerp(0.9, 0, head);

  // Brazos: recogidos → colgando → sujetando el rifle. En combate, una mano en la empuñadura (codo muy doblado)
  // y la otra en el guardamanos (brazo adelantado); ángulos calculados para que las palmas queden sobre el rifle.
  const shB = lerp(0.5, 0.12, stand), elB = lerp(1.5, 0.1, stand), adB = lerp(0.15, 0.04, stand);
  b.armL.rotation.set(lerp(shB, 0.499, arms), lerp(0, -0.014, arms), lerp(adB, 0.269, arms));
  b.forearmL.rotation.set(lerp(elB, 0.92, arms), 0, 0);
  b.armR.rotation.set(lerp(shB, -0.05, arms), lerp(0, 0.168, arms), lerp(-adB, -0.241, arms));
  b.forearmR.rotation.set(lerp(elB, 1.423, arms), 0, 0);
  b.handL.rotation.set(0, 0, 0); b.handR.rotation.set(0, 0, 0);

  // El rifle: recogido junto al cuerpo al principio y en posición de disparo al final
  b.gun.position.set(0, lerp(-0.25, 0, arms), lerp(0.1, 0, arms));
  b.gun.rotation.x = lerp(0.9, 0, arms);
}
