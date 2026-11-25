import * as THREE from 'three';
import { applyWorldTextures, groundExtraTexture, groundTexture, pitsTexture, rockJointsTexture, rockTexture, slabsTexture, strataTexture } from '../materials';
import { ARENA_A, ARENA_B } from './layout';

// ARENA — MATERIALES. Cada elemento lleva su propio aspecto, sobre las mismas texturas del cañón:
//  · sand    suelo de arena: tres tamaños de la textura de arena (grano fino de cerca) y parches de tierra con grava
//  · seats   gradas: arenisca ocre, con líneas muy finas de filas de asientos (sin juntas)
//  · sculpt  muro bajo, puertas, escaleras, palco: piedra lisa y erosionada, modelada en la roca, con grietas finas y desgaste (sin juntas)
//  · cliff   paredes altas: roca natural oscura y rugosa con chorreones que bajan desde arriba
//  · column  columnas: roca natural con chorreones suaves
//  · rock    rocas sueltas (coberturas y escombros)
//  · plain   sin textura (cajas, metal, huecos oscuros)
// Todas añaden manchas grandes de color (zonas más sucias o más claras) para romper la repetición. El color base, el oscurecimiento
// de huecos y rincones y las sombras del sol van pintados en cada vértice al cargar (ver arena.ts): no cuestan nada al jugar.

export type Look = 'sand' | 'seats' | 'sculpt' | 'cliff' | 'column' | 'rock' | 'plain';

/** Cuánta textura de roca lleva cada aspecto (0 = ninguna) y de qué tipo (1 = arenisca con grietas y juntas de las agujas). */
const BASE: Record<Look, { tex: number; kind: number }> = {
  sand: { tex: 0, kind: 0 },
  seats: { tex: 0.7, kind: 0 },
  sculpt: { tex: 0.55, kind: 0 },
  cliff: { tex: 1, kind: 0 },
  column: { tex: 1, kind: 0 },
  rock: { tex: 1, kind: 0 },
  plain: { tex: 0, kind: 0 },
};

