import * as THREE from 'three';
import type { Quality } from '../core/Settings';

// Efectos de la cañonera derribada, sin tocar el modelo: humo continuo de los motores, una columna de humo alta que se ve desde lejos,
// chispas ocasionales, brasas que suben, pequeños fuegos y polvo.
// Todo son puntos en una reserva fija (muy ligera para el móvil): un solo objeto por tipo. Cada punto dibuja una de las imágenes de partículas
// de Kenney (CC0, ver assets/CREDITOS.md) reunidas en public/particles/atlas.png; si no se pudieran cargar, se dibuja una mancha suave.

export interface FirePoint { x: number; y: number; z: number; size: number }
export interface SmokeSource { x: number; y: number; z: number; rate: number; size: number }
export interface DustSource { x: number; y: number; z: number; rate: number; size: number }
export interface SparkSource { x: number; y: number; z: number; every: [number, number]; count: number }

/** Puntos donde arde fuego en la cañonera (destellos que parpadean, ver Atmosphere). */
export const GUNSHIP_FIRES: FirePoint[] = [];
/** Dónde sale humo, saltan chispas y arden llamas en la cañonera (se rellena al montar el escenario). */
export const GUNSHIP_FX = {
  smoke: [] as SmokeSource[],
  sparks: [] as SparkSource[],
  flames: [] as FirePoint[],
  dust: [] as DustSource[],
};

// ---------- Imágenes de las partículas (atlas de 4×4 casillas) ----------
// 0-4 humo · 5-7 polvo · 8-11 fuego (2 estallidos y 2 lenguas) · 12-14 chispas · 15 rayo
export const SPRITES = { smoke: [0, 1, 2, 3, 4], dust: [5, 6, 7], fire: [8, 9, 10, 11], sparks: [12, 13, 14] };
let atlasTex: THREE.Texture | null = null;
/** Descarga el atlas de partículas. Si falla, las partículas se dibujan como manchas suaves. */
export async function loadParticleAtlas(base: string): Promise<boolean> {
  try {
    const t = await new THREE.TextureLoader().loadAsync(`${base}particles/atlas.png`);
    t.colorSpace = THREE.NoColorSpace; // el color son grises que luego se tiñen
    t.anisotropy = 1;
    atlasTex = t;
    return true;
  } catch (e) {
    console.warn('No se pudo cargar el atlas de partículas; se dibujan manchas suaves.', e);
    atlasTex = null;
    return false;
  }
}

const VERT = /* glsl */ `
attribute float aSize;
attribute float aAlpha;
attribute vec3 aColor;
attribute float aFrame;
attribute float aRot;
varying float vAlpha;
varying vec3 vColor;
varying float vFrame;
varying float vRot;
uniform float uScale;
uniform float uMax;
void main() {
  vec4 mv = modelViewMatrix * vec4(position, 1.0);
  gl_Position = projectionMatrix * mv;
  gl_PointSize = min(aSize * uScale / max(0.1, -mv.z), uMax);
  vAlpha = aAlpha;
  vColor = aColor;
  vFrame = aFrame;
  vRot = aRot;
}`;
const FRAG = /* glsl */ `
varying float vAlpha;
varying vec3 vColor;
varying float vFrame;
varying float vRot;
uniform sampler2D uAtlas;
void main() {
  if (vFrame < 0.0) {
    float d = length(gl_PointCoord - 0.5) * 2.0;
    float a = smoothstep(1.0, 0.0, d);
    gl_FragColor = vec4(vColor, a * a * vAlpha);
    return;
  }
  // la imagen de la partícula, girada y algo más pequeña que el punto (así no se recortan las esquinas al girar)
  vec2 c = gl_PointCoord - 0.5;
  float cs = cos(vRot), sn = sin(vRot);
  vec2 r = vec2(c.x * cs - c.y * sn, c.x * sn + c.y * cs) * 1.15 + 0.5;
  if (r.x < 0.0 || r.x > 1.0 || r.y < 0.0 || r.y > 1.0) discard;
  vec2 cell = vec2(mod(vFrame, 4.0), floor(vFrame / 4.0));
  vec4 t = texture2D(uAtlas, vec2((cell.x + r.x) * 0.25, 1.0 - (cell.y + r.y) * 0.25));
  gl_FragColor = vec4(vColor * t.rgb, t.a * vAlpha);
}`;

export interface PoolOpts {
  n: number;
  additive: boolean;
  gravity: number; // m/s² (positivo = cae)
  drag: number; // frenado por segundo
  wind: [number, number, number]; // deriva constante (m/s²)
  colorA: [number, number, number]; // color al nacer
  colorB: [number, number, number]; // color al morir
  alpha: number; // opacidad máxima
  sprites?: number[]; // casillas del atlas que usa cada partícula (se elige una al azar); sin esto, mancha suave
  spin?: number; // velocidad máxima de giro (rad/s)
  tilt?: number; // giro inicial máximo (rad; por defecto, cualquiera)
}

