import * as THREE from 'three';
import { makeRng } from './terrain';

// Texturas de Geonosis generadas por código (no pesan nada en la descarga) y el material que las aplica
// en el espacio del mundo («triplanar»): el suelo usa la textura de tierra, las paredes y las rocas la de arenisca.

/** Ruido de valores que se repite sin costuras (para que la textura no muestre juntas). */
function makeNoise(seed: number, period: number) {
  const rng = makeRng(seed);
  const g = new Float32Array(period * period);
  for (let i = 0; i < g.length; i++) g[i] = rng();
  const at = (x: number, y: number) => g[(((y % period) + period) % period) * period + (((x % period) + period) % period)];
  return (x: number, y: number) => {
    const xi = Math.floor(x), yi = Math.floor(y);
    const fx = x - xi, fy = y - yi;
    const u = fx * fx * (3 - 2 * fx), v = fy * fy * (3 - 2 * fy);
    return (at(xi, yi) * (1 - u) + at(xi + 1, yi) * u) * (1 - v) + (at(xi, yi + 1) * (1 - u) + at(xi + 1, yi + 1) * u) * v;
  };
}

function fbm(noise: (x: number, y: number) => number, x: number, y: number, oct: number, base: number) {
  let v = 0, a = 0.5, f = base, norm = 0;
  for (let i = 0; i < oct; i++) { v += a * noise(x * f, y * f); norm += a; a *= 0.5; f *= 2; }
  return v / norm;
}

function toTexture(data: Uint8ClampedArray, size: number): THREE.DataTexture {
  const t = new THREE.DataTexture(data, size, size, THREE.RGBAFormat);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.magFilter = THREE.LinearFilter;
  t.minFilter = THREE.LinearMipmapLinearFilter;
  t.generateMipmaps = true;
  t.anisotropy = 4;
  t.needsUpdate = true;
  return t;
}

/** Tierra rojiza de Geonosis: moteado, parches pálidos, guijarros y pequeñas ondulaciones. Los valores multiplican el color base. */
let groundCache: THREE.DataTexture | null = null;
let rockCache: THREE.DataTexture | null = null;

export function groundTexture(size = 512): THREE.DataTexture {
  if (groundCache) return groundCache;
  groundCache = buildGround(size);
  return groundCache;
}

function buildGround(size: number): THREE.DataTexture {
  const n1 = makeNoise(11, 8), n2 = makeNoise(23, 16), n3 = makeNoise(37, 32), rng = makeRng(5);
  const d = new Uint8ClampedArray(size * size * 4);
  for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
    const u = x / size, v = y / size;
    const big = fbm(n1, u * 8, v * 8, 4, 1);
    const fine = fbm(n3, u * 32, v * 32, 3, 1);
    let l = 0.78 + 0.5 * big + 0.28 * (fine - 0.5);
    // ondulaciones de arena soplada por el viento
    l += 0.05 * Math.sin((u * 6 + v * 2.4 + big * 1.6) * Math.PI * 2);
    // parches pálidos de roca descubierta (más claros y menos rojos)
    const patch = Math.max(0, (fbm(n2, u * 6 + 3, v * 6 + 7, 3, 1) - 0.6) * 4);
    l += patch * 0.45;
    const warm = 1 - patch * 0.5;
    const i = (y * size + x) * 4;
    d[i] = Math.min(255, l * 255 * 1.02); d[i + 1] = Math.min(255, l * 255 * (0.97 + 0.0 * warm)); d[i + 2] = Math.min(255, l * 255 * (0.93 + (1 - warm) * 0.25)); d[i + 3] = 255;
  }
  // guijarros: motas oscuras con un lado claro
  for (let k = 0; k < size * 2; k++) {
    const px = Math.floor(rng() * size), py = Math.floor(rng() * size), r = rng() < 0.85 ? 1 : 2, dark = 0.68 + rng() * 0.22;
    for (let dy = -r; dy <= r; dy++) for (let dx = -r; dx <= r; dx++) {
      if (dx * dx + dy * dy > r * r + 0.5) continue;
      const xx = (px + dx + size) % size, yy = (py + dy + size) % size, i = (yy * size + xx) * 4;
      const lit = dx + dy < 0 ? 1.15 : 1;
      d[i] *= dark * lit; d[i + 1] *= dark * lit; d[i + 2] *= dark * lit;
    }
  }
  return toTexture(d, size);
}

/** Arenisca estratificada: capas horizontales, surcos verticales por la erosión y grietas. */
export function rockTexture(size = 512): THREE.DataTexture {
  if (rockCache) return rockCache;
  rockCache = buildRock(size);
  return rockCache;
}

