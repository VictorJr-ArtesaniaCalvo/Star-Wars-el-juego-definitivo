import * as THREE from 'three';
import type RAPIER from '@dimforge/rapier3d-compat';
import type { EnemyKind, EnemyState } from '../sim/types';
import { CANYON_HALF_L, CANYON_HALF_W, terrainHeight } from '../world/terrain';
import { createB1, poseB1, type B1Bones } from './B1Rig';
import { createB2, poseB2, type B2Bones } from './B2Rig';
import { createDroideka, poseDroideka, type DekaBones } from './DroidekaRig';
import { DroidBrain, type BrainContext, type BrainParams } from './DroidBrain';

const CORPSE_TIME = 2.2;

/** Cuerpo y resistencia de cada tipo de droide. */
export const KINDS: Record<EnemyKind, { height: number; radius: number; chest: number; health: number; shield: number }> = {
  b1: { height: 1.9, radius: 0.28, chest: 1.25, health: 60, shield: 0 },
  b2: { height: 2.35, radius: 0.42, chest: 1.8, health: 180, shield: 0 },
  droideka: { height: 1.8, radius: 0.5, chest: 1.1, health: 100, shield: 150 },
};
const DEKA_ANIM = 0.8; // segundos que tarda el droideka en desplegarse (y en plegarse)
const UNFOLD_TIME = 2.4; // segundos que tarda un B1 en desplegarse al aparecer
const SHIELD_REGEN_DELAY = 4; // segundos sin recibir disparos antes de que el escudo se regenere
const SHIELD_REGEN_RATE = 45; // puntos de escudo por segundo
const LIFT = 0.08; // el cuerpo sólido flota un poco sobre el suelo para no engancharse