/** Reserva de partículas suaves: tamaño, opacidad y color cambian a lo largo de su vida. */
export class SoftPoints {
  readonly points: THREE.Points;
  private n: number;
  private pos: Float32Array; private vel: Float32Array;
  private age: Float32Array; private life: Float32Array; private s0: Float32Array; private s1: Float32Array;
  private frame: Float32Array; private rot: Float32Array; private spinV: Float32Array;
  private size: Float32Array; private alpha: Float32Array; private color: Float32Array;
  private next = 0;
  private tmpV = new THREE.Vector2();

  constructor(scene: THREE.Scene, private o: PoolOpts) {
    const n = (this.n = o.n);
    this.pos = new Float32Array(n * 3); this.vel = new Float32Array(n * 3);
    this.age = new Float32Array(n).fill(1); this.life = new Float32Array(n).fill(1);
    this.s0 = new Float32Array(n); this.s1 = new Float32Array(n);
    this.size = new Float32Array(n); this.alpha = new Float32Array(n); this.color = new Float32Array(n * 3);
    this.frame = new Float32Array(n).fill(-1); this.rot = new Float32Array(n); this.spinV = new Float32Array(n);
    for (let i = 0; i < n; i++) this.pos[i * 3 + 1] = -1000;
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(this.pos, 3));
    g.setAttribute('aSize', new THREE.BufferAttribute(this.size, 1));
    g.setAttribute('aAlpha', new THREE.BufferAttribute(this.alpha, 1));
    g.setAttribute('aColor', new THREE.BufferAttribute(this.color, 3));
    g.setAttribute('aFrame', new THREE.BufferAttribute(this.frame, 1));
    g.setAttribute('aRot', new THREE.BufferAttribute(this.rot, 1));
    const mat = new THREE.ShaderMaterial({
      uniforms: { uScale: { value: 400 }, uMax: { value: 400 }, uAtlas: { value: atlasTex } },
      vertexShader: VERT, fragmentShader: FRAG,
      transparent: true, depthWrite: false, blending: o.additive ? THREE.AdditiveBlending : THREE.NormalBlending, fog: false,
    });
    this.points = new THREE.Points(g, mat);
    this.points.frustumCulled = false;
    this.points.renderOrder = 2;
    // el tamaño de cada punto sigue a la distancia y a la pantalla
    this.points.onBeforeRender = (renderer, _scene, camera) => {
      const h = renderer.getDrawingBufferSize(this.tmpV).y;
      mat.uniforms.uScale.value = h * 0.5 * (camera as THREE.PerspectiveCamera).projectionMatrix.elements[5];
      mat.uniforms.uMax.value = h * 0.55; // una bocanada muy cerca de la cámara no cubre toda la pantalla
    };
    scene.add(this.points);
  }

  emit(x: number, y: number, z: number, vx: number, vy: number, vz: number, life: number, s0: number, s1: number) {
    const i = this.next;
    this.next = (this.next + 1) % this.n;
    this.pos.set([x, y, z], i * 3); this.vel.set([vx, vy, vz], i * 3);
    this.age[i] = 0; this.life[i] = life; this.s0[i] = s0; this.s1[i] = s1;
    const sp = this.o.sprites;
    this.frame[i] = sp && atlasTex ? sp[(Math.random() * sp.length) | 0] : -1;
    this.rot[i] = (Math.random() * 2 - 1) * (this.o.tilt ?? Math.PI);
    this.spinV[i] = (Math.random() * 2 - 1) * (this.o.spin ?? 0);
  }

  clear() {
    this.age.fill(1); this.life.fill(1); this.alpha.fill(0);
    for (let i = 0; i < this.n; i++) this.pos[i * 3 + 1] = -1000;
    const a = this.points.geometry.attributes;
    (a.position as THREE.BufferAttribute).needsUpdate = true; (a.aAlpha as THREE.BufferAttribute).needsUpdate = true;
  }

  update(dt: number) {
    const { gravity, drag, wind, colorA, colorB, alpha } = this.o;
    const d = Math.max(0, 1 - drag * dt);
    for (let i = 0; i < this.n; i++) {
      if (this.age[i] >= this.life[i]) { if (this.alpha[i] !== 0) { this.alpha[i] = 0; this.pos[i * 3 + 1] = -1000; } continue; }
      this.age[i] += dt;
      this.rot[i] += this.spinV[i] * dt;
      const k = Math.min(1, this.age[i] / this.life[i]);
      this.vel[i * 3] = (this.vel[i * 3] + wind[0] * dt) * d;
      this.vel[i * 3 + 1] = (this.vel[i * 3 + 1] + (wind[1] - gravity) * dt) * d;
      this.vel[i * 3 + 2] = (this.vel[i * 3 + 2] + wind[2] * dt) * d;
      this.pos[i * 3] += this.vel[i * 3] * dt; this.pos[i * 3 + 1] += this.vel[i * 3 + 1] * dt; this.pos[i * 3 + 2] += this.vel[i * 3 + 2] * dt;
      this.size[i] = this.s0[i] + (this.s1[i] - this.s0[i]) * k;
      this.alpha[i] = alpha * Math.min(1, k * 6) * (1 - k) * (1 - k * 0.3);
      for (let q = 0; q < 3; q++) this.color[i * 3 + q] = colorA[q] + (colorB[q] - colorA[q]) * k;
    }
    const a = this.points.geometry.attributes;
    (a.position as THREE.BufferAttribute).needsUpdate = true; (a.aSize as THREE.BufferAttribute).needsUpdate = true;
    (a.aAlpha as THREE.BufferAttribute).needsUpdate = true; (a.aColor as THREE.BufferAttribute).needsUpdate = true;
    (a.aFrame as THREE.BufferAttribute).needsUpdate = true; (a.aRot as THREE.BufferAttribute).needsUpdate = true;
  }
}

