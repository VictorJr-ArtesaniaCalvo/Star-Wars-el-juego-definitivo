import * as THREE from 'three';
import type RAPIER from '@dimforge/rapier3d-compat';
import { GameEntity, ObstacleAvoidanceBehavior, SeekBehavior, Vector3 as YVec, Vehicle } from 'yuka';
import { OBSTACLES, type Obstacle } from '../world/rocks';
import { CANYON_HALF_L, CANYON_HALF_W, terrainHeight } from '../world/terrain';
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
  /** Cuando una ronda se alarga, los últimos droides atacan sin esperar. */
  rush: boolean;
  /** Aviso de que un droide ha disparado (para el sonido). */
  audio?: (sfx: 'b1' | 'b2' | 'droideka', x: number, y: number, z: number, dist: number) => void;
  /** Aviso de que ha aparecido un droide (para el sonido de «cargar el arma» de los B1). */
  /** Aviso de que un droide ha sido destruido (para soltar un kit médico). */
  died?: (kind: 'b1' | 'b2' | 'droideka', x: number, z: number) => void;
  appear?: (kind: 'b1' | 'b2' | 'droideka', x: number, y: number, z: number) => void;
}

/** Dificultad de un droide (cambia con la ronda). */
export interface BrainParams {
  speed: number; // m/s
  damage: number; // por impacto
  spread: number; // desvío máximo de cada disparo, en radianes
  cooldown: [number, number]; // pausa entre ráfagas (s)
  burst: [number, number]; // disparos por ráfaga
  interval?: number; // segundos entre disparos de una ráfaga (por defecto 0,22)
  coverTime?: [number, number]; // cuánto se queda parado en cada parada (por defecto 0,7–1,5 s)
  deployTime?: number; // solo droidekas: tiempo que tardan en desplegarse tras rodar
  sfx?: 'b1' | 'b2' | 'droideka'; // qué sonido tiene su disparo
  muzzleY?: number; // altura de la que salen los disparos (por defecto 1,2 m)
  muzzleFwd?: number; // cuánto por delante del cuerpo (por defecto 0,35 m)
  muzzleSide?: number; // desplazamiento lateral (+ = a su derecha; por defecto 0)
}

