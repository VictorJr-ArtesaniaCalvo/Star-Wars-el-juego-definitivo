// Conversor del bláster E-5 (glTF de Sketchfab, A308 Digital, CC-BY 4.0) a un archivo compacto para el arma del jugador.
//   node tools/convert-blaster.mjs <scene.gltf> <textura-horneada.jpg> [salida=public/models/blaster.bin]
// La textura horneada es la imagen de color del autor (gris) multiplicada por su mapa de oclusión (canal R del mapa metal/rugosidad):
//   base * (0.40 + 0.60 * oclusión), guardada como JPG de 1024×1024. (El autor trae el mapa de normales plano, no se usa.)
// El modelo se gira para que el cañón apunte hacia -Z (como el resto del juego), se escala a LARGO unidades y se coloca con la boca del
// cañón en z = -BOCA y el eje del cañón en y = 0. Los datos van tal cual (sin simplificar: son ~4.900 triángulos).
import fs from 'node:fs';
import path from 'node:path';
import { loadGltf } from './gltf-lib.mjs';

const [, , src, texJpg, out = 'public/models/blaster.bin'] = process.argv;
if (!src || !texJpg) { console.error('Uso: node tools/convert-blaster.mjs scene.gltf textura.jpg [salida]'); process.exit(1); }
const LARGO = 0.8; // longitud total del arma (unidades del arma en cámara)
const BOCA = 0.45; // distancia de la boca del cañón al origen del arma

const { pieces } = loadGltf(src);
const p = pieces[0];
const n = p.pos.length / 3;
// el modelo original apunta hacia +Z (boca) con la culata en -Z: se gira 180° sobre Y
const pos = new Float32Array(p.pos.length), nor = new Float32Array(p.nor.length);
for (let i = 0; i < n; i++) {
  pos[i * 3] = -p.pos[i * 3]; pos[i * 3 + 1] = p.pos[i * 3 + 1]; pos[i * 3 + 2] = -p.pos[i * 3 + 2];
  nor[i * 3] = -p.nor[i * 3]; nor[i * 3 + 1] = p.nor[i * 3 + 1]; nor[i * 3 + 2] = -p.nor[i * 3 + 2];
}
let zmin = 1e9, zmax = -1e9;
for (let i = 0; i < n; i++) { zmin = Math.min(zmin, pos[i * 3 + 2]); zmax = Math.max(zmax, pos[i * 3 + 2]); }
const K = LARGO / (zmax - zmin);
// eje del cañón: centro de los vértices del último 3 % (la punta)
let sx = 0, sy = 0, cnt = 0;
for (let i = 0; i < n; i++) if (pos[i * 3 + 2] < zmin + (zmax - zmin) * 0.03) { sx += pos[i * 3]; sy += pos[i * 3 + 1]; cnt++; }
const cx = sx / cnt, cy = sy / cnt;
for (let i = 0; i < n; i++) {
  pos[i * 3] = (pos[i * 3] - cx) * K;
  pos[i * 3 + 1] = (pos[i * 3 + 1] - cy) * K;
  pos[i * 3 + 2] = (pos[i * 3 + 2] - zmin) * K - BOCA;
}
const mn = [1e9, 1e9, 1e9], mx = [-1e9, -1e9, -1e9];
for (let i = 0; i < n; i++) for (let k = 0; k < 3; k++) { mn[k] = Math.min(mn[k], pos[i * 3 + k]); mx[k] = Math.max(mx[k], pos[i * 3 + k]); }
console.log('caja final', mn.map((v) => v.toFixed(3)).join(','), '→', mx.map((v) => v.toFixed(3)).join(','), ' triángulos', p.idx.length / 3, 'vértices', n);
if (n > 65535) throw new Error('demasiados vértices');

const chunks = []; let off = 0;
const push = (typed) => { const pad = (4 - (off % 4)) % 4; if (pad) { chunks.push(Buffer.alloc(pad)); off += pad; } const o = off; chunks.push(Buffer.from(typed.buffer, typed.byteOffset, typed.byteLength)); off += typed.byteLength; return o; };
const q = new Int8Array(nor.length); for (let i = 0; i < q.length; i++) q[i] = Math.round(Math.max(-1, Math.min(1, nor[i])) * 127);
const header = { version: 1, texture: 'blaster-color.jpg', muzzle: [0, 0, -BOCA], verts: n, indices: p.idx.length, index: push(new Uint16Array(p.idx)), pos: push(pos), nor: push(q), uv: push(new Float32Array(p.uv)) };
const hb = Buffer.from(JSON.stringify(header));
const head = Buffer.alloc(8); head.write('BLS1', 0, 'ascii'); head.writeUInt32LE(hb.length, 4);
const padH = Buffer.alloc((4 - ((8 + hb.length) % 4)) % 4);
fs.mkdirSync(path.dirname(out), { recursive: true });
fs.writeFileSync(out, Buffer.concat([head, hb, padH, Buffer.concat(chunks)]));
fs.copyFileSync(texJpg, path.join(path.dirname(out), 'blaster-color.jpg'));
console.log('guardado', out, (fs.statSync(out).size / 1024).toFixed(0), 'KB; textura', (fs.statSync(path.join(path.dirname(out), 'blaster-color.jpg')).size / 1024).toFixed(0), 'KB');
