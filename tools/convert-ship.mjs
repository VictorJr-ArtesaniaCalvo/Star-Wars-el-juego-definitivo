// Conversor de modelos de Sketchfab (GLB) a un GLB ligero para el juego. Hecho para las naves grandes que se ven de lejos en el cielo;
// sirve también para objetos pequeños (ver el detonador térmico abajo).
//   node tools/convert-ship.mjs <entrada.glb> <salida.glb> --eslora=825 [--ejes=x,y,z] [--proporcion=0.15] [--error=0.01 | --metros=1]
//        [--color=512] [--brillo=256] [--relieve=0]
// - eslora: largo real (m) del modelo a lo largo de z; el modelo se escala a esa medida y se centra.
// - color / brillo / relieve: tamaño máximo (px) de las texturas de color, de brillo y de relieve (0 = quitarla; el relieve se quita por defecto).
// - ejes: de qué eje del modelo sale cada eje final (x = estribor, y = arriba, z = proa); con «-» se invierte.
//   Ej.: un modelo con la eslora en x hacia la proa y la altura en z → --ejes=y,z,x
// - cada pieza se simplifica (por defecto a ~15 % de sus triángulos) sin desviarse más del 1 % de su tamaño,
//   conservando las costuras de textura;
// - las texturas de color pasan a 512 px (JPG) y las de brillo (ventanas, motores) a 256 px; se quitan las de relieve y
//   metal/rugosidad (de lejos no se notan): metal y rugosidad quedan fijos. Las piezas de color liso no llevan textura.
// Naves convertidas:
//   Fragata Munificent → public/models/frigate.glb   --eslora=825
//   Destructor Venator → public/models/venator.glb   --eslora=1137 --ejes=y,z,x --metros=2
// Otros:
//   Detonador térmico (granada en la mano) → public/models/detonator.glb   --eslora=0.1 --proporcion=1 --relieve=512
// Necesita Python 3 con Pillow si el modelo tiene texturas.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { MeshoptSimplifier } from 'meshoptimizer';

const args = process.argv.slice(2).filter((a) => !a.startsWith('--'));
const opt = Object.fromEntries(process.argv.slice(2).filter((a) => a.startsWith('--')).map((a) => a.slice(2).split('=')));
const [src, out] = args;
if (!src || !out || !opt.eslora) { console.error('Uso: node tools/convert-ship.mjs entrada.glb salida.glb --eslora=825 [--ejes=x,y,z] [--proporcion=0.15] [--error=0.01]'); process.exit(1); }
await MeshoptSimplifier.ready;
const RATIO = Number(opt.proporcion || 0.15);
const LENGTH = Number(opt.eslora);
const MAX_ERR = Number(opt.error || 0.01); // desviación máxima permitida al simplificar (fracción del tamaño de cada pieza)
// o, con --metros, desviación máxima en metros reales (mejor cuando hay piezas que ocupan toda la nave)
const ERR_M = opt.metros ? Number(opt.metros) : null;
const errOpts = () => (ERR_M ? [ERR_M, ['ErrorAbsolute']] : [MAX_ERR, []]);
const TEX = { color: Number(opt.color ?? 512), brillo: Number(opt.brillo ?? 256), relieve: Number(opt.relieve ?? 0) };
const AXES = (opt.ejes || 'x,y,z').split(',').map((a) => ({ sign: a.startsWith('-') ? -1 : 1, k: 'xyz'.indexOf(a.replace('-', '')) }));

