import * as THREE from 'three';
import { SoftPoints, SPRITES } from '../world/crashFx';

const BOLT_SPEED = 170; // m/s
const BOLT_LENGTH = 2.2;
const ENEMY_BOLT_SPEED = 95;

function dotTexture(): THREE.Texture {
  const s = 64;
  const c = document.createElement('canvas');
  c.width = c.height = s;
  const g = c.getContext('2d')!;
  const grad = g.createRadialGradient(s / 2, s / 2, 0, s / 2, s / 2, s / 2);
  grad.addColorStop(0, 'rgba(255,255,255,1)');
  grad.addColorStop(0.5, 'rgba(255,255,255,0.6)');
  grad.addColorStop(1, 'rgba(255,255,255,0)');
  g.fillStyle = grad;
  g.fillRect(0, 0, s, s);
  return new THREE.CanvasTexture(c);
}

/** Reserva fija de partículas (chispas o humo) dibujadas como puntos: muy ligeras. */
class ParticlePool {
  readonly points: THREE.Points;
  private pos: Float32Array;
  private col: Float32Array;
  private vel: Float32Array;
  private life: Float32Array;
  private max: Float32Array;
  private next = 0;
  private alive = 0;

  constructor(
    scene: THREE.Scene,
    private n: number,
    size: number,
    private rgb: [number, number, number],
    private gravity: number,
    private drag: number,
    additive: boolean,
    map: THREE.Texture,
  ) {
    this.pos = new Float32Array(n * 3).fill(0);
    this.col = new Float32Array(n * 4).fill(0);
    this.vel = new Float32Array(n * 3);
    this.life = new Float32Array(n);
    this.max = new Float32Array(n).fill(1);
    for (let i = 0; i < n; i++) this.pos[i * 3 + 1] = -1000;
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(this.pos, 3));
    g.setAttribute('color', new THREE.BufferAttribute(this.col, 4));
    this.points = new THREE.Points(
      g,
      new THREE.PointsMaterial({ size, map, vertexColors: true, transparent: true, depthWrite: false, blending: additive ? THREE.AdditiveBlending : THREE.NormalBlending, sizeAttenuation: true }),
    );
    this.points.frustumCulled = false;
    scene.add(this.points);
  }

  emit(x: number, y: number, z: number, vx: number, vy: number, vz: number, life: number) {
    const i = this.next;
    this.next = (this.next + 1) % this.n;
    this.pos.set([x, y, z], i * 3);
    this.vel.set([vx, vy, vz], i * 3);
    this.life[i] = life;
    this.max[i] = life;
    this.alive++;
  }

  clear() {
    this.life.fill(0);
    this.col.fill(0);
    this.alive = 0;
    (this.points.geometry.attributes.color as THREE.BufferAttribute).needsUpdate = true;
  }

  update(dt: number) {
    if (this.alive === 0) return;
    let alive = 0;
    for (let i = 0; i < this.n; i++) {
      if (this.life[i] <= 0) { this.col[i * 4 + 3] = 0; continue; }
      this.life[i] -= dt;
      if (this.life[i] <= 0) { this.col[i * 4 + 3] = 0; this.pos[i * 3 + 1] = -1000; continue; }
      alive++;
      const k = this.life[i] / this.max[i];
      this.vel[i * 3 + 1] -= this.gravity * dt;
      const d = Math.max(0, 1 - this.drag * dt);
      this.vel[i * 3] *= d; this.vel[i * 3 + 1] *= d; this.vel[i * 3 + 2] *= d;
      this.pos[i * 3] += this.vel[i * 3] * dt;
      this.pos[i * 3 + 1] += this.vel[i * 3 + 1] * dt;
      this.pos[i * 3 + 2] += this.vel[i * 3 + 2] * dt;
      this.col.set([this.rgb[0], this.rgb[1], this.rgb[2], Math.min(1, k * 1.4) * (this.gravity > 0 ? 1 : 0.55)], i * 4);
    }
    this.alive = alive;
    (this.points.geometry.attributes.position as THREE.BufferAttribute).needsUpdate = true;
    (this.points.geometry.attributes.color as THREE.BufferAttribute).needsUpdate = true;
  }
}

