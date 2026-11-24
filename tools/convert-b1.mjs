// Conversor del modelo 3D del droide B1 (OBJ con piezas separadas) a un archivo compacto para el juego.
//   node tools/convert-b1.mjs <B1DROID.obj> [salida=public/models/b1.bin]
// - Quita piezas duplicadas, reparte cada pieza a un hueso del esqueleto y simplifica cada una (meshoptimizer).
// - Colorea con la arena de las texturas del autor (las texturas pintadas no se usan: se pasa solo la geometría).
// - Genera dos niveles de detalle: 0 (cerca) y 1 (lejos), con el mismo esqueleto.
import fs from 'node:fs';
import { MeshoptSimplifier } from 'meshoptimizer';

const [, , src, out = 'public/models/b1.bin'] = process.argv;
if (!src) { console.error('Uso: node tools/convert-b1.mjs B1DROID.obj [salida]'); process.exit(1); }
await MeshoptSimplifier.ready;

const SCALE = 2.6; // unidades del modelo → metros (el B1 mide ~1,9 m)
// El modelo mira hacia +Z; el juego, hacia -Z: giro de 180° sobre Y.
const tf = (x, y, z) => [-x * SCALE, y * SCALE, -z * SCALE];

// ---------- Leer el OBJ ----------
const V = [];
const parts = [];
let cur = null;
for (const line of fs.readFileSync(src, 'utf8').split('\n')) {
  if (line.startsWith('v ')) { const t = line.trim().split(/\s+/); V.push([+t[1], +t[2], +t[3]]); }
  else if (line.startsWith('o ')) { cur = { name: line.slice(2).trim(), faces: [] }; parts.push(cur); }
  else if (line.startsWith('f ') && cur) cur.faces.push(line.trim().split(/\s+/).slice(1).map((t) => parseInt(t.split('/')[0], 10) - 1));
}

// ---------- Esqueleto ----------
const BONES = [
  ['root', -1], ['spine', 0], ['neck', 1], ['head', 2],
  ['armL', 1], ['forearmL', 4], ['handL', 5], ['armR', 1], ['forearmR', 7], ['handR', 8],
  ['thighL', 0], ['shinL', 10], ['footL', 11], ['thighR', 0], ['shinR', 13], ['footR', 14], ['gun', 1],
];
const B = Object.fromEntries(BONES.map(([n], i) => [n, i]));

// Clasificación por nombre: [expresión, hueso, tipo]. «.L» del modelo (x>0) pasa a ser el lado -x del juego: «L».
const RULES = [
  [/^hip|^leg_part/, 'root', 'joint'],
  [/^body_Cube/, 'spine', 'body'],
  [/^Cube_Cube|^Cylinder/, 'spine', 'radio'],
  [/^neck/, 'neck', 'neck'],
  [/^head_Cube/, 'head', 'head'],
  [/^head_rotat/, 'head', 'joint'],
  [/^arm1_rotat\.L|^arm\.L_Cyl|^arm_2_rotat\.L/, 'armL', 'limb'],
  [/^arm1_rotat\.R|^arm\.L\.002|^arm_2_rotat\.R/, 'armR', 'limb'],
  [/^arm_2_controller\.L|^arm2\.L/, 'forearmL', 'limb'],
  [/^arm_2_controller\.R|^arm2\.R/, 'forearmR', 'limb'],
  [/^hand.*\.L|^finger.*\.L/, 'handL', 'finger'],
  [/^hand.*\.R|^finger.*\.R/, 'handR', 'finger'],
  [/^leg_rotat\.L|^leg\.L_Cube/, 'thighL', 'limb'],
  [/^leg_rotat\.R|^leg\.R_Cube/, 'thighR', 'limb'],
  [/^leg_2_rotat\.L_|^leg\.L\.001/, 'shinL', 'limb'],
  [/^leg_2_rotat\.L\.001|^leg\.R\.001/, 'shinR', 'limb'],
  [/^foot.*\.L|^foot_rotat\.L/, 'footL', 'foot'],
  [/^foot.*\.R|^foot_rotat\.R/, 'footR', 'foot'],
  [/^rifle/, 'gun', 'gun'],
];
function classify(name) {
  for (const [re, bone, kind] of RULES) if (re.test(name)) return { bone: B[bone], kind: /rotat|controller/.test(name) && kind !== 'gun' ? 'joint' : kind };
  return null;
}

// ---------- Filtrar: sin caras, duplicados, objetos sin clasificar ----------
const bboxKey = (p) => {
  const mn = [1e9, 1e9, 1e9], mx = [-1e9, -1e9, -1e9];
  for (const f of p.faces) for (const i of f) for (let k = 0; k < 3; k++) { mn[k] = Math.min(mn[k], V[i][k]); mx[k] = Math.max(mx[k], V[i][k]); }
  return [...mn, ...mx].map((v) => v.toFixed(4)).join(',') + ':' + p.faces.length;
};
const seen = new Set();
const use = [];
for (const p of parts) {
  if (!p.faces.length) continue;
  const key = bboxKey(p);
  if (seen.has(key)) { console.log('duplicada, se descarta:', p.name); continue; }
  seen.add(key);
  const c = classify(p.name);
  if (!c) { console.log('sin clasificar, se descarta:', p.name); continue; }
  p.bone = c.bone; p.kind = c.kind;
  use.push(p);
}