const rnd = (a: number, b: number) => a + Math.random() * (b - a);

/** Cuánto de cada efecto se dibuja según la calidad gráfica (1 = todo). */
const FX_SCALE: Record<Quality, number> = { low: 0.45, medium: 0.75, high: 1, ultra: 1 };

export class CrashFx {
  private smoke: SoftPoints;
  private column: SoftPoints;
  private embers: SoftPoints;
  private sparks: SoftPoints;
  private flames: SoftPoints;
  private dust: SoftPoints;
  private smokeAcc: number[];
  private sparkT: number[];
  private flameAcc: number[];
  private dustAcc: number[];
  private emberAcc: number[];
  private colAcc = 0;
  private k = 1; // escala de los efectos (calidad)
  /** Dónde nace la columna de humo alta (por defecto, el primer motor humeante). */
  private colSrc: { x: number; y: number; z: number };

  constructor(scene: THREE.Scene, private fx = GUNSHIP_FX, column?: { x: number; y: number; z: number }) {
    this.colSrc = column ?? (fx.smoke[0] ? { x: fx.smoke[0].x, y: fx.smoke[0].y, z: fx.smoke[0].z } : { x: 0, y: 2, z: 0 });
    // Humo: gris oscuro que sube, se ensancha y se aclara, empujado por el viento (hacia +x, como las brasas)
    this.smoke = new SoftPoints(scene, { n: 90, additive: false, gravity: 0, drag: 0.25, wind: [0.9, 0.55, 0.15], colorA: [0.1, 0.085, 0.075], colorB: [0.34, 0.29, 0.24], alpha: 0.55, sprites: SPRITES.smoke, spin: 0.5 });
    // Columna alta: sube despacio durante casi 20 s hasta unos 70 m, inclinada por el viento, y se aclara hasta el color de la neblina
    this.column = new SoftPoints(scene, { n: 64, additive: false, gravity: 0, drag: 0.06, wind: [0.18, 0.25, 0.04], colorA: [0.11, 0.095, 0.085], colorB: [0.62, 0.46, 0.31], alpha: 0.34, sprites: SPRITES.smoke, spin: 0.15 });
    // Brasas: puntitos incandescentes que suben desde los fuegos y se van con el viento
    this.embers = new SoftPoints(scene, { n: 50, additive: true, gravity: -0.5, drag: 0.3, wind: [0.7, 0, 0.1], colorA: [1, 0.7, 0.28], colorB: [0.8, 0.14, 0.03], alpha: 1, sprites: SPRITES.sparks, spin: 1.5 });
    // Chispas (caen) y llamas (suben): puntos que brillan, se suman a la luz
    this.sparks = new SoftPoints(scene, { n: 60, additive: true, gravity: 8, drag: 0.5, wind: [0, 0, 0], colorA: [1, 0.85, 0.45], colorB: [0.9, 0.25, 0.05], alpha: 1, sprites: SPRITES.sparks, spin: 3 });
    this.flames = new SoftPoints(scene, { n: 80, additive: true, gravity: -2.2, drag: 1.2, wind: [0.5, 0, 0.1], colorA: [1, 0.72, 0.25], colorB: [0.75, 0.12, 0.02], alpha: 0.9, sprites: SPRITES.fire, tilt: 0.3, spin: 0.35 });
    // Polvo: la arena que se levanta lentamente alrededor del morro hundido y del muñón del ala
    this.dust = new SoftPoints(scene, { n: 40, additive: false, gravity: -0.15, drag: 0.5, wind: [0.9, 0.1, 0.2], colorA: [0.62, 0.42, 0.28], colorB: [0.5, 0.35, 0.25], alpha: 0.4, sprites: SPRITES.dust, spin: 0.3 });
    this.smokeAcc = fx.smoke.map(() => Math.random());
    this.sparkT = fx.sparks.map((s) => rnd(...s.every));
    this.flameAcc = fx.flames.map(() => Math.random());
    this.dustAcc = fx.dust.map(() => Math.random());
    this.emberAcc = fx.flames.map(() => Math.random());
    // la columna ya está formada al empezar (si no, tardaría casi 20 s en subir)
    for (let t = 0; t < 18; t += 0.25) this.tickColumn(0.25);
  }

