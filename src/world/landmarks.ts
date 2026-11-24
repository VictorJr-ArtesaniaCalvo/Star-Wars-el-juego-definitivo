import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { glowTexture } from './atmosphere';
import { makeRng, terrainHeight } from './terrain';
import type { Quality } from '../core/Settings';

// Dos grandes referencias lejanas, solo para mirar (sin cuerpo sólido), hechas por código con pocos polígonos:
//  · Al norte, un castillo geonosiano: un montículo de roca en terrazas con ventanas oscuras en arco y torres con anillos redondeados (la central muy alta).
//  · Al sur, una nave núcleo separatista en buen estado: una gran esfera de paneles sobre patas, con la torre y las antenas arriba, que dispara
//    rayos pequeños hacia los lados y hacia el suelo.
// Se ven a 230–270 m, más lejos que la niebla normal: llevan una niebla propia que nunca los tapa del todo (se ven como siluetas pálidas en la bruma).

export const CASTLE = { x: -35, z: -265 };
export const CORE_SHIP = { x: -45, z: 235 };

const hash = (n: number) => { const x = Math.sin(n * 127.1 + 311.7) * 43758.5453; return x - Math.floor(x); };

/** Material con niebla limitada: la niebla se acerca al color del horizonte pero deja ver siempre la forma (`cap` = máximo de niebla, de 0 a 1). */
function farMaterial(cap: number, params: THREE.MeshLambertMaterialParameters) {
  const m = new THREE.MeshLambertMaterial(params);
  m.onBeforeCompile = (sh) => {
    sh.fragmentShader = sh.fragmentShader.replace('#include <fog_fragment>', `
#ifdef USE_FOG
  float ff = smoothstep(fogNear, fogFar, vFogDepth);
  gl_FragColor.rgb = mix(gl_FragColor.rgb, fogColor, min(ff, ${cap.toFixed(2)}));
#endif`);
  };
  m.customProgramCacheKey = () => 'farfog' + cap;
  return m;
}

// ---------- Piezas ----------
type Prof = Array<[number, number]>; // [radio, altura]

function paint(g: THREE.BufferGeometry, color: THREE.Color, vary = 0.14) {
  const p = g.attributes.position, c = new Float32Array(p.count * 3), k = new THREE.Color();
  for (let i = 0; i < p.count; i += 3) {
    const v = 1 - vary / 2 + vary * hash(Math.round(p.getX(i) * 3) + Math.round(p.getY(i) * 5) * 7 + Math.round(p.getZ(i) * 3) * 13);
    k.copy(color).multiplyScalar(v);
    for (let j = 0; j < 3; j++) c.set([k.r, k.g, k.b], (i + j) * 3);
  }
  g.setAttribute('color', new THREE.BufferAttribute(c, 3));
}

/** Pieza de revolución con irregularidades, colocada en (x, y, z). */
function lathe(profile: Prof, seg: number, x: number, y: number, z: number, color: THREE.Color, jitter: number, seed: number): THREE.BufferGeometry {
  const g = new THREE.LatheGeometry(profile.map(([r, h]) => new THREE.Vector2(Math.max(r, 0.001), h)), seg).toNonIndexed();
  g.deleteAttribute('uv');
  const p = g.attributes.position;
  for (let i = 0; i < p.count; i++) {
    const px = p.getX(i), py = p.getY(i), pz = p.getZ(i);
    const k = 1 + jitter * (hash(Math.round(px * 4) * 3 + Math.round(py * 2) * 17 + Math.round(pz * 4) * 31 + seed) - 0.5);
    p.setXYZ(i, px * k, py, pz * k);
  }
  g.translate(x, y, z);
  g.computeVertexNormals();
  paint(g, color);
  return g;
}