interface Bolt { mesh: THREE.Mesh; dir: THREE.Vector3; left: number; active: boolean }
interface Flash { mesh: THREE.Mesh; life: number; active: boolean }

// Efectos visuales de los disparos: rayos y chispazo de impacto. Se reutilizan
// siempre los mismos objetos para no cargar el móvil.
export class Effects {
  private bolts: Bolt[] = [];
  private flashes: Flash[] = [];
  private enemyBolts: Bolt[] = [];
  private sparks: ParticlePool;
  private blasts: Array<{ ball: THREE.Mesh; ring: THREE.Mesh; life: number; size: number }> = [];
  // Partículas suaves: polvo, humo grande, llamas y destellos (cada reserva es un solo objeto dibujable)
  private dust: SoftPoints;
  private smokeBig: SoftPoints;
  private fire: SoftPoints;
  private blue: SoftPoints;
  // Marcas de quemado que dejan las explosiones en el suelo (se desvanecen solas)
  private scorches: Array<{ mesh: THREE.Mesh; life: number }> = [];

  constructor(scene: THREE.Scene) {
    const dot = dotTexture();
    this.sparks = new ParticlePool(scene, 120, 0.22, [1, 0.62, 0.2], 9, 0.6, true, dot);
    this.dust = new SoftPoints(scene, { n: 70, additive: false, gravity: -0.35, drag: 1.6, wind: [0.4, 0, 0.1], colorA: [0.78, 0.58, 0.4], colorB: [0.56, 0.41, 0.3], alpha: 0.5, sprites: SPRITES.dust, spin: 0.5 });
    this.smokeBig = new SoftPoints(scene, { n: 90, additive: false, gravity: -0.5, drag: 0.8, wind: [0.5, 0.2, 0.1], colorA: [0.13, 0.11, 0.1], colorB: [0.36, 0.31, 0.27], alpha: 0.5, sprites: SPRITES.smoke, spin: 0.45 });
    this.fire = new SoftPoints(scene, { n: 70, additive: true, gravity: -1.2, drag: 2.2, wind: [0, 0, 0], colorA: [1, 0.97, 0.78], colorB: [0.95, 0.5, 0.12], alpha: 0.85, sprites: SPRITES.fire, tilt: 0.5, spin: 0.4 });
    this.blue = new SoftPoints(scene, { n: 40, additive: true, gravity: 0, drag: 3, wind: [0, 0, 0], colorA: [0.8, 0.95, 1], colorB: [0.2, 0.5, 1], alpha: 0.9, sprites: SPRITES.sparks, spin: 2 });
    // Marcas de quemado en el suelo
    const sc = document.createElement('canvas'); sc.width = sc.height = 128;
    const sg = sc.getContext('2d')!;
    const grad = sg.createRadialGradient(64, 64, 4, 64, 64, 64);
    grad.addColorStop(0, 'rgba(10,7,5,0.85)'); grad.addColorStop(0.55, 'rgba(14,10,7,0.55)'); grad.addColorStop(1, 'rgba(14,10,7,0)');
    sg.fillStyle = grad; sg.fillRect(0, 0, 128, 128);
    const scTex = new THREE.CanvasTexture(sc);
    const scGeo = new THREE.CircleGeometry(1, 24); scGeo.rotateX(-Math.PI / 2);
    for (let i = 0; i < 4; i++) {
      const mesh = new THREE.Mesh(scGeo, new THREE.MeshBasicMaterial({ map: scTex, transparent: true, depthWrite: false, opacity: 0, polygonOffset: true, polygonOffsetFactor: -3, polygonOffsetUnits: -3, fog: true }));
      mesh.visible = false; mesh.renderOrder = 1;
      scene.add(mesh);
      this.scorches.push({ mesh, life: 0 });
    }
    // Explosiones de granada: bola de fuego y onda expansiva (se reutilizan)
    const ballGeo = new THREE.IcosahedronGeometry(1, 2);
    const ringGeo = new THREE.RingGeometry(0.82, 1, 40);
    ringGeo.rotateX(-Math.PI / 2);
    for (let i = 0; i < 3; i++) {
      const ball = new THREE.Mesh(ballGeo, new THREE.MeshBasicMaterial({ color: 0xffd488, transparent: true, opacity: 0, depthWrite: false, blending: THREE.AdditiveBlending, fog: false }));
      const ring = new THREE.Mesh(ringGeo, new THREE.MeshBasicMaterial({ color: 0xfff2c8, transparent: true, opacity: 0, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide, fog: false }));
      ball.visible = ring.visible = false;
      scene.add(ball, ring);
      this.blasts.push({ ball, ring, life: 0, size: 1 });
    }
    const boltGeo = new THREE.BoxGeometry(0.045, 0.045, BOLT_LENGTH);
    boltGeo.translate(0, 0, BOLT_LENGTH / 2);
    const boltMat = new THREE.MeshBasicMaterial({ color: 0x66b8ff, fog: false });
    const glowGeo = new THREE.BoxGeometry(0.16, 0.16, BOLT_LENGTH * 1.15);
    glowGeo.translate(0, 0, BOLT_LENGTH * 0.575);
    const boltGlow = new THREE.MeshBasicMaterial({ color: 0x4aa8ff, transparent: true, opacity: 0.26, depthWrite: false, blending: THREE.AdditiveBlending, fog: false });
    for (let i = 0; i < 14; i++) {
      const mesh = new THREE.Mesh(boltGeo, boltMat);
      mesh.add(new THREE.Mesh(glowGeo, boltGlow)); // aura azul
      mesh.visible = false;
      scene.add(mesh);
      this.bolts.push({ mesh, dir: new THREE.Vector3(), left: 0, active: false });
    }
    // Rayos rojos de los droides (más gruesos y algo más lentos, para poder verlos venir).
    const eGeo = new THREE.BoxGeometry(0.07, 0.07, 1.6);
    eGeo.translate(0, 0, 0.8);
    const eMat = new THREE.MeshBasicMaterial({ color: 0xff3a30, fog: false });
    const eGlowGeo = new THREE.BoxGeometry(0.24, 0.24, 1.9);
    eGlowGeo.translate(0, 0, 0.95);
    const eGlow = new THREE.MeshBasicMaterial({ color: 0xff4a2a, transparent: true, opacity: 0.3, depthWrite: false, blending: THREE.AdditiveBlending, fog: false });
    for (let i = 0; i < 40; i++) {
      const mesh = new THREE.Mesh(eGeo, eMat);
      mesh.add(new THREE.Mesh(eGlowGeo, eGlow)); // aura roja
      mesh.visible = false;
      scene.add(mesh);
      this.enemyBolts.push({ mesh, dir: new THREE.Vector3(), left: 0, active: false });
    }
    const flashGeo = new THREE.IcosahedronGeometry(0.22, 0);
    for (let i = 0; i < 16; i++) {
      const mesh = new THREE.Mesh(flashGeo, new THREE.MeshBasicMaterial({ color: 0xbfe2ff, transparent: true, fog: false }));
      mesh.visible = false;
      scene.add(mesh);
      this.flashes.push({ mesh, life: 0, active: false });
    }
  }