/** Lo que añade cada aspecto al color (va justo después del color por vértice). */
const EXTRA: Record<Look, string> = {
  sand: `
  {
    // arena: la misma imagen a dos tamaños mezcladas (sin dibujo repetido) y un grano fino que solo se nota de cerca
    vec2 P = vWPos.xz; vec2 sn1, sn2;
    vec4 s1 = aperiodic(sandMap, P, 0.32, sn1);
    vec4 s2 = aperiodic(sandMap, P * 0.23 + vec2(13.0, 7.0), 0.32, sn2);
    float sl = mix(s1.b, s2.b, 0.45);
    diffuseColor.rgb *= clamp(0.42 + 0.9 * sl, 0.55, 1.3);
    float near = 1.0 - smoothstep(5.0, 28.0, length(vViewPosition));
    vec4 s3 = texture2D(sandMap, P * 1.7 + vec2(0.31, 0.77));
    diffuseColor.rgb *= 1.0 + (s3.b - 0.55) * 0.55 * near;
    // parches de tierra con grava (más oscuros y rugosos)
    vec4 gr = texture2D(groundMap, P * 0.45);
    float gm = smoothstep(0.55, 0.78, vnoise(P * 0.055 + vec2(4.0, 9.0))) * 0.75;
    diffuseColor.rgb *= mix(1.0, 0.55 + 0.65 * gr.b, gm);
    vec2 sn = mix(sn1, sn2, 0.45);
    gBump += (vec3(sn.x, 0.0, sn.y) * 0.32 + vec3(s3.r - 0.5, 0.0, s3.g - 0.5) * 0.5 * near + vec3(gr.r - 0.5, 0.0, gr.g - 0.5) * gm * 0.8) * uBump * (1.0 - smoothstep(14.0, 60.0, length(vViewPosition)));
    stainAmt = 0.18; dirtAmt = 0.4;
  }`,
  seats: `
  {
    // gradas: líneas muy finas de las filas de asientos (sin juntas de losas: parecían ladrillos)
    float flatF = smoothstep(0.6, 0.85, abs(wn.y));
    float l = mix(thinLine(vWPos.y, 0.42, 0.02), thinLine(vOval.y, 0.55, 0.025) * 0.7, flatF);
    diffuseColor.rgb *= 1.0 - 0.12 * l;
    rockTwoScales(0.06, 0.35);
    sculptCracks(0.25);
    stainAmt = 0.22; dirtAmt = 0.5;
  }`,
  sculpt: `
  {
    // piedra modelada en la roca: lisa y erosionada, con grietas finas, chorreones suaves y desgaste (sin juntas)
    rockTwoScales(0.05, 0.3);
    sculptCracks(0.22);
    float st = vnoise(vec2(vOval.x * 0.6, vWPos.y * 0.07));
    diffuseColor.rgb *= 1.0 - 0.16 * smoothstep(0.55, 0.85, st);
    stainAmt = 0.22; dirtAmt = 0.5;
  }`,
  cliff: `
  {
    // roca natural: la textura a dos tamaños y chorreones oscuros que bajan desde arriba
    rockTwoScales(0.06, 0.45);
    float s = vnoise(vec2(vOval.x * 0.42, vWPos.y * 0.018));
    float s2 = vnoise(vec2(vOval.x * 1.6 + 9.0, vWPos.y * 0.05));
    float fromTop = smoothstep(18.0, 62.0, vWPos.y);
    float streak = smoothstep(0.52, 0.82, s * 0.7 + s2 * 0.3) * (0.3 + 0.7 * fromTop);
    diffuseColor.rgb *= 1.0 - 0.36 * streak;
    // vetas claras de mineral, más raras
    float pale = smoothstep(0.78, 0.92, vnoise(vec2(vOval.x * 0.9 + 31.0, vWPos.y * 0.03)));
    diffuseColor.rgb = mix(diffuseColor.rgb, diffuseColor.rgb * vec3(1.25, 1.18, 1.1), pale * 0.6);
    stainAmt = 0.26; dirtAmt = 0.5;
  }`,
  column: `
  {
    rockTwoScales(0.08, 0.35);
    float s = vnoise(vec2(vOval.x * 1.2, vWPos.y * 0.03));
    diffuseColor.rgb *= 1.0 - 0.22 * smoothstep(0.55, 0.85, s) * smoothstep(10.0, 60.0, vWPos.y);
    stainAmt = 0.18; dirtAmt = 0.4;
  }`,
  rock: `
  {
    rockTwoScales(0.09, 0.35);
    stainAmt = 0.2; dirtAmt = 0.4;
  }`,
  plain: `
  {
    stainAmt = 0.06; dirtAmt = 0.25;
  }`,
};

const HELPERS = `
varying vec2 vOval;
uniform vec2 uAB;
// línea fina repetida cada 'period' (ancho 'w'), que se desvanece de lejos para no hacer dibujos raros
float thinLine(float v, float period, float w) {
  float fw = fwidth(v);
  float d = abs(fract(v / period + 0.5) - 0.5) * period;
  float l = 1.0 - smoothstep(w * 0.5, w + fw, d);
  return l * (1.0 - smoothstep(period * 0.12, period * 0.35, fw));
}
// ¿la cara mira hacia el centro de la arena (o hacia fuera)? 1 = sí; 0 = mira de lado
float facingRadial() {
  vec3 n = normalize(vWNor);
  vec2 h = n.xz; float hl = length(h);
  if (hl < 0.2) return 1.0;
  float a = uAB.x + vOval.y, b = uAB.y + vOval.y;
  vec2 r = normalize(vec2(vWPos.x / (a * a), vWPos.z / (b * b)) + 1e-6);
  return abs(dot(h / hl, r));
}`;