/** Torre geonosiana: una pila de «cuentas» redondeadas (cuello, panza, cuello) que se van estrechando hasta una punta. */
function beadedSpire(H: number, R: number, beads: number): Prof {
  const pts: Prof = [[R * 1.25, 0]];
  for (let b = 0; b < beads; b++) {
    const t0 = b / beads, t1 = (b + 1) / beads, tm = (t0 + t1) / 2;
    const taper = (t: number) => Math.pow(1 - t, 0.8) * 0.9 + 0.1 * (1 - t);
    pts.push([R * taper(t0) * 0.62, H * (t0 + (t1 - t0) * 0.05)], [R * taper(tm) * (b === 0 ? 1.2 : 1), H * tm], [R * taper(t1) * 0.62, H * (t1 - (t1 - t0) * 0.05)]);
  }
  pts.push([0, H]);
  return pts;
}

/** Montículo en terrazas (cada una algo más estrecha, con voladizo). */
function moundProfile(R: number, H: number): Prof {
  return [[R * 1.05, -8], [R, 0], [R * 0.98, H * 0.12], [R * 0.84, H * 0.16], [R * 0.86, H * 0.32], [R * 0.7, H * 0.38], [R * 0.72, H * 0.58], [R * 0.52, H * 0.64], [R * 0.54, H * 0.84], [R * 0.34, H * 0.92], [R * 0.2, H]];
}
const profRadius = (p: Prof, y: number) => { for (let i = 1; i < p.length; i++) if (y <= p[i][1]) { const [r0, y0] = p[i - 1], [r1, y1] = p[i]; return r0 + (r1 - r0) * ((y - y0) / Math.max(1e-3, y1 - y0)); } return p[p.length - 1][0]; };

/** Ventana en arco (pentágono) mirando hacia fuera en el ángulo `a` (0 = hacia +z). */
function arch(w: number, h: number, x: number, y: number, z: number, a: number, c: THREE.Color): THREE.BufferGeometry {
  const P = [[-w, 0], [w, 0], [w, h * 0.62], [0, h], [-w, h * 0.62]];
  const v: number[] = [];
  for (const [i, j, k] of [[0, 1, 2], [0, 2, 3], [0, 3, 4]]) for (const q of [i, j, k]) v.push(P[q][0], P[q][1], 0);
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(v, 3));
  g.rotateY(a); g.translate(x, y, z);
  g.computeVertexNormals();
  const col = new Float32Array(v.length);
  for (let i = 0; i < col.length; i += 3) col.set([c.r, c.g, c.b], i);
  g.setAttribute('color', new THREE.BufferAttribute(col, 3));
  return g;
}

function box(w: number, h: number, d: number, x: number, y: number, z: number, c: THREE.Color, rx = 0, ry = 0, rz = 0): THREE.BufferGeometry {
  const g = new THREE.BoxGeometry(w, h, d).toNonIndexed();
  g.deleteAttribute('uv');
  g.applyMatrix4(new THREE.Matrix4().makeRotationFromEuler(new THREE.Euler(rx, ry, rz)));
  g.translate(x, y, z);
  g.computeVertexNormals();
  paint(g, c, 0.06);
  return g;
}
function bar(p0: THREE.Vector3, p1: THREE.Vector3, r: number, c: THREE.Color): THREE.BufferGeometry {
  const len = p0.distanceTo(p1);
  const g = new THREE.CylinderGeometry(r, r, len, 5).toNonIndexed();
  g.deleteAttribute('uv');
  const q = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), p1.clone().sub(p0).normalize());
  g.applyMatrix4(new THREE.Matrix4().compose(p0.clone().add(p1).multiplyScalar(0.5), q, new THREE.Vector3(1, 1, 1)));
  g.computeVertexNormals();
  paint(g, c, 0.04);
  return g;
}

const merge = (list: THREE.BufferGeometry[]) => { const g = mergeGeometries(list, false)!; for (const x of list) x.dispose(); g.computeBoundingSphere(); return g; };

