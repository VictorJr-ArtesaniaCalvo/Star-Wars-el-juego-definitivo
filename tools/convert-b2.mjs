// Conversor del modelo 3D del droide B2 (glTF de Sketchfab con piezas rígidas) a un archivo compacto para el juego.
//   node tools/convert-b2.mjs <scene.gltf> <carpeta-de-texturas> [salida=public/models/b2.bin]
// - El modelo viene «congelado» en un paso de marcha (piernas y brazos descolocados): aquí se endereza cada miembro
//   (muslo, pierna, pie, brazo, antebrazo, mano) para dejarlo de pie y simétrico, girando cada pieza sobre su articulación.
// - Cada pieza se reparte a un hueso del esqueleto y se simplifica (meshoptimizer); hay dos niveles de detalle.
// - Los colores salen de las texturas del autor (cada pieza usa la textura de su material): se leen en los vértices.
//   Los mapas de relieve no se usan (pesan demasiado para un móvil).
import fs from 'node:fs';
import path from 'node:path';
import jpeg from 'jpeg-js';
import { MeshoptSimplifier } from 'meshoptimizer';
import { loadGltf } from './gltf-lib.mjs';

const [, , src, texDir, out = 'public/models/b2.bin'] = process.argv;
if (!src || !texDir) { console.error('Uso: node tools/convert-b2.mjs scene.gltf carpeta-texturas [salida]'); process.exit(1); }
await MeshoptSimplifier.ready;

const HEIGHT = 2.35; // altura del B2 en el juego (m)
const { g, pieces, world } = loadGltf(src);

// ---------- Álgebra mínima ----------
const sub = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const add = (a, b) => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const len = (a) => Math.hypot(...a);
const norm = (a) => { const l = len(a) || 1; return [a[0] / l, a[1] / l, a[2] / l]; };
const mulV = (m, v) => [m[0] * v[0] + m[1] * v[1] + m[2] * v[2], m[3] * v[0] + m[4] * v[1] + m[5] * v[2], m[6] * v[0] + m[7] * v[1] + m[8] * v[2]];
const mulM = (a, b) => { const o = new Array(9).fill(0); for (let r = 0; r < 3; r++) for (let c = 0; c < 3; c++) for (let k = 0; k < 3; k++) o[r * 3 + c] += a[r * 3 + k] * b[k * 3 + c]; return o; };
const transpose = (m) => [m[0], m[3], m[6], m[1], m[4], m[7], m[2], m[5], m[8]];
const I3 = [1, 0, 0, 0, 1, 0, 0, 0, 1];
// giro más corto que lleva el vector a sobre el b
const arc = (a, b) => {
  a = norm(a); b = norm(b);
  const c = dot(a, b);
  if (c > 0.999999) return I3;
  let ax = cross(a, b);
  if (c < -0.999999) ax = Math.abs(a[0]) < 0.9 ? cross(a, [1, 0, 0]) : cross(a, [0, 1, 0]);
  ax = norm(ax);
  const ang = Math.acos(Math.max(-1, Math.min(1, c))), s = Math.sin(ang), k = 1 - Math.cos(ang);
  const [x, y, z] = ax;
  return [1 + k * (x * x - 1), -z * s + k * x * y, y * s + k * x * z, z * s + k * x * y, 1 + k * (y * y - 1), -x * s + k * y * z, -y * s + k * x * z, x * s + k * y * z, 1 + k * (z * z - 1)];
};
const T_ID = { R: I3, t: [0, 0, 0] };
const applyT = (T, p) => add(mulV(T.R, p), T.t);
const compose = (A, B) => ({ R: mulM(A.R, B.R), t: add(mulV(A.R, B.t), A.t) }); // primero B, luego A
const rotAbout = (Q, c) => ({ R: Q, t: sub(c, mulV(Q, c)) });
// ejes principales de una nube de puntos (Jacobi sobre la matriz de covarianza 3x3)
function pca(points) {
  const n = points.length; const m = [0, 0, 0];
  for (const p of points) for (let k = 0; k < 3; k++) m[k] += p[k] / n;
  const C = new Array(9).fill(0);
  for (const p of points) for (let i = 0; i < 3; i++) for (let j = 0; j < 3; j++) C[i * 3 + j] += (p[i] - m[i]) * (p[j] - m[j]) / n;
  let A = C.slice(), V = I3.slice();
  for (let sweep = 0; sweep < 30; sweep++) {
    let off = 0;
    for (const [p, q] of [[0, 1], [0, 2], [1, 2]]) {
      const apq = A[p * 3 + q]; off += Math.abs(apq);
      if (Math.abs(apq) < 1e-12) continue;
      const th = (A[q * 3 + q] - A[p * 3 + p]) / (2 * apq);
      const t = Math.sign(th || 1) / (Math.abs(th) + Math.sqrt(th * th + 1)), c = 1 / Math.sqrt(t * t + 1), s = t * c;
      const G = I3.slice(); G[p * 3 + p] = c; G[q * 3 + q] = c; G[p * 3 + q] = s; G[q * 3 + p] = -s;
      A = mulM(transpose(G), mulM(A, G)); V = mulM(V, G);
    }
    if (off < 1e-12) break;
  }
  const vals = [A[0], A[4], A[8]];
  const axes = [0, 1, 2].map((i) => [V[i], V[3 + i], V[6 + i]]);
  const order = [0, 1, 2].sort((a, b) => vals[b] - vals[a]); // de mayor a menor varianza
  return { mean: m, axes: order.map((i) => axes[i]) };
}

