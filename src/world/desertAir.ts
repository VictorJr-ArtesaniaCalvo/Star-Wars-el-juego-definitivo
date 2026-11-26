import * as THREE from 'three';
import type { Quality } from '../core/Settings';
import { SoftPoints, SPRITES } from './crashFx';
import { DesertFog } from './desertFog';
import { FOG_COLOR } from './sky';
import { currentZone, groundHeight, type ZoneName } from './zone';
import { ARENA_SUN, ovalDist } from './arena/layout';

// AIRE DEL DESIERTO (pedido por Víctor): polvo en suspensión y ráfagas de viento, en el cañón y (más suave) en la arena.
//  · Niebla base: la de distancia + polvo a ras de suelo (desertFog.ts); en las ráfagas tapa un poco más lo lejano.
//  · Láminas de polvo: pocas, grandes y muy transparentes, a media y larga distancia; siempre de cara a la cámara (nunca se ven de canto),
//    con los bordes totalmente difuminados, lejos del suelo y de las paredes; avanzan despacio con el viento.
//  · Ráfagas cada 10–20 s (arena: 20–35 s y más flojas): estelas de arena que corren a ras de suelo 2–4 s, polvo que levantan,
//    golpe de viento (sonido) y las motas cercanas corren más.
//  · Remolinos de polvo a lo lejos de vez en cuando (solo en el cañón).
//  · Motas de polvo flotando cerca de la cámara (pocas).
//  · Arena: haces de luz con polvo brillando dentro.
// El viento sopla del oeste hacia el este (+x). Pocas piezas grandes (las transparencias superpuestas pesan en el iPhone).
// Cantidad según la calidad: en baja solo la niebla base y alguna estela; en Ultra no hay nada de esto (queda como estaba).

/** Dirección del viento: del oeste hacia el este. */
export const WIND = new THREE.Vector3(1, 0, 0);

interface Level { sheets: number; motes: number; streaks: number; puffs: boolean; devils: boolean; shafts: number }
const LEVELS: Record<Quality, Level | null> = {
  low: { sheets: 0, motes: 0, streaks: 2, puffs: false, devils: false, shafts: 0 },
  medium: { sheets: 3, motes: 25, streaks: 4, puffs: true, devils: true, shafts: 2 },
  high: { sheets: 5, motes: 40, streaks: 6, puffs: true, devils: true, shafts: 3 },
  ultra: null, // Ultra se queda como estaba (pedido por Víctor)
};

/** Cómo es el aire en cada zona. */
const ZONES = {
  canyon: {
    every: [10, 20], dur: [2, 4], strength: 1, // ráfagas: cada cuánto (s), cuánto duran (s), fuerza
    sheetDrift: 1.6, sheetW: [26, 36], sheetH: [9, 13], sheetDist: [32, 95], sheetOpacity: 0.3, sheetsMax: 5,
    streakLen: [14, 26], streakW: [1.6, 3.2], streakSpeed: 9, devilEvery: [25, 50],
  },
  arena: {
    every: [20, 35], dur: [2, 3.5], strength: 0.45,
    sheetDrift: 0.6, sheetW: [14, 20], sheetH: [6, 8], sheetDist: [16, 40], sheetOpacity: 0.18, sheetsMax: 2,
    streakLen: [7, 13], streakW: [1.2, 2.2], streakSpeed: 5, devilEvery: [0, 0],
  },
} as const;

const DUST = new THREE.Color(0xd8b886); // polvo en el aire (casi el color del horizonte, un poco más cálido)
const SAND = new THREE.Color(0xe2c08a); // arena levantada a ras de suelo
const rnd = (a: number, b: number) => a + Math.random() * (b - a);
const smooth = (a: number, b: number, x: number) => { const t = Math.min(1, Math.max(0, (x - a) / (b - a))); return t * t * (3 - 2 * t); };

// ---------- Texturas generadas (degradados suaves: sin grano) ----------

