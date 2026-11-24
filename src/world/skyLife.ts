import * as THREE from 'three';
import { glowTexture } from './atmosphere';
import { makeRng } from './terrain';

// Vida en el cielo (solo decoración, no afecta a la partida):
//  - un destructor de la República detrás de ti y una nave separatista delante,
//    altos y lejos, intercambiando disparos por encima del cañón;
//  - algún geonosiano que cruza el cañón de un lado a otro.

// ---------- Utilidades para armar modelos sencillos ----------

type Part = { geo: THREE.BufferGeometry; color: number; at?: [number, number, number]; rot?: [number, number, number] };

/** Junta varias piezas en una sola malla con color por vértice. */
function assemble(parts: Part[], paintByNormal?: (nx: number, ny: number, base: THREE.Color, out: THREE.Color) => void): THREE.BufferGeometry {
  const geos: THREE.BufferGeometry[] = [];
  const base = new THREE.Color();
  const out = new THREE.Color();
  for (const p of parts) {
    const g = p.geo.index ? p.geo.toNonIndexed() : p.geo.clone();
    if (p.rot) g.applyMatrix4(new THREE.Matrix4().makeRotationFromEuler(new THREE.Euler(p.rot[0], p.rot[1], p.rot[2])));
    if (p.at) g.translate(p.at[0], p.at[1], p.at[2]);
    g.deleteAttribute('uv');
    g.computeVertexNormals();
    const n = g.attributes.normal;
    const arr = new Float32Array(g.attributes.position.count * 3);
    base.set(p.color);
    for (let i = 0; i < n.count; i++) {
      out.copy(base);
      if (paintByNormal) paintByNormal(n.getX(i), n.getY(i), base, out);
      arr.set([out.r, out.g, out.b], i * 3);
    }
    g.setAttribute('color', new THREE.BufferAttribute(arr, 3));
    geos.push(g);
  }
  // mergeGeometries pide que todos tengan los mismos atributos
  return mergeAll(geos);
}

function mergeAll(geos: THREE.BufferGeometry[]): THREE.BufferGeometry {
  let total = 0;
  for (const g of geos) total += g.attributes.position.count;
  const pos = new Float32Array(total * 3), col = new Float32Array(total * 3);
  let o = 0;
  for (const g of geos) {
    pos.set(g.attributes.position.array as Float32Array, o * 3);
    col.set(g.attributes.color.array as Float32Array, o * 3);
    o += g.attributes.position.count;
  }
  const m = new THREE.BufferGeometry();
  m.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  m.setAttribute('color', new THREE.BufferAttribute(col, 3));
  m.computeVertexNormals();
  return m;
}

// Con algo de brillo propio para que no queden negras a contraluz.
const shipMat = () => new THREE.MeshLambertMaterial({ vertexColors: true, fog: false, flatShading: true, emissive: 0x4a3320 });

/** Destructor de la República (tipo Venator): casco en cuña, torre de mando atrás, motores. Apunta a -Z. */
function venator(): THREE.BufferGeometry {
  const hull = new THREE.ConeGeometry(1, 1, 3);
  hull.rotateX(-Math.PI / 2);
  hull.scale(34, 7, 130);
  const tint = (nx: number, ny: number, _b: THREE.Color, out: THREE.Color) => {
    if (ny < -0.5) out.setHex(0xc25a46); // vientre rojo de la República
    else if (ny > 0.3) out.setHex(0xcfc7b6);
    else out.setHex(0xaaa392);
    void nx;
  };
  const geo = assemble(
    [
      { geo: hull, color: 0xcfc7b6 },
      { geo: new THREE.BoxGeometry(9, 10, 12), color: 0xbfb8a8, at: [0, 9, 42] }, // torre
      { geo: new THREE.BoxGeometry(16, 3, 6), color: 0xd6cfbf, at: [0, 15.5, 44] }, // puente
      { geo: new THREE.BoxGeometry(30, 2.5, 26), color: 0xb9b2a2, at: [0, 4.4, 22] }, // cubierta
      { geo: new THREE.CylinderGeometry(4.2, 4.6, 12, 8), color: 0x4b4640, at: [-17, 0, 70], rot: [Math.PI / 2, 0, 0] }, // motores
      { geo: new THREE.CylinderGeometry(4.2, 4.6, 12, 8), color: 0x4b4640, at: [0, 0, 70], rot: [Math.PI / 2, 0, 0] },
      { geo: new THREE.CylinderGeometry(4.2, 4.6, 12, 8), color: 0x4b4640, at: [17, 0, 70], rot: [Math.PI / 2, 0, 0] },
    ],
    tint,
  );
  return geo;
}

