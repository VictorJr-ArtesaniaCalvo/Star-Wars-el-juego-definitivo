import * as THREE from 'three';
import type RAPIER from '@dimforge/rapier3d-compat';
import { GameEntity, ObstacleAvoidanceBehavior, SeekBehavior, Vector3 as YVec, Vehicle } from 'yuka';
import { OBSTACLES, type Obstacle } from '../world/rocks';
import type { Effects } from '../weapons/Effects';

// Todo lo que el cerebro de un droide necesita saber del mundo.
export interface BrainContext {
  physics: RAPIER.World;
  rapier: typeof RAPIER;
  effects: Effects;
  /** Posición del jugador (pies) y su postura. */
  player: () => { x: number; y: number; z: number; crouching: boolean };
  playerCollider: () => number;
  isDroid: (colliderHandle: number) => boolean;
  damagePlayer: (amount: number, fromX: number, fromZ: number) => void;
  claimed: Set<Obstacle>;
}

/** Dificultad de un droide (cambia con la ronda). */
export interface BrainParams {
  speed: number; // m/s
  damage: number; // por impacto
  spread: number; // desvío máximo de cada disparo, en radianes
  cooldown: [number, number]; // pausa entre ráfagas (s)
  burst: [number, number]; // disparos por ráfaga
}

const HOLD_DIST = 14; // a esta distancia del jugador deja de avanzar y se queda disparando
const FIRE_RANGE = 70;
const MAX_HOP = 38; // salto máximo entre coberturas
const MIN_PROGRESS = 5; // cada salto debe acercarle al menos esto

// Obstáculos para el esquive de Yuka (compartidos por todos los droides).
let yukaObstacles: GameEntity[] | null = null;
function getYukaObstacles() {
  if (yukaObstacles) return yukaObstacles;
  yukaObstacles = OBSTACLES.filter((o) => o.radius >= 0.7).map((o) => {
    const e = new GameEntity();
    e.position.set(o.x, 0, o.z);
    e.boundingRadius = o.radius + 0.25;
    return e;
  });
  return yukaObstacles;
}
export function resetYukaObstacles() { yukaObstacles = null; }

type Mode = 'advance' | 'cover' | 'hold';

const rnd = (a: number, b: number) => a + Math.random() * (b - a);

/**
 * Cerebro de un droide B1. Avanza de cobertura en cobertura (rocas, muros, restos),
 * se para a disparar desde cada una y, al llegar cerca, se queda disparando.
 * Yuka se encarga de moverlo y de esquivar obstáculos.
 */
export class DroidBrain {
  readonly vehicle = new Vehicle();
  private seek = new SeekBehavior(new YVec());
  private avoid = new ObstacleAvoidanceBehavior(getYukaObstacles());
  mode: Mode = 'advance';
  moving = true;
  yaw = 0;

  private cover: Obstacle | null = null;
  private timer = 0;
  private stuck = 0;
  private lastX = 0;
  private lastZ = 0;
  private aimDelay = 0;
  private losTimer = 0;
  private hasLos = false;
  private burstLeft = 0;
  private shotTimer = 0;
  private cooldown = 0;
  params!: BrainParams;

  private dir = new THREE.Vector3();
  private org = new THREE.Vector3();
  private end = new THREE.Vector3();
  private side = new THREE.Vector3();
  private up = new THREE.Vector3(0, 1, 0);

  constructor() {
    this.vehicle.boundingRadius = 0.45;
    this.vehicle.maxForce = 40;
    this.avoid.weight = 3;
    this.vehicle.steering.add(this.seek);
    this.vehicle.steering.add(this.avoid);
  }

  reset(x: number, z: number, params: BrainParams, ctx: BrainContext) {
    this.release(ctx);
    this.params = params;
    this.vehicle.maxSpeed = params.speed;
    this.vehicle.position.set(x, 0, z);
    this.vehicle.velocity.set(0, 0, 0);
    this.lastX = x;
    this.lastZ = z;
    this.mode = 'advance';
    this.moving = true;
    this.burstLeft = 0;
    this.cooldown = rnd(0.5, 2);
    this.hasLos = false;
    this.stuck = 0;
    this.choose(ctx);
  }