/** Lámina de polvo: manchas suaves superpuestas dentro de un óvalo que se desvanece del todo hacia los bordes (y más por abajo). */
function sheetTexture(): THREE.Texture {
  const W = 256, H = 128, c = document.createElement('canvas');
  c.width = W; c.height = H;
  const g = c.getContext('2d')!;
  for (let i = 0; i < 26; i++) {
    const x = W * rnd(0.18, 0.82), y = H * rnd(0.3, 0.65), r = W * rnd(0.12, 0.3);
    const gr = g.createRadialGradient(x, y, 0, x, y, r);
    const a = rnd(0.12, 0.26);
    gr.addColorStop(0, `rgba(255,255,255,${a})`); gr.addColorStop(1, 'rgba(255,255,255,0)');
    g.fillStyle = gr;
    g.save(); g.translate(x, y); g.scale(1.6, 0.7); g.translate(-x, -y);
    g.beginPath(); g.arc(x, y, r, 0, Math.PI * 2); g.fill();
    g.restore();
  }
  // máscara: óvalo que se desvanece del todo antes de llegar al borde de la imagen; el tercio de abajo se apaga más (nunca toca el suelo)
  const img = g.getImageData(0, 0, W, H), d = img.data;
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    const u = (x / (W - 1)) * 2 - 1, v = (y / (H - 1)) * 2 - 1;
    const r = Math.hypot(u, v * 1.1);
    let m = 1 - smooth(0.45, 0.95, r);
    m *= smooth(1, 0.35, v); // por abajo (v = 1) se apaga
    const i = (y * W + x) * 4;
    d[i] = d[i + 1] = d[i + 2] = 255;
    d[i + 3] *= m;
  }
  g.putImageData(img, 0, 0);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

/** Estela de arena: una banda de arena en suspensión con líneas horizontales suaves encima (se repite a lo largo y se desplaza con el
 *  viento); se apaga hacia los lados. Densa a propósito: con huecos se perdía de lejos. */
function streakTexture(): THREE.Texture {
  const W = 256, H = 64, c = document.createElement('canvas');
  c.width = W; c.height = H;
  const g = c.getContext('2d')!;
  // base: arena en suspensión, más densa en el centro de la banda
  const band = g.createLinearGradient(0, 0, 0, H);
  band.addColorStop(0, 'rgba(255,255,255,0)'); band.addColorStop(0.5, 'rgba(255,255,255,0.45)'); band.addColorStop(1, 'rgba(255,255,255,0)');
  g.fillStyle = band; g.fillRect(0, 0, W, H);
  for (let i = 0; i < 90; i++) {
    const y = H * rnd(0.12, 0.88), len = W * rnd(0.15, 0.6), x = W * Math.random(), th = rnd(2.5, 8);
    const a = rnd(0.3, 0.8) * (1 - Math.abs(y / H - 0.5) * 1.6);
    for (const dx of [0, -W]) { // que se repita sin corte a lo largo
      const gr = g.createLinearGradient(x + dx, 0, x + dx + len, 0);
      gr.addColorStop(0, 'rgba(255,255,255,0)'); gr.addColorStop(0.5, `rgba(255,255,255,${a})`); gr.addColorStop(1, 'rgba(255,255,255,0)');
      g.fillStyle = gr;
      g.fillRect(x + dx, y - th / 2, len, th);
    }
  }
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.wrapS = THREE.RepeatWrapping;
  return t;
}

/** Punto suave (motas). */
function dotTexture(): THREE.Texture {
  const c = document.createElement('canvas');
  c.width = c.height = 32;
  const g = c.getContext('2d')!;
  const gr = g.createRadialGradient(16, 16, 0, 16, 16, 16);
  gr.addColorStop(0, 'rgba(255,255,255,1)'); gr.addColorStop(0.4, 'rgba(255,255,255,0.5)'); gr.addColorStop(1, 'rgba(255,255,255,0)');
  g.fillStyle = gr; g.fillRect(0, 0, 32, 32);
  return new THREE.CanvasTexture(c);
}

// ---------- Piezas ----------

interface Sheet { sprite: THREE.Sprite; mat: THREE.SpriteMaterial; age: number; base: number }
/** Una estela de arena: sus vértices (desde `v0`) van dentro de una sola pieza con todas las estelas (un solo dibujo). */
interface Streak { v0: number; delay: number; len: number; on: boolean; k: number }
interface Devil { x: number; z: number; t: number; dur: number; acc: number }

