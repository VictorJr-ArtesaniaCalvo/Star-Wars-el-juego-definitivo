// Conversor del droideka (glTF de Sketchfab, PokCat, CC-BY 4.0) a un archivo compacto con esqueleto para el juego.
//   node tools/convert-droideka.mjs <scene.gltf> <carpeta-texturas-jpg> [salida=public/models/droideka.bin]
// La carpeta de texturas lleva mat1.jpg … mat5.jpg: las imágenes de color de los materiales 1 a 5 del modelo (el material 0 es negro liso).
// - El modelo original (257.000 triángulos, 7 esqueletos, 112 piezas) viene en postura DESPLEGADA. Se pasa a metros (1,8 m de alto), con el
//   frente hacia -Z (como el resto del juego) y los pies en y = 0, y se reparte en 12 huesos (los mismos que el droideka de antes):
//   rueda, cuenco (la bola central), capucha, columna (con la cabeza y las cajas laterales), brazo I/D y, por cada pata, cadera y rodilla.
// - Cada pieza pertenece a un solo hueso (los pesos originales se sustituyen por el hueso dominante). Se sueldan los vértices, se simplifica
//   cada hueso por separado (~8.000 triángulos de cerca y ~2.500 de lejos) y el color sale de la textura del autor, ya por vértice.
// - El archivo guarda también las medidas de las patas, para calcular al cargar la postura de rueda (patas plegadas formando un aro).
import fs from 'node:fs';
import path from 'node:path';
import jpeg from 'jpeg-js';
import { MeshoptSimplifier } from 'meshoptimizer';
import { loadSkinned } from './gltf-skin.mjs';

const [, , src, texDir, out = 'public/models/droideka.bin'] = process.argv;
if (!src || !texDir) { console.error('Uso: node tools/convert-droideka.mjs scene.gltf carpeta-texturas [salida]'); process.exit(1); }
await MeshoptSimplifier.ready;

// ---------- Del modelo original al juego ----------
const SCALE = 0.215; // metros por unidad del modelo (8,5 unidades de alto → 1,83 m)
const X0 = 1.0, Z0 = -0.1, Y_FEET = -0.7; // centro del trípode y suelo, en coordenadas del modelo
// el original mira hacia +X y su derecha es +Z; en el juego se mira hacia -Z y la derecha es +X
const tf = (x, y, z) => [(z - Z0) * SCALE, (y - Y_FEET) * SCALE, -(x - X0) * SCALE];
const tfN = (x, y, z) => [z, y, -x];

const { g, N, world, prims } = loadSkinned(src);
const jointPos = (name) => { const i = N.findIndex((n) => n.name === name); return tf(world[i][12], world[i][13], world[i][14]); };

// ---------- Huesos ----------
const BONES = [
  ['roll', -1], ['pelvis', 0], ['shell', 0], ['column', 0], ['armL', 0], ['armR', 0],
  ['hip0', 0], ['knee0', 6], ['hip1', 0], ['knee1', 8], ['hip2', 0], ['knee2', 10],
];
const B = Object.fromEntries(BONES.map(([n], i) => [n, i]));
// patas: 0 = trasera (esqueleto 5), 1 = delantera izquierda (esqueleto 4, z negativa del modelo), 2 = delantera derecha (esqueleto 3)
const LEGS = [
  { hip: 'Bone_90', knee: 'Bone.002_87', skin: 5 },
  { hip: 'Bone_81', knee: 'Bone.002_78', skin: 4 },
  { hip: 'Bone_72', knee: 'Bone.002_69', skin: 3 },
];
const legHip = LEGS.map((l) => jointPos(l.hip)), legKnee = LEGS.map((l) => jointPos(l.knee));
const CENTER = tf(0.85, 1.54, Z0); // centro de la bola al rodar (las patas forman un aro a su alrededor, apoyado en el suelo)
const pivots = {
  roll: CENTER, pelvis: tf(0.85, 2.0, Z0), shell: tf(1.17, 4.67, Z0) /* centro del arco de la capucha (ajustado a sus vértices) */, column: tf(0.85, 2.6, Z0),
  armL: jointPos('Bone.005_67'), armR: jointPos('Bone.005_41'),
};
const bonesOut = BONES.map(([name, parent]) => {
  let pv;
  if (pivots[name]) pv = pivots[name];
  else { const i = +name.slice(-1); pv = name.startsWith('hip') ? legHip[i] : legKnee[i]; }
  return { name, parent, pivot: pv.map((v) => +v.toFixed(5)) };
});

// ---------- Qué hueso lleva cada vértice ----------
const topName = (chain) => chain[chain.length - 4] ?? chain[0];
const jointName = (j) => N[j].name;
function boneOf(p, v) {
  const t = topName(p.chain);
  if (t.startsWith('Armature.023')) return jointName(p.joint[v]) === LEGS[2].knee ? B.knee2 : B.hip2;
  if (t.startsWith('Armature.024')) return jointName(p.joint[v]) === LEGS[1].knee ? B.knee1 : B.hip1;
  if (t.startsWith('Armature.027')) return jointName(p.joint[v]) === LEGS[0].knee ? B.knee0 : B.hip0;
  if (t.startsWith('Armature.022')) return B.armL; // brazo de la z negativa del modelo = izquierda del juego
  if (t.startsWith('Armature.028')) return B.armR;
  if (t.startsWith('Circle.004')) return B.shell; // capucha
  if (t.startsWith('Sphere.004')) return B.pelvis; // bola central (cuenco)
  return B.column; // columna, costillas, cabeza (Armature.026) y las dos cajas perforadas de los costados (Armature.025)
}

