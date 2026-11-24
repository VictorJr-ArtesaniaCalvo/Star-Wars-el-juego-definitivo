// Lector mínimo de glTF (sin dependencias): devuelve, por cada pieza (nodo con malla), sus triángulos en coordenadas del mundo.
import fs from 'node:fs';
import path from 'node:path';

const mul = (a, b) => { // matrices 4x4 por columnas: a·b
  const o = new Array(16).fill(0);
  for (let c = 0; c < 4; c++) for (let r = 0; r < 4; r++) for (let k = 0; k < 4; k++) o[c * 4 + r] += a[k * 4 + r] * b[c * 4 + k];
  return o;
};
const fromTRS = (t = [0, 0, 0], q = [0, 0, 0, 1], s = [1, 1, 1]) => {
  const [x, y, z, w] = q;
  const xx = x * x, yy = y * y, zz = z * z, xy = x * y, xz = x * z, yz = y * z, wx = w * x, wy = w * y, wz = w * z;
  return [
    (1 - 2 * (yy + zz)) * s[0], (2 * (xy + wz)) * s[0], (2 * (xz - wy)) * s[0], 0,
    (2 * (xy - wz)) * s[1], (1 - 2 * (xx + zz)) * s[1], (2 * (yz + wx)) * s[1], 0,
    (2 * (xz + wy)) * s[2], (2 * (yz - wx)) * s[2], (1 - 2 * (xx + yy)) * s[2], 0,
    t[0], t[1], t[2], 1,
  ];
};
const apply = (m, p) => [m[0] * p[0] + m[4] * p[1] + m[8] * p[2] + m[12], m[1] * p[0] + m[5] * p[1] + m[9] * p[2] + m[13], m[2] * p[0] + m[6] * p[1] + m[10] * p[2] + m[14]];
const det3 = (m) => m[0] * (m[5] * m[10] - m[9] * m[6]) - m[4] * (m[1] * m[10] - m[9] * m[2]) + m[8] * (m[1] * m[6] - m[5] * m[2]);
// inversa-transpuesta de la parte 3x3 (para normales)
const normalMat = (m) => {
  const a = [m[0], m[4], m[8], m[1], m[5], m[9], m[2], m[6], m[10]]; // filas
  const [a0, a1, a2, b0, b1, b2, c0, c1, c2] = a;
  const d = a0 * (b1 * c2 - b2 * c1) - a1 * (b0 * c2 - b2 * c0) + a2 * (b0 * c1 - b1 * c0) || 1;
  const inv = [
    (b1 * c2 - b2 * c1) / d, (a2 * c1 - a1 * c2) / d, (a1 * b2 - a2 * b1) / d,
    (b2 * c0 - b0 * c2) / d, (a0 * c2 - a2 * c0) / d, (a2 * b0 - a0 * b2) / d,
    (b0 * c1 - b1 * c0) / d, (a1 * c0 - a0 * c1) / d, (a0 * b1 - a1 * b0) / d,
  ];
  // la inversa-transpuesta de A es (A^-1)^T
  return [inv[0], inv[3], inv[6], inv[1], inv[4], inv[7], inv[2], inv[5], inv[8]];
};

export function loadGltf(file) {
  const g = JSON.parse(fs.readFileSync(file, 'utf8'));
  const bins = g.buffers.map((b) => fs.readFileSync(path.join(path.dirname(file), b.uri)));
  const comp = { 5126: [Float32Array, 4], 5125: [Uint32Array, 4], 5123: [Uint16Array, 2] };
  const ncomp = { SCALAR: 1, VEC2: 2, VEC3: 3, VEC4: 4 };
  const read = (ai) => {
    const a = g.accessors[ai], bv = g.bufferViews[a.bufferView];
    const [T, sz] = comp[a.componentType], n = ncomp[a.type];
    const stride = bv.byteStride || n * sz;
    const base = (bv.byteOffset || 0) + (a.byteOffset || 0);
    const buf = bins[bv.buffer];
    const out = new T(a.count * n);
    const dv = new DataView(buf.buffer, buf.byteOffset, buf.byteLength);
    for (let i = 0; i < a.count; i++) for (let k = 0; k < n; k++) {
      const o = base + i * stride + k * sz;
      out[i * n + k] = a.componentType === 5126 ? dv.getFloat32(o, true) : a.componentType === 5125 ? dv.getUint32(o, true) : dv.getUint16(o, true);
    }
    return out;
  };
  const N = g.nodes;
  const parent = new Array(N.length).fill(-1);
  N.forEach((n, i) => (n.children || []).forEach((c) => (parent[c] = i)));
  const local = N.map((n) => n.matrix ? n.matrix.slice() : fromTRS(n.translation, n.rotation, n.scale));
  const world = new Array(N.length);
  const wm = (i) => world[i] || (world[i] = parent[i] < 0 ? local[i] : mul(wm(parent[i]), local[i]));
  N.forEach((_, i) => wm(i));
  const chain = (i) => { const c = []; for (let k = i; k >= 0; k = parent[k]) c.push(N[k].name); return c; };
  const pieces = [];
  N.forEach((n, i) => {
    if (n.mesh === undefined) return;
    const M = world[i], NM = normalMat(M), flip = det3(M) < 0;
    for (const pr of g.meshes[n.mesh].primitives) {
      const P = read(pr.attributes.POSITION), Nn = pr.attributes.NORMAL !== undefined ? read(pr.attributes.NORMAL) : null;
      const UV = pr.attributes.TEXCOORD_0 !== undefined ? read(pr.attributes.TEXCOORD_0) : null;
      const I = pr.indices !== undefined ? read(pr.indices) : Uint32Array.from({ length: P.length / 3 }, (_, k) => k);
      const pos = new Float32Array(P.length), nor = new Float32Array(P.length);
      for (let v = 0; v < P.length / 3; v++) {
        const w = apply(M, [P[v * 3], P[v * 3 + 1], P[v * 3 + 2]]); pos.set(w, v * 3);
        if (Nn) { const x = Nn[v * 3], y = Nn[v * 3 + 1], z = Nn[v * 3 + 2]; const q = [NM[0] * x + NM[3] * y + NM[6] * z, NM[1] * x + NM[4] * y + NM[7] * z, NM[2] * x + NM[5] * y + NM[8] * z]; const l = Math.hypot(...q) || 1; nor.set([q[0] / l, q[1] / l, q[2] / l], v * 3); }
      }
      let idx = I;
      if (flip) { idx = Uint32Array.from(I); for (let t = 0; t < idx.length; t += 3) { const x = idx[t + 1]; idx[t + 1] = idx[t + 2]; idx[t + 2] = x; } }
      pieces.push({ node: i, name: n.name, chain: chain(i), material: pr.material, pos, nor, uv: UV, idx });
    }
  });
  return { g, pieces, world, parent, nodeName: (i) => N[i].name };
}