const STREAK_SEGS = 14;
const STREAK_COLS = STREAK_SEGS + 1;
/** Vértices de cada estela: franja tumbada (2 filas) + velo de arena levantada (2 filas). */
const STREAK_VERTS = STREAK_COLS * 4;

export class DesertAir {
  /** Fuerza de la ráfaga actual (0 = calma; 1 = la más fuerte del cañón). */
  gust = 0;
  private level: Level | null = LEVELS.high;
  private zone: ZoneName = currentZone();
  private focus = new THREE.Vector3();
  private t = 0;
  // ráfagas
  private nextGust = rnd(4, 8);
  private gustT = -1;
  private gustDur = 3;
  private gustStr = 1;
  private gustEvent = 0;
  // piezas
  private sheetTex = sheetTexture();
  private sheets: Sheet[] = [];
  private streakTex = streakTexture();
  private streaks: Streak[] = [];
  private streakMesh: THREE.Mesh;
  private streakBase: Float32Array; // transparencia de cada vértice (extremos que se apagan) antes de la fuerza de la ráfaga
  private motes: THREE.Points;
  private moteVel: Float32Array;
  private puffs: SoftPoints;
  private devilPool: SoftPoints;
  private devil: Devil | null = null;
  private nextDevil = rnd(15, 30);
  private shafts = new THREE.Group();
  private shaftMotes: THREE.Points | null = null;
  private puffAcc = 0;

  constructor(private scene: THREE.Scene, private fogs: { desert: DesertFog; linear: THREE.Fog }) {
    // láminas (como mucho 5)
    for (let i = 0; i < 5; i++) {
      // sin niebla: ya son del color del aire polvoriento (con niebla se perdían del todo a lo lejos)
      const mat = new THREE.SpriteMaterial({ map: this.sheetTex, color: DUST, transparent: true, opacity: 0, depthWrite: false, fog: false });
      const sprite = new THREE.Sprite(mat);
      sprite.visible = false;
      sprite.renderOrder = 1;
      scene.add(sprite);
      this.sheets.push({ sprite, mat, age: 0, base: 1 });
    }
    // estelas de arena (como mucho 6)
    // cada una: una franja tumbada en el suelo y un velo bajo de arena levantada (menos de 1 m, se apaga hacia arriba):
    // tumbada casi no se ve desde la altura de los ojos; el velo es lo que se ve correr de lado
    // (todas en una sola pieza: un solo dibujo por fotograma; la fuerza de cada una va en la transparencia de sus vértices)
    const NS = 6, NV = NS * STREAK_VERTS;
    const sg = new THREE.BufferGeometry();
    sg.setAttribute('position', new THREE.BufferAttribute(new Float32Array(NV * 3), 3));
    sg.setAttribute('uv', new THREE.BufferAttribute(new Float32Array(NV * 2), 2));
    sg.setAttribute('color', new THREE.BufferAttribute(new Float32Array(NV * 4).fill(1), 4));
    const idx: number[] = [];
    for (let s = 0; s < NS; s++) for (let strip = 0; strip < 2; strip++) {
      const r0 = s * STREAK_VERTS + strip * STREAK_COLS * 2, r1 = r0 + STREAK_COLS;
      for (let i = 0; i < STREAK_SEGS; i++) idx.push(r0 + i, r1 + i, r0 + i + 1, r0 + i + 1, r1 + i, r1 + i + 1);
    }
    sg.setIndex(idx);
    this.streakBase = new Float32Array(NV);
    for (let s = 0; s < NS; s++) this.streaks.push({ v0: s * STREAK_VERTS, delay: 0, len: 10, on: false, k: 0 });
    this.streakMesh = new THREE.Mesh(sg, new THREE.MeshBasicMaterial({
      map: this.streakTex, color: SAND, vertexColors: true, transparent: true, opacity: 0.6, depthWrite: false, fog: true,
      side: THREE.DoubleSide, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2,
    }));
    this.streakMesh.frustumCulled = false;
    this.streakMesh.renderOrder = 1;
    this.streakMesh.visible = false;
    scene.add(this.streakMesh);
    // motas cerca de la cámara (como mucho 40)
    const N = 40, pos = new Float32Array(N * 3);
    this.moteVel = new Float32Array(N * 3);
    for (let i = 0; i < N; i++) { pos[i * 3 + 1] = -1000; this.moteVel.set([rnd(0.6, 1.3), rnd(-0.08, 0.12), rnd(-0.25, 0.25)], i * 3); }
    const mg = new THREE.BufferGeometry();
    mg.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    mg.setDrawRange(0, 0);
    this.motes = new THREE.Points(mg, new THREE.PointsMaterial({
      map: dotTexture(), color: 0xf3e0bf, size: 0.022, sizeAttenuation: true, transparent: true, opacity: 0.32, depthWrite: false, fog: false,
    }));
    this.motes.frustumCulled = false;
    scene.add(this.motes);
    // polvo que levantan las ráfagas y remolinos (bocanadas del atlas de Kenney)
    const sand: [number, number, number] = [SAND.r * 0.9, SAND.g * 0.85, SAND.b * 0.8];
    const fog = new THREE.Color(FOG_COLOR);
    this.puffs = new SoftPoints(scene, { n: 60, additive: false, gravity: -0.15, drag: 0.6, wind: [1.5, 0, 0], colorA: sand, colorB: [fog.r, fog.g, fog.b], alpha: 0.3, sprites: SPRITES.dust, spin: 0.6 });
    // remolino: ocre más oscuro que la neblina (si no, a 50 m se confunde con ella) y se aclara al subir
    const ochre: [number, number, number] = [sand[0] * 0.72, sand[1] * 0.62, sand[2] * 0.55];
    const high: [number, number, number] = [(sand[0] + fog.r) / 2, (sand[1] + fog.g) / 2, (sand[2] + fog.b) / 2];
    this.devilPool = new SoftPoints(scene, { n: 110, additive: false, gravity: -1.2, drag: 0.25, wind: [0.8, 0, 0], colorA: ochre, colorB: high, alpha: 0.55, sprites: SPRITES.dust, spin: 2 });
    scene.add(this.shafts);
    this.applyZone();
  }