  /** Lanza un rayo desde la boca del arma hasta el punto de impacto. */
  bolt(from: THREE.Vector3, to: THREE.Vector3) {
    const b = this.bolts.find((x) => !x.active) ?? this.bolts[0];
    b.dir.copy(to).sub(from);
    b.left = b.dir.length();
    b.dir.normalize();
    b.mesh.position.copy(from);
    b.mesh.lookAt(to);
    b.mesh.visible = true;
    b.active = true;
  }

  flash(at: THREE.Vector3, color = 0xbfe2ff) {
    const f = this.flashes.find((x) => !x.active) ?? this.flashes[0];
    (f.mesh.material as THREE.MeshBasicMaterial).color.setHex(color);
    f.mesh.position.copy(at);
    f.life = 1;
    f.active = true;
    f.mesh.visible = true;
  }

  /** Rayo rojo disparado por un droide. */
  enemyBolt(from: THREE.Vector3, to: THREE.Vector3) {
    const b = this.enemyBolts.find((x) => !x.active) ?? this.enemyBolts[0];
    b.dir.copy(to).sub(from);
    b.left = b.dir.length();
    b.dir.normalize();
    b.mesh.position.copy(from);
    b.mesh.lookAt(to);
    b.mesh.visible = true;
    b.active = true;
  }