function buildRock(size: number): THREE.DataTexture {
  const n1 = makeNoise(41, 8), n2 = makeNoise(53, 16), n3 = makeNoise(61, 32);
  const d = new Uint8ClampedArray(size * size * 4);
  for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
    const u = x / size, v = y / size;
    // v = altura: capas de distinto tono
    const warp = fbm(n1, u * 4, v * 2, 3, 1) * 0.6;
    const band = Math.sin((v * 14 + warp * 3) * Math.PI * 2) * 0.5 + 0.5;
    const layer = Math.floor(v * 14 + warp * 3);
    const layerTone = 0.86 + 0.22 * (Math.sin(layer * 12.9898) * 43758.5453 % 1 + 1) % 1;
    // surcos verticales: ruido muy estirado en vertical
    const groove = fbm(n3, u * 40, v * 2.5, 3, 1);
    const crumble = fbm(n2, u * 16, v * 16, 3, 1);
    let l = layerTone * (0.82 + 0.2 * band) + 0.35 * (groove - 0.5) + 0.2 * (crumble - 0.5);
    // grietas finas (líneas oscuras irregulares)
    const crack = Math.abs(fbm(n2, u * 5 + 9, v * 7, 2, 1) - 0.5);
    if (crack < 0.008) l *= 0.78;
    l = Math.max(0.25, l);
    const i = (y * size + x) * 4;
    d[i] = Math.min(255, l * 255 * 1.0); d[i + 1] = Math.min(255, l * 255 * 0.96); d[i + 2] = Math.min(255, l * 255 * 0.9); d[i + 3] = 255;
  }
  return toTexture(d, size);
}

interface Options { ground: THREE.Texture; rock: THREE.Texture; rockOnly?: boolean; groundScale?: number; rockScale?: number }

/**
 * Añade al material las texturas en el espacio del mundo: sobre superficies casi horizontales la tierra,
 * en las pendientes y paredes la arenisca (proyectada por los tres ejes, sin estirarse).
 */
export function applyWorldTextures(mat: THREE.MeshLambertMaterial, o: Options) {
  const gs = o.groundScale ?? 0.11, rs = o.rockScale ?? 0.085;
  mat.onBeforeCompile = (shader) => {
    shader.uniforms.groundMap = { value: o.ground };
    shader.uniforms.rockMap = { value: o.rock };
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\nvarying vec3 vWPos;\nvarying vec3 vWNor;\nvarying float vTexAmt;' + (o.rockOnly ? '\nattribute float texAmt;' : ''))
      .replace('#include <begin_vertex>', '#include <begin_vertex>\nvWPos = (modelMatrix * vec4(position, 1.0)).xyz;\nvWNor = normalize(mat3(modelMatrix) * objectNormal);\nvTexAmt = ' + (o.rockOnly ? 'texAmt' : '1.0') + ';');
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', `#include <common>
varying vec3 vWPos;
varying vec3 vWNor;
varying float vTexAmt;
uniform sampler2D groundMap;
uniform sampler2D rockMap;`)
      .replace('#include <map_fragment>', `
  vec3 wn = normalize(vWNor);
  vec3 an = abs(wn);
  float steep = ${o.rockOnly ? '1.0' : 'smoothstep(0.5, 0.82, 1.0 - an.y)'};
  vec3 g1 = texture2D(groundMap, vWPos.xz * ${gs.toFixed(4)}).rgb;
  vec3 g2 = texture2D(groundMap, vWPos.xz * ${(gs * 0.12).toFixed(4)} + vec2(0.37, 0.61)).rgb;
  vec3 groundTex = g1 * (0.55 + 0.6 * g2);
  vec3 rx = texture2D(rockMap, vec2(vWPos.z, vWPos.y) * ${rs.toFixed(4)}).rgb;
  vec3 rz = texture2D(rockMap, vec2(vWPos.x, vWPos.y) * ${rs.toFixed(4)}).rgb;
  vec3 ry = texture2D(rockMap, vWPos.xz * ${rs.toFixed(4)}).rgb;
  float wx = an.x * an.x, wz = an.z * an.z, wy = an.y * an.y;
  vec3 rockTex = (rx * wx + rz * wz + ry * wy) / max(wx + wz + wy, 0.0001);
  diffuseColor.rgb *= mix(vec3(1.0), mix(groundTex, rockTex, steep) * 1.12, vTexAmt);`);
  };
  mat.customProgramCacheKey = () => 'worldtex-' + (o.rockOnly ? 'rock' : 'terrain');
  return mat;
}