/** Nave separatista (tipo Recusant): casco largo y cilíndrico con anillos y motores atrás. Apunta a -Z. */
function separatist(): THREE.BufferGeometry {
  return assemble([
    { geo: new THREE.CylinderGeometry(7, 8.5, 90, 10), color: 0x5f6a70, rot: [Math.PI / 2, 0, 0] },
    { geo: new THREE.ConeGeometry(7, 24, 10), color: 0x4a545a, at: [0, 0, -57], rot: [-Math.PI / 2, 0, 0] },
    { geo: new THREE.TorusGeometry(11.5, 1.7, 6, 16), color: 0x555d60, at: [0, 0, -24] },
    { geo: new THREE.TorusGeometry(11.5, 1.7, 6, 16), color: 0x555d60, at: [0, 0, 2] },
    { geo: new THREE.TorusGeometry(11.5, 1.7, 6, 16), color: 0x555d60, at: [0, 0, 28] },
    { geo: new THREE.BoxGeometry(6, 6, 14), color: 0x9aa2a0, at: [0, 10, 14] },
    { geo: new THREE.BoxGeometry(5, 5, 28), color: 0x697376, at: [-13, -1, 20] },
    { geo: new THREE.BoxGeometry(5, 5, 28), color: 0x697376, at: [13, -1, 20] },
    { geo: new THREE.BoxGeometry(2, 0.5, 46), color: 0x7a2b24, at: [0, 8.6, -6] }, // franja roja
    { geo: new THREE.CylinderGeometry(3.4, 3.8, 9, 8), color: 0x3c4245, at: [0, 0, 49], rot: [Math.PI / 2, 0, 0] },
    { geo: new THREE.CylinderGeometry(3, 3.4, 9, 8), color: 0x3c4245, at: [-6.5, 3.5, 49], rot: [Math.PI / 2, 0, 0] },
    { geo: new THREE.CylinderGeometry(3, 3.4, 9, 8), color: 0x3c4245, at: [6.5, 3.5, 49], rot: [Math.PI / 2, 0, 0] },
  ]);
}

// ---------- Batalla en el cielo ----------

interface Bolt { mesh: THREE.Mesh; from: THREE.Vector3; to: THREE.Vector3; t: number; dur: number; active: boolean; side: number }
interface Flash { sprite: THREE.Sprite; life: number }

const BOLT_SPEED = 300; // m/s

class SkyBattle {
  private republic: THREE.Mesh;
  private sep: THREE.Mesh;
  private glows: Array<{ sprite: THREE.Sprite; base: number; phase: number }> = [];
  private bolts: Bolt[] = [];
  private flashes: Flash[] = [];
  private pending: Array<{ at: number; side: number }> = [];
  private t = 0;
  private nextVolley = [1.5, 3.2];
  private pos = [new THREE.Vector3(), new THREE.Vector3()];