  release(ctx: BrainContext) {
    if (this.cover) ctx.claimed.delete(this.cover);
    this.cover = null;
  }

  /** Elige el siguiente destino: la mejor cobertura más cercana al jugador, o un punto de combate. */
  private choose(ctx: BrainContext) {
    const T = ctx.player();
    const P = this.vehicle.position;
    this.release(ctx);
    const dT = Math.hypot(P.x - T.x, P.z - T.z);

    if (dT <= HOLD_DIST + 2) { this.startHold(ctx); return; }

    let best: Obstacle | null = null, bestScore = -Infinity;
    for (const o of OBSTACLES) {
      if (o.radius < 0.9 || ctx.claimed.has(o)) continue;
      const dOT = Math.hypot(o.x - T.x, o.z - T.z);
      const progress = dT - dOT;
      if (progress < MIN_PROGRESS || dOT < HOLD_DIST) continue;
      const dPO = Math.hypot(o.x - P.x, o.z - P.z);
      if (dPO > MAX_HOP) continue;
      const score = progress - dPO * 0.4 + Math.random() * 7;
      if (score > bestScore) { bestScore = score; best = o; }
    }
    if (!best) { this.startHold(ctx); return; }

    ctx.claimed.add(best);
    this.cover = best;
    // Se coloca en el lado de la roca que queda lejos del jugador.
    const dx = best.x - T.x, dz = best.z - T.z, l = Math.hypot(dx, dz) || 1;
    const off = best.radius + 0.9;
    this.seek.target.set(best.x + (dx / l) * off, 0, best.z + (dz / l) * off);
    this.mode = 'advance';
    this.moving = true;
    this.timer = 9; // si en 9 s no llega, elige otra
    this.stuck = 0;
  }

  private startHold(ctx: BrainContext) {
    const T = ctx.player();
    const P = this.vehicle.position;
    const a = Math.atan2(P.x - T.x, P.z - T.z) + rnd(-0.5, 0.5);
    const d = HOLD_DIST + rnd(-2, 3);
    this.seek.target.set(T.x + Math.sin(a) * d, 0, T.z + Math.cos(a) * d);
    this.mode = 'hold';
    this.moving = true;
    this.timer = rnd(6, 10);
    this.stuck = 0;
  }

  /** Pone al droide quieto, mirando al jugador y con retardo antes de empezar a disparar. */
  private stop() {
    this.moving = false;
    this.vehicle.velocity.set(0, 0, 0);
    this.aimDelay = rnd(0.5, 1.0);
    this.losTimer = 0;
    this.burstLeft = 0;
  }

  /**
   * Piensa un paso. Devuelve el desplazamiento deseado (x,z) para este instante;
   * después, el cuerpo físico del droide lo ajusta contra las rocas.
   */
  think(dt: number, x: number, y: number, z: number, ctx: BrainContext, out: { dx: number; dz: number }) {
    const T = ctx.player();
    const v = this.vehicle;
    out.dx = out.dz = 0;
    v.position.set(x, 0, z);
    const dT = Math.hypot(T.x - x, T.z - z);

    // Atascado: si casi no avanza, elige otro destino.
    if (this.moving) {
      this.stuck += dt;
      if (this.stuck > 1.2) {
        const moved = Math.hypot(x - this.lastX, z - this.lastZ);
        if (moved < 0.5) this.choose(ctx);
        this.stuck = 0; this.lastX = x; this.lastZ = z;
      }
    }

    if (this.moving) {
      this.timer -= dt;
      const t = this.seek.target;
      const arrived = Math.hypot(t.x - x, t.z - z) < 1.3;
      if (arrived || this.timer <= 0) {
        if (this.mode === 'advance' && arrived) { this.mode = 'cover'; this.timer = rnd(2.2, 4.2); this.stop(); }
        else if (this.mode === 'hold') { this.timer = rnd(5, 9); this.stop(); }
        else this.choose(ctx);
      } else {
        v.update(dt);
        out.dx = v.position.x - x;
        out.dz = v.position.z - z;
        const sp = Math.hypot(v.velocity.x, v.velocity.z);
        if (sp > 0.3) this.yaw = Math.atan2(-v.velocity.x, -v.velocity.z);
      }
    } else {
      // Quieto: gira hacia el jugador y dispara.
      const want = Math.atan2(-(T.x - x), -(T.z - z));
      let d = want - this.yaw;
      d = Math.atan2(Math.sin(d), Math.cos(d));
      this.yaw += Math.sign(d) * Math.min(Math.abs(d), dt * 5);
      this.fire(dt, x, y, z, T, dT, ctx);

      this.timer -= dt;
      if (this.timer <= 0 && this.burstLeft === 0) this.choose(ctx);
      // Si el jugador se aleja mucho de una posición de combate, vuelve a avanzar.
      if (this.mode === 'hold' && dT > HOLD_DIST + 14) this.choose(ctx);
    }
  }