  /** Calidad gráfica: cuánto se dibuja; en Ultra, nada de esto y la niebla lineal de antes. */
  setQuality(q: Quality, viewDistance: number) {
    this.level = LEVELS[q];
    const fog = this.level ? this.fogs.desert : this.fogs.linear;
    const prev = this.scene.fog as unknown as { near: number; far: number } | null;
    if (prev) { fog.near = prev.near; }
    fog.far = viewDistance;
    this.scene.fog = fog as unknown as THREE.FogExp2;
    this.applyZone();
  }

  /** Posición de la cámara: todo se reparte a su alrededor. */
  follow(p: THREE.Vector3) { this.focus.copy(p); }

  /** Si acaba de empezar una ráfaga, su fuerza (para el golpe de viento); si no, 0. Se lee una vez. */
  consumeGust() { const g = this.gustEvent; this.gustEvent = 0; return g; }

  /** Al cambiar de zona o de calidad: qué piezas se usan y cómo. */
  private applyZone() {
    this.zone = currentZone();
    const L = this.level, Z = ZONES[this.zone];
    const nSheets = L ? Math.min(L.sheets, Z.sheetsMax) : 0;
    this.sheets.forEach((s, i) => { s.sprite.visible = i < nSheets; if (i < nSheets) this.placeSheet(s, true); });
    for (const s of this.streaks) s.on = false;
    this.streakMesh.visible = false;
    (this.motes.geometry as THREE.BufferGeometry).setDrawRange(0, L ? L.motes : 0);
    // lo que no se usa no se dibuja (ni siquiera vacío)
    this.motes.visible = !!L && L.motes > 0;
    this.puffs.points.visible = !!L?.puffs;
    this.devilPool.points.visible = !!L?.devils && this.zone === 'canyon';
    const mp = this.motes.geometry.attributes.position as THREE.BufferAttribute;
    for (let i = 0; i < mp.count; i++) this.placeMote(mp.array as Float32Array, i, true);
    mp.needsUpdate = true;
    this.puffs.clear();
    this.devilPool.clear();
    this.devil = null;
    this.buildShafts(this.zone === 'arena' && L ? L.shafts : 0);
  }