// ---------- Esqueleto ----------
const BONES = [
  ['root', -1], ['spine', 0],
  ['armL', 1], ['forearmL', 2], ['handL', 3], ['armR', 1], ['forearmR', 5], ['handR', 6],
  ['thighL', 0], ['shinL', 8], ['footL', 9], ['thighR', 0], ['shinR', 11], ['footR', 12],
];
const B = Object.fromEntries(BONES.map(([n], i) => [n, i]));

// A qué hueso va cada pieza: por el hueso del modelo más cercano en su cadena de padres. «.L» del modelo (x>0) pasa a ser el lado -x del juego: «L».
const BONE_RULES = [
  [/^Bone\.007/, 'root'], [/^Bone\.008|^Bone\.012_/, 'spine'],
  [/^arm\.L\.001/, 'armL'], [/^arm\.L\.002/, 'forearmL'], [/^arm\.L\.(003|004|005|007|008|009|010)/, 'handL'],
  [/^arm\.R\.001/, 'armR'], [/^arm\.R\.002/, 'forearmR'], [/^arm\.R\.(003|004|005|007|008|009|010)/, 'handR'],
  [/^Bone\.L\.012/, 'root'], [/^Bone\.R\.012/, 'root'],
  [/^Bone\.L\.009/, 'thighL'], [/^Bone\.L\.010/, 'shinL'], [/^Bone\.L\.011/, 'footL'],
  [/^Bone\.R\.009/, 'thighR'], [/^Bone\.R\.010/, 'shinR'], [/^Bone\.R\.011/, 'footR'],
];
const boneOf = (chain) => { for (const n of chain) for (const [re, b] of BONE_RULES) if (re.test(n)) return B[b]; return -1; };

const origin = (re) => { const i = g.nodes.findIndex((n) => re.test(n.name)); if (i < 0) throw new Error('falta ' + re); return [world[i][12], world[i][13], world[i][14]]; };
const orig = {
  root: origin(/^Bone\.007/), spine: origin(/^Bone\.008/),
  armL: origin(/^arm\.L\.001/), forearmL: origin(/^arm\.L\.002/), handL: origin(/^arm\.L\.005/),
  armR: origin(/^arm\.R\.001/), forearmR: origin(/^arm\.R\.002/), handR: origin(/^arm\.R\.005/),
  thighL: origin(/^Bone\.L\.009/), shinL: origin(/^Bone\.L\.010/), footL: origin(/^Bone\.L\.011/),
  thighR: origin(/^Bone\.R\.009/), shinR: origin(/^Bone\.R\.010/), footR: origin(/^Bone\.R\.011/),
};
const fingerTip = (side) => {
  const pts = [4, 8, 10].map((n) => origin(new RegExp(`^arm\\.${side}\\.0${String(n).padStart(2, '0')}_`)));
  return [0, 1, 2].map((k) => (pts[0][k] + pts[1][k] + pts[2][k]) / 3);
};