/** Mezcla la textura de roca a un segundo tamaño (más grande). Necesita las variables del material del cañón (tw, strataMap). */
const TWO_SCALES = `
#define rockTwoScales(S, K) { float rl2_; vec3 rb2_; tri(strataMap, vWPos, S, tw, rl2_, rb2_); diffuseColor.rgb *= mix(1.0, rl2_ / 0.78, K); gBump += rb2_ * K * 0.5 * uBump; }
// grietas finas y ramificadas (líneas de ruido), solo en algunas zonas; se desvanecen de lejos
#define sculptCracks(K) { vec2 cp_ = vec2(vOval.x * 0.32, vWPos.y * 0.45 + vOval.y * 0.32); float cn_ = vnoise(cp_) * 0.65 + vnoise(cp_ * 2.7 + 7.0) * 0.35; float fw_ = fwidth(cn_); float cr_ = 1.0 - smoothstep(0.002, 0.01 + fw_ * 1.2, abs(cn_ - 0.62)); cr_ *= smoothstep(0.55, 0.75, vnoise(cp_ * 0.35 + 3.0)) * (1.0 - smoothstep(0.03, 0.12, fw_)); diffuseColor.rgb *= 1.0 - K * cr_; }
`;

/** Material de la arena para un aspecto. La geometría debe llevar color, texAmt, texKind y aOval (lo pone arena.ts). */
export function arenaMaterial(look: Look, side: THREE.Side = THREE.FrontSide): THREE.Material {
  const mat = new THREE.MeshLambertMaterial({ vertexColors: true, side });
  const tex = { ground: groundTexture(), groundX: groundExtraTexture(), slabs: slabsTexture(), strata: strataTexture(), pits: pitsTexture() };
  applyWorldTextures(mat, { ...tex, spire: { rock: rockTexture(), joints: rockJointsTexture() }, rockOnly: true, strataScale: 0.2 });
  const prev = mat.onBeforeCompile, prevKey = mat.customProgramCacheKey;
  mat.onBeforeCompile = (sh, r) => {
    prev.call(mat, sh, r);
    sh.uniforms.uAB = { value: new THREE.Vector2(ARENA_A, ARENA_B) };
    sh.vertexShader = sh.vertexShader
      .replace('#include <common>', '#include <common>\nattribute vec2 aOval;\nvarying vec2 vOval;')
      .replace('#include <begin_vertex>', '#include <begin_vertex>\nvOval = aOval;');
    sh.fragmentShader = sh.fragmentShader
      .replace('uniform float uBump;', 'uniform float uBump;' + HELPERS + TWO_SCALES)
      .replace('#include <color_fragment>', `#include <color_fragment>
  float stainAmt = 0.0, dirtAmt = 0.0;
${EXTRA[look]}
  // manchas grandes: zonas más claras o más oscuras y zonas sucias (más pardas), para que las superficies grandes no se vean iguales
  float big = vnoise(vWPos.xz * 0.017 + vec2(vWPos.y * 0.013, 17.0));
  float big2 = vnoise(vWPos.xz * 0.045 + vec2(5.0, vWPos.y * 0.03));
  diffuseColor.rgb *= 1.0 + stainAmt * ((big - 0.5) * 1.6 + (big2 - 0.5) * 0.7);
  diffuseColor.rgb = mix(diffuseColor.rgb, diffuseColor.rgb * vec3(0.84, 0.76, 0.7), smoothstep(0.58, 0.85, big2) * dirtAmt);`);
  };
  mat.customProgramCacheKey = () => prevKey.call(mat) + '+arena-' + look;
  return mat;
}

/** Valores de texAmt/texKind de cada aspecto (los pone arena.ts en la geometría). */
export const lookBase = (look: Look) => BASE[look];

// ── Marcas en el suelo: huellas, arrastres y quemaduras ──────────────────────
// Una sola imagen dibujada por código (blanco = no cambia nada; más oscuro = oscurece la arena): se pinta encima del suelo multiplicando.
// Columnas de la imagen: [0, 0.25) huellas sueltas · [0.25, 0.5) arrastre · [0.5, 0.75) quemadura · [0.75, 1) arena pisada.