// Un droide: aspecto, cuerpo sólido (recibe disparos) y cerebro. Se reutilizan siempre
// los mismos (reserva) para no cargar el móvil creando y destruyendo objetos.
export class Droid {
  readonly group: THREE.Mesh;
  readonly body: RAPIER.RigidBody;
  readonly collider: RAPIER.Collider;
  readonly brain = new DroidBrain();
  readonly kind: EnemyKind;
  /** true si el último disparo recibido lo absorbió el escudo (para la marca azul de la mira). */
  lastShielded = false;
  private mat = new THREE.MeshLambertMaterial({ vertexColors: true });
  private shieldMesh: THREE.Mesh | null = null;
  private shieldFlash = 0;
  private shieldDelay = 0;
  private roll = 0;
  private height: number;
  private rig: B1Bones | null = null;
  private dekaRig: DekaBones | null = null;
  private b2Rig: B2Bones | null = null;
  private deploy = 0; // 0 = rueda, 1 = desplegado
  private unfold = 1;
  private walkBlend = 0;
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
    this.kind = state.kind;
    const k = KINDS[this.kind];
    this.height = k.height;
    if (this.kind === 'b1') {
      const rig = createB1(this.mat);
      this.group = rig.mesh;
      this.rig = rig.bones;
    } else if (this.kind === 'droideka') {
      const r = createDroideka(this.mat);
      this.group = r.mesh;
      this.dekaRig = r.bones;
    } else {
      const r = createB2(this.mat);
      this.group = r.mesh;
      this.b2Rig = r.bones;
    }
    this.group.rotation.order = 'YXZ'; // primero el giro hacia donde mira y luego el balanceo o la rodadura
    this.group.castShadow = true;
    this.group.visible = false;
    scene.add(this.group);
    this.body = physics.createRigidBody(rapier.RigidBodyDesc.kinematicPositionBased());
    this.collider = physics.createCollider(rapier.ColliderDesc.capsule(Math.max(0.05, k.height / 2 - k.radius), k.radius), this.body);
    this.collider.setEnabled(false);
    if (this.kind === 'droideka') {
      // Escudo: una burbuja azul translúcida alrededor del droideka desplegado
      this.shieldMesh = new THREE.Mesh(
        new THREE.SphereGeometry(1.0, 14, 10),
        new THREE.MeshBasicMaterial({ color: 0x3aa8ff, transparent: true, opacity: 0.18, depthWrite: false, side: THREE.DoubleSide, fog: false }),
      );
      this.shieldMesh.position.y = 0.95;
      this.shieldMesh.visible = false;
      this.group.add(this.shieldMesh);
    }
  }

  /** Solo para pruebas: pone al B2 en un punto del paso. */
  poseB2Now(phase: number, walk: number) {
    if (this.b2Rig) poseB2(this.b2Rig, walk, phase);
  }

  /** Solo para pruebas: aplica la postura actual del droideka. */
  poseNow() {
    if (this.dekaRig) poseDroideka(this.dekaRig, this.deploy, this.roll, this.t);
  }

  /** Solo para pruebas: coloca al B1 en un punto del despliegue (0 = plegado, 1 = en combate). */
  posePreview(u: number, walk = 0, phase = 0) {
    if (this.rig) poseB1(this.rig, u, walk, phase);
  }

  /** Punto al que conviene apuntar (el pecho). */
  aimPoint(out: THREE.Vector3) {
    return out.set(this.state.x, this.state.y + KINDS[this.kind].chest, this.state.z);
  }

  private syncBody() {
    const s = this.state;
    this.body.setTranslation({ x: s.x, y: s.y + this.height / 2 + LIFT, z: s.z }, true);
  }

  activate(x: number, z: number, params: BrainParams, ctx: BrainContext) {
    const s = this.state;
    const k = KINDS[this.kind];
    s.x = x; s.z = z; s.y = terrainHeight(x, z);
    s.health = k.health;
    s.shield = k.shield;
    this.shieldFlash = 0;
    this.shieldDelay = 0;
    this.roll = 0;
    this.deploy = 0;
    this.roll = 0;
    if (this.dekaRig) poseDroideka(this.dekaRig, 0, 0);
    if (this.b2Rig) ctx.appear?.('b2', x, s.y + 1.2, z); // el B2 también suena a «cargar el arma» al aparecer
    if (this.rig) {
      // Los B1 aparecen agachados y plegados y se van desplegando (se ve desde lejos)
      this.unfold = 0;
      this.walkBlend = 0;
      poseB1(this.rig, 0);
      const T = ctx.player();
      const want = Math.atan2(-(T.x - x), -(T.z - z));
      this.brain.yaw = want;
      s.yaw = want;
      ctx.effects.smokePuff(x, s.y + 0.4, z);
      ctx.appear?.('b1', x, s.y + 1, z); // suena el «cargar el arma» al empezar a desplegarse
    }
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

  /**
   * Recibe daño. Devuelve true si este disparo lo destruye.
   * El escudo del droideka absorbe los disparos (salvo `bypassShield`, que usan las granadas);
   * rodando en forma de bola, el droideka recibe la mitad de daño.
   */
  hit(damage: number, ctx: BrainContext, bypassShield = false): boolean {
    const s = this.state;
    if (!s.alive) return false;
    this.lastShielded = false;
    if (this.kind === 'droideka') {
      if (!this.brain.deployed) damage *= 0.5;
      else if (s.shield > 0 && !bypassShield) {
        this.lastShielded = true;
        const absorbed = Math.min(s.shield, damage);
        s.shield -= absorbed;
        damage -= absorbed;
        this.shieldFlash = 1;
        this.shieldDelay = SHIELD_REGEN_DELAY;
        if (s.shield <= 0) ctx.effects.flash(this.aimPoint(new THREE.Vector3()), 0x66c8ff);
        if (damage <= 0) return false;
      }
    }
    s.health -= damage;
    this.flash = 1;
    if (s.health > 0) return false;
    s.alive = false;
    this.deadTime = 0;
    this.smokeT = 0.3;
    this.collider.setEnabled(false);
    this.brain.release(ctx);
    if (this.shieldMesh) this.shieldMesh.visible = false;
    const c = this.aimPoint(new THREE.Vector3());
    ctx.effects.deathBurst(c.x, c.y, c.z);
    ctx.died?.(this.kind, s.x, s.z);
    if (this.kind !== 'b1') ctx.effects.deathBurst(c.x, c.y + 0.2, c.z);
    return true;
  }

  update(dt: number, ctx: BrainContext) {
    const s = this.state;
    if (!s.active) return;
    this.flash = Math.max(0, this.flash - dt * 7);
    this.mat.emissive.setRGB(this.flash, this.flash * 0.8, this.flash * 0.6);
    if (this.shieldMesh) this.updateShield(dt);

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

    if (this.rig && this.unfold < 1) {
      // Despliegue: mientras tanto no se mueve ni dispara, mira hacia el jugador.
      this.unfold = Math.min(1, this.unfold + dt / UNFOLD_TIME);
      const T = ctx.player();
      const want = Math.atan2(-(T.x - s.x), -(T.z - s.z));
      this.brain.yaw = want;
      s.yaw = want;
      this.group.position.set(s.x, s.y, s.z);
      this.group.rotation.set(0, s.yaw, 0);
      poseB1(this.rig, this.unfold);
      return;
    }
    this.brain.think(dt, s.x, s.y, s.z, ctx, this.out);
    if (this.dekaRig) {
      // Se despliega al pararse y se pliega (la misma animación al revés) antes de volver a rodar.
      const open = !this.brain.moving;
      this.deploy = Math.min(1, Math.max(0, this.deploy + (open ? 1 : -1) * dt / DEKA_ANIM));
      if (this.brain.moving && this.deploy > 0.02) { this.out.dx = 0; this.out.dz = 0; } // plegando: aún no rueda
    }

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
      if (this.dekaRig) this.roll += Math.hypot(m.x, m.z) / 0.5; // la rueda gira al rodar
    }

    s.yaw = this.brain.yaw;
    this.group.position.set(s.x, s.y, s.z);
    this.group.rotation.y = s.yaw;
    if (this.rig) {
      // Detalle según la distancia: lejos se usa la versión simplificada
      const T = ctx.player();
      const lod = Math.hypot(T.x - s.x, T.z - s.z) > 42 ? 1 : 0;
      if (this.group.geometry !== this.rig.lods[lod]) this.group.geometry = this.rig.lods[lod];
      this.walkBlend += ((this.brain.moving ? 1 : 0) - this.walkBlend) * Math.min(1, dt * 8);
      poseB1(this.rig, 1, this.walkBlend, this.t);
      this.group.rotation.z = 0;
    } else if (this.b2Rig) {
      this.walkBlend += ((this.brain.moving ? 1 : 0) - this.walkBlend) * Math.min(1, dt * 6);
      poseB2(this.b2Rig, this.walkBlend, this.t * 0.8); // paso más lento que el del B1: es más grande
      this.group.rotation.z = 0;
    } else if (this.dekaRig) {
      poseDroideka(this.dekaRig, this.deploy, this.roll, this.t);
      this.group.rotation.z = 0;
    } else {
      // Balanceo al andar.
      this.group.rotation.z = this.brain.moving ? Math.sin(this.t) * 0.045 : 0;
    }
  }

  /** Escudo del droideka: visible desplegado, parpadea al recibir disparos y se regenera si lo dejan en paz. */
  private updateShield(dt: number) {
    const s = this.state;
    const mesh = this.shieldMesh!;
    this.shieldFlash = Math.max(0, this.shieldFlash - dt * 4);
    if (s.alive && this.shieldDelay > 0) this.shieldDelay -= dt;
    else if (s.alive && s.shield < KINDS.droideka.shield) s.shield = Math.min(KINDS.droideka.shield, s.shield + SHIELD_REGEN_RATE * dt);
    const on = s.alive && this.brain.deployed && s.shield > 0;
    mesh.visible = on;
    if (on) {
      const frac = s.shield / KINDS.droideka.shield;
      (mesh.material as THREE.MeshBasicMaterial).opacity = 0.12 + 0.1 * frac + this.shieldFlash * 0.28;
      mesh.scale.setScalar(1 + this.shieldFlash * 0.06);
    }
  }
}
