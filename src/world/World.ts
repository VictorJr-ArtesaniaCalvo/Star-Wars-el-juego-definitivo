import * as THREE from 'three';
import type RAPIER from '@dimforge/rapier3d-compat';
import { Builder } from './builder';
import { buildDefenseZone } from './defenseZone';
import { buildRocks } from './rocks';
import { buildSky, SUN_DIR } from './sky';
import { buildTerrain } from './terrain';
import { QUALITY, type Quality } from '../core/Settings';

// Monta todo el escenario: terreno, cielo, rocas y zona de defensa.
export class World {
  readonly sky: THREE.Mesh;
  private sun: THREE.DirectionalLight;

  constructor(
    private scene: THREE.Scene,
    rapier: typeof RAPIER,
    physics: RAPIER.World,
  ) {
    buildTerrain(scene, rapier, physics);
    const { sky, sun } = buildSky(scene);
    this.sky = sky;
    this.sun = sun;
    const b = new Builder(rapier, physics);
    buildRocks(b);
    buildDefenseZone(b);
    b.finish(scene);
  }

  setQuality(q: Quality) {
    const cfg = QUALITY[q];
    this.sun.castShadow = cfg.shadows;
    (this.scene.fog as THREE.Fog).far = cfg.viewDistance;
  }

  /** El cielo y la luz del sol acompañan al jugador. */
  follow(p: THREE.Vector3) {
    this.sky.position.copy(p);
    this.sun.target.position.copy(p);
    this.sun.position.copy(p).addScaledVector(SUN_DIR, 80);
  }
}
