import * as THREE from 'three';
import type RAPIER from '@dimforge/rapier3d-compat';
import type { EnemyState } from '../sim/types';
import { CANYON_HALF_L, CANYON_HALF_W, terrainHeight } from '../world/terrain';
import { b1Geometry, DROID_HEIGHT } from './B1Model';
import { DroidBrain, type BrainContext, type BrainParams } from './DroidBrain';

const CORPSE_TIME = 2.2;
const LIFT = 0.08; // el cuerpo sólido flota un poco sobre el suelo para no engancharse

// Un droide: aspecto, cuerpo sólido (recibe disparos) y cerebro. Se reutilizan siempre
// los mismos (reserva) para no cargar el móvil creando y destruyendo objetos.
export class Droid {
  readonly group: THREE.Mesh;
  readonly body: RAPIER.RigidBody;
  readonly collider: RAPIER.Collider;
  readonly brain = new DroidBrain();
  private mat = new THREE.MeshLambertMaterial({ vertexColors: true });
  private flash = 0;
  private deadTime = 0;
  private t = 0;
  private smokeT = 0;
  private out = { dx: 0, dz: 0 };

  constructor(
    scene: THREE.Scene,
    rapier: typeof RAPIER,
    physics: RAPIER.World,
    private controller: RAPIER.KinematicCharacterController,
    public state: EnemyState,
  ) {
    this.group = new THREE.Mesh(b1Geometry(), this.mat);
    this.group.castShadow = true;
    this.group.visible = false;
    scene.add(this.group);
    this.body = physics.createRigidBody(rapier.RigidBodyDesc.kinematicPositionBased());
    this.collider = physics.createCollider(rapier.ColliderDesc.capsule(DROID_HEIGHT / 2 - 0.28, 0.28), this.body);
    this.collider.setEnabled(false);
  }

  /** Punto al que conviene apuntar (el pecho). */
  aimPoint(out: THREE.Vector3) {
    return out.set(this.state.x, this.state.y + 1.25, this.state.z);
  }

  private syncBody() {
    const s = this.state;
    this.body.setTranslation({ x: s.x, y: s.y + DROID_HEIGHT / 2 + LIFT, z: s.z }, true);
  }

  activate(x: number, z: number, health: number, params: BrainParams, ctx: BrainContext) {
    const s = this.state;
    s.x = x; s.z = z; s.y = terrainHeight(x, z);
    s.health = health;
    s.alive = true;
    s.active = true;
    this.flash = 0;
    this.deadTime = 0;
    this.t = Math.random() * 10;
    this.group.rotation.set(0, 0, 0);
    this.group.visible = true;
    this.collider.setEnabled(true);
    this.syncBody();
    this.brain.reset(x, z, params, ctx);
    this.group.position.set(s.x, s.y, s.z);
  }

  deactivate(ctx: BrainContext) {
    this.brain.release(ctx);
    this.state.active = false;
    this.state.alive = false;
    this.group.visible = false;
    this.collider.setEnabled(false);
  }

  /** Recibe daño. Devuelve true si este disparo lo destruye. */
  hit(damage: number, ctx: BrainContext): boolean {
    if (!this.state.alive) return false;
    this.state.health -= damage;
    this.flash = 1;
    if (this.state.health > 0) return false;
    this.state.alive = false;
    this.deadTime = 0;
    this.smokeT = 0.3;
    this.collider.setEnabled(false);
    this.brain.release(ctx);
    ctx.effects.deathBurst(this.state.x, this.state.y + 1.2, this.state.z);
    return true;
  }

  update(dt: number, ctx: BrainContext) {
    const s = this.state;
    if (!s.active) return;
    this.flash = Math.max(0, this.flash - dt * 7);
    this.mat.emissive.setRGB(this.flash, this.flash * 0.8, this.flash * 0.6);

    if (!s.alive) {
      this.deadTime += dt;
      // Se desploma hacia atrás.
      this.group.rotation.x = Math.min(Math.PI / 2, this.deadTime * 5);
      this.group.position.y = s.y + Math.min(0.12, this.deadTime * 0.5);
      // El droide caído echa humo un momento
      this.smokeT -= dt;
      if (this.smokeT <= 0 && this.deadTime < 1.7) {
        this.smokeT = 0.4;
        ctx.effects.smokePuff(s.x + (Math.random() - 0.5) * 0.5, s.y + 0.5, s.z + (Math.random() - 0.5) * 0.5);
      }
      if (this.deadTime > CORPSE_TIME) this.deactivate(ctx);
      return;
    }

    this.brain.think(dt, s.x, s.y, s.z, ctx, this.out);

    if (this.out.dx !== 0 || this.out.dz !== 0) {
      // El cuerpo sólido ajusta el movimiento para no atravesar rocas, muros ni a otros droides.
      const nx0 = s.x + this.out.dx, nz0 = s.z + this.out.dz;
      const dy = terrainHeight(nx0, nz0) - s.y;
      this.controller.computeColliderMovement(this.collider, { x: this.out.dx, y: dy, z: this.out.dz });
      const m = this.controller.computedMovement();
      s.x = Math.max(-CANYON_HALF_W + 1, Math.min(CANYON_HALF_W - 1, s.x + m.x));
      s.z = Math.max(-CANYON_HALF_L + 1, Math.min(CANYON_HALF_L - 1, s.z + m.z));
      s.y = terrainHeight(s.x, s.z);
      this.syncBody();
      this.t += dt * (Math.hypot(m.x, m.z) / Math.max(dt, 1e-4)) * 2.2;
    }

    s.yaw = this.brain.yaw;
    this.group.position.set(s.x, s.y, s.z);
    this.group.rotation.y = s.yaw;
    // Balanceo al andar.
    this.group.rotation.z = this.brain.moving ? Math.sin(this.t) * 0.045 : 0;
  }
}
