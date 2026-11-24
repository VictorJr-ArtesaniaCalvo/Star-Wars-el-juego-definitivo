import * as THREE from 'three';
import RAPIER from '@dimforge/rapier3d-compat';

// Granadas: se lanzan en arco, rebotan en el suelo y las rocas, y explotan al acabar la mecha.
export const GRENADE = {
  perGame: 4, // granadas por partida
  speed: 24.5, // m/s al lanzar
  lift: 4, // impulso hacia arriba al lanzar
  fuse: 2.4, // segundos hasta explotar
  radius: 7, // radio de la explosión (m)
  maxDamage: 130, // daño en el centro (un B1 aguanta 60)
  selfDamage: 45, // daño máximo que te haces a ti mismo
  cooldown: 0.7, // segundos entre lanzamientos
};

const GRAVITY = 20;
const BALL = 0.12; // radio de la granada
const BOUNCE = 0.45;
const FRICTION = 0.65;

interface Active {
  mesh: THREE.Mesh;
  pos: THREE.Vector3;
  vel: THREE.Vector3;
  fuse: number;
  rest: boolean;
  active: boolean;
}

/** Lleva todas las granadas en el aire. La física es sencilla: movimiento en arco y rebote contra lo que haya delante. */
export class GrenadeSystem {
  private pool: Active[] = [];
  private mat: THREE.MeshLambertMaterial;
  private tmp = new THREE.Vector3();

  constructor(
    scene: THREE.Scene,
    private physics: RAPIER.World,
    private ignoreBody: RAPIER.RigidBody,
    private onExplode: (at: THREE.Vector3) => void,
    private onBounce?: (at: THREE.Vector3) => void,
  ) {
    const geo = new THREE.SphereGeometry(BALL, 8, 6);
    this.mat = new THREE.MeshLambertMaterial({ color: 0x4d5a3c, emissive: 0x000000 });
    for (let i = 0; i < 6; i++) {
      const mesh = new THREE.Mesh(geo, this.mat);
      mesh.visible = false;
      scene.add(mesh);
      this.pool.push({ mesh, pos: new THREE.Vector3(), vel: new THREE.Vector3(), fuse: 0, rest: false, active: false });
    }
  }

  throwFrom(origin: THREE.Vector3, dir: THREE.Vector3) {
    const g = this.pool.find((x) => !x.active);
    if (!g) return;
    g.pos.copy(origin).addScaledVector(dir, 0.25);
    g.vel.copy(dir).multiplyScalar(GRENADE.speed);
    g.vel.y += GRENADE.lift;
    g.fuse = GRENADE.fuse;
    g.rest = false;
    g.active = true;
    g.mesh.visible = true;
    g.mesh.position.copy(g.pos);
  }

  clear() {
    for (const g of this.pool) { g.active = false; g.mesh.visible = false; }
  }

  /** ¿Hay alguna granada en el aire? (para pruebas) */
  get inFlight() {
    return this.pool.filter((g) => g.active).length;
  }

  update(dt: number) {
    for (const g of this.pool) {
      if (!g.active) continue;
      g.fuse -= dt;
      if (g.fuse <= 0) {
        g.active = false;
        g.mesh.visible = false;
        this.onExplode(this.tmp.copy(g.pos));
        continue;
      }
      if (!g.rest) {
        g.vel.y -= GRAVITY * dt;
        const step = g.vel.length() * dt;
        if (step > 1e-6) {
          const dir = this.tmp.copy(g.vel).normalize();
          const hit = this.physics.castRayAndGetNormal(
            new RAPIER.Ray(g.pos, dir), step + BALL, true, undefined, undefined, undefined, this.ignoreBody,
          );
          if (hit && hit.timeOfImpact <= step + BALL) {
            const travel = Math.max(0, hit.timeOfImpact - BALL);
            g.pos.addScaledVector(dir, travel);
            const n = hit.normal;
            const vn = g.vel.x * n.x + g.vel.y * n.y + g.vel.z * n.z;
            if (vn < 0) {
              if (vn < -2.5) this.onBounce?.(g.pos);
              g.vel.x -= (1 + BOUNCE) * vn * n.x;
              g.vel.y -= (1 + BOUNCE) * vn * n.y;
              g.vel.z -= (1 + BOUNCE) * vn * n.z;
              g.vel.x *= FRICTION; g.vel.z *= FRICTION;
            }
            // Si ya casi no se mueve sobre una superficie casi horizontal, se queda quieta.
            if (g.vel.length() < 1.4 && n.y > 0.6) { g.vel.set(0, 0, 0); g.rest = true; }
          } else {
            g.pos.addScaledVector(dir, step);
          }
        }
        g.mesh.rotation.x += dt * 9;
        g.mesh.rotation.z += dt * 6;
      }
      g.mesh.position.copy(g.pos);
      // La luz de la mecha parpadea cada vez más rápido.
      const blink = Math.sin((GRENADE.fuse - g.fuse) * (10 + (GRENADE.fuse - g.fuse) * 14)) > 0;
      g.mesh.scale.setScalar(blink ? 1.15 : 1);
    }
    // Brillo rojo general según la granada más cercana a explotar
    let soon = 99;
    for (const g of this.pool) if (g.active) soon = Math.min(soon, g.fuse);
    this.mat.emissive.setRGB(soon < 0.9 ? 0.9 * (1 - soon / 0.9) : 0, 0, 0);
  }
}
