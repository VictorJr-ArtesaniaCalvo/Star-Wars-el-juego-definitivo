import type RAPIER from '@dimforge/rapier3d-compat';
import type { InputCommand, PlayerState } from '../sim/types';
import { CANYON_HALF_L, CANYON_HALF_W, terrainHeight } from '../world/terrain';

const RADIUS = 0.35;
const HALF_STAND = 0.575; // altura total de pie: 1,85 m (la estatura del clon comando)
const HALF_CROUCH = 0.2; // altura total agachado: 1,10 m
export const EYE_STAND = 1.7; // ojos a 1,70 m (15 cm por debajo de lo alto del casco)
export const EYE_CROUCH = 0.92;
const SPEED_WALK = 6;
const SPEED_CROUCH = 2.6;
const JUMP_SPEED = 7.4; // salto de ~1,2 m: sirve para subirse a las cajas bajas
const GRAVITY = 22;

// Mueve a un jugador por el mundo respetando suelo, rocas y coberturas.
export class PlayerController {
  readonly body: RAPIER.RigidBody;
  readonly collider: RAPIER.Collider;
  private controller: RAPIER.KinematicCharacterController;
  private half = HALF_STAND;
  private vy = 0;
  private grounded = false;
  /** Se pone a true cuando acaba de saltar (el juego lo lee y lo apaga). */
  didJump = false;

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

    if (cmd.jump && this.grounded && !s.crouching) {
      this.vy = JUMP_SPEED;
      this.didJump = true;
    } else if (this.vy > 0 || !this.grounded) {
      this.vy -= GRAVITY * dt; // subiendo o cayendo
    } else {
      this.vy = -2; // en el suelo
    }

    // Mientras sube (salto) no se pega al suelo; al caer o andar, sí.
    if (this.vy > 0) this.controller.disableSnapToGround();
    else this.controller.enableSnapToGround(0.4);
    this.controller.computeColliderMovement(this.collider, { x: vx * dt, y: this.vy * dt, z: vz * dt });
    const m = this.controller.computedMovement();
    this.grounded = this.controller.computedGrounded();

    const t = this.body.translation();
    let nx = t.x + m.x, ny = t.y + m.y, nz = t.z + m.z;

    // Límite del mapa.
    nx = Math.max(-CANYON_HALF_W, Math.min(CANYON_HALF_W, nx));
    nz = Math.max(-CANYON_HALF_L, Math.min(CANYON_HALF_L, nz));
    // Red de seguridad: nunca por debajo del suelo.
    const floor = terrainHeight(nx, nz) + this.half + RADIUS - 0.5;
    if (ny < floor) { ny = floor + 0.6; this.vy = 0; }

    this.body.setNextKinematicTranslation({ x: nx, y: ny, z: nz });
    s.x = nx;
    s.y = ny - this.half - RADIUS;
    s.z = nz;
  }
}