  /** Destello en la boca del arma al disparar (azul el del jugador, naranja el de los droides). */
  muzzle(at: THREE.Vector3, who: 'player' | 'enemy') {
    if (who === 'player') {
      this.blue.emit(at.x, at.y, at.z, 0, 0, 0, 0.09, 0.3, 0.7);
      this.blue.emit(at.x, at.y, at.z, 0, 0, 0, 0.06, 0.14, 0.36);
    } else {
      this.fire.emit(at.x, at.y, at.z, 0, 0, 0, 0.12, 0.7, 1.5);
      this.fire.emit(at.x, at.y, at.z, 0, 0, 0, 0.08, 0.35, 0.7);
    }
  }

  /** Impacto de un disparo: chispas hacia atrás y polvo en el suelo, destello azul en el escudo, chispas y humo en un droide. */
  impact(at: THREE.Vector3, dir: THREE.Vector3, kind: 'ground' | 'droid' | 'shield' | 'enemy') {
    const bx = -dir.x, by = -dir.y, bz = -dir.z;
    const spark = (n: number, speed: number) => {
      for (let i = 0; i < n; i++) {
        const s = speed * (0.5 + Math.random());
        this.sparks.emit(at.x, at.y, at.z, bx * s + (Math.random() - 0.5) * 4, Math.abs(by) * s * 0.5 + 1 + Math.random() * 3, bz * s + (Math.random() - 0.5) * 4, 0.25 + Math.random() * 0.45);
      }
    };
    if (kind === 'shield') {
      this.blue.emit(at.x, at.y, at.z, 0, 0, 0, 0.32, 0.8, 2.2);
      this.blue.emit(at.x, at.y, at.z, 0, 0, 0, 0.22, 0.5, 1.4);
    } else if (kind === 'droid') {
      spark(7, 3.5);
      this.fire.emit(at.x, at.y, at.z, 0, 0.3, 0, 0.22, 0.5, 1.0);
      this.smokeBig.emit(at.x, at.y, at.z, bx * 0.4, 0.8, bz * 0.4, 1.0, 0.5, 1.4);
    } else {
      spark(kind === 'enemy' ? 5 : 6, 4);
      const n = kind === 'enemy' ? 2 : 3;
      for (let i = 0; i < n; i++) this.dust.emit(at.x + (Math.random() - 0.5) * 0.2, at.y + 0.05, at.z + (Math.random() - 0.5) * 0.2, bx * 0.6 + (Math.random() - 0.5) * 0.8, 0.5 + Math.random() * 0.8, bz * 0.6 + (Math.random() - 0.5) * 0.8, 0.8 + Math.random() * 0.6, 0.6, 1.9);
    }
  }