const HOLD_DIST = 14; // a esta distancia del jugador deja de avanzar y se queda disparando
const FIRE_RANGE = 110; // distancia máxima a la que abren fuego (a larga distancia casi siempre fallan)
const MAX_HOP = 26; // salto máximo entre coberturas (saltos cortos = paradas más frecuentes para disparar)
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
  /** Los droidekas solo disparan (y tienen escudo) desplegados; el resto siempre. */
  deployed = true;
  private deployT = 0;
  yaw = 0;

  private cover: Obstacle | null = null;
  private timer = 0;
  private stuck = 0;
  private lastX = 0;
  private lastZ = 0;
  private bad = new Set<Obstacle>(); // coberturas en las que ya se quedó atascado
  private holdDist = HOLD_DIST;
  private noLos = 0;
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
    this.holdDist = HOLD_DIST;
    this.noLos = 0;
    this.deployed = !params.deployTime;
    this.deployT = 0;
    this.bad.clear();
    this.choose(ctx);
  }

  /** Si se queda clavado contra una roca, rodea por un lado y no vuelve a elegir esa cobertura. */
  private unstick(x: number, z: number, ctx: BrainContext) {
    if (this.cover) this.bad.add(this.cover);
    this.release(ctx);
    const t = this.seek.target;
    let dx = t.x - x, dz = t.z - z;
    const l = Math.hypot(dx, dz) || 1;
    dx /= l; dz /= l;
    const s = Math.random() < 0.5 ? 1 : -1;
    const px = Math.max(-CANYON_HALF_W + 2, Math.min(CANYON_HALF_W - 2, x - dz * s * 9));
    const pz = Math.max(-CANYON_HALF_L + 2, Math.min(CANYON_HALF_L - 2, z + dx * s * 9));
    this.seek.target.set(px, 0, pz);
    this.vehicle.velocity.set(0, 0, 0);
    this.mode = 'advance';
    this.moving = true;
    this.timer = 4;
    this.stuck = 0;
  }

  /** ¿Se vería al jugador desde ese punto del suelo? */
  private losFrom(x: number, z: number, ctx: BrainContext, T: { x: number; y: number; z: number; crouching: boolean }) {
    const R = ctx.rapier;
    const oy = terrainHeight(x, z) + 1.4;
    const tx = T.x, ty = T.y + (T.crouching ? 0.6 : 1.2), tz = T.z;
    this.dir.set(tx - x, ty - oy, tz - z);
    const len = this.dir.length();
    if (len < 0.5) return true;
    this.dir.divideScalar(len);
    this.org.set(x, oy, z);
    const h = ctx.physics.castRay(new R.Ray(this.org, this.dir), len + 1, true, undefined, undefined, undefined, undefined, (c) => !ctx.isDroid(c.handle));
    return !!h && h.collider.handle === ctx.playerCollider();
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

    if (dT <= this.holdDist + 2) { this.startHold(ctx); return; }

    // Candidatas: las mejores coberturas (las que más acercan al jugador sin dar un salto largo).
    const cands: Array<{ o: Obstacle; score: number }> = [];
    for (const o of OBSTACLES) {
      if (o.radius < 0.9 || ctx.claimed.has(o) || this.bad.has(o)) continue;
      const dOT = Math.hypot(o.x - T.x, o.z - T.z);
      const progress = dT - dOT;
      if (progress < MIN_PROGRESS || dOT < HOLD_DIST) continue;
      const dPO = Math.hypot(o.x - P.x, o.z - P.z);
      if (dPO > MAX_HOP) continue;
      cands.push({ o, score: progress * 1.2 - dPO * 0.3 + Math.random() * 5 });
    }
    if (cands.length === 0) { this.startHold(ctx); return; }
    cands.sort((a, b) => b.score - a.score);

    // Se coloca AL LADO de la roca (no detrás), en un punto desde el que vea al jugador, para poder disparar.
    // Se prueban varias coberturas; si ninguna tiene un lado con vista al jugador, se esconde detrás de la mejor.
    let best = cands[0].o;
    let tx = 0, tz = 0, found = false;
    const off = (o: Obstacle) => o.radius + 1.9; // algo separado de la roca para no quedar dentro de su volumen
    for (const { o } of cands.slice(0, 14)) {
      const a0 = Math.atan2(o.z - T.z, o.x - T.x);
      const near = Math.hypot(o.x - T.x, o.z - T.z) <= FIRE_RANGE;
      let bestD = Infinity, fx = 0, fz = 0, ok = false;
      for (const a of [a0 + Math.PI / 2, a0 - Math.PI / 2, a0 + 0.9, a0 - 0.9, a0 + 2.2, a0 - 2.2, a0 + 1.5, a0 - 1.5]) {
        const px = o.x + Math.cos(a) * off(o), pz = o.z + Math.sin(a) * off(o);
        if (Math.abs(px) > CANYON_HALF_W - 1.5 || Math.abs(pz) > CANYON_HALF_L - 1.5) continue;
        if (near && !this.losFrom(px, pz, ctx, T)) continue;
        const d = Math.hypot(px - P.x, pz - P.z);
        if (d < bestD) { bestD = d; fx = px; fz = pz; ok = true; }
      }
      if (ok) { best = o; tx = fx; tz = fz; found = true; break; }
    }
    // Si ninguna cobertura tiene un lado con vista, prueba en terreno abierto: se asoma a disparar desde donde sí ve.
    let open = false;
    for (let i = 0; i < 10 && !found; i++) {
      const toT = Math.atan2(T.x - P.x, T.z - P.z) + (Math.random() * 2 - 1) * 1.1;
      const d = 8 + Math.random() * (MAX_HOP - 8);
      const px = P.x + Math.sin(toT) * d, pz = P.z + Math.cos(toT) * d;
      if (Math.abs(px) > CANYON_HALF_W - 2 || Math.abs(pz) > CANYON_HALF_L - 2) continue;
      if (dT - Math.hypot(px - T.x, pz - T.z) < MIN_PROGRESS || Math.hypot(px - T.x, pz - T.z) < HOLD_DIST) continue;
      if (this.losFrom(px, pz, ctx, T)) { tx = px; tz = pz; found = true; open = true; }
    }
    if (!found) {
      const a0 = Math.atan2(best.z - T.z, best.x - T.x);
      tx = best.x + Math.cos(a0) * off(best);
      tz = best.z + Math.sin(a0) * off(best);
    }
    if (open) this.cover = null;
    else { ctx.claimed.add(best); this.cover = best; }
    this.seek.target.set(tx, 0, tz);
    this.mode = 'advance';
    this.moving = true;
    // Tiempo para llegar: según la distancia, con margen para rodear rocas; si no llega, elige otra.
    this.timer = Math.hypot(tx - P.x, tz - P.z) / Math.max(1, this.params.speed) * 2 + 3;
    this.stuck = 0;
  }

  private startHold(ctx: BrainContext) {
    const T = ctx.player();
    const P = this.vehicle.position;
    // Busca un punto de combate desde el que vea al jugador; si no lo encuentra, se acerca más la próxima vez.
    const a0 = Math.atan2(P.x - T.x, P.z - T.z);
    let px = 0, pz = 0, found = false;
    for (let i = 0; i < 14 && !found; i++) {
      const spread = Math.min(Math.PI, 0.5 + i * 0.25);
      const a = a0 + rnd(-spread, spread);
      const d = this.holdDist + rnd(-1.5, 2.5);
      px = T.x + Math.sin(a) * d;
      pz = T.z + Math.cos(a) * d;
      if (Math.abs(px) > CANYON_HALF_W - 2 || Math.abs(pz) > CANYON_HALF_L - 2) continue;
      if (this.losFrom(px, pz, ctx, T)) found = true;
    }
    if (!found) this.holdDist = Math.max(7, this.holdDist - 2.5);
    this.seek.target.set(px, 0, pz);
    this.mode = 'hold';
    this.moving = true;
    this.timer = rnd(4, 7);
    this.noLos = 0;
    this.stuck = 0;
  }

  /** Pone al droide quieto, mirando al jugador y con retardo antes de empezar a disparar. */
  private stop() {
    this.moving = false;
    this.vehicle.velocity.set(0, 0, 0);
    this.aimDelay = rnd(0.2, 0.4);
    this.losTimer = 0;
    this.burstLeft = 0;
    this.cooldown = Math.min(this.cooldown, rnd(0.1, 0.4)); // dispara enseguida al llegar
    this.deployed = !this.params.deployTime;
    this.deployT = this.params.deployTime ?? 0;
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
    v.maxSpeed = this.params.speed * (ctx.rush ? 1.5 : 1);
    if (ctx.rush) this.holdDist = Math.min(this.holdDist, 8);

    // Atascado: si casi no avanza, elige otro destino.
    if (this.moving) {
      this.stuck += dt;
      if (this.stuck > 1.2) {
        const moved = Math.hypot(x - this.lastX, z - this.lastZ);
        if (moved < 0.8) this.unstick(x, z, ctx);
        this.stuck = 0; this.lastX = x; this.lastZ = z;
      }
    }

    if (this.moving) {
      this.timer -= dt;
      const t = this.seek.target;
      const arrived = Math.hypot(t.x - x, t.z - z) < 1.3;
      if (arrived || this.timer <= 0) {
        if (this.mode === 'advance' && (arrived || Math.hypot(t.x - x, t.z - z) < 4)) { this.mode = 'cover'; this.timer = ctx.rush ? 0.2 : rnd(this.params.coverTime?.[0] ?? 0.7, this.params.coverTime?.[1] ?? 1.5); this.stop(); }
        else if (this.mode === 'hold') { this.timer = rnd(4, 8); this.stop(); }
        else this.choose(ctx);
      } else {
        v.update(dt);
        out.dx = v.position.x - x;
        out.dz = v.position.z - z;
        const sp = Math.hypot(v.velocity.x, v.velocity.z);
        if (sp > 0.3) this.yaw = Math.atan2(-v.velocity.x, -v.velocity.z);
        if (this.params.deployTime) this.deployed = false; // rodando, cerrado
      }
    } else {
      // Quieto: gira hacia el jugador y dispara.
      const want = Math.atan2(-(T.x - x), -(T.z - z));
      let d = want - this.yaw;
      d = Math.atan2(Math.sin(d), Math.cos(d));
      this.yaw += Math.sign(d) * Math.min(Math.abs(d), dt * 5);
      if (!this.deployed) { this.deployT -= dt; if (this.deployT <= 0) this.deployed = true; }
      if (this.deployed) this.fire(dt, x, y, z, T, dT, ctx);

      this.timer -= dt;
      if (this.timer <= 0 && this.burstLeft === 0) this.choose(ctx);
      // Si el jugador se aleja mucho de una posición de combate, vuelve a avanzar.
      if (this.mode === 'hold' && dT > this.holdDist + 14) this.choose(ctx);
      // Si en posición de combate no ve al jugador, cambia de sitio (y se acerca más cada vez).
      if (this.mode === 'hold') {
        this.noLos = this.hasLos ? 0 : this.noLos + dt;
        if (this.noLos > 2.5 && this.burstLeft === 0) { this.holdDist = Math.max(7, this.holdDist - 2); this.choose(ctx); }
      }
    }
  }

  private fire(dt: number, x: number, y: number, z: number, T: { x: number; y: number; z: number; crouching: boolean }, dT: number, ctx: BrainContext) {
    if (dT > FIRE_RANGE) return;
    if (this.aimDelay > 0) { this.aimDelay -= dt; return; }
    const R = ctx.rapier;
    const playerHandle = ctx.playerCollider();
    const tx = T.x, ty = T.y + (T.crouching ? 0.6 : 1.2), tz = T.z;
    const mf = this.params.muzzleFwd ?? 0.35;
    const ms = this.params.muzzleSide ?? 0;
    this.org.set(x - Math.sin(this.yaw) * mf + Math.cos(this.yaw) * ms, y + (this.params.muzzleY ?? 1.2), z - Math.cos(this.yaw) * mf - Math.sin(this.yaw) * ms);

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
        this.shotTimer = this.params.interval ?? 0.22;
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
    ctx.effects.muzzle(this.org, 'enemy');
    ctx.audio?.(this.params.sfx ?? 'b1', this.org.x, this.org.y, this.org.z, dT);
    if (h) {
      if (h.collider.handle === ctx.playerCollider()) ctx.damagePlayer(this.params.damage, this.org.x, this.org.z);
      else { ctx.effects.flash(this.end, 0xffa060); ctx.effects.impact(this.end, this.dir, 'enemy'); }
    }
  }
}