// ---------- Leer el GLB ----------
const glb = fs.readFileSync(src);
const jsonLen = glb.readUInt32LE(12);
const g = JSON.parse(glb.subarray(20, 20 + jsonLen).toString('utf8'));
const binStart = 20 + jsonLen + 8;
const bin = glb.subarray(binStart, binStart + glb.readUInt32LE(20 + jsonLen));
const comp = { 5126: 4, 5125: 4, 5123: 2 }, ncomp = { SCALAR: 1, VEC2: 2, VEC3: 3, VEC4: 4 };
function read(ai) {
  const a = g.accessors[ai], bv = g.bufferViews[a.bufferView];
  const sz = comp[a.componentType], n = ncomp[a.type], stride = bv.byteStride || n * sz;
  const base = (bv.byteOffset || 0) + (a.byteOffset || 0);
  const outA = a.componentType === 5126 ? new Float32Array(a.count * n) : new Uint32Array(a.count * n);
  for (let i = 0; i < a.count; i++) for (let k = 0; k < n; k++) {
    const o = base + i * stride + k * sz;
    outA[i * n + k] = a.componentType === 5126 ? bin.readFloatLE(o) : a.componentType === 5125 ? bin.readUInt32LE(o) : bin.readUInt16LE(o);
  }
  return outA;
}
const imageBytes = (i) => { const bv = g.bufferViews[g.images[i].bufferView]; return bin.subarray(bv.byteOffset || 0, (bv.byteOffset || 0) + bv.byteLength); };

// Se usan las coordenadas propias de cada pieza (en estos modelos ninguna lleva giro propio; los nodos de encima solo
// colocan la nave para el visor de Sketchfab) y se reordenan los ejes según --ejes.
const hasTex = (mi) => !!g.materials[mi]?.pbrMetallicRoughness?.baseColorTexture || !!g.materials[mi]?.emissiveTexture;
const swap = (a) => { const o = new Float32Array(a.length); for (let i = 0; i < a.length; i += 3) for (let k = 0; k < 3; k++) o[i + k] = AXES[k].sign * a[i + AXES[k].k]; return o; };
const pieces = g.meshes.flatMap((m) => m.primitives.map((pr) => {
  const pos = swap(read(pr.attributes.POSITION));
  const tex = hasTex(pr.material) && pr.attributes.TEXCOORD_0 !== undefined;
  return { name: m.name, material: pr.material, pos, nor: swap(read(pr.attributes.NORMAL)), uv: tex ? read(pr.attributes.TEXCOORD_0) : null, idx: pr.indices !== undefined ? read(pr.indices) : Uint32Array.from({ length: pos.length / 3 }, (_, k) => k) };
}));
// si el cambio de ejes es un espejo (determinante negativo), se da la vuelta a los triángulos para que no queden del revés
const M = AXES.map((a) => [0, 1, 2].map((k) => (k === a.k ? a.sign : 0)));
const det = M[0][0] * (M[1][1] * M[2][2] - M[1][2] * M[2][1]) - M[0][1] * (M[1][0] * M[2][2] - M[1][2] * M[2][0]) + M[0][2] * (M[1][0] * M[2][1] - M[1][1] * M[2][0]);
if (det < 0) for (const p of pieces) for (let t = 0; t < p.idx.length; t += 3) { const x = p.idx[t + 1]; p.idx[t + 1] = p.idx[t + 2]; p.idx[t + 2] = x; }

// ---------- Centrar y pasar a metros ----------
const mn = [1e9, 1e9, 1e9], mx = [-1e9, -1e9, -1e9];
for (const p of pieces) for (let i = 0; i < p.pos.length; i += 3) for (let k = 0; k < 3; k++) { mn[k] = Math.min(mn[k], p.pos[i + k]); mx[k] = Math.max(mx[k], p.pos[i + k]); }
const K = LENGTH / (mx[2] - mn[2]);
const C = mn.map((v, k) => (v + mx[k]) / 2);
for (const p of pieces) for (let i = 0; i < p.pos.length; i += 3) for (let k = 0; k < 3; k++) p.pos[i + k] = (p.pos[i + k] - C[k]) * K;
console.log('tamaño final (m):', mx.map((v, k) => +((v - mn[k]) * K).toPrecision(3)).join(' × '));

