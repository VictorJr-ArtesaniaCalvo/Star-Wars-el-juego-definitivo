import * as THREE from 'three';
import type RAPIER from '@dimforge/rapier3d-compat';
import { Builder } from './builder';
import { Atmosphere } from './atmosphere';
import { buildDroidWreck, WRECK_FIRES } from './wreck';
import { GUNSHIP_FIRES, CrashFx } from './crashFx';
import { laatReady } from './laat';
import { buildDefenseZone } from './defenseZone';
import { buildRocks } from './rocks';
import { buildSky, SUN_DIR } from './sky';
import { setWorldBump } from './materials';
import { SkyLife } from './skyLife';
import { buildTerrain, CRASH, terrainHeight } from './terrain';
import { buildScorch } from './scorch';
import { QUALITY, type Quality } from '../core/Settings';

// Monta todo el escenario: terreno, cielo, rocas y zona de defensa.
export class World {
  readonly sky: THREE.Mesh;
  private sun: THREE.DirectionalLight;
  private skyMat: THREE.ShaderMaterial;
  private atmosphere: Atmosphere;
  private skyLife: SkyLife;
  private crashFx: CrashFx | null = null;
  private time = 0;
  private baseFar = 0;

  constructor(
    private scene: THREE.Scene,
    rapier: typeof RAPIER,
    physics: RAPIER.World,
    hooks: { skyFire?: (x: number, y: number, z: number) => void } = {},
  ) {
    buildTerrain(scene, rapier, physics);
    buildScorch(scene); // marcas de quemado del accidente sobre el suelo
    const { sky, sun, material } = buildSky(scene);
    this.sky = sky;
    this.sun = sun;
    this.skyMat = material;
    const b = new Builder(rapier, physics);
    buildRocks(b);
    buildDefenseZone(b);
    buildDroidWreck(b);
    b.finish(scene);
    this.atmosphere = new Atmosphere(scene, [...WRECK_FIRES, ...GUNSHIP_FIRES]);
    this.skyLife = new SkyLife(scene, hooks.skyFire);
    // humo, columna de humo alta, brasas, chispas y llamas de la cañonera derribada (si falta el modelo, solo la columna desde el casco sencillo)
    this.crashFx = new CrashFx(scene, undefined, laatReady() ? undefined : { x: CRASH.x - 5, y: terrainHeight(CRASH.x - 5, CRASH.z) + 2.6, z: CRASH.z });
  }

  /** Fuerza de la ráfaga de viento y arena (0 a 1). */
  get gust() { return this.atmosphere.gust; }

  setQuality(q: Quality) {
    const cfg = QUALITY[q];
    this.sun.castShadow = cfg.shadows;
    if (this.sun.shadow.mapSize.x !== cfg.shadowSize) {
      this.sun.shadow.mapSize.set(cfg.shadowSize, cfg.shadowSize);
      this.sun.shadow.map?.dispose();
      (this.sun.shadow as unknown as { map: unknown }).map = null;
    }
    (this.scene.fog as THREE.Fog).far = this.baseFar = cfg.viewDistance;
    this.atmosphere.gustDustOn = q !== 'low';
    this.crashFx?.setQuality(q);
    setWorldBump(q !== 'low'); // el relieve de las texturas se apaga en calidad baja
  }

  /** Las nubes avanzan y los voladores giran. */
  tick(dt: number) {
    this.time += dt;
    this.skyMat.uniforms.time.value = this.time;
    this.atmosphere.tick(dt);
    this.skyLife.update(dt);
    this.crashFx?.tick(dt);
    // en las ráfagas la niebla de arena se cierra un poco
    if (this.baseFar > 0) (this.scene.fog as THREE.Fog).far = this.baseFar * (1 - 0.3 * this.atmosphere.gust);
  }

  /** El cielo y la luz del sol acompañan al jugador. */
  follow(p: THREE.Vector3) {
    this.sky.position.copy(p);
    this.atmosphere.follow(p);
    this.sun.target.position.copy(p);
    this.sun.position.copy(p).addScaledVector(SUN_DIR, 80);
  }
}