  constructor(
    scene: THREE.Scene,
    private onFire?: (x: number, y: number, z: number) => void,
  ) {
    const glow = glowTexture();

    // Destructor de la República: detrás de ti, alto, con el morro hacia la derecha.
    this.republic = new THREE.Mesh(venator(), shipMat());
    this.republic.position.set(25, 260, 300);
    this.republic.rotation.y = -Math.PI / 2 + 0.28;
    this.republic.scale.setScalar(1.45);
    // Nave separatista: delante, algo más baja, mirando hacia el otro lado.
    this.sep = new THREE.Mesh(separatist(), shipMat());
    this.sep.position.set(-35, 235, -310);
    this.sep.rotation.y = Math.PI / 2 - 0.22;
    this.sep.scale.setScalar(1.6);
    for (const m of [this.republic, this.sep]) {
      m.frustumCulled = false;
      m.renderOrder = 2;
      scene.add(m);
    }

    // Brillo de los motores
    const addGlow = (ship: THREE.Mesh, x: number, y: number, z: number, size: number, color: number) => {
      const sprite = new THREE.Sprite(new THREE.SpriteMaterial({ map: glow, color, blending: THREE.AdditiveBlending, depthWrite: false, fog: false, transparent: true }));
      sprite.position.set(x, y, z);
      sprite.scale.setScalar(size);
      ship.add(sprite);
      this.glows.push({ sprite, base: size, phase: Math.random() * 6 });
    };
    for (const x of [-17, 0, 17]) addGlow(this.republic, x, 0, 78, 20, 0x80c0ff);
    addGlow(this.sep, 0, 0, 56, 15, 0xffa050);
    addGlow(this.sep, -6.5, 3.5, 56, 12, 0xffa050);
    addGlow(this.sep, 6.5, 3.5, 56, 12, 0xffa050);

    // Rayos: verdes los de la República, rojos los separatistas
    const boltGeo = new THREE.BoxGeometry(1.5, 1.5, 17);
    boltGeo.translate(0, 0, 8.5);
    const mats = [
      new THREE.MeshBasicMaterial({ color: 0x3dff7a, fog: false }),
      new THREE.MeshBasicMaterial({ color: 0xff3020, fog: false }),
    ];
    for (let i = 0; i < 30; i++) {
      const mesh = new THREE.Mesh(boltGeo, mats[i % 2]);
      mesh.visible = false;
      mesh.frustumCulled = false;
      mesh.renderOrder = 3;
      scene.add(mesh);
      this.bolts.push({ mesh, from: new THREE.Vector3(), to: new THREE.Vector3(), t: 0, dur: 1, active: false, side: i % 2 });
    }
    // Destellos de impacto en los cascos
    for (let i = 0; i < 8; i++) {
      const sprite = new THREE.Sprite(new THREE.SpriteMaterial({ map: glow, color: 0xffc070, blending: THREE.AdditiveBlending, depthWrite: false, fog: false, transparent: true }));
      sprite.visible = false;
      sprite.renderOrder = 3;
      scene.add(sprite);
      this.flashes.push({ sprite, life: 0 });
    }
  }

  /** Punto al azar sobre el casco de una nave (en el mundo). */
  private hullPoint(ship: THREE.Mesh, out: THREE.Vector3, towardZ: number) {
    out.set((Math.random() * 2 - 1) * 12, Math.random() * 6, (Math.random() * 2 - 1) * 50);
    ship.updateMatrixWorld();
    ship.localToWorld(out);
    void towardZ;
    return out;
  }

  private fire(side: number) {
    const b = this.bolts.find((x) => !x.active && x.side === side);
    if (!b) return;
    const src = side === 0 ? this.republic : this.sep;
    const dst = side === 0 ? this.sep : this.republic;
    this.hullPoint(src, b.from, 0);
    this.hullPoint(dst, b.to, 0);
    this.onFire?.(b.from.x, b.from.y, b.from.z);
    const dist = b.from.distanceTo(b.to);
    b.dur = dist / BOLT_SPEED;
    b.t = 0;
    b.active = true;
    b.mesh.visible = true;
    b.mesh.position.copy(b.from);
    b.mesh.lookAt(b.to);
  }

  private flash(at: THREE.Vector3) {
    const f = this.flashes.find((x) => x.life <= 0) ?? this.flashes[0];
    f.sprite.position.copy(at);
    f.life = 1;
    f.sprite.visible = true;
  }

