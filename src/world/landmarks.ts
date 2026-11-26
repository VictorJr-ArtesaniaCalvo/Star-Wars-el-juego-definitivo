import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { glowTexture } from './atmosphere';
import { makeRng, terrainHeight } from './terrain';
import type { Quality } from '../core/Settings';

// Referencia lejana, solo para mirar (sin cuerpo sólido), hecha por código con pocos polígonos (el castillo geonosiano del norte se quitó: Víctor):
//  · Al sur, una nave núcleo separatista en buen estado: una gran esfera de paneles sobre patas, con la torre y las antenas arriba, que dispara
//    rayos pequeños hacia los lados y hacia el suelo.
// Se ven a 230–270 m, más lejos que la niebla normal: llevan una niebla propia que nunca los tapa del todo (se ven como siluetas pálidas en la bruma).

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

function paint(g: THREE.BufferGeometry, color: THREE.Color, vary = 0.14) {
  const p = g.attributes.position, c = new Float32Array(p.count * 3), k = new THREE.Color();
  for (let i = 0; i < p.count; i += 3) {
    const v = 1 - vary / 2 + vary * hash(Math.round(p.getX(i) * 3) + Math.round(p.getY(i) * 5) * 7 + Math.round(p.getZ(i) * 3) * 13);
    k.copy(color).multiplyScalar(v);
    for (let j = 0; j < 3; j++) c.set([k.r, k.g, k.b], (i + j) * 3);
  }
  g.setAttribute('color', new THREE.BufferAttribute(c, 3));
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
  const K = 0.55; // escala de la torre de arriba
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
  // torre de arriba (más pequeña: a poco más de la mitad de su tamaño anterior): tallo, plataforma, bloque, travesaño con extremos, antena y cuatro platos
  const T = C.y + R;
  parts.push(box(3.4 * K, 10 * K, 3.4 * K, C.x, T + 1.5 + 3 * K, C.z, GREY));
  parts.push(box(12 * K, 2.4 * K, 12 * K, C.x, T + 8.5 * K, C.z, LIGHT));
  parts.push(box(5.5 * K, 6 * K, 5.5 * K, C.x, T + 12.5 * K, C.z, GREY));
  parts.push(box(32 * K, 1.6 * K, 3.4 * K, C.x, T + 18 * K, C.z, LIGHT));
  parts.push(box(5.5 * K, 2.8 * K, 4.4 * K, C.x - 16 * K, T + 18 * K, C.z, GREY), box(5.5 * K, 2.8 * K, 4.4 * K, C.x + 16 * K, T + 18 * K, C.z, GREY));
  parts.push(bar(new THREE.Vector3(C.x, T + 18 * K, C.z), new THREE.Vector3(C.x, T + 36 * K, C.z), 0.3, BLACK));
  for (const [dx, dz, sc] of [[-10, 3, 1], [10, 3, 1], [-7, -7, 0.7], [7, -7, 0.7]] as const) {
    const d = new THREE.CylinderGeometry(3.4 * sc * K, 3.4 * sc * K, 0.5, 10).toNonIndexed();
    d.deleteAttribute('uv');
    d.rotateX(Math.PI / 2.6); d.rotateY(Math.atan2(dx, dz) * 0.8);
    d.translate(C.x + dx * K, T - 1.5, C.z + dz * K);
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
    { x: C.x - 16 * K, y: T + 18 * K, z: C.z + 1.4, color: 0x7fb8ff }, { x: C.x + 16 * K, y: T + 18 * K, z: C.z + 1.4, color: 0x7fb8ff },
    { x: C.x, y: T + 36 * K, z: C.z, color: 0xeaf4ff }, { x: C.x, y: T + 8.5 * K, z: C.z + 3.6, color: 0xeaf4ff },
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
