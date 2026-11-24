// Conversor del modelo 3D de la cañonera LAAT (glTF de Sketchfab) a un archivo compacto para el juego.
//   node tools/convert-laat.mjs <scene.gltf> <carpeta-de-texturas-jpg> [salida=public/models/laat.bin]
// - El casco exterior (una sola pieza con las alas dentro) se parte con un corte limpio junto al fuselaje: queda el casco con un ala
//   (y el muñón del otro lado) y, aparte, el ala arrancada, que el juego deja tirada como cobertura.
// - Del interior (bahía, cabina) se conserva lo que se ve desde fuera, simplificado; los objetos diminutos se descartan.
// - Las texturas del autor se reducen a la mitad de tamaño. El modelo no se edita: los daños (hollín, humo, fuego) se simulan en el juego.
import fs from 'node:fs';
import path from 'node:path';
import jpeg from 'jpeg-js';
import { MeshoptSimplifier } from 'meshoptimizer';
import { loadGltf } from './gltf-lib.mjs';

const [, , src, texDir, out = 'public/models/laat.bin'] = process.argv;
if (!src || !texDir) { console.error('Uso: node tools/convert-laat.mjs scene.gltf carpeta-texturas [salida]'); process.exit(1); }
await MeshoptSimplifier.ready;

const SPAN = 17.4; // envergadura real de la LAAT/i (m): el modelo se pasa a metros reales; el juego lo reduce con su propia escala
const CUT = 2.15; // el ala se corta a esta distancia del eje (m, a escala real): justo fuera del fuselaje
const { g, pieces } = loadGltf(src);

// ---------- Centrar y pasar a metros ----------
let mn = [1e9, 1e9, 1e9], mx = [-1e9, -1e9, -1e9];
for (const p of pieces) for (let i = 0; i < p.pos.length; i += 3) for (let k = 0; k < 3; k++) { mn[k] = Math.min(mn[k], p.pos[i + k]); mx[k] = Math.max(mx[k], p.pos[i + k]); }
const K = SPAN / (mx[2] - mn[2]);
const C = mn.map((v, k) => (v + mx[k]) / 2);
for (const p of pieces) {
  for (let i = 0; i < p.pos.length; i += 3) for (let k = 0; k < 3; k++) p.pos[i + k] = (p.pos[i + k] - C[k]) * K;
  // las coordenadas de textura vienen con v entre -1 y 0 (textura repetida): se pasan a 0..1
  if (p.uv) for (let i = 1; i < p.uv.length; i += 2) p.uv[i] = p.uv[i] - Math.floor(p.uv[i]);
}
console.log('escala', K.toFixed(3), 'caja final', mn.map((v, k) => ((v - C[k]) * K).toFixed(1)).join(','), '→', mx.map((v, k) => ((v - C[k]) * K).toFixed(1)).join(','));

// ---------- Cortar el casco por el plano z = CUT (Sutherland–Hodgman) ----------
// Vértice = [px,py,pz, nx,ny,nz, u,v]
const vtx = (p, i) => [p.pos[i * 3], p.pos[i * 3 + 1], p.pos[i * 3 + 2], p.nor[i * 3], p.nor[i * 3 + 1], p.nor[i * 3 + 2], p.uv[i * 2], p.uv[i * 2 + 1]];
const lerpV = (a, b, t) => a.map((v, k) => v + (b[k] - v) * t);
function clipPoly(poly, keepOver) {
  const out = [];
  for (let i = 0; i < poly.length; i++) {
    const a = poly[i], b = poly[(i + 1) % poly.length];
    const da = a[2] - CUT, db = b[2] - CUT;
    const ina = keepOver ? da >= 0 : da < 0, inb = keepOver ? db >= 0 : db < 0;
    if (ina) out.push(a);
    if (ina !== inb) { const t = da / (da - db); const v = lerpV(a, b, t); v[2] = CUT; out.push(v); }
  }
  return out;
}
function splitWing(p) {
  const rest = [], wing = []; // listas de triángulos (cada uno: 3 vértices)
  for (let t = 0; t < p.idx.length; t += 3) {
    const tri = [vtx(p, p.idx[t]), vtx(p, p.idx[t + 1]), vtx(p, p.idx[t + 2])];
    const zs = tri.map((v) => v[2]);
    if (Math.max(...zs) <= CUT) { rest.push(tri); continue; }
    if (Math.min(...zs) >= CUT) { wing.push(tri); continue; }
    for (const [list, over] of [[rest, false], [wing, true]]) {
      const poly = clipPoly(tri, over);
      for (let k = 1; k < poly.length - 1; k++) list.push([poly[0], poly[k], poly[k + 1]]);
    }
  }
  return { rest, wing };
}