  // ---------- Láminas ----------

  private placeSheet(s: Sheet, anywhere: boolean) {
    const Z = ZONES[this.zone], f = this.focus;
    const w = rnd(Z.sheetW[0], Z.sheetW[1]), h = rnd(Z.sheetH[0], Z.sheetH[1]);
    let x = 0, z = 0;
    for (let tries = 0; tries < 20; tries++) {
      const a = Math.random() * Math.PI * 2, r = rnd(Z.sheetDist[0], Z.sheetDist[1]);
      x = f.x + Math.cos(a) * r; z = f.z + Math.sin(a) * r;
      if (!anywhere) x = this.zone === 'canyon' ? -28 + rnd(0, 6) : f.x - rnd(20, 30); // vuelve a entrar por el oeste
      if (this.sheetRoom(x, z) > 0.5) break;
    }
    s.sprite.scale.set(w, h, 1);
    s.sprite.position.set(x, groundHeight(x, z) + h * 0.5 + rnd(0.5, 3), z);
    s.age = 0;
    s.base = Z.sheetOpacity * rnd(0.7, 1);
  }

  /** ¿Hay sitio para una lámina aquí? (1 = de sobra; 0 = demasiado cerca de las paredes o fuera) */
  private sheetRoom(x: number, z: number) {
    if (this.zone === 'canyon') return 1 - smooth(18, 28, Math.abs(x)); // el suelo del cañón mide 80 m de ancho
    return smooth(-6, -14, ovalDist(x, z)); // dentro del suelo de la arena, lejos del muro
  }

  // ---------- Estelas ----------

  private startStreaks() {
    const L = this.level, Z = ZONES[this.zone], f = this.focus;
    const n = L ? L.streaks : 0;
    for (let i = 0; i < this.streaks.length; i++) {
      const s = this.streaks[i];
      s.on = i < n;
      s.k = 0;
      if (!s.on) continue;
      // a 5–30 m, más bien por delante y a los lados; a lo largo del viento
      let x = 0, z = 0;
      for (let tries = 0; tries < 12; tries++) {
        const a = Math.random() * Math.PI * 2, r = rnd(5, 30);
        x = f.x + Math.cos(a) * r - 6; z = f.z + Math.sin(a) * r;
        if (this.zone === 'canyon' ? Math.abs(x) < 34 : ovalDist(x, z) < -3) break;
      }
      s.len = rnd(Z.streakLen[0], Z.streakLen[1]);
      const w = rnd(Z.streakW[0], Z.streakW[1]);
      this.layStreak(s, x, z, w);
      s.delay = rnd(0, 0.9);
    }
  }

  /** Coloca una estela sobre el suelo (sigue su forma) desde (x, z) hacia el este. */
  private layStreak(s: Streak, x0: number, z0: number, w: number) {
    const cols = STREAK_COLS;
    const hgt = rnd(0.5, 1.1) * (this.zone === 'arena' ? 0.7 : 1); // altura del velo de arena
    const geo = this.streakMesh.geometry;
    const p = geo.attributes.position as THREE.BufferAttribute, uv = geo.attributes.uv as THREE.BufferAttribute;
    const rep = s.len / 12; // la textura se repite cada 12 m
    for (let j = 0; j < 2; j++) for (let i = 0; i < cols; i++) {
      const u = i / STREAK_SEGS;
      const ends = smooth(0, 0.25, u) * smooth(1, 0.7, u); // se desvanece por los dos extremos
      const x = x0 + u * s.len, wob = Math.sin(u * 3 + x0) * 0.6;
      // franja tumbada (fila 0 a un lado, fila 1 al otro)
      const kf = s.v0 + j * cols + i;
      const z = z0 + (j === 0 ? -w / 2 : w / 2) + wob;
      p.setXYZ(kf, x, groundHeight(x, z) + 0.14, z);
      uv.setXY(kf, u * rep, j);
      this.streakBase[kf] = ends;
      // velo: fila 0 arriba (transparente), fila 1 abajo, algo hundida en el suelo para que no se vea el corte
      const kv = s.v0 + cols * 2 + j * cols + i;
      const zc = z0 + wob, gy = groundHeight(x, zc);
      p.setXYZ(kv, x, j === 0 ? gy + hgt : gy - 0.15, zc);
      uv.setXY(kv, u * rep, j === 0 ? 0.95 : 0.5); // abajo, lo más denso de la banda
      this.streakBase[kv] = j === 0 ? 0 : ends * 0.9;
    }
    p.needsUpdate = true; uv.needsUpdate = true;
  }