// ---------- Piezas: hueso, quitar el plano del suelo ----------
const parts = [];
for (const p of pieces) {
  const mat = g.materials[p.material];
  if (mat && mat.alphaMode === 'BLEND') continue; // plano de sombra bajo el droide
  const bone = boneOf(p.chain);
  if (bone < 0) { console.log('sin hueso, se descarta:', p.name, p.chain.slice(0, 3).join('<')); continue; }
  parts.push({ ...p, bone, matName: mat?.name || '?' });
}
console.log(parts.length, 'piezas;', parts.reduce((s, p) => s + p.idx.length / 3, 0), 'triángulos de origen');

// ---------- Enderezar: transformación de cada hueso ----------
const DOWN = [0, -1, 0];
const T = {};
T.root = T_ID; T.spine = T_ID;
const vertsOf = (boneIdx) => { const pts = []; for (const p of parts) if (p.bone === boneIdx) for (let i = 0; i < p.pos.length; i += 3) pts.push([p.pos[i], p.pos[i + 1], p.pos[i + 2]]); return pts; };
const chain = (name, parentName, tipOrig) => {
  const parentT = T[parentName] || T_ID;
  const pv = applyT(parentT, orig[name]);
  const tip = applyT(parentT, tipOrig);
  const Q = arc(sub(tip, pv), DOWN);
  T[name] = compose(rotAbout(Q, pv), parentT);
};
for (const s of ['L', 'R']) {
  chain('arm' + s, 'spine', orig['forearm' + s]);
  chain('forearm' + s, 'arm' + s, orig['hand' + s]);
  chain('hand' + s, 'forearm' + s, fingerTip(s));
  chain('thigh' + s, 'root', orig['shin' + s]);
  chain('shin' + s, 'thigh' + s, orig['foot' + s]);
}

// Pies. El modelo está congelado en un paso: el pie izquierdo es el que está plantado (plano en el suelo) y el derecho está levantado
// (talón en el aire). Se deja el izquierdo con su orientación original, solo acompañando al tobillo, y el derecho se orienta como el
// espejo del izquierdo (se busca el giro que mejor encaja las dos mallas, que son una copia espejada de la otra).
{
  const ankleL = applyT(T.shinL, orig.footL);
  T.footL = { R: I3, t: sub(ankleL, orig.footL) };
  const PL = vertsOf(B.footL).map((q) => applyT(T.footL, q));
  const xm = (orig.thighL[0] + orig.thighR[0]) / 2;
  const PLm = PL.map((q) => [2 * xm - q[0], q[1], q[2]]); // espejo del izquierdo
  const PR = vertsOf(B.footR);
  const A = (axes) => [axes[0][0], axes[1][0], axes[2][0], axes[0][1], axes[1][1], axes[2][1], axes[0][2], axes[1][2], axes[2][2]];
  const det = (m) => m[0] * (m[4] * m[8] - m[5] * m[7]) - m[1] * (m[3] * m[8] - m[5] * m[6]) + m[2] * (m[3] * m[7] - m[4] * m[6]);
  const pl = pca(PLm), pr = pca(PR);
  const AL = A(pl.axes), AR = A(pr.axes);
  let best = null;
  for (const sg of [[1, 1, 1], [1, -1, -1], [-1, 1, -1], [-1, -1, 1], [-1, -1, -1], [-1, 1, 1], [1, -1, 1], [1, 1, -1]]) {
    const S = [sg[0], 0, 0, 0, sg[1], 0, 0, 0, sg[2]];
    const Rc = mulM(AL, mulM(S, transpose(AR)));
    if (det(Rc) < 0.5) continue;
    let err = 0;
    for (const q of PR) {
      const r = add(mulV(Rc, sub(q, pr.mean)), pl.mean);
      let d = 1e18; for (const w of PLm) d = Math.min(d, (r[0] - w[0]) ** 2 + (r[1] - w[1]) ** 2 + (r[2] - w[2]) ** 2);
      err += d;
    }
    if (!best || err < best.err) best = { err, Rc };
  }
  const ankleR = applyT(T.shinR, orig.footR);
  T.footR = { R: best.Rc, t: sub(ankleR, mulV(best.Rc, orig.footR)) };
  console.log('encaje del pie derecho (error medio):', Math.sqrt(best.err / PR.length).toFixed(3));
}