// ---------- Simplificar ----------
// Piezas de color liso (sin textura): suelen venir partidas en muchas caras sueltas (una copia de cada vértice por cara), lo que
// impide simplificar. Se unen los vértices que están en el mismo sitio, se simplifica y luego se recalculan las normales
// con aristas vivas: caras que se doblan más de CREASE grados no se suavizan entre sí (como en el modelo original).
const CREASE = Math.cos((35 * Math.PI) / 180);
function weld(p) {
  const map = new Map(), pos = [], remap = new Uint32Array(p.pos.length / 3);
  for (let v = 0; v < remap.length; v++) {
    const key = `${Math.round(p.pos[v * 3] * 100)},${Math.round(p.pos[v * 3 + 1] * 100)},${Math.round(p.pos[v * 3 + 2] * 100)}`; // al centímetro
    let id = map.get(key);
    if (id === undefined) { id = pos.length / 3; map.set(key, id); pos.push(p.pos[v * 3], p.pos[v * 3 + 1], p.pos[v * 3 + 2]); }
    remap[v] = id;
  }
  const idx = [];
  for (let t = 0; t < p.idx.length; t += 3) { const a = remap[p.idx[t]], b = remap[p.idx[t + 1]], c = remap[p.idx[t + 2]]; if (a !== b && b !== c && a !== c) idx.push(a, b, c); }
  return { pos: new Float32Array(pos), idx: new Uint32Array(idx) };
}
function creaseNormals(pos, idx) {
  const nT = idx.length / 3, fn = new Float32Array(nT * 3), around = new Map();
  for (let t = 0; t < nT; t++) {
    const [a, b, c] = [idx[t * 3], idx[t * 3 + 1], idx[t * 3 + 2]];
    const ux = pos[b * 3] - pos[a * 3], uy = pos[b * 3 + 1] - pos[a * 3 + 1], uz = pos[b * 3 + 2] - pos[a * 3 + 2];
    const vx = pos[c * 3] - pos[a * 3], vy = pos[c * 3 + 1] - pos[a * 3 + 1], vz = pos[c * 3 + 2] - pos[a * 3 + 2];
    const nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx, l = Math.hypot(nx, ny, nz) || 1;
    fn.set([nx / l, ny / l, nz / l], t * 3); // también lleva el área (sin normalizar) para pesar: aquí basta la dirección
    for (const v of [a, b, c]) { if (!around.has(v)) around.set(v, []); around.get(v).push(t); }
  }
  const outPos = [], outNor = [], outIdx = [], key = new Map();
  for (let t = 0; t < nT; t++) for (let k = 0; k < 3; k++) {
    const v = idx[t * 3 + k];
    let nx = 0, ny = 0, nz = 0;
    for (const u of around.get(v)) {
      // en las piezas de doble cara el lado no importa: se juntan caras paralelas aunque miren al revés
      const d = fn[t * 3] * fn[u * 3] + fn[t * 3 + 1] * fn[u * 3 + 1] + fn[t * 3 + 2] * fn[u * 3 + 2];
      if (d >= CREASE) { nx += fn[u * 3]; ny += fn[u * 3 + 1]; nz += fn[u * 3 + 2]; }
    }
    const l = Math.hypot(nx, ny, nz) || 1; nx /= l; ny /= l; nz /= l;
    const kk = `${v},${Math.round(nx * 50)},${Math.round(ny * 50)},${Math.round(nz * 50)}`;
    let id = key.get(kk);
    if (id === undefined) { id = outPos.length / 3; key.set(kk, id); outPos.push(pos[v * 3], pos[v * 3 + 1], pos[v * 3 + 2]); outNor.push(nx, ny, nz); }
    outIdx.push(id);
  }
  return { pos: new Float32Array(outPos), nor: new Float32Array(outNor), idx: new Uint16Array(outIdx) };
}