  // ---------- Motas ----------

  private placeMote(a: Float32Array, i: number, anywhere: boolean) {
    const f = this.focus;
    for (;;) {
      const x = rnd(-7, 7), y = rnd(-1.2, 3), z = rnd(-7, 7);
      if (x * x + y * y + z * z < 2.2) continue; // nunca pegadas a la cámara
      a[i * 3] = f.x + (anywhere ? x : -7); a[i * 3 + 1] = f.y + y; a[i * 3 + 2] = f.z + z;
      return;
    }
  }

  // ---------- Haces de luz (arena) ----------

  private buildShafts(n: number) {
    for (const c of [...this.shafts.children]) { c.removeFromParent(); const m = c as THREE.Mesh; m.geometry?.dispose(); (m.material as THREE.Material)?.dispose(); }
    this.shaftMotes = null;
    if (!n) return;
    const sun = new THREE.Vector3(ARENA_SUN.x, ARENA_SUN.y, ARENA_SUN.z).normalize();
    const mat = new THREE.ShaderMaterial({
      uniforms: { uColor: { value: new THREE.Color(0xffe6bd) }, uOpacity: { value: 0.16 } },
      vertexShader: /* glsl */ `
        varying vec3 vN; varying vec3 vW; varying float vV;
        void main() {
          vec4 w = modelMatrix * vec4(position, 1.0);
          vW = w.xyz; vN = normalize(mat3(modelMatrix) * normal); vV = uv.y;
          gl_Position = projectionMatrix * viewMatrix * w;
        }`,
      fragmentShader: /* glsl */ `
        uniform vec3 uColor; uniform float uOpacity;
        varying vec3 vN; varying vec3 vW; varying float vV;
        void main() {
          // de frente brilla más y hacia la silueta se apaga: parece un volumen de luz desde cualquier lado (sin bordes)
          float face = abs(dot(normalize(vN), normalize(cameraPosition - vW)));
          float a = pow(face, 2.0) * smoothstep(0.0, 0.12, vV) * smoothstep(1.0, 0.55, vV);
          gl_FragColor = vec4(uColor * a * uOpacity, 1.0);
        }`,
      transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.FrontSide,
    });
    const spots = [[-8, -6, 3.2], [6, 4, 4], [-2, 16, 3], [12, -16, 3]].slice(0, n);
    const motePos: number[] = [];
    const up = new THREE.Vector3(0, 1, 0);
    for (const [x, z, r] of spots) {
      const L = 60;
      const geo = new THREE.CylinderGeometry(r, r * 1.15, L, 16, 1, true);
      geo.translate(0, L / 2, 0); // la base (uv.y = 0) en el suelo
      const m = new THREE.Mesh(geo, mat);
      m.quaternion.setFromUnitVectors(up, sun);
      m.position.set(x, groundHeight(x, z) - 0.5, z);
      m.renderOrder = 3;
      this.shafts.add(m);
      // motas dentro del haz (brillan con la luz)
      for (let i = 0; i < 45; i++) {
        const along = rnd(0.5, 12), ang = Math.random() * Math.PI * 2, rr = Math.sqrt(Math.random()) * r * 0.85;
        const off = new THREE.Vector3(Math.cos(ang) * rr, along, Math.sin(ang) * rr).applyQuaternion(m.quaternion);
        motePos.push(x + off.x, m.position.y + off.y, z + off.z);
      }
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(motePos, 3));
    this.shaftMotes = new THREE.Points(g, new THREE.PointsMaterial({
      map: dotTexture(), color: 0xfff0d0, size: 0.06, transparent: true, opacity: 0.8, depthWrite: false, blending: THREE.AdditiveBlending, fog: false,
    }));
    this.shaftMotes.frustumCulled = false;
    this.shaftMotes.userData.base = Float32Array.from(motePos);
    this.shafts.add(this.shaftMotes);
  }