// Comprobación: cada pie, ya colocado, debe quedar con su largo en z, su alto en y y su ancho en x.
for (const s of ['L', 'R']) {
  const mn = [1e9, 1e9, 1e9], mx = [-1e9, -1e9, -1e9];
  for (const q of vertsOf(B['foot' + s])) { const r = applyT(T['foot' + s], q); for (let k = 0; k < 3; k++) { mn[k] = Math.min(mn[k], r[k]); mx[k] = Math.max(mx[k], r[k]); } }
  console.log('pie', s, 'ancho(x)', (mx[0] - mn[0]).toFixed(2), 'alto(y)', (mx[1] - mn[1]).toFixed(2), 'largo(z)', (mx[2] - mn[2]).toFixed(2));
}

// ---------- Aplicar las transformaciones y pasar a coordenadas del juego ----------
const boneName = BONES.map(([n]) => n);
const pivotWorld = {};
for (const n of boneName) pivotWorld[n] = applyT(T[n] || T_ID, orig[n] || orig.root);
for (const p of parts) {
  const Tt = T[boneName[p.bone]] || T_ID;
  for (let i = 0; i < p.pos.length; i += 3) { const q = applyT(Tt, [p.pos[i], p.pos[i + 1], p.pos[i + 2]]); p.pos[i] = q[0]; p.pos[i + 1] = q[1]; p.pos[i + 2] = q[2]; }
  for (let i = 0; i < p.nor.length; i += 3) { const q = mulV(Tt.R, [p.nor[i], p.nor[i + 1], p.nor[i + 2]]); p.nor[i] = q[0]; p.nor[i + 1] = q[1]; p.nor[i + 2] = q[2]; }
}
let miny = 1e9, maxy = -1e9;
for (const p of parts) for (let i = 1; i < p.pos.length; i += 3) { miny = Math.min(miny, p.pos[i]); maxy = Math.max(maxy, p.pos[i]); }
const SC = HEIGHT / (maxy - miny);
const cx = pivotWorld.root[0], cz = pivotWorld.root[2];
// El modelo mira hacia +z; el juego, hacia -z: giro de 180° sobre Y.
const tf = (p) => [-(p[0] - cx) * SC, (p[1] - miny) * SC, -(p[2] - cz) * SC];
console.log('alto original', (maxy - miny).toFixed(2), 'escala', SC.toFixed(4));
const bonesOut = BONES.map(([name, parent]) => ({ name, parent, pivot: tf(pivotWorld[name]).map((v) => +v.toFixed(5)) }));
for (const b of bonesOut) console.log(b.name.padEnd(9), b.pivot.join(', '));

// ---------- Texturas ----------
const texCache = new Map();
function loadTex(file) {
  if (texCache.has(file)) return texCache.get(file);
  let tex = null;
  for (const ext of ['.jpg', '.jpeg', '.png']) {
    const f = path.join(texDir, path.basename(file).replace(/\.[^.]+$/, '') + ext);
    if (fs.existsSync(f) && ext !== '.png') { const d = jpeg.decode(fs.readFileSync(f), { useTArray: true }); tex = { w: d.width, h: d.height, data: d.data }; break; }
  }
  texCache.set(file, tex);
  return tex;
}
const matTex = (mi) => { const m = g.materials[mi]; const ti = m?.pbrMetallicRoughness?.baseColorTexture?.index; return ti === undefined ? null : loadTex(g.images[g.textures[ti].source].uri); };
const sample = (tex, u, v) => { // vecino más cercano con v invertida (glTF: origen arriba a la izquierda)
  const x = Math.min(tex.w - 1, Math.max(0, Math.floor(u * tex.w))), y = Math.min(tex.h - 1, Math.max(0, Math.floor(v * tex.h)));
  const o = (y * tex.w + x) * 4; return [tex.data[o], tex.data[o + 1], tex.data[o + 2]];
};
const meanLit = new Map(); // color medio de la parte pintada de cada textura (sin el fondo negro)
const litMean = (tex) => {
  if (meanLit.has(tex)) return meanLit.get(tex);
  let s = [0, 0, 0], n = 0;
  for (let i = 0; i < tex.data.length; i += 16) { const r = tex.data[i], gg = tex.data[i + 1], b = tex.data[i + 2]; if (r + gg + b > 60) { s[0] += r; s[1] += gg; s[2] += b; n++; } }
  const m = n ? s.map((v) => v / n) : [90, 90, 90]; meanLit.set(tex, m); return m;
};
// Acero azulado: se aclara y se tiñe un poco para que no quede casi negro con la luz del juego.
// Las texturas están en sRGB y el juego mezcla la luz en lineal: se pasa a lineal (si no, todo sale lavado y demasiado claro).
// BRIGHT aclara un poco el gris carbón del original para que no se pierda con la luz cálida de Geonosis.
const BRIGHT = 1.45;
const lin = (v) => Math.pow(v / 255, 2.2);
// Las piezas de articulación (cadera, manos, pies, detalles) van algo más oscuras que el blindaje, para que se distingan.
const DARKER = /^Material\.(017|025|038|040|041|032|037)$/;
const steel = (c, mat) => {
  const k = BRIGHT * (DARKER.test(mat) ? 0.75 : 1);
  const tint = [0.97, 1.0, 1.05];
  return [0, 1, 2].map((q) => Math.min(255, lin(c[q]) * tint[q] * k * 255));
};
const EYE = [255, 250, 245]; // el original lleva los ojos blancos y luminosos

