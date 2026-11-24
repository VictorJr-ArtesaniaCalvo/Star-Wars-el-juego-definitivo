import * as THREE from 'three';
import type RAPIER from '@dimforge/rapier3d-compat';
import type { EnemyKind, GameState } from '../sim/types';
import type { Effects } from '../weapons/Effects';
import type { Obstacle } from '../world/rocks';
import { terrainHeight } from '../world/terrain';
import { Droid, KINDS } from './Droid';
import type { BrainContext, BrainParams } from './DroidBrain';

// Reserva de droides de cada tipo (el total a la vez lo limitan las oleadas, para cuidar el móvil)
const POOL: Record<EnemyKind, number> = { b1: 14, b2: 5, droideka: 4 };

export interface EnemyHooks {
  effects: Effects;
  player: BrainContext['player'];
  playerCollider: () => number;
  damagePlayer: BrainContext['damagePlayer'];
  audio?: BrainContext['audio'];
  appear?: BrainContext['appear'];
  died?: BrainContext['died'];
}

// Lleva la cuenta de todos los droides y los crea desde una reserva.
export class EnemyManager {
  readonly droids: Droid[] = [];
  private byCollider = new Map<number, Droid>();
  private ctx: BrainContext;
  private nextId = 1;
  private spawnShape: RAPIER.Capsule;

  constructor(
    scene: THREE.Scene,
    rapier: typeof RAPIER,
    private physics: RAPIER.World,
    state: GameState,
    hooks: EnemyHooks,
  ) {
    this.ctx = {
      physics,
      rapier,
      effects: hooks.effects,
      player: hooks.player,
      playerCollider: hooks.playerCollider,
      isDroid: (h) => this.byCollider.has(h),
      damagePlayer: hooks.damagePlayer,
      claimed: new Set<Obstacle>(),
      rush: false,
      audio: hooks.audio,
      appear: hooks.appear,
      died: hooks.died,
    };
    const controller = physics.createCharacterController(0.02);
    controller.enableAutostep(0.3, 0.1, false);
    controller.setSlideEnabled(true);
    this.spawnShape = new rapier.Capsule(0.6, 0.4);
    for (const kind of Object.keys(POOL) as EnemyKind[]) {
      for (let i = 0; i < POOL[kind]; i++) {
        const st = { id: this.nextId++, kind, x: 0, y: 0, z: 0, yaw: 0, health: 0, shield: KINDS[kind].shield, alive: false, active: false };
        state.enemies.push(st);
        const d = new Droid(scene, rapier, physics, controller, st);
        this.droids.push(d);
        this.byCollider.set(d.collider.handle, d);
      }
    }
  }

  get context() { return this.ctx; }

  /** Si ese cuerpo sólido pertenece a un droide, lo devuelve. */
  find(colliderHandle: number) {
    return this.byCollider.get(colliderHandle);
  }

  aliveCount(kind?: EnemyKind) {
    let n = 0;
    for (const d of this.droids) if (d.state.alive && (!kind || d.kind === kind)) n++;
    return n;
  }

  /** ¿Hay sitio libre en ese punto (sin rocas ni muros)? */
  private free(x: number, z: number) {
    const y = terrainHeight(x, z) + 1.35;
    let blocked = false;
    this.physics.intersectionsWithShape({ x, y, z }, { x: 0, y: 0, z: 0, w: 1 }, this.spawnShape, () => {
      blocked = true;
      return false;
    });
    return !blocked;
  }

  /**
   * Hace aparecer un droide en uno de los dos extremos del cañón (`rear` = por detrás de ti).
   * Al principio aparecen más cerca (rondas 1–2: 35–55 m; 3–4: 45–70 m; desde la 5: 60–88 m).
   * Devuelve null si ya hay el máximo.
   */
  spawn(kind: EnemyKind, params: BrainParams, rear: boolean, round: number): Droid | null {
    const d = this.droids.find((x) => x.kind === kind && !x.state.active);
    if (!d) return null;
    const [zMin, zMax] = round <= 2 ? [35, 55] : round <= 4 ? [45, 70] : [60, 88];
    const T = this.ctx.player();
    let x = 0, z = rear ? zMin : -zMin;
    for (let i = 0; i < 24; i++) {
      // Repartidos a lo ancho del cañón; los últimos intentos prueban el otro extremo.
      const side = (i < 16 ? rear : !rear) ? 1 : -1;
      x = (Math.random() * 2 - 1) * 32;
      z = side * (zMin + Math.random() * (zMax - zMin));
      if (Math.hypot(x - T.x, z - T.z) < 28) continue; // nunca encima del jugador
      if (this.free(x, z)) break;
    }
    d.activate(x, z, params, this.ctx);
    return d;
  }

  /** Hace aparecer un droide en un punto concreto (para pruebas). */
  spawnAt(kind: EnemyKind, params: BrainParams, x: number, z: number): Droid | null {
    const d = this.droids.find((q) => q.kind === kind && !q.state.active);
    if (!d) return null;
    d.activate(x, z, params, this.ctx);
    return d;
  }

  clear() {
    for (const d of this.droids) if (d.state.active) d.deactivate(this.ctx);
    this.ctx.claimed.clear();
  }

  update(dt: number) {
    for (const d of this.droids) d.update(dt, this.ctx);
  }
}
