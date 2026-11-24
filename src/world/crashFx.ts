import * as THREE from 'three';

// Efectos de la cañonera derribada, sin tocar el modelo: humo continuo de los motores, chispas ocasionales y pequeños fuegos.
// Todo son puntos suaves en una reserva fija (muy ligera para el móvil): un solo objeto para el humo y otro para chispas y llamas.

export interface FirePoint { x: number; y: number; z: number; size: number }
export interface SmokeSource { x: number; y: number; z: number; rate: number; size: number }
export interface SparkSource { x: number; y: number; z: number; every: [number, number]; count: number }

/** Puntos donde arde fuego en la cañonera (destellos que parpadean, ver Atmosphere). */
export const GUNSHIP_FIRES: FirePoint[] = [];
/** Dónde sale humo, saltan chispas y arden llamas en la cañonera (se rellena al montar el escenario). */
export const GUNSHIP_FX = {
  smoke: [] as SmokeSource[],
  sparks: [] as SparkSource[],
  flames: [] as FirePoint[],
};

const VERT = /* glsl */ `
attribute float aSize;
attribute float aAlpha;
attribute vec3 aColor;
varying float vAlpha;
varying vec3 vColor;
uniform float uScale;
uniform float uMax;
void main() {
  vec4 mv = modelViewMatrix * vec4(position, 1.0);
  gl_Position = projectionMatrix * mv;
  gl_PointSize = min(aSize * uScale / max(0.1, -mv.z), uMax);
  vAlpha = aAlpha;
  vColor = aColor;
}`;
const FRAG = /* glsl */ `
varying float vAlpha;
varying vec3 vColor;
void main() {
  float d = length(gl_PointCoord - 0.5) * 2.0;
  float a = smoothstep(1.0, 0.0, d);
  gl_FragColor = vec4(vColor, a * a * vAlpha);
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
}

/** Reserva de partículas suaves: tamaño, opacidad y color cambian a lo largo de su vida. */
export class SoftPoints {
  readonly points: THREE.Points;
  private n: number;
  private pos: Float32Array; private vel: Float32Array;
  private age: Float32Array; private life: Float32Array; private s0: Float32Array; private s1: Float32Array;
  private size: Float32Array; private alpha: Float32Array; private color: Float32Array;
  private next = 0;
  private tmpV = new THREE.Vector2();

  constructor(scene: THREE.Scene, private o: PoolOpts) {
    const n = (this.n = o.n);
    this.pos = new Float32Array(n * 3); this.vel = new Float32Array(n * 3);
    this.age = new Float32Array(n).fill(1); this.life = new Float32Array(n).fill(1);
    this.s0 = new Float32Array(n); this.s1 = new Float32Array(n);
    this.size = new Float32Array(n); this.alpha = new Float32Array(n); this.color = new Float32Array(n * 3);
    for (let i = 0; i < n; i++) this.pos[i * 3 + 1] = -1000;
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(this.pos, 3));
    g.setAttribute('aSize', new THREE.BufferAttribute(this.size, 1));
    g.setAttribute('aAlpha', new THREE.BufferAttribute(this.alpha, 1));
    g.setAttribute('aColor', new THREE.BufferAttribute(this.color, 3));
    const mat = new THREE.ShaderMaterial({
      uniforms: { uScale: { value: 400 }, uMax: { value: 400 } },
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
  }
}

const rnd = (a: number, b: number) => a + Math.random() * (b - a);

export class CrashFx {
  private smoke: SoftPoints;
  private sparks: SoftPoints;
  private flames: SoftPoints;
  private smokeAcc: number[];
  private sparkT: number[];
  private flameAcc: number[];

  constructor(scene: THREE.Scene, private fx = GUNSHIP_FX) {
    // Humo: gris oscuro que sube, se ensancha y se aclara, empujado por el viento (hacia +x, como las brasas)
    this.smoke = new SoftPoints(scene, { n: 90, additive: false, gravity: 0, drag: 0.25, wind: [0.9, 0.55, 0.15], colorA: [0.1, 0.085, 0.075], colorB: [0.34, 0.29, 0.24], alpha: 0.55 });
    // Chispas (caen) y llamas (suben): puntos que brillan, se suman a la luz
    this.sparks = new SoftPoints(scene, { n: 60, additive: true, gravity: 8, drag: 0.5, wind: [0, 0, 0], colorA: [1, 0.85, 0.45], colorB: [0.9, 0.25, 0.05], alpha: 1 });
    this.flames = new SoftPoints(scene, { n: 80, additive: true, gravity: -2.2, drag: 1.2, wind: [0.5, 0, 0.1], colorA: [1, 0.72, 0.25], colorB: [0.75, 0.12, 0.02], alpha: 0.9 });
    this.smokeAcc = fx.smoke.map(() => Math.random());
    this.sparkT = fx.sparks.map((s) => rnd(...s.every));
    this.flameAcc = fx.flames.map(() => Math.random());
  }

  tick(dt: number) {
    if (dt <= 0) return;
    dt = Math.min(dt, 0.1);
    // humo continuo
    this.fx.smoke.forEach((s, i) => {
      this.smokeAcc[i] += s.rate * dt;
      while (this.smokeAcc[i] >= 1) {
        this.smokeAcc[i] -= 1;
        this.smoke.emit(s.x + rnd(-0.15, 0.15), s.y + rnd(0, 0.2), s.z + rnd(-0.15, 0.15), rnd(-0.35, 0.35) - 0.5, rnd(1.1, 1.9), rnd(-0.35, 0.35), rnd(4.4, 6.4), s.size * 0.8, s.size * rnd(2.2, 3.0));
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
    this.smoke.update(dt);
    this.sparks.update(dt);
    this.flames.update(dt);
  }
}