// ---------- Atlas: todas las texturas del autor en una sola imagen (una sola textura por droide) ----------
// Cada textura se baja a la mitad de tamaño, se rellena su fondo negro con su gris medio (para que no «sangre» negro en los bordes)
// y se coloca en un atlas de 2048×2048. Las piezas de articulación se oscurecen un poco aquí mismo.
const ATLAS = 2048;
const atlasData = new Uint8Array(ATLAS * ATLAS * 4);
for (let i = 0; i < atlasData.length; i += 4) { atlasData[i] = atlasData[i + 1] = atlasData[i + 2] = 90; atlasData[i + 3] = 255; }
const texKey = (mi) => { const ti = g.materials[mi]?.pbrMetallicRoughness?.baseColorTexture?.index; return ti === undefined ? null : g.textures[ti].source; };
const isEyeMat = (name) => /Material\.002$/.test(name);
const used = new Map();
for (const p of parts) {
  const k = texKey(p.material);
  if (k === null || used.has(k) || isEyeMat(p.matName)) continue;
  const tex = matTex(p.material);
  if (tex) used.set(k, { k, tex, dark: DARKER.test(p.matName), name: p.matName });
}
const tiles = [...used.values()].map((t) => ({ ...t, tw: Math.max(64, t.tex.w >> 1), th: Math.max(64, t.tex.h >> 1) }));
tiles.sort((a, b) => b.th - a.th || b.tw - a.tw);
const tileOf = new Map();
{
  let cx = 0, cy = 0, rowH = 0; const PAD = 4;
  for (const t of tiles) {
    if (cx + t.tw > ATLAS) { cx = 0; cy += rowH + PAD; rowH = 0; }
    if (cy + t.th > ATLAS - 24) throw new Error('el atlas se queda pequeño');
    t.x = cx; t.y = cy; cx += t.tw + PAD; rowH = Math.max(rowH, t.th);
    const m = litMean(t.tex), dim = t.dark ? 0.88 : 1;
    for (let y = 0; y < t.th; y++) for (let x = 0; x < t.tw; x++) {
      const acc = [0, 0, 0];
      for (let dy = 0; dy < 2; dy++) for (let dx = 0; dx < 2; dx++) {
        const sx = Math.min(t.tex.w - 1, Math.floor(((x + 0.5) / t.tw) * t.tex.w) - 1 + dx), sy = Math.min(t.tex.h - 1, Math.floor(((y + 0.5) / t.th) * t.tex.h) - 1 + dy);
        const o = (Math.max(0, sy) * t.tex.w + Math.max(0, sx)) * 4;
        const r = t.tex.data[o], gg = t.tex.data[o + 1], b = t.tex.data[o + 2];
        const bg = r + gg + b < 60;
        acc[0] += bg ? m[0] : r; acc[1] += bg ? m[1] : gg; acc[2] += bg ? m[2] : b;
      }
      const o = ((t.y + y) * ATLAS + t.x + x) * 4;
      for (let q = 0; q < 3; q++) atlasData[o + q] = Math.round((acc[q] / 4) * dim);
    }
    tileOf.set(t.k, { x: t.x, y: t.y, w: t.tw, h: t.th });
  }
  // cuadrito blanco (para los ojos luminosos) en la esquina
  for (let y = ATLAS - 16; y < ATLAS; y++) for (let x = ATLAS - 16; x < ATLAS; x++) { const o = (y * ATLAS + x) * 4; atlasData[o] = atlasData[o + 1] = atlasData[o + 2] = 255; }
  console.log('atlas:', tiles.length, 'texturas colocadas hasta y =', cy + rowH);
}
const WHITE_UV = [(ATLAS - 8) / ATLAS, (ATLAS - 8) / ATLAS];
// Materiales sin textura (solo un color fijo): un cuadrito de ese color en la fila de abajo del atlas.
const solidUV = new Map();
for (const p of parts) {
  if (isEyeMat(p.matName) || texKey(p.material) !== null || solidUV.has(p.material)) continue;
  const f = g.materials[p.material]?.pbrMetallicRoughness?.baseColorFactor || [0.5, 0.5, 0.5, 1];
  const n = solidUV.size, x0 = ATLAS - 16 - 20 * (n + 1), y0 = ATLAS - 16;
  const c = [0, 1, 2].map((q) => Math.round(Math.pow(f[q], 1 / 2.2) * 255)); // lineal → sRGB
  for (let y = y0; y < y0 + 16; y++) for (let x = x0; x < x0 + 16; x++) { const o = (y * ATLAS + x) * 4; atlasData[o] = c[0]; atlasData[o + 1] = c[1]; atlasData[o + 2] = c[2]; }
  solidUV.set(p.material, [(x0 + 8) / ATLAS, (y0 + 8) / ATLAS]);
}
// coordenadas de cada vértice en el atlas (origen arriba a la izquierda, como en glTF)
for (const p of parts) {
  const nv = p.pos.length / 3; p.auv = new Float32Array(nv * 2);
  const tile = isEyeMat(p.matName) || !p.uv ? null : tileOf.get(texKey(p.material));
  for (let v = 0; v < nv; v++) {
    let uv = isEyeMat(p.matName) ? WHITE_UV : solidUV.get(p.material) || WHITE_UV;
    if (tile) { const u = Math.min(1, Math.max(0, p.uv[v * 2])), w = Math.min(1, Math.max(0, p.uv[v * 2 + 1])); uv = [(tile.x + 0.5 + u * (tile.w - 1)) / ATLAS, (tile.y + 0.5 + w * (tile.h - 1)) / ATLAS]; }
    p.auv[v * 2] = uv[0]; p.auv[v * 2 + 1] = uv[1];
  }
}
const atlasFile = path.join(path.dirname(out), 'b2-atlas.jpg');
fs.mkdirSync(path.dirname(out), { recursive: true });
fs.writeFileSync(atlasFile, jpeg.encode({ data: atlasData, width: ATLAS, height: ATLAS }, 86).data);
console.log('atlas guardado', atlasFile, (fs.statSync(atlasFile).size / 1024).toFixed(0), 'KB');