// ---------- Partes ----------
const byName = (n) => pieces.find((p) => p.name === n);
const shell = byName('Object_5'); // casco exterior
const { rest, wing } = splitWing(shell);
console.log('casco:', rest.length, 'triángulos;  ala arrancada:', wing.length);

// Lista de triángulos → malla soldada (posición+normal+uv iguales)
function toMesh(tris) {
  const map = new Map(); const pos = [], nor = [], uv = []; const idx = [];
  for (const tri of tris) for (const v of tri) {
    const key = v.map((q, k) => Math.round(q * (k < 3 ? 2000 : k < 6 ? 100 : 4096))).join(',');
    let id = map.get(key);
    if (id === undefined) { id = pos.length / 3; map.set(key, id); pos.push(v[0], v[1], v[2]); nor.push(v[3], v[4], v[5]); uv.push(v[6], v[7]); }
    idx.push(id);
  }
  // quitar triángulos degenerados
  const clean = [];
  for (let t = 0; t < idx.length; t += 3) if (idx[t] !== idx[t + 1] && idx[t + 1] !== idx[t + 2] && idx[t] !== idx[t + 2]) clean.push(idx[t], idx[t + 1], idx[t + 2]);
  return { pos: new Float32Array(pos), nor: new Float32Array(nor), uv: new Float32Array(uv), idx: new Uint32Array(clean) };
}
const fromPiece = (p) => toMesh(Array.from({ length: p.idx.length / 3 }, (_, t) => [vtx(p, p.idx[t * 3]), vtx(p, p.idx[t * 3 + 1]), vtx(p, p.idx[t * 3 + 2])]));

// Simplifica conservando las coordenadas de textura
function simplify(m, ratio, minTris) {
  const total = m.idx.length / 3;
  const target = Math.max(Math.min(minTris, total), Math.round(total * ratio));
  if (target >= total) return m;
  let idx = m.idx, err = 0.01;
  for (let tries = 0; tries < 6; tries++) {
    const [res] = MeshoptSimplifier.simplifyWithAttributes(m.idx, m.pos, 3, m.uv, 2, [1, 1], null, target * 3, err);
    idx = res; if (idx.length / 3 <= target * 1.15) break; err *= 3;
  }
  // compactar: solo los vértices usados
  const used = new Map(); const pos = [], nor = [], uv = []; const out = [];
  for (const v of idx) {
    let id = used.get(v);
    if (id === undefined) { id = pos.length / 3; used.set(v, id); pos.push(m.pos[v * 3], m.pos[v * 3 + 1], m.pos[v * 3 + 2]); nor.push(m.nor[v * 3], m.nor[v * 3 + 1], m.nor[v * 3 + 2]); uv.push(m.uv[v * 2], m.uv[v * 2 + 1]); }
    out.push(id);
  }
  return { pos: new Float32Array(pos), nor: new Float32Array(nor), uv: new Float32Array(uv), idx: new Uint32Array(out) };
}