// ---------- Texturas de color ----------
const TEX = {};
for (let m = 1; m <= 5; m++) { const d = jpeg.decode(fs.readFileSync(path.join(texDir, `mat${m}.jpg`)), { useTArray: true }); TEX[m] = d; }
const sample = (mat, u, v) => {
  if (mat === 0 || !TEX[mat]) return [0, 0, 0];
  const t = TEX[mat]; u -= Math.floor(u); v -= Math.floor(v);
  const x = Math.min(t.width - 1, Math.floor(u * t.width)), y = Math.min(t.height - 1, Math.floor(v * t.height)), o = (y * t.width + x) * 4;
  return [t.data[o], t.data[o + 1], t.data[o + 2]];
};
const lin = (c) => Math.pow(c / 255, 2.2) * 255; // las imágenes están en sRGB y el juego mezcla la luz en lineal

// ---------- Reunir los vértices de cada hueso (soldados por posición) ----------
const groups = BONES.map(() => ({ map: new Map(), pos: [], nor: [], col: [], cnt: [], idx: [] }));
let srcTris = 0;
for (const p of prims) {
  srcTris += p.idx.length / 3;
  const local = new Map(); // vértice original -> índice soldado del hueso
  const gb = new Map(); // hueso -> grupo
  const vertexBone = new Uint8Array(p.pos.length / 3);
  for (let v = 0; v < vertexBone.length; v++) vertexBone[v] = boneOf(p, v);
  const weld = (v, bone) => {
    const G = groups[bone];
    const x = p.pos[v * 3], y = p.pos[v * 3 + 1], z = p.pos[v * 3 + 2];
    const key = p.node + '|' + Math.round(x * 4000) + ',' + Math.round(y * 4000) + ',' + Math.round(z * 4000);
    let id = G.map.get(key);
    const uv = p.uv ? [p.uv[v * 2], p.uv[v * 2 + 1]] : [0, 0];
    const c = sample(p.material ?? 0, uv[0], uv[1]);
    if (id === undefined) {
      id = G.pos.length / 3; G.map.set(key, id);
      G.pos.push(...tf(x, y, z)); G.nor.push(...tfN(p.nor[v * 3], p.nor[v * 3 + 1], p.nor[v * 3 + 2])); G.col.push(c[0], c[1], c[2]); G.cnt.push(1);
    } else { G.col[id * 3] += c[0]; G.col[id * 3 + 1] += c[1]; G.col[id * 3 + 2] += c[2]; G.cnt[id]++; }
    return id;
  };
  // un triángulo va al hueso de su primer vértice (se evitan costuras raras entre huesos distintos de una misma pieza)
  for (let t = 0; t < p.idx.length; t += 3) {
    const a = p.idx[t], b = p.idx[t + 1], c = p.idx[t + 2];
    const bone = vertexBone[a];
    // la rotación (x,z)->(z,-x) mantiene el sentido de las caras
    groups[bone].idx.push(weld(a, bone), weld(b, bone), weld(c, bone));
  }
}
console.log('triángulos de origen', srcTris);
for (const [i, G] of groups.entries()) {
  for (let k = 0; k < G.cnt.length; k++) for (let q = 0; q < 3; q++) G.col[k * 3 + q] /= G.cnt[k];
  console.log(BONES[i][0].padEnd(7), String(G.idx.length / 3).padStart(7), 'triángulos', String(G.pos.length / 3).padStart(7), 'vértices');
}

// ---------- Simplificar ----------
const BUDGET = { roll: 0, pelvis: 600, shell: 900, column: 1500, armL: 1000, armR: 1000, hip0: 650, knee0: 450, hip1: 650, knee1: 450, hip2: 650, knee2: 450 };
function simplifyGroup(G, target) {
  let idx = new Uint32Array(G.idx);
  const P = new Float32Array(G.pos), C = new Float32Array(G.col.map((v) => v / 255));
  if (idx.length / 3 > target) {
    let err = 0.002;
    for (let tries = 0; tries < 9; tries++) {
      const [res] = MeshoptSimplifier.simplifyWithAttributes(idx.length === G.idx.length ? new Uint32Array(G.idx) : idx, P, 3, C, 3, [0.3, 0.3, 0.3], null, target * 3, err, ['Prune', 'Sparse']);
      idx = res; if (idx.length / 3 <= target * 1.1) break; err *= 2.5;
    }
  }
  return { idx, P, C };
}