function simplify(p, ratio, minTris) {
  const total = p.idx.length / 3;
  const target = Math.max(Math.min(minTris, total), Math.round(total * ratio));
  if (!p.uv) {
    const w = weld(p);
    const [res] = target < total ? MeshoptSimplifier.simplify(w.idx, w.pos, 3, target * 3, errOpts()[0], errOpts()[1]) : [w.idx];
    return { name: p.name, material: p.material, ...creaseNormals(w.pos, res), uv: null, before: total };
  }
  let idx = p.idx;
  if (target < total) {
    // error máximo: 1 % del tamaño de la pieza; «Permissive» deja simplificar también junto a las costuras de textura
    [idx] = MeshoptSimplifier.simplifyWithAttributes(p.idx, p.pos, 3, p.uv, 2, [0.5, 0.5], null, target * 3, errOpts()[0], ['Permissive', ...errOpts()[1]]);
  }
  const used = new Map(); const pos = [], nor = [], uv = [], o = [];
  for (const v of idx) {
    let id = used.get(v);
    if (id === undefined) { id = pos.length / 3; used.set(v, id); pos.push(p.pos[v * 3], p.pos[v * 3 + 1], p.pos[v * 3 + 2]); nor.push(p.nor[v * 3], p.nor[v * 3 + 1], p.nor[v * 3 + 2]); uv.push(p.uv[v * 2], p.uv[v * 2 + 1]); }
    o.push(id);
  }
  return { name: p.name, material: p.material, pos: new Float32Array(pos), nor: new Float32Array(nor), uv: new Float32Array(uv), idx: new Uint16Array(o), before: total };
}
const parts = pieces.map((p) => simplify(p, RATIO, 150));
let before = 0, after = 0;
for (const p of parts) {
  before += p.before; after += p.idx.length / 3;
  console.log(p.name.padEnd(10), g.materials[p.material].name.padEnd(15), String(p.before).padStart(6), '→', String(p.idx.length / 3).padStart(5), 'triángulos');
  if (p.pos.length / 3 > 65535) throw new Error('demasiados vértices en ' + p.name);
}
console.log('TOTAL', before, '→', after, 'triángulos');

// ---------- Texturas (Pillow) ----------
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'nave-'));
const texJobs = new Map(); // imagen original → {tamaño}
const want = (tex, size) => { if (tex) { const img = g.textures[tex.index].source; texJobs.set(img, Math.max(texJobs.get(img) || 0, size)); } };
for (const m of g.materials) {
  if (TEX.color) want(m.pbrMetallicRoughness?.baseColorTexture, TEX.color);
  if (TEX.brillo) want(m.emissiveTexture, TEX.brillo);
  if (TEX.relieve) want(m.normalTexture, TEX.relieve);
}
const list = []; if (!texJobs.size) if (list.length) fs.rmSync(tmp, { recursive: true, force: true });
for (const [img, size] of texJobs) { const f = path.join(tmp, `${img}.png`); fs.writeFileSync(f, imageBytes(img)); list.push(`${f}:${size}`); }
const py = `import sys
from PIL import Image
for a in sys.argv[1:]:
    f, s = a.rsplit(':', 1); s = int(s)
    im = Image.open(f).convert('RGB')
    if im.width > s: im = im.resize((s, s * im.height // im.width), Image.LANCZOS)
    im.save(f[:-4] + '.jpg', quality=85, optimize=True)`;
if (list.length) execFileSync('python3', ['-I', '-c', py, ...list]);
const imgIndex = new Map(); const images = [];
for (const img of texJobs.keys()) { imgIndex.set(img, images.length); images.push(fs.readFileSync(path.join(tmp, `${img}.jpg`))); }
if (list.length) fs.rmSync(tmp, { recursive: true, force: true });