  update(dt: number) {
    this.t += dt;
    // Las naves se mecen despacio
    this.republic.position.y = 185 + Math.sin(this.t * 0.11) * 4;
    this.republic.rotation.z = Math.sin(this.t * 0.17) * 0.025;
    this.sep.position.y = 160 + Math.sin(this.t * 0.13 + 1) * 4;
    this.sep.rotation.z = Math.sin(this.t * 0.15 + 2) * 0.03;
    for (const g of this.glows) g.sprite.scale.setScalar(g.base * (0.9 + 0.1 * Math.sin(this.t * 9 + g.phase)));

    // Descargas de disparos: salvas de 2–4 rayos, alternando bandos
    for (let s = 0; s < 2; s++) {
      this.nextVolley[s] -= dt;
      if (this.nextVolley[s] <= 0) {
        this.nextVolley[s] = (s === 0 ? 1.8 : 2.6) + Math.random() * 2.6;
        const n = 2 + Math.floor(Math.random() * 3);
        for (let i = 0; i < n; i++) this.pending.push({ at: this.t + i * 0.14, side: s });
      }
    }
    for (let i = this.pending.length - 1; i >= 0; i--) {
      if (this.pending[i].at <= this.t) { this.fire(this.pending[i].side); this.pending.splice(i, 1); }
    }
    for (const b of this.bolts) {
      if (!b.active) continue;
      b.t += dt;
      const k = b.t / b.dur;
      if (k >= 1) {
        b.active = false;
        b.mesh.visible = false;
        this.flash(b.to);
        continue;
      }
      b.mesh.position.lerpVectors(b.from, b.to, k);
    }
    for (const f of this.flashes) {
      if (f.life <= 0) continue;
      f.life -= dt * 2.2;
      if (f.life <= 0) { f.sprite.visible = false; continue; }
      f.sprite.scale.setScalar(14 * (1.2 - f.life * 0.6));
      (f.sprite.material as THREE.SpriteMaterial).opacity = f.life;
    }
    void this.pos;
  }
}

// ---------- Geonosianos que cruzan el cañón ----------

const GEO_BODY = 0x8a7358;
const GEO_DARK = 0x4a3c2e;

function geonosianBody(): THREE.BufferGeometry {
  return assemble([
    { geo: new THREE.BoxGeometry(0.5, 1.0, 0.32), color: GEO_BODY, at: [0, 0, 0] }, // torso
    { geo: new THREE.BoxGeometry(0.34, 0.5, 0.4), color: GEO_BODY, at: [0, 0.78, -0.05] }, // cabeza
    { geo: new THREE.BoxGeometry(0.04, 0.5, 0.04), color: GEO_DARK, at: [-0.1, 1.2, 0.02], rot: [0, 0, 0.35] }, // antenas
    { geo: new THREE.BoxGeometry(0.04, 0.5, 0.04), color: GEO_DARK, at: [0.1, 1.2, 0.02], rot: [0, 0, -0.35] },
    { geo: new THREE.BoxGeometry(0.14, 0.9, 0.14), color: GEO_DARK, at: [-0.14, -0.9, 0] }, // piernas
    { geo: new THREE.BoxGeometry(0.14, 0.9, 0.14), color: GEO_DARK, at: [0.14, -0.9, 0] },
    { geo: new THREE.BoxGeometry(0.1, 0.7, 0.1), color: GEO_DARK, at: [-0.32, 0.05, -0.1], rot: [-0.4, 0, 0] }, // brazos
    { geo: new THREE.BoxGeometry(0.1, 0.7, 0.1), color: GEO_DARK, at: [0.32, 0.05, -0.1], rot: [-0.4, 0, 0] },
  ]);
}

class Flyer {
  readonly group = new THREE.Group();
  private wingL: THREE.Mesh;
  private wingR: THREE.Mesh;
  active = false;
  private t = 0;
  private dur = 0;
  private x0 = 0; private z0 = 0; private y0 = 0; private dir = 1; private speed = 10;
  private p = [0, 0, 0, 0];
  private prev = new THREE.Vector3();
  private cur = new THREE.Vector3();

  constructor(scene: THREE.Scene, body: THREE.BufferGeometry, wingMat: THREE.Material, bodyMat: THREE.Material) {
    this.group.add(new THREE.Mesh(body, bodyMat));
    const wing = new THREE.BoxGeometry(1.7, 0.03, 0.55);
    wing.translate(0.85, 0, 0);
    this.wingR = new THREE.Mesh(wing, wingMat);
    this.wingR.position.set(0.18, 0.35, 0.2);
    const wingL = new THREE.BoxGeometry(1.7, 0.03, 0.55);
    wingL.translate(-0.85, 0, 0);
    this.wingL = new THREE.Mesh(wingL, wingMat);
    this.wingL.position.set(-0.18, 0.35, 0.2);
    this.group.add(this.wingL, this.wingR);
    this.group.visible = false;
    this.group.scale.setScalar(2.0);
    scene.add(this.group);
  }

