import * as THREE from 'three';
import { groundHeight } from '../world/zone';

// Kits médicos: algunos droides los sueltan al morir. Se recogen pasando por encima y curan.
export const MEDKIT = {
  heal: { b1: 15, b2: 18, droideka: 28 },
  chance: { b1: 0.1, b2: 0.35, droideka: 0.75 },
  life: 20, // segundos en el suelo
  blinkFrom: 5, // parpadea en los últimos segundos
  pickupRadius: 1.7,
  max: 4, // a la vez
};

const WHITE = 0xe2ddd0, RED = 0xb02a22, STEEL = 0x56606c, DARK = 0x2c2a29, LIGHT = 0xf4e8b8;

function buildGeometry(): THREE.BufferGeometry {
  // Caja baja en forma de trapecio (como la referencia): paredes inclinadas, tapa plana, persiana oscura en el lateral
  const parts: THREE.BufferGeometry[] = [];
  const col = (g: THREE.BufferGeometry, c: number) => {
    g = g.toNonIndexed(); g.deleteAttribute('uv');
    const cc = new THREE.Color(c), n = g.attributes.position.count, a = new Float32Array(n * 3);
    for (let i = 0; i < n; i++) { a[i * 3] = cc.r; a[i * 3 + 1] = cc.g; a[i * 3 + 2] = cc.b; }
    g.setAttribute('color', new THREE.BufferAttribute(a, 3));
    return g;
  };
  // cuerpo: prisma con la base más ancha que la tapa
  const body = new THREE.CylinderGeometry(0.5, 0.78, 0.5, 4, 1);
  body.rotateY(Math.PI / 4);
  body.scale(1.35, 1, 0.82);
  parts.push(col(body, WHITE));
  const add = (w: number, h: number, d: number, x: number, y: number, z: number, c: number) => {
    const g = new THREE.BoxGeometry(w, h, d); g.translate(x, y, z); parts.push(col(g, c));
  };
  add(0.5, 0.025, 0.3, 0, 0.26, 0, STEEL); // tapa metálica
  add(0.17, 0.03, 0.09, -0.1, 0.285, 0, LIGHT); // dos luces crema
  add(0.17, 0.03, 0.09, 0.1, 0.285, 0, LIGHT);
  add(1.1, 0.02, 0.1, 0, 0.255, 0.28, RED); // franjas rojas de la tapa
  add(1.1, 0.02, 0.1, 0, 0.255, -0.28, RED);
  add(0.28, 0.24, 0.02, -0.4, 0.0, 0.62, RED); // bloques rojos del lateral
  add(0.14, 0.12, 0.02, -0.4, -0.1, 0.62, RED);
  add(0.6, 0.2, 0.02, 0.18, -0.02, 0.6, DARK); // persiana oscura
  return parts.reduce((acc, g, i) => (i === 0 ? g : merge(acc, g)));
}

function merge(a: THREE.BufferGeometry, b: THREE.BufferGeometry): THREE.BufferGeometry {
  const pa = a.attributes.position.array as Float32Array, pb = b.attributes.position.array as Float32Array;
  const ca = a.attributes.color.array as Float32Array, cb = b.attributes.color.array as Float32Array;
  const p = new Float32Array(pa.length + pb.length), c = new Float32Array(ca.length + cb.length);
  p.set(pa); p.set(pb, pa.length); c.set(ca); c.set(cb, ca.length);
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(p, 3));
  g.setAttribute('color', new THREE.BufferAttribute(c, 3));
  g.computeVertexNormals();
  return g;
}

interface Kit { group: THREE.Group; mesh: THREE.Mesh; beam: THREE.Mesh; life: number; heal: number; active: boolean; phase: number }

/** Lleva los kits médicos sueltos por el suelo. */
export class MedkitSystem {
  private pool: Kit[] = [];

  constructor(scene: THREE.Scene) {
    const geo = buildGeometry();
    const mat = new THREE.MeshLambertMaterial({ vertexColors: true, flatShading: true, emissive: 0x1a3a1a });
    const beamGeo = new THREE.CylinderGeometry(0.5, 0.5, 6, 12, 1, true);
    beamGeo.translate(0, 3, 0);
    const beamMat = new THREE.MeshBasicMaterial({ color: 0x2cff7a, transparent: true, opacity: 0.2, depthWrite: false, side: THREE.DoubleSide, fog: false });
    for (let i = 0; i < MEDKIT.max; i++) {
      const group = new THREE.Group();
      const mesh = new THREE.Mesh(geo, mat);
      mesh.scale.setScalar(0.85);
      mesh.position.y = 0.2;
      const beam = new THREE.Mesh(beamGeo, beamMat.clone());
      group.add(mesh, beam);
      group.visible = false;
      scene.add(group);
      this.pool.push({ group, mesh, beam, life: 0, heal: 0, active: false, phase: Math.random() * 6 });
    }
  }

  /** Suelta un kit en ese punto (si hay hueco; si no, sustituye al más antiguo). */
  drop(x: number, z: number, heal: number) {
    const k = this.pool.find((q) => !q.active) ?? [...this.pool].sort((a, b) => a.life - b.life)[0];
    k.active = true; k.life = MEDKIT.life; k.heal = heal;
    k.group.position.set(x, groundHeight(x, z), z);
    k.group.rotation.y = Math.random() * 6.28;
    k.group.visible = true;
  }

  clear() {
    for (const k of this.pool) { k.active = false; k.group.visible = false; }
  }

  /** Posiciones de los kits (para la brújula). */
  list() {
    return this.pool.filter((k) => k.active).map((k) => ({ x: k.group.position.x, z: k.group.position.z, life: k.life }));
  }

  /** Avanza el tiempo; `onPickup` recibe la cura de cada kit recogido por el jugador en (px, pz). */
  update(dt: number, px: number, py: number, pz: number, canHeal: boolean, onPickup: (heal: number, x: number, z: number) => void) {
    for (const k of this.pool) {
      if (!k.active) continue;
      k.life -= dt;
      if (k.life <= 0) { k.active = false; k.group.visible = false; continue; }
      k.phase += dt * 2;
      k.mesh.rotation.y += dt * 0.8;
      k.mesh.position.y = 0.3 + Math.sin(k.phase) * 0.06;
      const blink = k.life < MEDKIT.blinkFrom ? (Math.sin(k.life * 14) > 0 ? 1 : 0.25) : 1;
      (k.beam.material as THREE.MeshBasicMaterial).opacity = 0.3 * blink;
      k.mesh.visible = blink > 0.5;
      const dx = k.group.position.x - px, dz = k.group.position.z - pz;
      if (Math.abs(py - k.group.position.y) < 2.5 && dx * dx + dz * dz < MEDKIT.pickupRadius ** 2 && canHeal) {
        k.active = false; k.group.visible = false;
        onPickup(k.heal, k.group.position.x, k.group.position.z);
      }
    }
  }
}