// Color de cada pieza, vértice a vértice (cada vértice toma la media de lo que ve en sus triángulos).
for (const p of parts) {
  const nv = p.pos.length / 3;
  const tex = matTex(p.material);
  p.col = new Float32Array(nv * 3);
  const cnt = new Float32Array(nv);
  const fallback = tex ? litMean(tex) : [90, 90, 90];
  for (let t = 0; t < p.idx.length; t += 3) {
    let c = fallback;
    if (tex && p.uv) {
      const ids = [p.idx[t], p.idx[t + 1], p.idx[t + 2]];
      const cu = (p.uv[ids[0] * 2] + p.uv[ids[1] * 2] + p.uv[ids[2] * 2]) / 3, cv = (p.uv[ids[0] * 2 + 1] + p.uv[ids[1] * 2 + 1] + p.uv[ids[2] * 2 + 1]) / 3;
      let acc = [0, 0, 0], k = 0;
      for (const id of ids) {
        const s = sample(tex, p.uv[id * 2] * 0.65 + cu * 0.35, p.uv[id * 2 + 1] * 0.65 + cv * 0.35);
        if (s[0] + s[1] + s[2] > 45) { acc = add(acc, s); k++; }
      }
      if (k) c = acc.map((v) => v / k);
    }
    for (const id of [p.idx[t], p.idx[t + 1], p.idx[t + 2]]) { for (let q = 0; q < 3; q++) p.col[id * 3 + q] += c[q]; cnt[id]++; }
  }
  const isRed = /Material\.005$/.test(p.matName), isEye = /Material\.002$/.test(p.matName);
  for (let v = 0; v < nv; v++) {
    const c = [0, 1, 2].map((q) => p.col[v * 3 + q] / (cnt[v] || 1));
    const f = isEye ? EYE : isRed ? [Math.min(255, lin(c[0]) * 255 * 1.6), lin(c[1]) * 255 * 1.2, lin(c[2]) * 255 * 1.2] : steel(c, p.matName);
    p.col.set(f, v * 3);
  }
}