  /** Con calidad baja o media salen menos partículas (la columna alta y las brasas son lo que más se nota al fondo). */
  setQuality(q: Quality) { this.k = FX_SCALE[q]; }

  private tickColumn(dt: number) {
    this.colAcc += 2.6 * this.k * dt;
    const c = this.colSrc;
    while (this.colAcc >= 1) {
      this.colAcc -= 1;
      this.column.emit(c.x + rnd(-0.4, 0.4), c.y + rnd(0, 0.4), c.z + rnd(-0.4, 0.4), rnd(-0.3, 0.3), rnd(3.0, 4.2), rnd(-0.3, 0.3), rnd(15, 20), 2.4, rnd(18, 26));
    }
    this.column.update(dt);
  }

  tick(dt: number) {
    if (dt <= 0) return;
    dt = Math.min(dt, 0.1);
    this.tickColumn(dt);
    // humo continuo
    this.fx.smoke.forEach((s, i) => {
      this.smokeAcc[i] += s.rate * this.k * dt;
      while (this.smokeAcc[i] >= 1) {
        this.smokeAcc[i] -= 1;
        this.smoke.emit(s.x + rnd(-0.15, 0.15), s.y + rnd(0, 0.2), s.z + rnd(-0.15, 0.15), rnd(-0.35, 0.35) - 0.5, rnd(1.1, 1.9), rnd(-0.35, 0.35), rnd(4.4, 6.4), s.size * 0.8, s.size * rnd(2.2, 3.0));
      }
    });
    // brasas que suben de los fuegos
    this.fx.flames.forEach((f, i) => {
      this.emberAcc[i] += 2.2 * this.k * dt;
      while (this.emberAcc[i] >= 1) {
        this.emberAcc[i] -= 1;
        this.embers.emit(f.x + rnd(-0.3, 0.3), f.y + 0.2, f.z + rnd(-0.3, 0.3), rnd(-0.4, 0.9), rnd(0.9, 2.3), rnd(-0.4, 0.4), rnd(3, 6.5), 0.2, 0.06);
      }
    });
    // chispas ocasionales
    this.fx.sparks.forEach((s, i) => {
      this.sparkT[i] -= dt;
      if (this.sparkT[i] > 0) return;
      this.sparkT[i] = rnd(...s.every);
      const n = Math.round(s.count * rnd(0.6, 1.2));
      for (let k = 0; k < n; k++) {
        const a = Math.random() * Math.PI * 2, v = rnd(1.5, 4.5);
        this.sparks.emit(s.x, s.y, s.z, Math.cos(a) * v, rnd(1.5, 4.5), Math.sin(a) * v, rnd(0.35, 0.8), 0.14, 0.05);
      }
    });
    // llamas pequeñas
    this.fx.flames.forEach((f, i) => {
      this.flameAcc[i] += 16 * dt;
      while (this.flameAcc[i] >= 1) {
        this.flameAcc[i] -= 1;
        this.flames.emit(f.x + rnd(-0.12, 0.12) * f.size, f.y, f.z + rnd(-0.12, 0.12) * f.size, rnd(-0.15, 0.15), rnd(0.9, 1.6), rnd(-0.15, 0.15), rnd(0.5, 0.9), f.size * 0.38, f.size * 0.08);
      }
    });
    // polvo
    this.fx.dust.forEach((d, i) => {
      this.dustAcc[i] += d.rate * dt;
      while (this.dustAcc[i] >= 1) {
        this.dustAcc[i] -= 1;
        this.dust.emit(d.x + rnd(-0.8, 0.8), d.y + rnd(0, 0.3), d.z + rnd(-0.8, 0.8), rnd(-0.2, 0.4), rnd(0.15, 0.45), rnd(-0.3, 0.3), rnd(4, 6.5), d.size * 0.6, d.size * rnd(1.5, 2.2));
      }
    });
    this.smoke.update(dt);
    this.embers.update(dt);
    this.sparks.update(dt);
    this.flames.update(dt);
    this.dust.update(dt);
  }
}
