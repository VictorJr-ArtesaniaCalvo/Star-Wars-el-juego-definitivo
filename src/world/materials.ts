import * as THREE from 'three';
import { makeRng } from './terrain';

// Texturas de Geonosis y el material que las aplica en el espacio del mundo («triplanar»): el suelo usa la tierra,
// las paredes y las rocas la arenisca. Son fotos reales (Poly Haven y OpenGameArt, CC0, ver assets/CREDITOS.md) ya preparadas
// con tools/build-textures.py: cada imagen lleva el relieve (rojo y verde) y el detalle de brillo (azul), que se multiplica por el color de cada trozo.
// Si no se pudieran cargar, se usan las de abajo, generadas por código.

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

interface Real { ground: THREE.Texture; groundX: THREE.Texture; wall: THREE.Texture; cracks: THREE.Texture }
let real: Real | null = null;

/** Descarga las texturas reales (1024 px). Si alguna falla, el juego sigue con las generadas por código. */
export async function loadWorldTextures(base: string): Promise<boolean> {
  try {
    const loader = new THREE.TextureLoader();
    const get = async (name: string) => {
      const t = await loader.loadAsync(`${base}textures/${name}.jpg`);
      t.wrapS = t.wrapT = THREE.RepeatWrapping;
      t.anisotropy = 4;
      t.colorSpace = THREE.NoColorSpace; // son datos (relieve y brillo), no un color
      return t;
    };
    const [ground, groundX, wall, cracks] = await Promise.all([get('ground-red'), get('ground-extra'), get('rock-wall'), get('rock-cracks')]);
    real = { ground, groundX, wall, cracks };
    return true;
  } catch (e) {
    console.warn('No se pudieron cargar las texturas del escenario; se usan las generadas por código.', e);
    real = null;
    return false;
  }
}

/** Convierte una textura generada por código al formato de las reales (relieve plano y su brillo en el azul). */
function packFallback(src: THREE.DataTexture, groundExtra = false): THREE.DataTexture {
  const a = src.image.data as Uint8ClampedArray, n = a.length / 4;
  const d = new Uint8ClampedArray(a.length);
  for (let i = 0; i < n; i++) {
    const l = a[i * 4 + 1] * 0.8; // el brillo generado por código es algo más alto que el de las fotos
    if (groundExtra) { d[i * 4] = l; d[i * 4 + 1] = l; d[i * 4 + 2] = 128; } else { d[i * 4] = 128; d[i * 4 + 1] = 128; d[i * 4 + 2] = l; }
    d[i * 4 + 3] = 255;
  }
  return toTexture(d, src.image.width);
}
const fb: Record<string, THREE.DataTexture> = {};
const fallback = (k: string, mk: () => THREE.DataTexture, extra = false) => (fb[k] ??= packFallback(mk(), extra));

export const groundTexture = (): THREE.Texture => real?.ground ?? fallback('g', () => buildGroundCached());
export const groundExtraTexture = (): THREE.Texture => real?.groundX ?? fallback('gx', () => buildGroundCached(), true);
/** Paredes altas del cañón y rocas: arenisca con grietas. */
export const wallTexture = (): THREE.Texture => real?.cracks ?? fallback('w', () => buildRockCached());
export const rockTexture = wallTexture;
/** Juntas grandes de bloques (agujas y rocas): se mezcla por encima de la anterior. */
export const rockJointsTexture = (): THREE.Texture | null => real?.wall ?? null;

/** Tierra rojiza de Geonosis: moteado, parches pálidos, guijarros y pequeñas ondulaciones. Los valores multiplican el color base. */
let groundCache: THREE.DataTexture | null = null;
let rockCache: THREE.DataTexture | null = null;