// ---------- Simplificación ----------
// Objetivo de triángulos por pieza según su tamaño: las piezas grandes pierden más, las pequeñas se respetan.
function targetFor(total, lod) {
  const r = total > 8000 ? 0.1 : total > 3000 ? 0.12 : total > 1000 ? 0.16 : total > 300 ? 0.24 : 0.4;
  const min = total > 8000 ? 2300 : 36;
  let t = Math.max(Math.round(total * r), Math.min(min, total));
  if (lod === 1) t = Math.max(Math.round(t * 0.3), Math.min(20, total));
  return Math.min(t, total);
}
const UV_WEIGHT = 1.0;
function simplifyPart(p, lod) {
  // unir vértices que están en el mismo sitio y con la misma textura (el glTF repite los de las aristas duras)
  const map = new Map(); const wpos = []; const wcol = []; const wcnt = []; const wuv = [];
  const remap = new Uint32Array(p.pos.length / 3);
  for (let v = 0; v < remap.length; v++) {
    const key = `${Math.round(p.pos[v * 3] * 2000)},${Math.round(p.pos[v * 3 + 1] * 2000)},${Math.round(p.pos[v * 3 + 2] * 2000)}|${Math.round(p.auv[v * 2] * 8192)},${Math.round(p.auv[v * 2 + 1] * 8192)}`;
    let id = map.get(key);
    if (id === undefined) { id = wpos.length / 3; map.set(key, id); wpos.push(p.pos[v * 3], p.pos[v * 3 + 1], p.pos[v * 3 + 2]); wuv.push(p.auv[v * 2], p.auv[v * 2 + 1]); wcol.push(0, 0, 0); wcnt.push(0); }
    remap[v] = id; for (let q = 0; q < 3; q++) wcol[id * 3 + q] += p.col[v * 3 + q]; wcnt[id]++;
  }
  for (let i = 0; i < wcnt.length; i++) for (let q = 0; q < 3; q++) wcol[i * 3 + q] /= wcnt[i];
  const tri = [];
  for (let t = 0; t < p.idx.length; t += 3) { const a = remap[p.idx[t]], b = remap[p.idx[t + 1]], c = remap[p.idx[t + 2]]; if (a !== b && b !== c && a !== c) tri.push(a, b, c); }
  const P = new Float32Array(wpos), UV = new Float32Array(wuv);
  const total = tri.length / 3;
  const target = targetFor(total, lod);
  let idx = new Uint32Array(tri);
  if (target < total) {
    let err = 0.02;
    for (let tries = 0; tries < 6; tries++) {
      const [res] = MeshoptSimplifier.simplifyWithAttributes(idx, P, 3, UV, 2, [UV_WEIGHT, UV_WEIGHT], null, target * 3, err);
      idx = res; if (idx.length / 3 <= target * 1.15) break; err *= 3;
    }
  }
  return { P, C: wcol, UV, idx };
}