// Materiales (textura reducida)
const texFiles = ['laat-casco.jpg', 'laat-cabina.jpg', 'laat-bahia.jpg'];
const matSources = { 'Tex_0000_1': 0, 'Tex_0001_0': 1, 'Tex_0005_0': 2 };
function downscale2(img) {
  const w = img.width >> 1, h = img.height >> 1, d = new Uint8Array(w * h * 4);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) for (let q = 0; q < 4; q++) {
    const o = (a, b) => ((y * 2 + a) * img.width + x * 2 + b) * 4 + q;
    d[(y * w + x) * 4 + q] = (img.data[o(0, 0)] + img.data[o(0, 1)] + img.data[o(1, 0)] + img.data[o(1, 1)]) >> 2;
  }
  return { width: w, height: h, data: d };
}
const outDir = path.dirname(out);
fs.mkdirSync(outDir, { recursive: true });
const texInfo = [];
for (const [name, i] of Object.entries(matSources)) {
  let img = jpeg.decode(fs.readFileSync(path.join(texDir, `${name}_baseColor.jpg`)), { useTArray: true });
  if (img.width > 1024 || name === 'Tex_0005_0') img = downscale2(img); // el exterior pasa de 2048 a 1024 y la bahía de 1024×512 a 512×256
  const file = path.join(outDir, texFiles[i]);
  fs.writeFileSync(file, jpeg.encode({ data: img.data, width: img.width, height: img.height }, 86).data);
  texInfo[i] = { file: texFiles[i], w: img.width, h: img.height };
  console.log('textura', texFiles[i], img.width + '×' + img.height, (fs.statSync(file).size / 1024).toFixed(0), 'KB');
}

const parts = [
  { name: 'casco', material: 0, mesh: simplify(toMesh(rest), 0.8, 3000) },
  { name: 'ala', material: 0, mesh: simplify(toMesh(wing), 0.8, 500) },
  { name: 'cabina', material: 1, mesh: simplify(fromPiece(byName('Object_7')), 0.5, 200) },
  { name: 'bahia', material: 2, mesh: simplify(fromPiece(byName('Object_9')), 0.3, 800) },
  { name: 'marco', material: 2, mesh: fromPiece(byName('Object_15')) },
];
let total = 0;
for (const p of parts) { total += p.mesh.idx.length / 3; console.log(p.name.padEnd(7), String(p.mesh.idx.length / 3).padStart(5), 'triángulos', p.mesh.pos.length / 3, 'vértices'); }
console.log('TOTAL', total, 'triángulos');
for (const p of parts) if (p.mesh.pos.length / 3 > 65535) throw new Error('demasiados vértices en ' + p.name);

// ---------- Escribir ----------
const chunks = []; let off = 0;
const push = (typed) => { const pad = (4 - (off % 4)) % 4; if (pad) { chunks.push(Buffer.alloc(pad)); off += pad; } const o = off; chunks.push(Buffer.from(typed.buffer, typed.byteOffset, typed.byteLength)); off += typed.byteLength; return o; };
const partMeta = parts.map((p) => {
  const q = new Int8Array(p.mesh.nor.length);
  for (let i = 0; i < q.length; i++) q[i] = Math.round(Math.max(-1, Math.min(1, p.mesh.nor[i])) * 127);
  return { name: p.name, material: p.material, verts: p.mesh.pos.length / 3, indices: p.mesh.idx.length, index: push(new Uint16Array(p.mesh.idx)), pos: push(p.mesh.pos), nor: push(q), uv: push(p.mesh.uv) };
});
const body = Buffer.concat(chunks);
const header = Buffer.from(JSON.stringify({ version: 1, span: SPAN, cut: CUT, textures: texInfo.map((t) => t.file), parts: partMeta }));
const head = Buffer.alloc(8); head.write('LAT1', 0, 'ascii'); head.writeUInt32LE(header.length, 4);
const padH = Buffer.alloc((4 - ((8 + header.length) % 4)) % 4);
fs.writeFileSync(out, Buffer.concat([head, header, padH, body]));
console.log('guardado', out, (fs.statSync(out).size / 1024).toFixed(0), 'KB');
