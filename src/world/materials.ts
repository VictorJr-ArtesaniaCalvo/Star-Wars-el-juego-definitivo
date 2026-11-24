import * as THREE from 'three';
import { makeRng } from './terrain';
import { withLightFloor } from './lightFill';

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

interface Real { ground: THREE.Texture; groundX: THREE.Texture; wall: THREE.Texture; cracks: THREE.Texture; slabs: THREE.Texture; strata: THREE.Texture; pits: THREE.Texture }
let real: Real | null = null;
/** Texturas del suelo «rico» (calidad media y alta): arena roja, roca en lajas, roca con agujeros y la roca de las lajas en 3D. */
interface Rich { sand: THREE.Texture; rocky: THREE.Texture; pitted: THREE.Texture; slab: THREE.Texture }
let rich: Rich | null = null;

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
    const [ground, groundX, wall, cracks, slabs, strata, pits] = await Promise.all([get('ground-red'), get('ground-extra'), get('rock-wall'), get('rock-cracks'), get('ground-slabs'), get('rock-strata'), get('rock-pits')]);
    real = { ground, groundX, wall, cracks, slabs, strata, pits };
    // las nuevas se cargan aparte: si faltan, el suelo se queda como antes
    try {
      const [sand, rocky, pitted, slab] = await Promise.all([get('ground-sand'), get('ground-rocky'), get('rock-pitted'), get('rock-slab')]);
      rich = { sand, rocky, pitted, slab };
    } catch (e) {
      console.warn('No se pudieron cargar las texturas nuevas del suelo; se queda el suelo de siempre.', e);
      rich = null;
    }
    applyRich();
    return true;
  } catch (e) {
    console.warn('No se pudieron cargar las texturas del escenario; se usan las generadas por código.', e);
    real = null; rich = null;
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
/** Arenisca con grietas: ahora solo la llevan las agujas (torres). */
export const wallTexture = (): THREE.Texture => real?.cracks ?? fallback('w', () => buildRockCached());
export const rockTexture = wallTexture;
/** Juntas grandes de bloques (agujas): se mezcla por encima de la anterior. */
export const rockJointsTexture = (): THREE.Texture | null => real?.wall ?? null;
// Textura neutra (relieve plano, brillo medio) para cuando faltan las nuevas
let neutralTex: THREE.DataTexture | null = null;
const neutral = () => (neutralTex ??= toTexture(new Uint8ClampedArray(Array.from({ length: 16 }, () => [128, 128, 200, 255]).flat()), 2));
/** Roca estratificada (capas horizontales): paredes del cañón y rocas (no las agujas). */
export const strataTexture = (): THREE.Texture => real?.strata ?? fallback('w', () => buildRockCached());
/** Huecos de erosión sobre las rocas. */
export const pitsTexture = (): THREE.Texture => real?.pits ?? neutral();
/** Lajas de arenisca sueltas sobre arena (suelo). */
export const slabsTexture = (): THREE.Texture => real?.slabs ?? neutral();

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

interface Options {
  ground: THREE.Texture; groundX: THREE.Texture; slabs: THREE.Texture;
  /** Roca estratificada: paredes del cañón y rocas. */
  strata: THREE.Texture; pits?: THREE.Texture;
  /** Solo en el material de las rocas sueltas: las agujas (torres) llevan estas dos imágenes de siempre en vez de las nuevas. */
  spire?: { rock: THREE.Texture; joints: THREE.Texture | null };
  rockOnly?: boolean; groundScale?: number; strataScale?: number;
  /** Solo el terreno: cuánta roca hay cerca de cada vértice (coberturas), de 0 a 1. */
  terrainRock?: boolean;
}

// Fuerza del relieve de las texturas (se baja a 0 en calidad «baja» para ahorrar batería). Se comparte entre todos los materiales.
const bumpUniform = { value: 1 };
export const setWorldBump = (on: boolean) => { bumpUniform.value = on ? 1 : 0; };

// Suelo «rico» (calidad media y alta): arena roja + roca en lajas + roca con agujeros. En calidad baja se queda el de siempre.
const richUniform = { value: 0 };
const pitMapUniform: { value: THREE.Texture | null } = { value: null };
const pitScaleUniform = { value: 0.13 };
const strataUniform: { value: THREE.Texture | null } = { value: null };
const strataKUniform = { value: 1 };
let richWanted = false;
function applyRich() {
  const on = richWanted && !!rich;
  richUniform.value = on ? 1 : 0;
  pitMapUniform.value = on ? rich!.pitted : (real?.pits ?? neutral());
  pitScaleUniform.value = on ? 0.2 : 0.13;
  // en las paredes y rocas la capa de roca pasa a ser Rock 029 (a otra escala)
  strataUniform.value = on ? rich!.slab : strataTexture();
  strataKUniform.value = on ? 2.3 : 1;
}
export const setWorldRich = (on: boolean) => { richWanted = on; applyRich(); };
/** Textura de la roca de las lajas en 3D (solo si se cargaron las texturas nuevas). */
export const slabRockTexture = (): THREE.Texture | null => rich?.slab ?? null;
export const richGroundReady = () => !!rich;

/**
 * Añade al material las texturas en el espacio del mundo: sobre superficies casi horizontales la tierra (con parches de lajas de arenisca,
 * de barro agrietado y de arena), en las pendientes y paredes la roca estratificada con huecos de erosión (proyectada por los tres ejes,
 * sin estirarse). Las agujas (torres) llevan arenisca con grietas y juntas de bloques. Además de colorear, las texturas inclinan un poco
 * la luz (relieve) para que se noten las piedras, las capas y los huecos.
 */
export function applyWorldTextures(mat: THREE.MeshLambertMaterial, o: Options) {
  const gs = o.groundScale ?? 0.4, ss = o.strataScale ?? 0.15, sp = o.spire, pits = !!o.pits;
  mat.onBeforeCompile = (shader) => {
    shader.uniforms.groundMap = { value: o.ground };
    shader.uniforms.groundXMap = { value: o.groundX };
    shader.uniforms.slabMap = { value: o.slabs };
    strataUniform.value ??= o.strata;
    shader.uniforms.strataMap = strataUniform;
    shader.uniforms.uStrataK = strataKUniform;
    if (pits) { shader.uniforms.pitMap = pitMapUniform; shader.uniforms.uPitScale = pitScaleUniform; }
    shader.uniforms.sandMap = { value: rich?.sand ?? neutral() };
    shader.uniforms.rockyMap = { value: rich?.rocky ?? neutral() };
    shader.uniforms.uRich = richUniform;
    if (sp) { shader.uniforms.spireMap = { value: sp.rock }; if (sp.joints) shader.uniforms.jointMap = { value: sp.joints }; }
    shader.uniforms.uBump = bumpUniform;
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\nvarying vec3 vWPos;\nvarying vec3 vWNor;\nvarying float vTexAmt;\nvarying float vKind;\nvarying float vRock;' + (o.rockOnly ? '\nattribute float texAmt;\nattribute float texKind;' : '') + (o.terrainRock ? '\nattribute float aRock;' : ''))
      .replace('#include <begin_vertex>', '#include <begin_vertex>\n#ifdef USE_INSTANCING\nvWPos = (modelMatrix * instanceMatrix * vec4(position, 1.0)).xyz;\nvWNor = normalize(mat3(modelMatrix) * mat3(instanceMatrix) * objectNormal);\n#else\nvWPos = (modelMatrix * vec4(position, 1.0)).xyz;\nvWNor = normalize(mat3(modelMatrix) * objectNormal);\n#endif\nvTexAmt = ' + (o.rockOnly ? 'texAmt' : '1.0') + ';\nvKind = ' + (o.rockOnly ? 'texKind' : '0.0') + ';\nvRock = ' + (o.terrainRock ? 'aRock' : '0.0') + ';');
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', `#include <common>
varying vec3 vWPos;
varying vec3 vWNor;
varying float vTexAmt;
varying float vKind;
varying float vRock;
uniform sampler2D groundMap;
uniform sampler2D sandMap;
uniform sampler2D rockyMap;
uniform float uRich;
uniform sampler2D groundXMap;
uniform sampler2D slabMap;
uniform sampler2D strataMap;
uniform float uStrataK;
${pits ? 'uniform sampler2D pitMap;\nuniform float uPitScale;' : ''}
${sp ? 'uniform sampler2D spireMap;' + (sp.joints ? '\nuniform sampler2D jointMap;' : '') : ''}
uniform float uBump;
float hash21(vec2 p) { p = fract(p * vec2(123.34, 456.21)); p += dot(p, p + 45.32); return fract(p.x * p.y); }
float vnoise(vec2 p) {
  vec2 i = floor(p), f = fract(p); f = f * f * (3.0 - 2.0 * f);
  return mix(mix(hash21(i), hash21(i + vec2(1.0, 0.0)), f.x), mix(hash21(i + vec2(0.0, 1.0)), hash21(i + vec2(1.0, 1.0)), f.x), f.y);
}
// Una imagen proyectada por los tres ejes: devuelve su brillo (azul) y la inclinación de la luz (rojo y verde) en coordenadas del mundo
void tri(sampler2D t, vec3 p, float s, vec3 w, out float l, out vec3 b) {
  vec4 x = texture2D(t, vec2(p.z, p.y) * s);
  vec4 z = texture2D(t, vec2(p.x, p.y) * s);
  vec4 y = texture2D(t, p.xz * s);
  vec2 nx = x.rg * 2.0 - 1.0, nz = z.rg * 2.0 - 1.0, ny = y.rg * 2.0 - 1.0;
  float k = max(w.x + w.y + w.z, 0.0001);
  l = (x.b * w.x + z.b * w.z + y.b * w.y) / k;
  b = (vec3(0.0, nx.y, nx.x) * w.x + vec3(nz.x, nz.y, 0.0) * w.z + vec3(ny.x, 0.0, ny.y) * w.y) / k;
}
// Imagen del suelo sin repetición visible: dos pasadas (una girada y a otra escala) mezcladas por manchas de ruido. Devuelve el brillo (b) y la inclinación de la luz (n)
vec4 aperiodic(sampler2D t, vec2 p, float s, out vec2 n) {
  vec4 a = texture2D(t, p * s);
  mat2 R = mat2(0.8, -0.6, 0.6, 0.8);
  vec4 c = texture2D(t, R * p * (s * 0.71) + vec2(0.37, 0.61));
  float m = smoothstep(0.3, 0.7, vnoise(p * 0.05));
  n = mix(a.rg * 2.0 - 1.0, (c.rg * 2.0 - 1.0) * R, m);
  return mix(a, c, m);
}`)
      .replace('#include <map_fragment>', `
  vec3 wn = normalize(vWNor);
  vec3 an = abs(wn);
  // las pendientes del terreno se proyectan según la cara real del triángulo (no la normal interpolada): así la pared no se estira en vertical
  vec3 fn = abs(normalize(cross(dFdx(vWPos), dFdy(vWPos))));
  vec3 tw = uRich > 0.5 ? pow(${o.terrainRock ? 'fn' : 'an'}, vec3(10.0)) : ${o.terrainRock ? 'fn * fn' : 'an * an'}; // en el suelo rico la proyección se decide con más firmeza (así no se estira en las cuestas)
  float ay = ${o.terrainRock ? 'fn.y' : 'an.y'}; // inclinación de la cara real en el terreno (la interpolada mezclaría tierra estirada en las paredes)
  float steep = ${o.rockOnly ? '1.0' : 'smoothstep(0.5, 0.82, 1.0 - ay)'};
  // suelo: tierra con grava (relieve y brillo en una sola imagen), una pasada grande para romper la repetición y parches de lajas, barro y arena
  vec4 g1 = texture2D(groundMap, vWPos.xz * ${gs.toFixed(4)});
  vec4 g2 = texture2D(groundMap, vWPos.xz * ${(gs * 0.09).toFixed(4)} + vec2(0.37, 0.61));
  vec2 gx = texture2D(groundXMap, vWPos.xz * ${(gs * 0.45).toFixed(4)}).rg;
  float flatG = smoothstep(0.9, 0.97, ay);
  float gl; vec3 groundTex; vec2 gnv;
  if (uRich > 0.5) {
    // --- suelo rico: arena roja de base, que pasa a roca en lajas cerca de las paredes, en pendientes y junto a las coberturas ---
    vec2 P = vWPos.xz;
    float wallM = 0.0; // (la cercanía a las paredes llega ya calculada en vRock)
    float patchM = smoothstep(0.44, 0.56, vnoise(P * 0.028 + vec2(3.7, 9.1)));
    float pathM = 1.0 - smoothstep(0.0, 0.05, abs(vnoise(P * 0.014 + vec2(5.0, 1.0)) - 0.5)); // caminos de arena
    float steepG = 1.0 - smoothstep(0.88, 0.97, ay);
    float rockM = clamp(wallM * 0.85 + patchM * 0.65 + vRock * 0.9 + steepG, 0.0, 1.0);
    rockM *= 1.0 - 0.85 * pathM * (1.0 - vRock);
    rockM = smoothstep(0.25, 0.75, rockM + (vnoise(P * 0.35) - 0.5) * 0.35); // borde irregular
    float mudM = smoothstep(0.55, 0.66, vnoise(P * 0.017)) * (1.0 - rockM) * flatG;
    float earthM = smoothstep(0.35, 0.65, vnoise(P * 0.021 + vec2(8.0, 3.0)));
    vec2 sn, rn;
    vec4 sa = aperiodic(sandMap, P, 0.3, sn);
    vec4 ro = aperiodic(rockyMap, P, 0.2, rn);
    float baseL = mix(sa.b, g1.b, earthM);
    vec2 baseN = mix(sn * 1.0, g1.rg * 2.0 - 1.0, earthM);
    vec3 sandTint = vec3(1.18, 1.04, 0.82);
    vec3 baseCol = vec3(baseL) * mix(sandTint, vec3(1.0), earthM);
    float rl2 = clamp(0.78 + (ro.b - 0.78) * 2.0, 0.25, 1.25); // más contraste: lajas claras y juntas oscuras
    vec3 rockCol = vec3(rl2) * vec3(1.0, 0.96, 0.9);
    float dust = smoothstep(0.7, 0.3, rl2) * 0.6 * rockM; // polvo claro acumulado en los huecos de la piedra
    vec3 col = mix(baseCol, rockCol, rockM);
    col = mix(col, vec3(baseL) * sandTint * 1.08, dust);
    col = mix(col, vec3(gx.r), mudM * 0.8);
    groundTex = col * (0.55 + 0.6 * g2.b);
    gnv = mix(baseN, rn * 1.9, rockM) * (1.0 - 0.6 * mudM);
  } else {
    // --- suelo de siempre: tierra con grava, con parches de lajas dibujadas, barro y arena ---
    vec4 sl = texture2D(slabMap, vWPos.xz * ${(gs * 0.5).toFixed(4)});
    float slabM = smoothstep(0.36, 0.5, vnoise(vWPos.xz * 0.026 + vec2(3.7, 9.1)));
    float mudM = smoothstep(0.5, 0.62, vnoise(vWPos.xz * 0.017)) * (1.0 - slabM);
    float sandM = smoothstep(0.52, 0.66, vnoise(vWPos.xz * 0.011 + vec2(7.3, 2.1))) * (1.0 - mudM) * (1.0 - slabM);
    // las lajas, el barro y la arena solo en suelo casi llano (en las cuestas se estirarían)
    slabM *= flatG; mudM *= flatG; sandM *= flatG;
    gl = mix(mix(g1.b, gx.r, mudM), gx.g, sandM);
    gl = mix(gl, sl.b, slabM);
    groundTex = vec3(gl * (0.55 + 0.6 * g2.b)) * mix(vec3(1.0), vec3(1.2, 1.04, 0.8), sandM);
    gnv = mix(g1.rg * 2.0 - 1.0, (sl.rg * 2.0 - 1.0) * 1.7, slabM) * (1.0 - 0.6 * mudM);
  }
  // rocas y paredes
  vec3 rockTex = vec3(1.0);
  vec3 rockBump = vec3(0.0);
  float rl; vec3 rb;
${sp ? `  if (vKind > 0.5) {
    // agujas (torres): arenisca con grietas y juntas de bloques de siempre
    tri(spireMap, vWPos, 0.3, tw, rl, rb);
    rockTex = vec3(rl) * vec3(1.0, 0.97, 0.92);
    rockBump = rb;
${sp.joints ? `    float jl; vec3 jb;
    tri(jointMap, vWPos, 0.07, tw, jl, jb);
    rockTex *= mix(1.0, jl / 0.78, 0.65);
    rockBump += 0.6 * jb;` : ''}
  } else {` : ''}
  tri(strataMap, vWPos, ${ss.toFixed(4)} * uStrataK, tw, rl, rb);
  // las manchas de claro y oscuro a gran escala rompen la repetición de la imagen
  float macroR = 0.78 + 0.44 * vnoise(vec2(vWPos.x + vWPos.z, vWPos.y) * 0.045);
  rockTex = vec3(rl * macroR) * vec3(1.0, 0.97, 0.92);
  rockBump = rb;
${pits ? `  // huecos de erosión en parches de las caras verticales
  float pl; vec3 pb;
  tri(pitMap, vWPos, uPitScale, tw, pl, pb);
  float pitM = smoothstep(mix(0.45, 0.56, uRich), mix(0.62, 0.7, uRich), vnoise(vWPos.xz * 0.06 + vWPos.y * 0.05)) * smoothstep(0.3, 0.7, 1.0 - an.y);
  ${o.terrainRock ? 'pitM *= uRich;' : ''}
  rockTex *= mix(1.0, pl / 0.78, pitM);
  rockBump = mix(rockBump, pb * 1.3, pitM);` : ''}
${sp ? '  }' : ''}
  diffuseColor.rgb *= mix(vec3(1.0), mix(groundTex * 1.46, rockTex * 1.34, steep), vTexAmt);
  // relieve: se inclina la luz según la pendiente de cada imagen (en el mundo)
  vec3 gBump = mix(vec3(gnv.x, 0.0, gnv.y) * 0.35, rockBump * 0.8, steep) * vTexAmt * uBump;
  // en el suelo rico el relieve fino se apaga con la distancia (a ras de suelo se vería como hebras)
  gBump *= mix(1.0, 1.0 - smoothstep(18.0, 70.0, length(vViewPosition)), uRich * (1.0 - steep));`)
      .replace('#include <normal_fragment_maps>', `#include <normal_fragment_maps>
  normal = normalize(normal + (viewMatrix * vec4(gBump, 0.0)).xyz);`);
  };
  mat.customProgramCacheKey = () => 'worldtex5-' + (o.rockOnly ? 'rock' : 'terrain') + (pits ? 'p' : '') + (o.terrainRock ? 'r' : '') + (sp ? 's' : '');
  return withLightFloor(mat);
}
