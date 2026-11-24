import * as THREE from 'three';

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
  private smoke: ParticlePool;

  constructor(scene: THREE.Scene) {
    const dot = dotTexture();
    this.sparks = new ParticlePool(scene, 120, 0.22, [1, 0.62, 0.2], 9, 0.6, true, dot);
    this.smoke = new ParticlePool(scene, 40, 2.4, [0.2, 0.17, 0.15], 0, 0.9, false, dot);
    const boltGeo = new THREE.BoxGeometry(0.045, 0.045, BOLT_LENGTH);
    boltGeo.translate(0, 0, BOLT_LENGTH / 2);
    const boltMat = new THREE.MeshBasicMaterial({ color: 0x66b8ff, fog: false });
    for (let i = 0; i < 14; i++) {
      const mesh = new THREE.Mesh(boltGeo, boltMat);
      mesh.visible = false;
      scene.add(mesh);
      this.bolts.push({ mesh, dir: new THREE.Vector3(), left: 0, active: false });
    }
    // Rayos rojos de los droides (más gruesos y algo más lentos, para poder verlos venir).
    const eGeo = new THREE.BoxGeometry(0.07, 0.07, 1.6);
    eGeo.translate(0, 0, 0.8);
    const eMat = new THREE.MeshBasicMaterial({ color: 0xff3a30, fog: false });
    for (let i = 0; i < 40; i++) {
      const mesh = new THREE.Mesh(eGeo, eMat);
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

  /** Chispas y humo cuando un droide queda destruido. */
  deathBurst(x: number, y: number, z: number) {
    for (let i = 0; i < 18; i++) {
      const a = Math.random() * Math.PI * 2, s = 2 + Math.random() * 5;
      this.sparks.emit(x, y, z, Math.cos(a) * s, 2 + Math.random() * 5, Math.sin(a) * s, 0.45 + Math.random() * 0.5);
    }
    for (let i = 0; i < 4; i++) this.smokePuff(x + (Math.random() - 0.5) * 0.4, y + Math.random() * 0.3, z + (Math.random() - 0.5) * 0.4);
    this.flash(new THREE.Vector3(x, y, z), 0xffb060);
  }

  /** Una bocanada de humo oscuro que sube despacio. */
  smokePuff(x: number, y: number, z: number) {
    this.smoke.emit(x, y, z, (Math.random() - 0.5) * 0.7, 0.9 + Math.random() * 0.9, (Math.random() - 0.5) * 0.7, 1.5 + Math.random() * 0.8);
  }

  /** Quita todos los rayos y chispazos de la pantalla. */
  clear() {
    this.sparks.clear();
    this.smoke.clear();
    for (const b of [...this.bolts, ...this.enemyBolts]) { b.active = false; b.mesh.visible = false; }
    for (const f of this.flashes) { f.active = false; f.mesh.visible = false; }
  }

  update(dt: number) {
    this.sparks.update(dt);
    this.smoke.update(dt);
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