  /** Chispas, llamas y humo cuando un droide queda destruido. */
  deathBurst(x: number, y: number, z: number) {
    for (let i = 0; i < 18; i++) {
      const a = Math.random() * Math.PI * 2, s = 2 + Math.random() * 5;
      this.sparks.emit(x, y, z, Math.cos(a) * s, 2 + Math.random() * 5, Math.sin(a) * s, 0.45 + Math.random() * 0.5);
    }
    for (let i = 0; i < 3; i++) this.fire.emit(x + (Math.random() - 0.5) * 0.4, y + (Math.random() - 0.3) * 0.4, z + (Math.random() - 0.5) * 0.4, (Math.random() - 0.5) * 1.5, 0.8 + Math.random(), (Math.random() - 0.5) * 1.5, 0.45 + Math.random() * 0.3, 0.5, 1.5);
    for (let i = 0; i < 3; i++) this.smokeBig.emit(x + (Math.random() - 0.5) * 0.4, y + Math.random() * 0.3, z + (Math.random() - 0.5) * 0.4, (Math.random() - 0.5) * 0.8, 1 + Math.random() * 0.8, (Math.random() - 0.5) * 0.8, 1.6 + Math.random() * 0.8, 0.5, 1.9);
    this.flash(new THREE.Vector3(x, y, z), 0xffb060);
  }

  /** Explosión de granada: bola de fuego en capas, onda de polvo por el suelo, columna de humo, chispas y una marca quemada. `radius` = alcance real. */
  explosion(x: number, y: number, z: number, radius: number) {
    const b = this.blasts.find((q) => q.life <= 0) ?? this.blasts[0];
    b.life = 1;
    b.size = radius;
    b.ball.position.set(x, y + 0.3, z);
    b.ring.position.set(x, y + 0.12, z);
    b.ball.visible = b.ring.visible = true;
    const R = radius, r = () => Math.random();
    // llamas
    for (let i = 0; i < 9; i++) this.fire.emit(x + (r() - 0.5) * 1.2, y + 0.4 + r() * 0.8, z + (r() - 0.5) * 1.2, (r() - 0.5) * 2.5, 2 + r() * 3.5, (r() - 0.5) * 2.5, 0.8 + r() * 0.6, R * 0.3, R * 0.8);
    // onda de polvo que se extiende por el suelo
    for (let i = 0; i < 16; i++) { const a = (i / 16) * Math.PI * 2 + r() * 0.3, s = 7 + r() * 6; this.dust.emit(x, y + 0.2, z, Math.cos(a) * s, 0.3 + r() * 0.9, Math.sin(a) * s, 1 + r() * 0.7, 0.9, 3.6); }
    // columna de humo oscuro
    for (let i = 0; i < 10; i++) this.smokeBig.emit(x + (r() - 0.5) * 0.9, y + 0.5, z + (r() - 0.5) * 0.9, (r() - 0.5) * 1.2, 2.5 + r() * 3, (r() - 0.5) * 1.2, 3.4 + r() * 1.4, 1.4, 5.4);
    // chispas y fragmentos
    for (let i = 0; i < 60; i++) {
      const a = r() * Math.PI * 2, s = 3 + r() * 10;
      this.sparks.emit(x, y + 0.3, z, Math.cos(a) * s, 2 + r() * 9, Math.sin(a) * s, 0.5 + r() * 0.8);
    }
    for (let i = 0; i < 12; i++) {
      const a = r() * Math.PI * 2, s = r() * 2.2;
      this.smokeBig.emit(x + (r() - 0.5), y + 0.2 + r() * 0.6, z + (r() - 0.5), Math.cos(a) * s, 0.8 + r() * 1.6, Math.sin(a) * s, 1.8 + r() * 1.4, 1.1, 3.0);
    }
    // marca quemada en el suelo
    const sc = this.scorches.find((q) => q.life <= 0) ?? this.scorches[0];
    sc.mesh.position.set(x, y + 0.04, z);
    sc.mesh.scale.setScalar(R * 0.55);
    sc.mesh.rotation.y = r() * 6.28;
    sc.life = 12;
    sc.mesh.visible = true;
  }