function buildLod(lod) {
  const pos = [], nor = [], col = [], bone = [], index = [];
  let tris = 0;
  for (const [bi, G] of groups.entries()) {
    const target = Math.round((BUDGET[BONES[bi][0]]) * (lod === 0 ? 1 : 0.3));
    if (!G.idx.length || !target) continue;
    const { idx, P, C } = simplifyGroup(G, target);
    const nt = idx.length / 3; tris += nt;
    // normales de cara, suavizadas por ángulo (35°)
    const fn = new Float32Array(nt * 3), area = new Float32Array(nt), inc = new Map();
    for (let t = 0; t < nt; t++) {
      const a = idx[t * 3], b = idx[t * 3 + 1], c = idx[t * 3 + 2];
      const e1 = [0, 1, 2].map((k) => P[b * 3 + k] - P[a * 3 + k]), e2 = [0, 1, 2].map((k) => P[c * 3 + k] - P[a * 3 + k]);
      const n = [e1[1] * e2[2] - e1[2] * e2[1], e1[2] * e2[0] - e1[0] * e2[2], e1[0] * e2[1] - e1[1] * e2[0]];
      const l = Math.hypot(...n) || 1; area[t] = l; fn.set(n.map((v) => v / l), t * 3);
      for (const v of [a, b, c]) { if (!inc.has(v)) inc.set(v, []); inc.get(v).push(t); }
    }
    const uniq = new Map();
    for (let t = 0; t < nt; t++) for (let k = 0; k < 3; k++) {
      const v = idx[t * 3 + k], acc = [0, 0, 0];
      for (const u of inc.get(v)) { const d = fn[u * 3] * fn[t * 3] + fn[u * 3 + 1] * fn[t * 3 + 1] + fn[u * 3 + 2] * fn[t * 3 + 2]; if (d > 0.82) for (let q = 0; q < 3; q++) acc[q] += fn[u * 3 + q] * area[u]; }
      const l = Math.hypot(...acc) || 1;
      const P3 = [P[v * 3], P[v * 3 + 1], P[v * 3 + 2]].map((q) => Math.fround(q));
      const N3 = acc.map((q) => Math.round((q / l) * 127));
      const C3 = [0, 1, 2].map((q) => Math.min(255, Math.round(lin(C[v * 3 + q] * 255))));
      const key = `${P3.join(',')}|${N3.join(',')}|${C3.join(',')}|${bi}`;
      let id = uniq.get(key);
      if (id === undefined) { id = pos.length / 3; uniq.set(key, id); pos.push(...P3); nor.push(...N3); col.push(...C3); bone.push(bi); }
      index.push(id);
    }
  }
  return { pos, nor, col, bone, index, tris };
}
const lods = [buildLod(0), buildLod(1)];
for (const [i, l] of lods.entries()) console.log(`LOD${i}: ${l.tris} triángulos, ${l.pos.length / 3} vértices`);
for (const l of lods) if (l.pos.length / 3 > 65535) throw new Error('demasiados vértices');

// ---------- Medidas de las patas (para la postura de rueda) ----------
// pie = el punto más bajo de la pata; se guarda también la dirección «hacia fuera» en reposo
const feet = [0, 1, 2].map((i) => {
  let best = null;
  const G = groups[B['knee' + i]];
  for (let k = 0; k < G.pos.length; k += 3) if (!best || G.pos[k + 1] < best[1]) best = [G.pos[k], G.pos[k + 1], G.pos[k + 2]];
  return best;
});
const legs = [0, 1, 2].map((i) => ({ hip: legHip[i].map((v) => +v.toFixed(4)), knee: legKnee[i].map((v) => +v.toFixed(4)), foot: [legKnee[i][0] + (feet[i][0] - legKnee[i][0]) * 0, feet[i][1], legKnee[i][2] + (feet[i][2] - legKnee[i][2]) * 0].map((v) => +v.toFixed(4)) }));
console.log('patas', JSON.stringify(legs));

// ---------- Escribir ----------
const chunks = []; let off = 0;
const push = (typed) => { const pad = (4 - (off % 4)) % 4; if (pad) { chunks.push(Buffer.alloc(pad)); off += pad; } const o = off; chunks.push(Buffer.from(typed.buffer, typed.byteOffset, typed.byteLength)); off += typed.byteLength; return o; };
const lodMeta = lods.map((l) => ({ verts: l.pos.length / 3, tris: l.tris, indices: l.index.length, index: push(new Uint16Array(l.index)), pos: push(new Float32Array(l.pos)), nor: push(new Int8Array(l.nor)), col: push(new Uint8Array(l.col)), bone: push(new Uint8Array(l.bone)) }));
const body = Buffer.concat(chunks);
const header = Buffer.from(JSON.stringify({ version: 1, scale: SCALE, bones: bonesOut, legs, lods: lodMeta }));
const head = Buffer.alloc(8); head.write('DKA1', 0, 'ascii'); head.writeUInt32LE(header.length, 4);
const padH = Buffer.alloc((4 - ((8 + header.length) % 4)) % 4);
fs.mkdirSync(path.dirname(out), { recursive: true });
fs.writeFileSync(out, Buffer.concat([head, header, padH, body]));
console.log('guardado', out, (fs.statSync(out).size / 1024).toFixed(0), 'KB');
