import * as THREE from 'three';
import type RAPIER from '@dimforge/rapier3d-compat';
import { Builder } from './builder';
import { Atmosphere } from './atmosphere';
import { buildDroidWreck, WRECK_FIRES } from './wreck';
import { buildDefenseZone } from './defenseZone';
import { buildRocks } from './rocks';
import { buildSky, SUN_DIR } from './sky';
import { SkyLife } from './skyLife';
import { buildTerrain } from './terrain';
import { QUALITY, type Quality } from '../core/Settings';

// Monta todo el escenario: terreno, cielo, rocas y zona de defensa.
export class World {
  readonly sky: THREE.Mesh;
  private sun: THREE.DirectionalLight;
  private skyMat: THREE.ShaderMaterial;
  private atmosphere: Atmosphere;
  private skyLife: SkyLife;
  private time = 0;

  constructor(
    private scene: THREE.Scene,
    rapier: typeof RAPIER,
    physics: RAPIER.World,
    hooks: { skyFire?: (x: number, y: number, z: number) => void } = {},
  ) {
    buildTerrain(scene, rapier, physics);
    const { sky, sun, material } = buildSky(scene);
    this.sky = sky;
    this.sun = sun;
    this.skyMat = material;
    const b = new Builder(rapier, physics);
    buildRocks(b);
    buildDefenseZone(b);
    buildDroidWreck(b);
    b.finish(scene);
    this.atmosphere = new Atmosphere(scene, WRECK_FIRES);
    this.skyLife = new SkyLife(scene, hooks.skyFire);
  }

  setQuality(q: Quality) {
    const cfg = QUALITY[q];
    this.sun.castShadow = cfg.shadows;
    if (this.sun.shadow.mapSize.x !== cfg.shadowSize) {
      this.sun.shadow.mapSize.set(cfg.shadowSize, cfg.shadowSize);
      this.sun.shadow.map?.dispose();
      (this.sun.shadow as unknown as { map: unknown }).map = null;
    }
    (this.scene.fog as THREE.Fog).far = cfg.viewDistance;
  }

  /** Las nubes avanzan y los voladores giran. */
  tick(dt: number) {
    this.time += dt;
    this.skyMat.uniforms.time.value = this.time;
    this.atmosphere.tick(dt);
    this.skyLife.update(dt);
  }

  /** El cielo y la luz del sol acompañan al jugador. */
  follow(p: THREE.Vector3) {
    this.sky.position.copy(p);
    this.atmosphere.follow(p);
    this.sun.target.position.copy(p);
    this.sun.position.copy(p).addScaledVector(SUN_DIR, 80);
  }
}