export const DECAL_UV = { prints: [0, 0.25], drag: [0.25, 0.5], scorch: [0.5, 0.75], trample: [0.75, 1] } as const;

function hash(i: number, j: number) {
  let h = Math.imul(i, 374761393) ^ Math.imul(j, 668265263) ^ 0x5bd1e995;
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}
function vnoise(x: number, y: number) {
  const ix = Math.floor(x), iy = Math.floor(y), fx = x - ix, fy = y - iy;
  const sx = fx * fx * (3 - 2 * fx), sy = fy * fy * (3 - 2 * fy);
  const a = hash(ix, iy), b = hash(ix + 1, iy), c = hash(ix, iy + 1), d = hash(ix + 1, iy + 1);
  return a + (b - a) * sx + (c - a) * sy + (a - b - c + d) * sx * sy;
}

let decalTex: THREE.Texture | null = null;
function decalTexture(): THREE.Texture {
  if (decalTex) return decalTex;
  const W = 1024, H = 512;
  const c = document.createElement('canvas');
  c.width = W; c.height = H;
  const g = c.getContext('2d')!;
  g.fillStyle = '#ffffff';
  g.fillRect(0, 0, W, H);
  // huellas sueltas: pocas, giradas al azar, unas más marcadas que otras y borrosas (arena que se desmorona)
  let seed = 11;
  const rnd = () => { seed = (seed * 16807) % 2147483647; return seed / 2147483647; };
  g.filter = 'blur(3px)';
  for (let k = 0; k < 7; k++) {
    const x = 50 + rnd() * 156, y = 40 + k * 64 + rnd() * 20;
    g.save();
    g.translate(x, y);
    g.rotate(rnd() * 0.8 - 0.4);
    const a = 0.25 + rnd() * 0.45;
    g.fillStyle = `rgba(150,120,100,${a.toFixed(2)})`;
    g.beginPath(); g.ellipse(0, 4, 9, 16, 0, 0, Math.PI * 2); g.fill();
    g.beginPath(); g.ellipse(-6, -15, 4, 7, -0.3, 0, Math.PI * 2); g.fill();
    g.beginPath(); g.ellipse(6, -15, 4, 7, 0.3, 0, Math.PI * 2); g.fill();
    g.restore();
  }
  g.filter = 'none';
  // arrastre: un surco ancho y suave, de bordes irregulares
  const img = g.getImageData(256, 0, 256, H);
  for (let y = 0; y < H; y++) for (let x = 0; x < 256; x++) {
    const wob = (vnoise(y * 0.02, 3) - 0.5) * 0.25;
    const u = (x - 128) / 128 + wob;
    const groove = Math.exp(-((u / 0.38) ** 2)) * (0.6 + 0.4 * vnoise(x * 0.05, y * 0.03));
    const ends = smooth(0, 60, y) * (1 - smooth(H - 80, H, y));
    const k = groove * 0.45 * ends;
    const o = (y * 256 + x) * 4;
    img.data[o] = 255 - 95 * k; img.data[o + 1] = 255 - 112 * k; img.data[o + 2] = 255 - 125 * k;
  }
  g.putImageData(img, 256, 0);
  // quemadura: mancha suave y parda, de borde roto (256 × 256, en el centro de su columna)
  const sc = g.getImageData(512, 128, 256, 256);
  for (let y = 0; y < 256; y++) for (let x = 0; x < 256; x++) {
    const u = (x - 128) / 128, v = (y - 128) / 128;
    const r = Math.hypot(u, v), a = Math.atan2(v, u);
    const edge = 0.55 + 0.25 * vnoise(a * 3 + 10, 1) + 0.12 * vnoise(x * 0.06, y * 0.06);
    const core = 1 - smooth(edge * 0.3, edge, r);
    const rays = Math.pow(vnoise(a * 5 + 3, r * 1.5), 3) * (1 - smooth(0.35, 0.9, r)) * smooth(0.15, 0.5, r);
    const k = Math.min(1, core * 0.65 + rays * 0.3) * (0.8 + 0.2 * vnoise(x * 0.1, y * 0.1));
    const o = (y * 256 + x) * 4;
    sc.data[o] = 255 - 175 * k; sc.data[o + 1] = 255 - 190 * k; sc.data[o + 2] = 255 - 196 * k;
  }
  g.putImageData(sc, 512, 128);
  // arena pisada: manchas irregulares algo más oscuras con hoyitos, que se funden con la arena por los bordes
  const tr = g.getImageData(768, 0, 256, H);
  for (let y = 0; y < H; y++) for (let x = 0; x < 256; x++) {
    const u = (x - 128) / 128, v = (y - 256) / 256;
    const shape = 1 - smooth(0.45, 1.0, Math.hypot(u, v) + (vnoise(x * 0.03, y * 0.03) - 0.5) * 0.7);
    const dents = smooth(0.55, 0.8, vnoise(x * 0.22 + 5, y * 0.22)) * 0.6;
    const k = shape * (0.22 + 0.18 * vnoise(x * 0.06 + 2, y * 0.06) + dents * 0.35);
    const o = (y * 256 + x) * 4;
    tr.data[o] = 255 - 80 * k; tr.data[o + 1] = 255 - 98 * k; tr.data[o + 2] = 255 - 112 * k;
  }
  g.putImageData(tr, 768, 0);
  decalTex = new THREE.CanvasTexture(c);
  decalTex.colorSpace = THREE.SRGBColorSpace;
  decalTex.anisotropy = 4;
  return decalTex;
}
const smooth = (a: number, b: number, v: number) => { const t = Math.min(1, Math.max(0, (v - a) / (b - a))); return t * t * (3 - 2 * t); };