  // ---------- Cada fotograma ----------

  tick(dt: number) {
    this.t += dt;
    if (currentZone() !== this.zone) this.applyZone();
    const Z = ZONES[this.zone], L = this.level, f = this.focus;

    // Ráfagas: espera al azar, sube en 0,6 s, se mantiene y baja en 1,2 s
    this.nextGust -= dt;
    if (this.gustT < 0 && this.nextGust <= 0) {
      this.gustT = 0;
      this.gustDur = rnd(Z.dur[0], Z.dur[1]);
      this.gustStr = Z.strength * rnd(0.75, 1);
      this.gustEvent = this.gustStr;
      this.nextGust = rnd(Z.every[0], Z.every[1]);
      this.startStreaks();
    }
    if (this.gustT >= 0) {
      this.gustT += dt;
      const total = 0.6 + this.gustDur + 1.2;
      this.gust = this.gustStr * smooth(0, 0.6, this.gustT) * (1 - smooth(0.6 + this.gustDur, total, this.gustT));
      if (this.gustT >= total) { this.gustT = -1; this.gust = 0; for (const s of this.streaks) s.on = false; this.streakMesh.visible = false; }
    }
    const g = this.gust;
    if (L) this.fogs.desert.gust = g;

    // Láminas: avanzan con el viento; nunca cerca, nunca junto a las paredes; las que se van vuelven a entrar por el oeste
    for (const s of this.sheets) {
      if (!s.sprite.visible) continue;
      s.age += dt;
      const p = s.sprite.position;
      p.x += Z.sheetDrift * (1 + 1.8 * g) * dt;
      const dist = Math.hypot(p.x - f.x, p.z - f.z);
      const room = this.sheetRoom(p.x, p.z);
      if (dist > Z.sheetDist[1] + 35 || (room < 0.02 && s.age > 3) || p.x - f.x > Z.sheetDist[1]) { this.placeSheet(s, dist > Z.sheetDist[1] + 35); continue; }
      s.mat.opacity = s.base * (1 + 0.7 * g) * smooth(0, 4, s.age) * smooth(Z.sheetDist[0] * 0.45, Z.sheetDist[0], dist) * room;
    }

    // Estelas de arena durante la ráfaga
    if (this.gustT >= 0) {
      this.streakTex.offset.x -= (Z.streakSpeed / 12) * dt;
      const sp = this.streakMesh.geometry.attributes.position as THREE.BufferAttribute, sc = this.streakMesh.geometry.attributes.color as THREE.BufferAttribute;
      const pa = sp.array as Float32Array, ca = sc.array as Float32Array, dx = Z.streakSpeed * 0.25 * dt; // la sábana de arena también avanza
      let any = false;
      for (const s of this.streaks) {
        s.k = s.on ? smooth(s.delay, s.delay + 0.5, this.gustT) * (g / Math.max(0.01, this.gustStr)) : 0;
        any ||= s.k > 0.01;
        for (let v = s.v0; v < s.v0 + STREAK_VERTS; v++) { ca[v * 4 + 3] = this.streakBase[v] * s.k; if (s.on) pa[v * 3] += dx; }
      }
      sp.needsUpdate = true; sc.needsUpdate = true;
      this.streakMesh.visible = any;
    }

    // Polvo que levantan las ráfagas (a lo largo de las estelas)
    if (L?.puffs && g > 0.15) {
      this.puffAcc += dt * 7 * g;
      const pa = (this.streakMesh.geometry.attributes.position as THREE.BufferAttribute).array as Float32Array;
      while (this.puffAcc >= 1) {
        this.puffAcc -= 1;
        const s = this.streaks[Math.floor(Math.random() * this.streaks.length)];
        if (!s.on || s.k < 0.05) continue;
        const v = s.v0 + Math.floor(Math.random() * STREAK_COLS * 2); // un punto de la franja tumbada
        this.puffs.emit(pa[v * 3], pa[v * 3 + 1] + 0.2, pa[v * 3 + 2], rnd(5, 9) * g, rnd(0.3, 1.1), rnd(-0.6, 0.6), rnd(1.4, 2.4), rnd(0.8, 1.4), rnd(2.5, 4.5));
      }
    }
    this.puffs.update(dt);

    // Remolino de polvo a lo lejos (cañón, media y alta)
    if (L?.devils && this.zone === 'canyon') {
      this.nextDevil -= dt;
      if (!this.devil && this.nextDevil <= 0) {
        const a = Math.random() * Math.PI * 2, r = rnd(45, 80);
        const x = Math.max(-30, Math.min(30, f.x + Math.cos(a) * r)), z = f.z + Math.sin(a) * r;
        this.devil = { x, z, t: 0, dur: rnd(6, 8), acc: 0 };
        this.nextDevil = rnd(ZONES.canyon.devilEvery[0], ZONES.canyon.devilEvery[1]);
      }
      if (this.devil) {
        const d = this.devil;
        d.t += dt;
        d.x += 2 * dt;
        const k = smooth(0, 1.2, d.t) * (1 - smooth(d.dur - 1.5, d.dur, d.t)); // empieza y se apaga poco a poco
        d.acc += dt * 16 * k;
        const gy = groundHeight(d.x, d.z);
        while (d.acc >= 1) {
          d.acc -= 1;
          const ang = this.t * 7 + Math.random() * 1.2, rad = rnd(0.5, 1.4);
          const cx = Math.cos(ang), sz = Math.sin(ang);
          // gira (velocidad tangencial) y sube
          this.devilPool.emit(d.x + cx * rad, gy + rnd(0, 0.8), d.z + sz * rad, -sz * 3.5 + 1, rnd(3.8, 5.6), cx * 3.5, rnd(2.8, 3.8), rnd(1, 1.6), rnd(3.5, 6.5)); // sube unos 15 m
        }
        if (d.t >= d.dur) this.devil = null;
      }
    }
    this.devilPool.update(dt);

    // Motas cercanas: flotan despacio con el viento; en la ráfaga corren más
    const n = (this.motes.geometry as THREE.BufferGeometry).drawRange.count;
    if (n > 0) {
      const mp = this.motes.geometry.attributes.position as THREE.BufferAttribute, a = mp.array as Float32Array, v = this.moteVel;
      const speed = (this.zone === 'arena' ? 0.25 : 0.35) + 3 * g;
      for (let i = 0; i < n; i++) {
        const k = i * 3;
        a[k] += v[k] * speed * dt;
        a[k + 1] += (v[k + 1] + Math.sin(this.t * 0.7 + i) * 0.05) * dt;
        a[k + 2] += (v[k + 2] + Math.cos(this.t * 0.5 + i * 2) * 0.08) * dt;
        const dx = a[k] - f.x, dy = a[k + 1] - f.y, dz = a[k + 2] - f.z;
        if (dx > 7 || dx < -7 || dz > 7 || dz < -7 || dy > 3.2 || dy < -1.4) this.placeMote(a, i, dx < -7 || Math.abs(dz) > 7 || dy > 3.2 || dy < -1.4);
        else if (dx * dx + dy * dy + dz * dz < 1.2) this.placeMote(a, i, true);
      }
      mp.needsUpdate = true;
      (this.motes.material as THREE.PointsMaterial).opacity = 0.32 * (1 + 0.5 * g);
    }

    // Motas dentro de los haces de luz: suben y bajan muy despacio
    if (this.shaftMotes) {
      const mp = this.shaftMotes.geometry.attributes.position as THREE.BufferAttribute, a = mp.array as Float32Array;
      const b = this.shaftMotes.userData.base as Float32Array;
      for (let i = 0; i < a.length / 3; i++) {
        a[i * 3] = b[i * 3] + Math.sin(this.t * 0.3 + i) * 0.25;
        a[i * 3 + 1] = b[i * 3 + 1] + Math.sin(this.t * 0.22 + i * 1.7) * 0.4;
        a[i * 3 + 2] = b[i * 3 + 2] + Math.cos(this.t * 0.27 + i * 0.9) * 0.25;
      }
      mp.needsUpdate = true;
    }
  }
}
