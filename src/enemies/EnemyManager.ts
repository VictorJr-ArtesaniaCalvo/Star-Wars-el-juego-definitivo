import * as THREE from 'three';
import type RAPIER from '@dimforge/rapier3d-compat';
import type { GameState } from '../sim/types';
import { Droid } from './Droid';

const B1_HEALTH = 60;
// Puntos donde reaparece el droide de pruebas (a distintas distancias).
const TEST_SPOTS: Array<[number, number]> = [[0, -22], [-12, -30], [14, -26], [3, -42], [-8, -17], [10, -55]];

// Lleva la cuenta de todos los enemigos. En la Fase 3 aquí vivirán las oleadas.
export class EnemyManager {
  readonly droids: Droid[] = [];
  private byCollider = new Map<number, Droid>();
  private spot = 0;
  private nextId = 1;

  constructor(
    private scene: THREE.Scene,
    private rapier: typeof RAPIER,
    private physics: RAPIER.World,
    private state: GameState,
  ) {}

  spawnTestDroid() {
    const [x, z] = TEST_SPOTS[0];
    const st = { id: this.nextId++, kind: 'b1' as const, x, y: 0, z, yaw: 0, health: B1_HEALTH, alive: true };
    this.state.enemies.push(st);
    const d = new Droid(this.scene, this.rapier, this.physics, st);
    this.droids.push(d);
    this.byCollider.set(d.collider.handle, d);
  }

  /** Si ese cuerpo sólido pertenece a un droide, lo devuelve. */
  find(colliderHandle: number) {
    return this.byCollider.get(colliderHandle);
  }

  update(dt: number) {
    for (const d of this.droids) {
      const dead = d.update(dt);
      if (dead > 2.5) {
        this.spot = (this.spot + 1) % TEST_SPOTS.length;
        d.respawn(TEST_SPOTS[this.spot][0], TEST_SPOTS[this.spot][1], B1_HEALTH);
      }
    }
  }
}