function buildLod(lod) {
  const pos = [], nor = [], col = [], bone = [], index = [], uvs = [];
  const uniq = new Map();
  let tris = 0;
  for (const p of parts) {
    const { P, C, UV, idx } = simplifyPart(p, lod);
    const nt = idx.length / 3; tris += nt;
    const fn = new Float32Array(nt * 3); const area = new Float32Array(nt);
    const inc = new Map();
    for (let t = 0; t < nt; t++) {
      const a = idx[t * 3], b = idx[t * 3 + 1], c = idx[t * 3 + 2];
      const e1 = [0, 1, 2].map((k) => P[b * 3 + k] - P[a * 3 + k]), e2 = [0, 1, 2].map((k) => P[c * 3 + k] - P[a * 3 + k]);
      const n = cross(e1, e2);
      const l = len(n) || 1; area[t] = l;
      fn.set(n.map((v) => v / l), t * 3);
      for (const v of [a, b, c]) { if (!inc.has(v)) inc.set(v, []); inc.get(v).push(t); }
    }
    for (let t = 0; t < nt; t++) {
      for (let k = 0; k < 3; k++) {
        const v = idx[t * 3 + k];
        const acc = [0, 0, 0];
        for (const u of inc.get(v)) {
          const d = fn[u * 3] * fn[t * 3] + fn[u * 3 + 1] * fn[t * 3 + 1] + fn[u * 3 + 2] * fn[t * 3 + 2];
          if (d > 0.82) for (let q = 0; q < 3; q++) acc[q] += fn[u * 3 + q] * area[u];
        }
        const l = Math.hypot(...acc) || 1;
        const Pg = tf([P[v * 3], P[v * 3 + 1], P[v * 3 + 2]]).map((q) => Math.fround(q));
        const Ng = [Math.round((-acc[0] / l) * 127), Math.round((acc[1] / l) * 127), Math.round((-acc[2] / l) * 127)]; // giro de 180° sobre Y
        // un poco más oscuro hacia abajo en cada pieza (oclusión barata)
        const sh = 0.93 + 0.07 * Math.min(1, Math.max(0, (acc[1] / l + 1) / 2));
        const Cg = [0, 1, 2].map((q) => Math.min(255, Math.round(C[v * 3 + q] * sh)));
        const Ug = [Math.round(UV[v * 2] * 65535), Math.round(UV[v * 2 + 1] * 65535)];
        const key = `${Pg.join(',')}|${Ng.join(',')}|${p.bone}|${Cg.join(',')}|${Ug.join(',')}`;
        let id = uniq.get(key);
        if (id === undefined) { id = pos.length / 3; uniq.set(key, id); pos.push(...Pg); nor.push(...Ng); col.push(...Cg); bone.push(p.bone); uvs.push(...Ug); }
        index.push(id);
      }
    }
  }
  return { pos, nor, col, bone, index, uvs, tris };
}

const lods = [buildLod(0), buildLod(1)];
for (const [i, l] of lods.entries()) console.log(`LOD${i}: ${l.tris} triángulos, ${l.pos.length / 3} vértices`);
if (lods.some((l) => l.pos.length / 3 > 65535)) throw new Error('demasiados vértices para índices de 16 bits');

// ---------- Escribir ----------
const chunks = []; let off = 0;
const push = (typed) => { const pad = (4 - (off % 4)) % 4; if (pad) { chunks.push(Buffer.alloc(pad)); off += pad; } const o = off; chunks.push(Buffer.from(typed.buffer, typed.byteOffset, typed.byteLength)); off += typed.byteLength; return o; };
const lodMeta = lods.map((l) => ({
  verts: l.pos.length / 3, tris: l.tris, indices: l.index.length,
  index: push(new Uint16Array(l.index)), pos: push(new Float32Array(l.pos)), nor: push(new Int8Array(l.nor)), col: push(new Uint8Array(l.col)), bone: push(new Uint8Array(l.bone)), uv: push(new Uint16Array(l.uvs)),
}));
const body = Buffer.concat(chunks);
const header = Buffer.from(JSON.stringify({ version: 1, scale: SC, atlas: path.basename(atlasFile), bones: bonesOut, lods: lodMeta }));
const head = Buffer.alloc(8); head.write('B2M1', 0, 'ascii'); head.writeUInt32LE(header.length, 4);
const padH = Buffer.alloc((4 - ((8 + header.length) % 4)) % 4);
fs.mkdirSync(path.dirname(out), { recursive: true });
fs.writeFileSync(out, Buffer.concat([head, header, padH, body]));
console.log('guardado', out, (fs.statSync(out).size / 1024).toFixed(0), 'KB');