// ---------- Castillo geonosiano ----------
function buildCastle(scene: THREE.Scene): Array<{ x: number; y: number; z: number }> {
  const STONE = new THREE.Color(0x7a5236), STONE2 = new THREE.Color(0x684529), DARK = new THREE.Color(0x1c120e); // más oscuro que el cielo: se lee como silueta
  const gy = (x: number, z: number) => terrainHeight(x, z);
  const rng = makeRng(31337), range = (a: number, b: number) => a + rng() * (b - a);
  const parts: THREE.BufferGeometry[] = [];
  const lights: Array<{ x: number; y: number; z: number }> = [];
  const cx = CASTLE.x, cz = CASTLE.z;
  const base = gy(cx, cz);

  const mound = (dx: number, dz: number, R: number, H: number, seed: number, windows: boolean) => {
    const x = cx + dx, z = cz + dz, y = gy(x, z);
    const prof = moundProfile(R, H);
    parts.push(lathe(prof, 14, x, y, z, STONE2, 0.22, seed));
    if (!windows) return;
    // filas de ventanas en arco en las terrazas, mirando hacia el sur (hacia ti) y algo a los lados
    for (const [fy, n] of [[H * 0.08, 7], [H * 0.2, 6], [H * 0.36, 5], [H * 0.6, 4]] as const) {
      for (let i = 0; i < n; i++) {
        const a = ((i + 0.5) / n - 0.5) * 2.5 + range(-0.08, 0.08); // de −72° a +72°
        const r = profRadius(prof, fy + 2) + 0.5;
        const wx = x + Math.sin(a) * r, wz = z + Math.cos(a) * r, wy = y + fy;
        parts.push(arch(R * 0.045, R * 0.11, wx, wy, wz, a, DARK));
        if (rng() < 0.22) lights.push({ x: wx + Math.sin(a) * 0.6, y: wy + R * 0.05, z: wz + Math.cos(a) * 0.6 });
      }
    }
  };
  const spire = (dx: number, dz: number, H: number, R: number, beads: number, from: number, seed: number, color = STONE) => {
    const x = cx + dx, z = cz + dz;
    parts.push(lathe(beadedSpire(H, R, beads), 8, x, from === Infinity ? gy(x, z) - 3 : from, z, color, 0.12, seed));
  };

  mound(0, 0, 34, 42, 1, true);
  mound(-46, 4, 20, 26, 2, true);
  mound(35, -5, 17, 22, 3, true);
  // torres sobre los montículos: la central muy alta y dos algo menores a sus lados, más una sobre cada montículo pequeño
  const top = base + 38;
  spire(0, 0, 108, 8.5, 9, top, 10);
  spire(-10, 3, 80, 5.8, 7, top - 2, 11);
  spire(11, -3, 70, 5.0, 6, top - 2, 12);
  spire(-46, 4, 56, 4.6, 6, gy(cx - 46, cz + 4) + 22, 13);
  spire(35, -5, 46, 4.0, 5, gy(cx + 35, cz - 5) + 18, 14);
  // torres pequeñas esparcidas alrededor
  for (let i = 0; i < 14; i++) {
    const dx = range(-72, 58), dz = range(-20, 24);
    if (Math.hypot(dx, dz) < 24 || Math.abs(dx + 46) < 14 && Math.abs(dz) < 12 || Math.abs(dx - 35) < 12 && Math.abs(dz) < 12) continue;
    spire(dx, dz, range(14, 38), range(1.8, 3.4), 4 + Math.floor(rng() * 2), Infinity, 20 + i, rng() < 0.5 ? STONE : STONE2);
  }
  const g = merge(parts);
  const mesh = new THREE.Mesh(g, farMaterial(0.5, { vertexColors: true, flatShading: true, emissive: 0x120a07 }));
  mesh.frustumCulled = false;
  scene.add(mesh);
  return lights;
}