// ---------- Pivotes (centro de las piezas «rotat» = articulaciones) ----------
const center = (re) => {
  const p = parts.find((q) => re.test(q.name) && q.faces.length);
  const mn = [1e9, 1e9, 1e9], mx = [-1e9, -1e9, -1e9];
  for (const f of p.faces) for (const i of f) for (let k = 0; k < 3; k++) { mn[k] = Math.min(mn[k], V[i][k]); mx[k] = Math.max(mx[k], V[i][k]); }
  return [0, 1, 2].map((k) => (mn[k] + mx[k]) / 2);
};
const pivotsOrig = {
  root: center(/^hip_Cylinder/), spine: center(/^hip_Cylinder/),
  neck: center(/^neck_controller/), head: center(/^head_rotat/),
  armL: center(/^arm1_rotat\.L/), armR: center(/^arm1_rotat\.R/),
  forearmL: center(/^arm_2_rotat\.L/), forearmR: center(/^arm_2_rotat\.R/),
  handL: center(/^hand_controller\.L/), handR: center(/^hand_controller\.R/),
  thighL: center(/^leg_rotat\.L/), thighR: center(/^leg_rotat\.R/),
  shinL: center(/^leg_2_rotat\.L_/), shinR: center(/^leg_2_rotat\.L\.001/),
  footL: center(/^foot_rotat\.L/), footR: center(/^foot_rotat\.R/),
  gun: center(/^hip_Cylinder/),
};
// Los hombros se articulan en el extremo exterior del tubo «arm1_rotat».
pivotsOrig.armL = [0.069, pivotsOrig.armL[1], 0.0005];
pivotsOrig.armR = [-0.069, pivotsOrig.armR[1], 0.0005];
const bonesOut = BONES.map(([name, parent]) => ({ name, parent, pivot: tf(...pivotsOrig[name]).map((v) => +v.toFixed(5)) }));

// El rifle se coloca centrado ante el pecho, apuntando hacia delante (en coordenadas del modelo, antes del giro).
const GUN_TARGET = [0.0, 0.44, 0.155];

// ---------- Simplificación ----------
const RATIO = { body: 0.15, head: 0.2, limb: 0.22, joint: 0.06, finger: 0.25, radio: 0.12, neck: 0.3, foot: 0.35, gun: 0.05 };
const MIN = { joint: 36, finger: 20, radio: 40, neck: 24, foot: 40, limb: 60, head: 200, gun: 300, body: 300 };

function simplifyPart(p, lod) {
  // posiciones compactas y triángulos
  const map = new Map(); const pos = []; const tri = [];
  const vid = (i) => { let k = map.get(i); if (k === undefined) { k = pos.length / 3; map.set(i, k); pos.push(...V[i]); } return k; };
  for (const f of p.faces) for (let k = 1; k < f.length - 1; k++) tri.push(vid(f[0]), vid(f[k]), vid(f[k + 1]));
  let P = new Float32Array(pos);
  if (p.kind === 'gun') {
    // mover el rifle (sus coordenadas originales) al punto deseado
    const mn = [1e9, 1e9, 1e9], mx = [-1e9, -1e9, -1e9];
    for (let i = 0; i < P.length; i += 3) for (let k = 0; k < 3; k++) { mn[k] = Math.min(mn[k], P[i + k]); mx[k] = Math.max(mx[k], P[i + k]); }
    const c = [0, 1, 2].map((k) => (mn[k] + mx[k]) / 2);
    for (let i = 0; i < P.length; i += 3) for (let k = 0; k < 3; k++) P[i + k] += GUN_TARGET[k] - c[k];
  }
  const total = tri.length / 3;
  const r = (RATIO[p.kind] ?? 0.2) * (lod === 0 ? 1 : 0.3);
  let target = Math.max(Math.round(total * r), lod === 0 ? (MIN[p.kind] ?? 20) : Math.round((MIN[p.kind] ?? 20) * 0.4));
  if (lod === 1 && (p.kind === 'radio' || p.kind === 'finger')) target = Math.min(target, p.kind === 'finger' ? 8 : 16);
  target = Math.min(target, total);
  let idx = new Uint32Array(tri);
  if (target < total) {
    let err = 0.02;
    for (let tries = 0; tries < 6; tries++) {
      const [res] = MeshoptSimplifier.simplify(idx, P, 3, target * 3, err);
      idx = res; if (idx.length / 3 <= target * 1.15) break; err *= 3;
    }
  }
  return { P, idx };
}