/** Material de las marcas del suelo: oscurece la arena multiplicando (así se ven igual al sol que a la sombra). */
export function decalMaterial(): THREE.Material {
  return new THREE.MeshBasicMaterial({
    map: decalTexture(), blending: THREE.MultiplyBlending, premultipliedAlpha: true, transparent: true, depthWrite: false, fog: false,
    polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2,
  });
}

// ── Polvo en los túneles de las puertas ──────────────────────────────────────

let dustTex: THREE.Texture | null = null;
/** Textura de polvo: nube suave y alargada (sin puntitos). */
export function dustMaterial(): THREE.Material {
  if (!dustTex) {
    const S = 128, c = document.createElement('canvas');
    c.width = c.height = S;
    const g = c.getContext('2d')!;
    const img = g.createImageData(S, S);
    for (let y = 0; y < S; y++) for (let x = 0; x < S; x++) {
      const u = (x / S) * 2 - 1, v = (y / S) * 2 - 1;
      const fall = (1 - smooth(0.3, 1, Math.abs(u))) * (1 - smooth(0.2, 1, Math.abs(v)));
      const n = 0.55 * vnoise(x * 0.05, y * 0.03) + 0.45 * vnoise(x * 0.11 + 7, y * 0.08 + 3);
      const a = fall * (0.45 + 0.55 * smooth(0.2, 0.85, n)); // neblina suave, sin manchas fuertes (si no, parece fuego)
      const o = (y * S + x) * 4;
      img.data[o] = 255; img.data[o + 1] = 225; img.data[o + 2] = 175; img.data[o + 3] = Math.round(a * 255);
    }
    g.putImageData(img, 0, 0);
    dustTex = new THREE.CanvasTexture(c);
    dustTex.colorSpace = THREE.SRGBColorSpace;
  }
  return new THREE.MeshBasicMaterial({ map: dustTex, transparent: true, opacity: 0.11, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide, fog: true });
}