// ---------- Nave núcleo separatista ----------
function panelTexture(): THREE.Texture {
  const W = 512, H = 256, c = document.createElement('canvas');
  c.width = W; c.height = H;
  const g = c.getContext('2d')!;
  g.fillStyle = '#b8b2a4'; g.fillRect(0, 0, W, H);
  const rng = makeRng(777);
  // paneles rectangulares de tonos algo distintos
  for (let i = 0; i < 900; i++) {
    const w = 8 + rng() * 34, h = 5 + rng() * 14, x = rng() * W, y = rng() * H, t = 150 + rng() * 60;
    g.fillStyle = `rgb(${t},${t - 5},${t - 14})`;
    g.fillRect(x, y, w, h);
    g.strokeStyle = 'rgba(40,36,30,.55)'; g.lineWidth = 1; g.strokeRect(x + .5, y + .5, w, h);
  }
  // cinturones: bandas oscuras alrededor de la esfera
  for (const y of [0.18, 0.36, 0.5, 0.66, 0.82]) { g.fillStyle = 'rgba(30,26,22,.8)'; g.fillRect(0, y * H - 2, W, 4); }
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.wrapS = THREE.RepeatWrapping;
  t.anisotropy = 2;
  return t;
}

interface Port { origin: THREE.Vector3; dir: THREE.Vector3 }

function buildCoreShip(scene: THREE.Scene): { ports: Port[]; lights: Array<{ x: number; y: number; z: number; color: number }>; center: THREE.Vector3 } {
  const R = 19, gy = terrainHeight(CORE_SHIP.x, CORE_SHIP.z);
  const center = new THREE.Vector3(CORE_SHIP.x, gy + R * 1.25, CORE_SHIP.z);
  const LIGHT = new THREE.Color(0xc9c3b4), BLACK = new THREE.Color(0x1d1f23), GREY = new THREE.Color(0x6f7378);

  const sphere = new THREE.Mesh(new THREE.SphereGeometry(R, 26, 18), farMaterial(0.74, { map: panelTexture(), emissive: 0x1c1813 }));
  sphere.position.copy(center);
  sphere.frustumCulled = false;
  scene.add(sphere);

  const parts: THREE.BufferGeometry[] = [];
  const C = center;
  // patas: seis aletas curvas alrededor de la mitad de abajo, con un puntal negro y un pie
  for (let i = 0; i < 6; i++) {
    const a = (i / 6) * Math.PI * 2 + 0.3;
    const dir = new THREE.Vector3(Math.sin(a), 0, Math.cos(a));
    const arc = (62 * Math.PI) / 180;
    const fin = new THREE.TorusGeometry(R + 2.4, 0.55, 4, 10, arc).toNonIndexed();
    fin.deleteAttribute('uv');
    fin.scale(1, 1, 3.6);
    fin.rotateZ(-(75 * Math.PI) / 180); // el arco va de −75° a −13° bajo el ecuador
    fin.rotateY(a - Math.PI / 2); // en el plano vertical del azimut a
    fin.translate(C.x, C.y, C.z);
    fin.computeVertexNormals(); paint(fin, LIGHT, 0.06);
    parts.push(fin);
    const p0 = new THREE.Vector3(C.x + dir.x * R * 0.78, C.y - R * 0.62, C.z + dir.z * R * 0.78);
    const foot = new THREE.Vector3(C.x + dir.x * R * 1.5, gy + 0.5, C.z + dir.z * R * 1.5);
    parts.push(bar(p0, foot, 0.7, BLACK));
    parts.push(box(4.2, 0.8, 5, foot.x, gy + 0.4, foot.z, BLACK, 0, a, 0));
  }
  // torre de arriba: tallo, plataforma, bloque, travesaño con extremos, antena y cuatro platos
  const T = C.y + R;
  parts.push(box(3.4, 10, 3.4, C.x, T + 3, C.z, GREY));
  parts.push(box(12, 2.4, 12, C.x, T + 8.5, C.z, LIGHT));
  parts.push(box(5.5, 6, 5.5, C.x, T + 12.5, C.z, GREY));
  parts.push(box(32, 1.6, 3.4, C.x, T + 18, C.z, LIGHT));
  parts.push(box(5.5, 2.8, 4.4, C.x - 16, T + 18, C.z, GREY), box(5.5, 2.8, 4.4, C.x + 16, T + 18, C.z, GREY));
  parts.push(bar(new THREE.Vector3(C.x, T + 18, C.z), new THREE.Vector3(C.x, T + 36, C.z), 0.35, BLACK));
  for (const [dx, dz, s] of [[-10, 3, 1], [10, 3, 1], [-7, -7, 0.7], [7, -7, 0.7]] as const) {
    const d = new THREE.CylinderGeometry(3.4 * s, 3.4 * s, 0.7, 10).toNonIndexed();
    d.deleteAttribute('uv');
    d.rotateX(Math.PI / 2.6); d.rotateY(Math.atan2(dx, dz) * 0.8);
    d.translate(C.x + dx, T - 1.5, C.z + dz);
    d.computeVertexNormals(); paint(d, LIGHT, 0.05);
    parts.push(d);
  }
  // cañones: ocho puertos alrededor, algo por debajo del ecuador (de aquí salen los rayos)
  const ports: Port[] = [];
  for (let i = 0; i < 8; i++) {
    const a = (i / 8) * Math.PI * 2 + 0.1;
    const dir = new THREE.Vector3(Math.sin(a) * Math.cos(0.2), -Math.sin(0.2), Math.cos(a) * Math.cos(0.2));
    const o = C.clone().addScaledVector(dir, R + 1.6);
    parts.push(box(1.8, 1.8, 3.2, o.x, o.y, o.z, BLACK, 0, a, 0));
    ports.push({ origin: o, dir });
  }
  const mesh = new THREE.Mesh(merge(parts), farMaterial(0.74, { vertexColors: true, flatShading: true, emissive: 0x1c1813 }));
  mesh.frustumCulled = false;
  scene.add(mesh);
  const lights = [
    { x: C.x - 16, y: T + 18, z: C.z + 2.5, color: 0x7fb8ff }, { x: C.x + 16, y: T + 18, z: C.z + 2.5, color: 0x7fb8ff },
    { x: C.x, y: T + 36, z: C.z, color: 0xeaf4ff }, { x: C.x, y: T + 8.5, z: C.z + 6.4, color: 0xeaf4ff },
  ];
  return { ports, lights, center };
}