function buildLod(lod) {
  const pos = [], nor = [], col = [], bone = [], index = [];
  const uniq = new Map();
  const rng = (() => { let a = 12345; return () => { a = (a * 1664525 + 1013904223) >>> 0; return a / 4294967296; }; })();
  const TAN = [198, 156, 108], DARK = [160, 126, 88], GUNM = [52, 54, 58], NECK = [174, 138, 96];
  let tris = 0;
  for (const p of use) {
    const { P, idx } = simplifyPart(p, lod);
    const nt = idx.length / 3; tris += nt;
    if (process.env.VERBOSE && lod === 0) console.log(String(nt).padStart(5), p.kind.padEnd(7), p.name);
    // normales de cara y suavizado por ángulo (35°)
    const fn = new Float32Array(nt * 3); const area = new Float32Array(nt);
    const inc = new Map();
    for (let t = 0; t < nt; t++) {
      const a = idx[t * 3], b = idx[t * 3 + 1], c = idx[t * 3 + 2];
      const e1 = [0, 1, 2].map((k) => P[b * 3 + k] - P[a * 3 + k]), e2 = [0, 1, 2].map((k) => P[c * 3 + k] - P[a * 3 + k]);
      const n = [e1[1] * e2[2] - e1[2] * e2[1], e1[2] * e2[0] - e1[0] * e2[2], e1[0] * e2[1] - e1[1] * e2[0]];
      const l = Math.hypot(...n) || 1; area[t] = l;
      fn.set(n.map((v) => v / l), t * 3);
      for (const v of [a, b, c]) { if (!inc.has(v)) inc.set(v, []); inc.get(v).push(t); }
    }
    const base = p.kind === 'gun' ? GUNM : p.kind === 'joint' ? DARK : p.kind === 'neck' ? NECK : TAN;
    const tone = 0.96 + rng() * 0.08;
    for (let t = 0; t < nt; t++) {
      for (let k = 0; k < 3; k++) {
        const v = idx[t * 3 + k];
        const acc = [0, 0, 0];
        for (const u of inc.get(v)) {
          const d = fn[u * 3] * fn[t * 3] + fn[u * 3 + 1] * fn[t * 3 + 1] + fn[u * 3 + 2] * fn[t * 3 + 2];
          if (d > 0.82) for (let q = 0; q < 3; q++) acc[q] += fn[u * 3 + q] * area[u];
        }
        const l = Math.hypot(...acc) || 1;
        // al transformar (giro de 180° sobre Y): x y z de posición y normal se giran igual
        const px = P[v * 3], py = P[v * 3 + 1], pz = P[v * 3 + 2];
        const P3 = tf(px, py, pz).map((q) => Math.fround(q));
        const N3 = [Math.round((-acc[0] / l) * 127), Math.round((acc[1] / l) * 127), Math.round((-acc[2] / l) * 127)];
        // un poco más oscuro en la parte baja de cada pieza (sombreado de oclusión barato)
        const sh = tone * (0.93 + 0.07 * Math.min(1, Math.max(0, (acc[1] / l + 1) / 2)));
        const C3 = base.map((c) => Math.min(255, Math.round(c * sh)));
        const key = `${P3.join(',')}|${N3.join(',')}|${p.bone}|${C3.join(',')}`;
        let id = uniq.get(key);
        if (id === undefined) { id = pos.length / 3; uniq.set(key, id); pos.push(...P3); nor.push(...N3); col.push(...C3); bone.push(p.bone); }
        index.push(id);
      }
    }
  }
  return { pos, nor, col, bone, index, tris };
}

const lods = [buildLod(0), buildLod(1)];
for (const [i, l] of lods.entries()) console.log(`LOD${i}: ${l.tris} triángulos`);

// ---------- Escribir ----------
const chunks = []; let off = 0;
const push = (typed) => { const pad = (4 - (off % 4)) % 4; if (pad) { chunks.push(Buffer.alloc(pad)); off += pad; } const o = off; chunks.push(Buffer.from(typed.buffer, typed.byteOffset, typed.byteLength)); off += typed.byteLength; return o; };
const lodMeta = lods.map((l) => ({
  verts: l.pos.length / 3, tris: l.tris,
  indices: l.index.length,
  index: push(new Uint16Array(l.index)), pos: push(new Float32Array(l.pos)), nor: push(new Int8Array(l.nor)), col: push(new Uint8Array(l.col)), bone: push(new Uint8Array(l.bone)),
}));
const body = Buffer.concat(chunks);
const header = Buffer.from(JSON.stringify({ version: 1, scale: SCALE, bones: bonesOut, lods: lodMeta }));
const head = Buffer.alloc(8); head.write('B1M1', 0, 'ascii'); head.writeUInt32LE(header.length, 4);
const padH = Buffer.alloc((4 - ((8 + header.length) % 4)) % 4);
fs.mkdirSync(out.replace(/[^/]*$/, '') || '.', { recursive: true });
fs.writeFileSync(out, Buffer.concat([head, header, padH, body]));
console.log('guardado', out, (fs.statSync(out).size / 1024).toFixed(0), 'KB');