  private fire(dt: number, x: number, y: number, z: number, T: { x: number; y: number; z: number; crouching: boolean }, dT: number, ctx: BrainContext) {
    if (dT > FIRE_RANGE) return;
    if (this.aimDelay > 0) { this.aimDelay -= dt; return; }
    const R = ctx.rapier;
    const playerHandle = ctx.playerCollider();
    const tx = T.x, ty = T.y + (T.crouching ? 0.6 : 1.2), tz = T.z;
    this.org.set(x - Math.sin(this.yaw) * 0.35, y + 1.2, z - Math.cos(this.yaw) * 0.35);

    // ¿Veo al jugador? (se comprueba unas cuatro veces por segundo)
    this.losTimer -= dt;
    if (this.losTimer <= 0 && this.burstLeft === 0) {
      this.losTimer = 0.25;
      this.dir.set(tx - this.org.x, ty - this.org.y, tz - this.org.z);
      const len = this.dir.length();
      this.dir.divideScalar(len);
      const h = ctx.physics.castRay(new R.Ray(this.org, this.dir), len + 1, true, undefined, undefined, undefined, undefined, (c) => !ctx.isDroid(c.handle));
      this.hasLos = !!h && h.collider.handle === playerHandle;
    }

    if (this.burstLeft > 0) {
      this.shotTimer -= dt;
      if (this.shotTimer <= 0) {
        this.shotTimer = 0.22;
        this.burstLeft--;
        this.shoot(tx, ty, tz, dT, ctx);
        if (this.burstLeft === 0) this.cooldown = rnd(this.params.cooldown[0], this.params.cooldown[1]);
      }
    } else {
      this.cooldown -= dt;
      if (this.cooldown <= 0 && this.hasLos) {
        this.burstLeft = Math.round(rnd(this.params.burst[0], this.params.burst[1]));
        this.shotTimer = 0;
      }
    }
  }

  private shoot(tx: number, ty: number, tz: number, dT: number, ctx: BrainContext) {
    const R = ctx.rapier;
    this.dir.set(tx - this.org.x, ty - this.org.y, tz - this.org.z).normalize();
    // Desvío aleatorio: más a larga distancia.
    this.side.crossVectors(this.dir, this.up).normalize();
    const sp = this.params.spread * (0.5 + Math.min(1, dT / 60) * 0.7);
    const a = (Math.random() * 2 - 1) * sp, b = (Math.random() * 2 - 1) * sp;
    this.dir.addScaledVector(this.side, Math.tan(a));
    this.dir.y += Math.tan(b);
    this.dir.normalize();

    const h = ctx.physics.castRay(new R.Ray(this.org, this.dir), 90, true, undefined, undefined, undefined, undefined, (c) => !ctx.isDroid(c.handle));
    const d = h ? h.timeOfImpact : 80;
    this.end.copy(this.org).addScaledVector(this.dir, d);
    ctx.effects.enemyBolt(this.org, this.end);
    if (h) {
      if (h.collider.handle === ctx.playerCollider()) ctx.damagePlayer(this.params.damage, this.org.x, this.org.z);
      else ctx.effects.flash(this.end, 0xffa060);
    }
  }
}