// ---------- Todo junto ----------
interface Bolt { mesh: THREE.Mesh; from: THREE.Vector3; to: THREE.Vector3; t: number; dur: number; active: boolean }
interface Flash { sprite: THREE.Sprite; life: number }

export class Landmarks {
  private lights: Array<{ sprite: THREE.Sprite; rate: number; phase: number }> = [];
  private ports: Port[];
  private bolts: Bolt[] = [];
  private flashes: Flash[] = [];
  private t = 0;
  private next = 2;
  private lightsOn = true;

  constructor(scene: THREE.Scene) {
    const castleLights = buildCastle(scene);
    const ship = buildCoreShip(scene);
    this.ports = ship.ports;
    const glow = glowTexture();
    const mk = (x: number, y: number, z: number, size: number, color: number, rate: number) => {
      const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: glow, color, blending: THREE.AdditiveBlending, depthWrite: false, fog: false, transparent: true, opacity: 0.8 }));
      s.position.set(x, y, z); s.scale.setScalar(size);
      s.renderOrder = 3;
      scene.add(s);
      this.lights.push({ sprite: s, rate, phase: Math.random() * 6.28 });
    };
    for (const l of castleLights) mk(l.x, l.y, l.z, 4.2, 0xffcf8a, 0); // ventanas con luz cálida, fijas
    for (const l of ship.lights) mk(l.x, l.y, l.z, 4, l.color, 1.2 + Math.random() * 1.5); // pilotos azules y blancos que parpadean
    // rayos rojos, pequeños (la nave está lejos), y destellos donde dan en el suelo
    const geo = new THREE.BoxGeometry(0.55, 0.55, 7);
    geo.translate(0, 0, 3.5);
    const mat = new THREE.MeshBasicMaterial({ color: 0xff3a24, fog: false });
    for (let i = 0; i < 10; i++) {
      const mesh = new THREE.Mesh(geo, mat);
      mesh.visible = false; mesh.frustumCulled = false; mesh.renderOrder = 3;
      scene.add(mesh);
      this.bolts.push({ mesh, from: new THREE.Vector3(), to: new THREE.Vector3(), t: 0, dur: 1, active: false });
      const sprite = new THREE.Sprite(new THREE.SpriteMaterial({ map: glow, color: 0xffd9a0, blending: THREE.AdditiveBlending, depthWrite: false, fog: false, transparent: true }));
      sprite.visible = false; sprite.renderOrder = 3;
      scene.add(sprite);
      this.flashes.push({ sprite, life: 0 });
    }
  }

  setQuality(q: Quality) {
    this.lightsOn = q !== 'low'; // en baja no se dibujan las lucecitas ni los rayos (las dos formas sí)
    for (const l of this.lights) l.sprite.visible = this.lightsOn;
    if (!this.lightsOn) for (const b of this.bolts) { b.active = false; b.mesh.visible = false; }
  }

  private volley() {
    const n = 1 + Math.floor(Math.random() * 3);
    for (let k = 0; k < n; k++) {
      const b = this.bolts.find((x) => !x.active);
      if (!b) return;
      const p = this.ports[Math.floor(Math.random() * this.ports.length)];
      b.from.copy(p.origin);
      // hacia el lado en el que apunta el cañón y hacia el suelo, a unos 35–80 m de la nave
      const d = 35 + Math.random() * 45, a = (Math.random() - 0.5) * 0.5;
      const dx = p.dir.x * Math.cos(a) - p.dir.z * Math.sin(a), dz = p.dir.x * Math.sin(a) + p.dir.z * Math.cos(a);
      const tl = Math.hypot(dx, dz) || 1;
      const x = b.from.x + (dx / tl) * d, z = b.from.z + (dz / tl) * d;
      b.to.set(x, terrainHeight(x, z) + 0.5, z);
      b.dur = b.from.distanceTo(b.to) / 150;
      b.t = 0; b.active = true; b.mesh.visible = true;
      b.mesh.position.copy(b.from); b.mesh.lookAt(b.to);
    }
  }

  update(dt: number) {
    this.t += dt;
    if (this.lightsOn) {
      for (const l of this.lights) {
        (l.sprite.material as THREE.SpriteMaterial).opacity = l.rate === 0 ? 0.75 : (Math.sin(this.t * l.rate + l.phase) > -0.2 ? 0.95 : 0.1);
      }
      this.next -= dt;
      if (this.next <= 0) { this.next = 0.7 + Math.random() * 2.4; this.volley(); }
      for (const b of this.bolts) {
        if (!b.active) continue;
        b.t += dt;
        const k = b.t / b.dur;
        if (k >= 1) {
          b.active = false; b.mesh.visible = false;
          const f = this.flashes.find((x) => x.life <= 0);
          if (f) { f.life = 1; f.sprite.position.copy(b.to); f.sprite.visible = true; }
          continue;
        }
        b.mesh.position.lerpVectors(b.from, b.to, k);
      }
      for (const f of this.flashes) {
        if (f.life <= 0) continue;
        f.life -= dt * 2.4;
        if (f.life <= 0) { f.sprite.visible = false; continue; }
        f.sprite.scale.setScalar(7 * (1.3 - f.life * 0.6));
        (f.sprite.material as THREE.SpriteMaterial).opacity = f.life;
      }
    }
  }
}
