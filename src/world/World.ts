import * as THREE from 'three';
import type RAPIER from '@dimforge/rapier3d-compat';
import { Builder } from './builder';
import { Atmosphere } from './atmosphere';
import { buildDroidWreck, WRECK_FIRES, WRECK_LIGHTS } from './wreck';
import { GUNSHIP_FIRES, GUNSHIP_LIGHTS, CrashFx } from './crashFx';
import { laatReady } from './laat';
import { buildDefenseZone } from './defenseZone';
import { buildRocks } from './rocks';
import { buildSky, SUN_DIR } from './sky';
import { setWorldBump, setWorldRich } from './materials';
import { SkyLife } from './skyLife';
import { buildTerrain, CRASH, paintRock, terrainHeight, wallDetailOn } from './terrain';
import { WallBlocks } from './wallBlocks';
import { Wreckage } from './wreckage';
import { Landmarks } from './landmarks';
import { buildContactDecals } from './contact';
import { setDroidMetal } from '../enemies/droidWear';
import { buildScorch } from './scorch';
import { Ledges, Scatter } from './scatter';
import { QUALITY, type Quality } from '../core/Settings';

// Monta todo el escenario: terreno, cielo, rocas y zona de defensa.
export class World {
  readonly sky: THREE.Mesh;
  private sun: THREE.DirectionalLight;
  private fill: THREE.DirectionalLight;
  private skyMat: THREE.ShaderMaterial;
  private atmosphere: Atmosphere;
  private skyLife: SkyLife;
  private crashFx: CrashFx | null = null;
  private scatter: Scatter;
  private ledges: Ledges;
  private wallBlocks: WallBlocks | null = null;
  private landmarks: Landmarks;
  private time = 0;

  constructor(
    private scene: THREE.Scene,
    rapier: typeof RAPIER,
    physics: RAPIER.World,
    hooks: { skyFire?: (x: number, y: number, z: number) => void } = {},
  ) {
    const terrain = buildTerrain(scene, rapier, physics);
    buildScorch(scene); // marcas de quemado del accidente sobre el suelo
    const { sky, sun, fill, material } = buildSky(scene);
    this.fill = fill;
    this.sky = sky;
    this.sun = sun;
    this.skyMat = material;
    const b = new Builder(rapier, physics);
    buildRocks(b);
    buildDefenseZone(b);
    buildDroidWreck(b);
    b.finish(scene);
    this.landmarks = new Landmarks(scene); // castillo geonosiano al norte y nave núcleo separatista al sur (solo para mirar)
    new Wreckage(scene, rapier, physics); // restos de la cañonera, chapas, muros de chapa y cajas de la República
    buildContactDecals(scene, b.feet); // manchas de contacto bajo rocas, muros y cajas
    paintRock(terrain, b.spots); // el suelo se vuelve rocoso alrededor de las coberturas
    this.scatter = new Scatter(scene, b.spots); // lajas de piedra y piedrecitas (calidad media y alta)
    this.ledges = new Ledges(scene, rapier, physics); // repisas de roca en capas (calidad media y alta)
    if (wallDetailOn()) this.wallBlocks = new WallBlocks(scene); // bloques apilados y escombros en las paredes (calidad media y alta)
    this.atmosphere = new Atmosphere(scene, [...WRECK_FIRES, ...GUNSHIP_FIRES], [...WRECK_LIGHTS, ...GUNSHIP_LIGHTS]);
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
    (this.scene.fog as THREE.Fog).far = cfg.viewDistance;
    this.crashFx?.setQuality(q);
    this.scatter.setQuality(q);
    this.ledges.setQuality(q);
    this.wallBlocks?.setQuality(q);
    this.landmarks.setQuality(q);
    setDroidMetal(q !== 'low'); // brillo metálico de los droides (en baja, mate)
    setWorldBump(q !== 'low');
    setWorldRich(q !== 'low'); // suelo de arena roja y roca en lajas (en baja se queda el de siempre) // el relieve de las texturas se apaga en calidad baja
  }

  /** Las nubes avanzan y los voladores giran. */
  tick(dt: number) {
    this.time += dt;
    this.skyMat.uniforms.time.value = this.time;
    this.atmosphere.tick(dt);
    this.skyLife.update(dt);
    this.crashFx?.tick(dt);
    this.landmarks.update(dt);
  }

  /** El cielo y la luz del sol acompañan al jugador. */
  follow(p: THREE.Vector3) {
    this.sky.position.copy(p);
    this.atmosphere.follow(p);
    this.scatter.follow(p);
    this.sun.target.position.copy(p);
    this.sun.position.copy(p).addScaledVector(SUN_DIR, 80);
    this.fill.target.position.copy(p);
    this.fill.position.set(p.x - SUN_DIR.x * 80, p.y + 18, p.z - SUN_DIR.z * 80); // desde el lado opuesto al sol, algo elevada
  }
}
