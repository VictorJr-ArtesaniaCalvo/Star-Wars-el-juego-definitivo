// Lector glTF con piel: devuelve por cada primitiva sus vértices en el mundo (con la piel aplicada en la postura de reposo)
import fs from 'node:fs';
import path from 'node:path';
const mul = (a, b) => { const o = new Array(16).fill(0); for (let c = 0; c < 4; c++) for (let r = 0; r < 4; r++) for (let k = 0; k < 4; k++) o[c * 4 + r] += a[k * 4 + r] * b[c * 4 + k]; return o; };
const fromTRS = (t = [0, 0, 0], q = [0, 0, 0, 1], s = [1, 1, 1]) => { const [x, y, z, w] = q; const xx = x * x, yy = y * y, zz = z * z, xy = x * y, xz = x * z, yz = y * z, wx = w * x, wy = w * y, wz = w * z; return [(1 - 2 * (yy + zz)) * s[0], (2 * (xy + wz)) * s[0], (2 * (xz - wy)) * s[0], 0, (2 * (xy - wz)) * s[1], (1 - 2 * (xx + zz)) * s[1], (2 * (yz + wx)) * s[1], 0, (2 * (xz + wy)) * s[2], (2 * (yz - wx)) * s[2], (1 - 2 * (xx + yy)) * s[2], 0, t[0], t[1], t[2], 1]; };
const apply = (m, p) => [m[0] * p[0] + m[4] * p[1] + m[8] * p[2] + m[12], m[1] * p[0] + m[5] * p[1] + m[9] * p[2] + m[13], m[2] * p[0] + m[6] * p[1] + m[10] * p[2] + m[14]];
const applyN = (m, p) => [m[0] * p[0] + m[4] * p[1] + m[8] * p[2], m[1] * p[0] + m[5] * p[1] + m[9] * p[2], m[2] * p[0] + m[6] * p[1] + m[10] * p[2]];
export function loadSkinned(file) {
  const g = JSON.parse(fs.readFileSync(file, 'utf8'));
  const bins = g.buffers.map((b) => fs.readFileSync(path.join(path.dirname(file), b.uri)));
  const comp = { 5126: [Float32Array, 4, 'getFloat32'], 5125: [Uint32Array, 4, 'getUint32'], 5123: [Uint16Array, 2, 'getUint16'], 5121: [Uint8Array, 1, 'getUint8'] };
  const nc = { SCALAR: 1, VEC2: 2, VEC3: 3, VEC4: 4, MAT4: 16 };
  const read = (ai) => {
    const a = g.accessors[ai], bv = g.bufferViews[a.bufferView];
    const [T, sz, fn] = comp[a.componentType], n = nc[a.type];
    const stride = bv.byteStride || n * sz, base = (bv.byteOffset || 0) + (a.byteOffset || 0), buf = bins[bv.buffer];
    const dv = new DataView(buf.buffer, buf.byteOffset, buf.byteLength), out = new T(a.count * n);
    for (let i = 0; i < a.count; i++) for (let k = 0; k < n; k++) out[i * n + k] = dv[fn](base + i * stride + k * sz, true);
    return out;
  };
  const N = g.nodes, parent = new Array(N.length).fill(-1);
  N.forEach((n, i) => (n.children || []).forEach((c) => (parent[c] = i)));
  const local = N.map((n) => (n.matrix ? n.matrix.slice() : fromTRS(n.translation, n.rotation, n.scale)));
  const world = new Array(N.length); const wm = (i) => world[i] || (world[i] = parent[i] < 0 ? local[i] : mul(wm(parent[i]), local[i])); N.forEach((_, i) => wm(i));
  const chain = (i) => { const c = []; for (let k = i; k >= 0; k = parent[k]) c.push(N[k].name); return c; };
  const skins = (g.skins || []).map((s) => ({ joints: s.joints, ibm: read(s.inverseBindMatrices) }));
  const prims = [];
  N.forEach((n, i) => {
    if (n.mesh === undefined) return;
    for (const pr of g.meshes[n.mesh].primitives) {
      const P = read(pr.attributes.POSITION), Nn = pr.attributes.NORMAL !== undefined ? read(pr.attributes.NORMAL) : null, UV = pr.attributes.TEXCOORD_0 !== undefined ? read(pr.attributes.TEXCOORD_0) : null;
      const I = pr.indices !== undefined ? read(pr.indices) : Uint32Array.from({ length: P.length / 3 }, (_, k) => k);
      const nv = P.length / 3, pos = new Float32Array(nv * 3), nor = new Float32Array(nv * 3), joint = new Int32Array(nv).fill(-1);
      if (n.skin !== undefined) {
        const sk = skins[n.skin], J = read(pr.attributes.JOINTS_0), Wt = read(pr.attributes.WEIGHTS_0);
        const jm = sk.joints.map((j, k) => mul(world[j], Array.from(sk.ibm.slice(k * 16, k * 16 + 16)))); // matriz de piel de cada hueso (mundo)
        for (let v = 0; v < nv; v++) {
          const p = [P[v * 3], P[v * 3 + 1], P[v * 3 + 2]], nn = Nn ? [Nn[v * 3], Nn[v * 3 + 1], Nn[v * 3 + 2]] : [0, 1, 0];
          const ap = [0, 0, 0], an = [0, 0, 0]; let best = -1, bw = -1;
          for (let k = 0; k < 4; k++) { const w = Wt[v * 4 + k]; if (w <= 0) continue; const q = apply(jm[J[v * 4 + k]], p), qn = applyN(jm[J[v * 4 + k]], nn); for (let c = 0; c < 3; c++) { ap[c] += q[c] * w; an[c] += qn[c] * w; } if (w > bw) { bw = w; best = sk.joints[J[v * 4 + k]]; } }
          pos.set(ap, v * 3); const l = Math.hypot(...an) || 1; nor.set(an.map((x) => x / l), v * 3); joint[v] = best;
        }
      } else {
        const M = world[i];
        for (let v = 0; v < nv; v++) { pos.set(apply(M, [P[v * 3], P[v * 3 + 1], P[v * 3 + 2]]), v * 3); if (Nn) { const q = applyN(M, [Nn[v * 3], Nn[v * 3 + 1], Nn[v * 3 + 2]]); const l = Math.hypot(...q) || 1; nor.set(q.map((x) => x / l), v * 3); } }
        // un espejo (determinante negativo) invierte el orden de los triángulos
        const d = M[0] * (M[5] * M[10] - M[9] * M[6]) - M[4] * (M[1] * M[10] - M[9] * M[2]) + M[8] * (M[1] * M[6] - M[5] * M[2]);
        if (d < 0) for (let t = 0; t < I.length; t += 3) { const x = I[t + 1]; I[t + 1] = I[t + 2]; I[t + 2] = x; }
      }
      prims.push({ node: i, name: N[i].name, chain: chain(i), skin: n.skin, material: pr.material, pos, nor, uv: UV, idx: I, joint });
    }
  });
  return { g, N, world, parent, prims, nodeName: (i) => N[i].name };
}
