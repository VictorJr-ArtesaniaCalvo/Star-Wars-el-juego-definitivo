import * as THREE from 'three';
import { CRASH, terrainHeight } from './terrain';

// Marcas de quemado en el suelo de la zona del accidente: una malla fina pegada al terreno (una sola pieza) con una textura de hollín
// dibujada por código: mancha negra alrededor del cráter, vetas que salen hacia fuera, una raya oscura a lo largo del surco y
// pequeñas manchas de quemado sueltas. Al ser más fina que la malla del terreno, se ve nítida (el color por vértice del terreno es muy suave).

const U0 = -42, U1 = 18; // a lo largo de la nave (el surco va hacia -U)
const V0 = -16, V1 = 16; // de lado
const STEP = 0.9; // separación de la malla (m)
const TEX_W = 512, TEX_H = 272; // ≈ 8,5 píxeles por metro

const CY = Math.cos(CRASH.yaw), SY = Math.sin(CRASH.yaw);

function hash(ix: number, iy: number): number {
  let h = Math.imul(ix, 374761393) ^ Math.imul(iy, 668265263) ^ 0x5bd1e995;
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}
function vnoise(x: number, y: number): number {
  const ix = Math.floor(x), iy = Math.floor(y), fx = x - ix, fy = y - iy;
  const sx = fx * fx * (3 - 2 * fx), sy = fy * fy * (3 - 2 * fy);
  const a = hash(ix, iy), b = hash(ix + 1, iy), c = hash(ix, iy + 1), d = hash(ix + 1, iy + 1);
  return a + (b - a) * sx + (c - a) * sy + (a - b - c + d) * sx * sy;
}
const fbm = (x: number, y: number) => 0.55 * vnoise(x, y) + 0.3 * vnoise(x * 2.1 + 5, y * 2.1 + 9) + 0.15 * vnoise(x * 4.3 + 13, y * 4.3 + 2);
const smooth = (a: number, b: number, v: number) => { const t = Math.min(1, Math.max(0, (v - a) / (b - a))); return t * t * (3 - 2 * t); };

/** Cuánto hollín hay en un punto, de 0 a 1 (u: a lo largo de la nave, v: de lado, en metros desde el centro del accidente). */
function soot(u: number, v: number): number {
  const e = Math.hypot(u / 12, v / 8);
  // mancha del impacto, con el borde roto
  const blast = (1 - smooth(0.55, 1.65, e + (fbm(u * 0.35, v * 0.35) - 0.5) * 0.7)) * 0.5;
  // vetas que salen hacia fuera desde el centro
  const ang = Math.atan2(v / 8, u / 12);
  const streak = Math.pow(vnoise(ang * 5.2 + 3.1, 0.5 + e * 0.7), 2.2) * (1 - smooth(0.7, 2.3, e)) * smooth(0.25, 0.7, e) * 0.85;
  // raya oscura por el fondo del surco (más débil lejos de la nave)
  const back = -u;
  let furrow = 0;
  if (back > 0 && back < 40) {
    const vv = v - 0.9 * Math.sin(back * 0.11);
    furrow = Math.exp(-((vv / 2.1) ** 2)) * (1 - back / 40) * (0.55 + 0.45 * fbm(back * 0.5, v * 0.5)) * smooth(0, 4, back) * 0.6;
  }
  // manchas sueltas de quemado alrededor
  const spots = smooth(0.6, 0.68, fbm(u * 0.75 + 20, v * 0.75 + 7)) * (1 - smooth(0.9, 2.6, e)) * 0.8;
  return Math.min(1, Math.max(blast, streak, furrow, spots));
}

function sootTexture(): THREE.Texture {
  const c = document.createElement('canvas');
  c.width = TEX_W; c.height = TEX_H;
  const g = c.getContext('2d')!;
  const img = g.createImageData(TEX_W, TEX_H);
  for (let py = 0; py < TEX_H; py++) {
    const v = V1 - ((py + 0.5) / TEX_H) * (V1 - V0);
    for (let px = 0; px < TEX_W; px++) {
      const u = U0 + ((px + 0.5) / TEX_W) * (U1 - U0);
      const a = soot(u, v);
      const o = (py * TEX_W + px) * 4;
      // casi negro con un toque pardo; en los bordes (poco hollín) se ve más ceniza
      img.data[o] = 26 + 22 * (1 - a); img.data[o + 1] = 19 + 15 * (1 - a); img.data[o + 2] = 14 + 10 * (1 - a);
      img.data[o + 3] = Math.round(255 * Math.min(0.78, a * 0.95));
    }
  }
  g.putImageData(img, 0, 0);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 4;
  return t;
}

/** Dibuja las marcas de quemado sobre el terreno del accidente. */
export function buildScorch(scene: THREE.Scene): THREE.Mesh {
  const nu = Math.round((U1 - U0) / STEP), nv = Math.round((V1 - V0) / STEP);
  const pos = new Float32Array((nu + 1) * (nv + 1) * 3), uv = new Float32Array((nu + 1) * (nv + 1) * 2);
  for (let j = 0; j <= nv; j++) {
    for (let i = 0; i <= nu; i++) {
      const u = U0 + (i / nu) * (U1 - U0), v = V0 + (j / nv) * (V1 - V0);
      const x = CRASH.x + u * CY + v * SY, z = CRASH.z - u * SY + v * CY;
      const k = j * (nu + 1) + i;
      pos[k * 3] = x; pos[k * 3 + 1] = terrainHeight(x, z) + 0.07; pos[k * 3 + 2] = z;
      uv[k * 2] = i / nu; uv[k * 2 + 1] = j / nv;
    }
  }
  const idx: number[] = [];
  for (let j = 0; j < nv; j++) {
    for (let i = 0; i < nu; i++) {
      const a = j * (nu + 1) + i, b = a + 1, c = a + nu + 1, d = c + 1;
      idx.push(a, c, b, b, c, d); // sentido de las caras: hacia arriba
    }
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  geo.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
  geo.setIndex(idx);
  geo.computeVertexNormals();
  const mat = new THREE.MeshLambertMaterial({
    map: sootTexture(), transparent: true, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2,
  });
  const mesh = new THREE.Mesh(geo, mat);
  mesh.receiveShadow = true;
  mesh.renderOrder = 0.5;
  mesh.frustumCulled = false;
  scene.add(mesh);
  return mesh;
}