  /** Cruza el cañón de un lado a otro, a unos 50–62 m de altura (sobre las paredes), delante o detrás de ti. */
  start(rng: () => number) {
    this.active = true;
    this.t = 0;
    this.dir = rng() < 0.5 ? -1 : 1;
    this.speed = 8 + rng() * 5;
    this.x0 = -this.dir * 80;
    this.z0 = (rng() < 0.5 ? -1 : 1) * (35 + rng() * 60);
    this.y0 = 50 + rng() * 12; // por encima de la meseta del cañón
    this.p = [rng() * 6.28, rng() * 6.28, rng() * 6.28, rng() * 6.28];
    this.dur = 160 / this.speed;
    this.place(0);
    this.prev.copy(this.group.position);
    this.group.visible = true;
  }

  /** Trayectoria con vaivenes: avanza de lado a lado pero zigzaguea, sube y baja. */
  private place(t: number) {
    const p = this.p;
    const x = this.x0 + this.dir * this.speed * t + 6 * Math.sin(0.7 * t + p[0]);
    const z = this.z0 + 14 * Math.sin(0.43 * t + p[1]) + 5 * Math.sin(1.3 * t + p[2]);
    const y = this.y0 + 3.4 * Math.sin(0.9 * t + p[3]) + 1.2 * Math.sin(2.7 * t + p[0]);
    this.group.position.set(x, y, z);
  }

  update(dt: number) {
    if (!this.active) return;
    this.t += dt;
    this.prev.copy(this.group.position);
    this.place(this.t);
    this.cur.copy(this.group.position);
    const vx = (this.cur.x - this.prev.x) / dt, vy = (this.cur.y - this.prev.y) / dt, vz = (this.cur.z - this.prev.z) / dt;
    // Mira hacia donde vuela, se inclina en las curvas y adelanta el cuerpo al subir o bajar
    this.group.rotation.y = Math.atan2(-vx, -vz);
    this.group.rotation.x = -0.35 + THREE.MathUtils.clamp(vy * 0.04, -0.3, 0.3);
    this.group.rotation.z = THREE.MathUtils.clamp(-vz * 0.02, -0.4, 0.4);
    const f = Math.sin(this.t * 40) * 0.7;
    this.wingR.rotation.z = 0.3 + f;
    this.wingL.rotation.z = -0.3 - f;
    if (this.t > this.dur) { this.active = false; this.group.visible = false; }
  }
}

class Geonosians {
  private flyers: Flyer[] = [];
  private wait = 6;
  private rng = makeRng(31337 + Math.floor(Math.random() * 1000));

  constructor(scene: THREE.Scene) {
    const body = geonosianBody();
    const bodyMat = new THREE.MeshLambertMaterial({ vertexColors: true });
    const wingMat = new THREE.MeshBasicMaterial({ color: 0xe4d2a8, transparent: true, opacity: 0.6, side: THREE.DoubleSide });
    for (let i = 0; i < 3; i++) this.flyers.push(new Flyer(scene, body, wingMat, bodyMat));
  }

  update(dt: number) {
    this.wait -= dt;
    if (this.wait <= 0) {
      const f = this.flyers.find((x) => !x.active);
      if (f) f.start(this.rng);
      // A veces vuela otro justo detrás
      this.wait = this.rng() < 0.3 ? 2 + this.rng() * 2 : 7 + this.rng() * 9;
    }
    for (const f of this.flyers) f.update(dt);
  }
}

export class SkyLife {
  private battle: SkyBattle;
  private geonosians: Geonosians;

  constructor(scene: THREE.Scene, onFire?: (x: number, y: number, z: number) => void) {
    this.battle = new SkyBattle(scene, onFire);
    this.geonosians = new Geonosians(scene);
  }

  update(dt: number) {
    this.battle.update(dt);
    this.geonosians.update(dt);
  }
}