  /** Polvo levantado del suelo (el aire de los motores de una nave que pasa rasante): `n` nubecillas en un radio `spread` que salen hacia fuera. */
  groundDust(x: number, y: number, z: number, n = 2, spread = 3, speed = 4) {
    for (let i = 0; i < n; i++) {
      const a = Math.random() * Math.PI * 2, r = Math.random() * spread, s = speed * (0.5 + Math.random());
      this.dust.emit(x + Math.cos(a) * r, y + 0.15, z + Math.sin(a) * r, Math.cos(a) * s, 0.5 + Math.random() * 1.3, Math.sin(a) * s, 1.3 + Math.random() * 0.9, 1.4, 5.2);
    }
  }

  /** Una bocanada de humo oscuro que sube despacio. */
  smokePuff(x: number, y: number, z: number) {
    this.smokeBig.emit(x, y, z, (Math.random() - 0.5) * 0.7, 0.9 + Math.random() * 0.9, (Math.random() - 0.5) * 0.7, 1.5 + Math.random() * 0.8, 0.6, 1.8);
  }

  /** Quita todos los rayos y chispazos de la pantalla. */
  clear() {
    this.sparks.clear();
    this.dust.clear(); this.smokeBig.clear(); this.fire.clear(); this.blue.clear();
    for (const q of this.scorches) { q.life = 0; q.mesh.visible = false; }
    for (const b of this.blasts) { b.life = 0; b.ball.visible = b.ring.visible = false; }
    for (const b of [...this.bolts, ...this.enemyBolts]) { b.active = false; b.mesh.visible = false; }
    for (const f of this.flashes) { f.active = false; f.mesh.visible = false; }
  }

  update(dt: number) {
    for (const b of this.blasts) {
      if (b.life <= 0) continue;
      b.life -= dt * 3.4;
      if (b.life <= 0) { b.ball.visible = b.ring.visible = false; continue; }
      const k = 1 - b.life; // 0 → 1
      b.ball.scale.setScalar(b.size * 0.12 + b.size * 0.3 * Math.sqrt(k));
      b.ball.scale.y *= 0.85;
      (b.ball.material as THREE.MeshBasicMaterial).opacity = Math.min(1, b.life * 1.3) * 0.28;
      b.ring.scale.setScalar(Math.max(0.2, b.size * Math.sqrt(k)));
      (b.ring.material as THREE.MeshBasicMaterial).opacity = b.life * 0.7;
    }
    this.sparks.update(dt);
    this.dust.update(dt); this.smokeBig.update(dt); this.fire.update(dt); this.blue.update(dt);
    for (const q of this.scorches) {
      if (q.life <= 0) continue;
      q.life -= dt;
      (q.mesh.material as THREE.MeshBasicMaterial).opacity = Math.min(0.8, q.life * 0.5, Math.min(1, (12 - q.life) * 6) * 0.8);
      if (q.life <= 0) q.mesh.visible = false;
    }
    for (const b of this.enemyBolts) {
      if (!b.active) continue;
      const step = ENEMY_BOLT_SPEED * dt;
      b.left -= step;
      b.mesh.position.addScaledVector(b.dir, step);
      if (b.left <= 0) { b.active = false; b.mesh.visible = false; }
    }
    for (const b of this.bolts) {
      if (!b.active) continue;
      const step = BOLT_SPEED * dt;
      b.left -= step;
      b.mesh.position.addScaledVector(b.dir, step);
      if (b.left <= 0) { b.active = false; b.mesh.visible = false; }
    }
    for (const f of this.flashes) {
      if (!f.active) continue;
      f.life -= dt * 6;
      if (f.life <= 0) { f.active = false; f.mesh.visible = false; continue; }
      f.mesh.scale.setScalar(1 + (1 - f.life) * 1.8);
      (f.mesh.material as THREE.MeshBasicMaterial).opacity = f.life;
    }
  }
}