// ---------- Escribir el GLB ----------
const chunks = []; let off = 0; const views = [];
const push = (buf, target) => {
  const pad = (4 - (off % 4)) % 4; if (pad) { chunks.push(Buffer.alloc(pad)); off += pad; }
  views.push({ buffer: 0, byteOffset: off, byteLength: buf.byteLength, ...(target ? { target } : {}) });
  chunks.push(Buffer.from(buf.buffer ? Buffer.from(buf.buffer, buf.byteOffset, buf.byteLength) : buf)); off += buf.byteLength;
  return views.length - 1;
};
const accessors = [];
const acc = (typed, type, componentType, target, extra = {}) => { accessors.push({ bufferView: push(typed, target), componentType, count: typed.length / ncomp[type], type, ...extra }); return accessors.length - 1; };
const meshes = parts.map((p) => {
  const pmn = [1e9, 1e9, 1e9], pmx = [-1e9, -1e9, -1e9];
  for (let i = 0; i < p.pos.length; i += 3) for (let k = 0; k < 3; k++) { pmn[k] = Math.min(pmn[k], p.pos[i + k]); pmx[k] = Math.max(pmx[k], p.pos[i + k]); }
  return { name: g.materials[p.material].name, primitives: [{ attributes: {
    POSITION: acc(p.pos, 'VEC3', 5126, 34962, { min: pmn, max: pmx }),
    NORMAL: acc(p.nor, 'VEC3', 5126, 34962),
    ...(p.uv ? { TEXCOORD_0: acc(p.uv, 'VEC2', 5126, 34962) } : {}),
  }, indices: acc(p.idx, 'SCALAR', 5123, 34963), material: p.material }] };
});
const imageViews = images.map((b) => push(b));
const texOf = (t) => (t && imgIndex.has(g.textures[t.index].source) ? { index: imgIndex.get(g.textures[t.index].source) } : undefined);
const materials = g.materials.map((m) => {
  const pbr = m.pbrMetallicRoughness || {};
  const o = { name: m.name, doubleSided: true, pbrMetallicRoughness: { metallicFactor: 0.25, roughnessFactor: 0.7 } };
  if (texOf(pbr.baseColorTexture)) o.pbrMetallicRoughness.baseColorTexture = texOf(pbr.baseColorTexture);
  if (texOf(m.normalTexture)) o.normalTexture = texOf(m.normalTexture);
  if (pbr.baseColorFactor) o.pbrMetallicRoughness.baseColorFactor = pbr.baseColorFactor;
  if (texOf(m.emissiveTexture)) { o.emissiveTexture = texOf(m.emissiveTexture); o.emissiveFactor = m.emissiveFactor || [1, 1, 1]; if (m.extensions?.KHR_materials_emissive_strength) o.extensions = { KHR_materials_emissive_strength: m.extensions.KHR_materials_emissive_strength }; }
  return o;
});
const json = {
  asset: { version: '2.0', generator: 'tools/convert-ship.mjs', extras: g.asset.extras },
  extensionsUsed: ['KHR_materials_emissive_strength'],
  scene: 0, scenes: [{ nodes: [0] }],
  nodes: [{ name: path.basename(out, '.glb'), children: meshes.map((_, i) => i + 1) }, ...meshes.map((m, i) => ({ name: m.name, mesh: i }))],
  meshes, materials,
  ...(images.length ? {
    samplers: [{ magFilter: 9729, minFilter: 9987, wrapS: 10497, wrapT: 10497 }],
    images: imageViews.map((v) => ({ bufferView: v, mimeType: 'image/jpeg' })),
    textures: images.map((_, i) => ({ sampler: 0, source: i })),
  } : {}),
  accessors, bufferViews: views, buffers: [{ byteLength: off }],
};
const body = Buffer.concat(chunks);
const jsonBuf = Buffer.from(JSON.stringify(json));
const jsonPad = Buffer.concat([jsonBuf, Buffer.alloc((4 - (jsonBuf.length % 4)) % 4, 0x20)]);
const binPad = Buffer.concat([body, Buffer.alloc((4 - (body.length % 4)) % 4)]);
const header = Buffer.alloc(12); header.write('glTF', 0, 'ascii'); header.writeUInt32LE(2, 4); header.writeUInt32LE(12 + 8 + jsonPad.length + 8 + binPad.length, 8);
const ch = (len, type) => { const b = Buffer.alloc(8); b.writeUInt32LE(len, 0); b.write(type, 4, 'ascii'); return b; };
fs.mkdirSync(path.dirname(out), { recursive: true });
fs.writeFileSync(out, Buffer.concat([header, ch(jsonPad.length, 'JSON'), jsonPad, ch(binPad.length, 'BIN\0'), binPad]));
console.log('texturas:', images.length, (images.reduce((s, b) => s + b.length, 0) / 1024).toFixed(0), 'KB');
console.log('guardado', out, (fs.statSync(out).size / 1024).toFixed(0), 'KB');
