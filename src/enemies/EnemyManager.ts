import * as THREE from 'three';
import type RAPIER from '@dimforge/rapier3d-compat';
import type { GameState } from '../sim/types';
import type { Effects } from '../weapons/Effects';
import type { Obstacle } from '../world/rocks';
import { terrainHeight } from '../world/terrain';
import { Droid } from './Droid';
import type { BrainContext, BrainParams } from './DroidBrain';

export const MAX_DROIDS = 14; // tope de droides a la vez (cuida el rendimiento del móvil)
export const B1_HEALTH = 60;

export interface EnemyHooks {
  effects: Effects;
  player: BrainContext['player'];
  playerCollider: () => number;
  damagePlayer: BrainContext['damagePlayer'];
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
    };
    const controller = physics.createCharacterController(0.02);
    controller.enableAutostep(0.3, 0.1, false);
    controller.setSlideEnabled(true);
    this.spawnShape = new rapier.Capsule(0.6, 0.4);
    for (let i = 0; i < MAX_DROIDS; i++) {
      const st = { id: this.nextId++, kind: 'b1' as const, x: 0, y: 0, z: 0, yaw: 0, health: 0, alive: false, active: false };
      state.enemies.push(st);
      const d = new Droid(scene, rapier, physics, controller, st);
      this.droids.push(d);
      this.byCollider.set(d.collider.handle, d);
    }
  }

  get context() { return this.ctx; }

  /** Si ese cuerpo sólido pertenece a un droide, lo devuelve. */
  find(colliderHandle: number) {
    return this.byCollider.get(colliderHandle);
  }

  aliveCount() {
    let n = 0;
    for (const d of this.droids) if (d.state.alive) n++;
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

  /** Hace aparecer un droide en la zona enemiga. Devuelve null si ya hay el máximo. */
  spawn(params: BrainParams): Droid | null {
    const d = this.droids.find((x) => !x.state.active);
    if (!d) return null;
    let x = 0, z = -65;
    for (let i = 0; i < 12; i++) {
      // Un arco delante del jugador, lejos.
      const a = (Math.random() * 2 - 1) * 1.05;
      const r = 62 + Math.random() * 20;
      x = Math.sin(a) * r;
      z = -Math.cos(a) * r;
      if (this.free(x, z)) break;
    }
    d.activate(x, z, B1_HEALTH, params, this.ctx);
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
