import type RAPIER from '@dimforge/rapier3d-compat';
import type { InputCommand, PlayerState } from '../sim/types';
import { PLAY_RADIUS, terrainHeight } from '../world/terrain';

const RADIUS = 0.35;
const HALF_STAND = 0.55; // altura total de pie: 1,80 m
const HALF_CROUCH = 0.2; // altura total agachado: 1,10 m
export const EYE_STAND = 1.65;
export const EYE_CROUCH = 0.92;
const SPEED_WALK = 5;
const SPEED_CROUCH = 2.3;
const GRAVITY = 22;

// Mueve a un jugador por el mundo respetando suelo, rocas y coberturas.
export class PlayerController {
  readonly body: RAPIER.RigidBody;
  readonly collider: RAPIER.Collider;
  private controller: RAPIER.KinematicCharacterController;
  private half = HALF_STAND;
  private vy = 0;
  private grounded = false;

  constructor(
    private rapier: typeof RAPIER,
    private physics: RAPIER.World,
    public state: PlayerState,
  ) {
    state.y = terrainHeight(state.x, state.z) + 0.05;
    this.body = physics.createRigidBody(
      rapier.RigidBodyDesc.kinematicPositionBased().setTranslation(state.x, state.y + this.half + RADIUS, state.z),
    );
    this.collider = physics.createCollider(rapier.ColliderDesc.capsule(this.half, RADIUS), this.body);
    this.controller = physics.createCharacterController(0.03);
    this.controller.enableAutostep(0.35, 0.2, true);
    this.controller.enableSnapToGround(0.4);
    this.controller.setMaxSlopeClimbAngle((55 * Math.PI) / 180);
    this.controller.setMinSlopeSlideAngle((65 * Math.PI) / 180);
  }

  /** ¿Hay sitio para ponerse de pie? (por si estás bajo algo) */
  private canStand(): boolean {
    const t = this.body.translation();
    const shape = new this.rapier.Capsule(HALF_STAND, RADIUS - 0.03);
    const pos = { x: t.x, y: t.y + (HALF_STAND - this.half) + 0.06, z: t.z };
    let blocked = false;
    this.physics.intersectionsWithShape(pos, { x: 0, y: 0, z: 0, w: 1 }, shape, (c) => {
      if (c.handle !== this.collider.handle) blocked = true;
      return !blocked;
    });
    return !blocked;
  }

  private setCrouch(crouch: boolean) {
    if (crouch === this.state.crouching) return;
    if (!crouch && !this.canStand()) return;
    const newHalf = crouch ? HALF_CROUCH : HALF_STAND;
    const t = this.body.translation();
    // Los pies se quedan donde están; cambia la altura del cuerpo.
    this.body.setTranslation({ x: t.x, y: t.y + (newHalf - this.half), z: t.z }, true);
    this.collider.setHalfHeight(newHalf);
    this.half = newHalf;
    this.state.crouching = crouch;
  }

  /** Coloca al jugador en un punto del mapa (para pruebas y, más adelante, reapariciones). */
  teleport(x: number, z: number) {
    const y = terrainHeight(x, z) + 0.05;
    this.body.setTranslation({ x, y: y + this.half + RADIUS, z }, true);
    this.state.x = x; this.state.y = y; this.state.z = z;
    this.vy = 0;
  }

  step(cmd: InputCommand, dt: number) {
    const s = this.state;
    s.yaw = cmd.yaw;
    s.pitch = cmd.pitch;
    this.setCrouch(cmd.crouch);

    // Dirección de movimiento según hacia dónde miras.
    let mx = cmd.moveX, mz = cmd.moveZ;
    const len = Math.hypot(mx, mz);
    if (len > 1) { mx /= len; mz /= len; }
    const speed = s.crouching ? SPEED_CROUCH : SPEED_WALK;
    const sin = Math.sin(s.yaw), cos = Math.cos(s.yaw);
    const vx = (mx * cos - mz * sin) * speed;
    const vz = (-mx * sin - mz * cos) * speed;

    this.vy = this.grounded ? -2 : this.vy - GRAVITY * dt;

    this.controller.computeColliderMovement(this.collider, { x: vx * dt, y: this.vy * dt, z: vz * dt });
    const m = this.controller.computedMovement();
    this.grounded = this.controller.computedGrounded();

    const t = this.body.translation();
    let nx = t.x + m.x, ny = t.y + m.y, nz = t.z + m.z;

    // Límite del mapa.
    const d = Math.hypot(nx, nz);
    if (d > PLAY_RADIUS) { nx *= PLAY_RADIUS / d; nz *= PLAY_RADIUS / d; }
    // Red de seguridad: nunca por debajo del suelo.
    const floor = terrainHeight(nx, nz) + this.half + RADIUS - 0.5;
    if (ny < floor) { ny = floor + 0.6; this.vy = 0; }

    this.body.setNextKinematicTranslation({ x: nx, y: ny, z: nz });
    s.x = nx;
    s.y = ny - this.half - RADIUS;
    s.z = nz;
  }
}