function buildGroundCached(size = 512): THREE.DataTexture {
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
function buildRockCached(size = 512): THREE.DataTexture {
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

interface Options { ground: THREE.Texture; groundX: THREE.Texture; rock: THREE.Texture; /** Segunda imagen de roca (juntas de bloques), a otra escala. */ rock2?: THREE.Texture | null; rock2Scale?: number; rockOnly?: boolean; groundScale?: number; rockScale?: number }

// Fuerza del relieve de las texturas (se baja a 0 en calidad «baja» para ahorrar batería). Se comparte entre todos los materiales.
const bumpUniform = { value: 1 };
export const setWorldBump = (on: boolean) => { bumpUniform.value = on ? 1 : 0; };

/**
 * Añade al material las texturas en el espacio del mundo: sobre superficies casi horizontales la tierra (con parches de barro agrietado
 * y de arena), en las pendientes y paredes la arenisca (proyectada por los tres ejes, sin estirarse). Además de colorear, las texturas
 * inclinan un poco la luz (relieve) para que se noten las piedras, las grietas y las juntas.
 */
export function applyWorldTextures(mat: THREE.MeshLambertMaterial, o: Options) {
  const gs = o.groundScale ?? 0.4, rs = o.rockScale ?? 0.2, rs2 = o.rock2Scale ?? 0.07, two = !!o.rock2;
  mat.onBeforeCompile = (shader) => {
    shader.uniforms.groundMap = { value: o.ground };
    shader.uniforms.groundXMap = { value: o.groundX };
    shader.uniforms.rockMap = { value: o.rock };
    if (two) shader.uniforms.rock2Map = { value: o.rock2 };
    shader.uniforms.uBump = bumpUniform;
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\nvarying vec3 vWPos;\nvarying vec3 vWNor;\nvarying float vTexAmt;' + (o.rockOnly ? '\nattribute float texAmt;' : ''))
      .replace('#include <begin_vertex>', '#include <begin_vertex>\nvWPos = (modelMatrix * vec4(position, 1.0)).xyz;\nvWNor = normalize(mat3(modelMatrix) * objectNormal);\nvTexAmt = ' + (o.rockOnly ? 'texAmt' : '1.0') + ';');
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', `#include <common>
varying vec3 vWPos;
varying vec3 vWNor;
varying float vTexAmt;
uniform sampler2D groundMap;
uniform sampler2D groundXMap;
uniform sampler2D rockMap;
${two ? 'uniform sampler2D rock2Map;' : ''}
uniform float uBump;
float hash21(vec2 p) { p = fract(p * vec2(123.34, 456.21)); p += dot(p, p + 45.32); return fract(p.x * p.y); }
float vnoise(vec2 p) {
  vec2 i = floor(p), f = fract(p); f = f * f * (3.0 - 2.0 * f);
  return mix(mix(hash21(i), hash21(i + vec2(1.0, 0.0)), f.x), mix(hash21(i + vec2(0.0, 1.0)), hash21(i + vec2(1.0, 1.0)), f.x), f.y);
}`)
      .replace('#include <map_fragment>', `
  vec3 wn = normalize(vWNor);
  vec3 an = abs(wn);
  float steep = ${o.rockOnly ? '1.0' : 'smoothstep(0.5, 0.82, 1.0 - an.y)'};
  // suelo: tierra con grava (relieve y brillo en una sola imagen), una pasada grande para romper la repetición y parches de barro y arena
  vec4 g1 = texture2D(groundMap, vWPos.xz * ${gs.toFixed(4)});
  vec4 g2 = texture2D(groundMap, vWPos.xz * ${(gs * 0.09).toFixed(4)} + vec2(0.37, 0.61));
  vec2 gx = texture2D(groundXMap, vWPos.xz * ${(gs * 0.45).toFixed(4)}).rg;
  float mudM = smoothstep(0.5, 0.62, vnoise(vWPos.xz * 0.017));
  float sandM = smoothstep(0.52, 0.66, vnoise(vWPos.xz * 0.011 + vec2(7.3, 2.1))) * (1.0 - mudM);
  float gl = mix(mix(g1.b, gx.r, mudM), gx.g, sandM);
  vec3 groundTex = vec3(gl * (0.55 + 0.6 * g2.b)) * mix(vec3(1.0), vec3(1.2, 1.04, 0.8), sandM);
  // rocas y paredes: la misma imagen proyectada por los tres ejes
  vec4 rx = texture2D(rockMap, vec2(vWPos.z, vWPos.y) * ${rs.toFixed(4)});
  vec4 rz = texture2D(rockMap, vec2(vWPos.x, vWPos.y) * ${rs.toFixed(4)});
  vec4 ry = texture2D(rockMap, vWPos.xz * ${rs.toFixed(4)});
  float wx = an.x * an.x, wz = an.z * an.z, wy = an.y * an.y;
  float wsum = max(wx + wz + wy, 0.0001);
  vec3 rockTex = vec3((rx.b * wx + rz.b * wz + ry.b * wy) / wsum) * vec3(1.0, 0.97, 0.92);
${two ? `  vec4 sx = texture2D(rock2Map, vec2(vWPos.z, vWPos.y) * ${rs2.toFixed(4)});
  vec4 sz = texture2D(rock2Map, vec2(vWPos.x, vWPos.y) * ${rs2.toFixed(4)});
  vec4 sy = texture2D(rock2Map, vWPos.xz * ${rs2.toFixed(4)});
  rockTex *= mix(1.0, ((sx.b * wx + sz.b * wz + sy.b * wy) / wsum) / 0.78, 0.65);` : ''}
  diffuseColor.rgb *= mix(vec3(1.0) , mix(groundTex * 1.46, rockTex * 1.34, steep), vTexAmt);
  // relieve: se inclina la luz según la pendiente de cada imagen (en el mundo: u,v de cada proyección)
  vec2 gnv = (g1.rg * 2.0 - 1.0) * (1.0 - 0.6 * mudM);
  vec2 nx2 = rx.rg * 2.0 - 1.0, nz2 = rz.rg * 2.0 - 1.0, ny2 = ry.rg * 2.0 - 1.0;
  vec3 rockBump = (vec3(0.0, nx2.y, nx2.x) * wx + vec3(nz2.x, nz2.y, 0.0) * wz + vec3(ny2.x, 0.0, ny2.y) * wy) / wsum;
${two ? `  vec2 sx2 = sx.rg * 2.0 - 1.0, sz2 = sz.rg * 2.0 - 1.0, sy2 = sy.rg * 2.0 - 1.0;
  rockBump += 0.6 * (vec3(0.0, sx2.y, sx2.x) * wx + vec3(sz2.x, sz2.y, 0.0) * wz + vec3(sy2.x, 0.0, sy2.y) * wy) / wsum;` : ''}
  vec3 gBump = mix(vec3(gnv.x, 0.0, gnv.y) * 0.35, rockBump * 0.8, steep) * vTexAmt * uBump;`)
      .replace('#include <normal_fragment_maps>', `#include <normal_fragment_maps>
  normal = normalize(normal + (viewMatrix * vec4(gBump, 0.0)).xyz);`);
  };
  mat.customProgramCacheKey = () => 'worldtex3-' + (o.rockOnly ? 'rock' : 'terrain') + (two ? '2' : '');
  return mat;
}
