import * as THREE from 'three';
import type RAPIER from '@dimforge/rapier3d-compat';
import { Builder } from './builder';
import { Atmosphere } from './atmosphere';
import { DesertAir } from './desertAir';
import type { DesertFog } from './desertFog';
import { GUNSHIP_FIRES, GUNSHIP_LIGHTS, CrashFx } from './crashFx';
import { laatReady } from './laat';
import { buildDefenseZone } from './defenseZone';
import { buildRocks } from './rocks';
import { buildCaveWorld } from './cave';
import { buildSky, SUN_DIR } from './sky';
import { cruiserSiteOn, setWorldBump, setWorldRich } from './materials';
import { SkyLife } from './skyLife';
import { buildTerrain, CRASH, paintRock, terrainHeight, wallDetailOn } from './terrain';
import { WallBlocks } from './wallBlocks';
import { Wreckage } from './wreckage';
import { buildCruiserSite, CruiserFx, CRUISER_FIRES } from './consular';
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
  private air: DesertAir;
  private skyLife: SkyLife;
  private crashFx: CrashFx | null = null;
  private scatter: Scatter;
  private ledges: Ledges;
  private wallBlocks: WallBlocks | null = null;
  private cruiserFx: CruiserFx | null = null;
  private landmarks: Landmarks;
  private time = 0;
  /** Lo que es del cañón (piezas dibujadas y cuerpos sólidos): se borra entero al pasar a la arena. Cielo y luces se quedan. */
  private canyonObjects: THREE.Object3D[] = [];
  private canyonColliders: number[] = [];
  private canyonBodies: number[] = [];
  /** ¿Sigue cargado el cañón? */
  canyon = true;

  constructor(
    scene: THREE.Scene,
    rapier: typeof RAPIER,
    physics: RAPIER.World,
    hooks: { skyFire?: (x: number, y: number, z: number) => void } = {},
  ) {
    const before = new Set(scene.children);
    const collidersBefore = new Set<number>(), bodiesBefore = new Set<number>();
    physics.forEachCollider((c) => { collidersBefore.add(c.handle); });
    physics.forEachRigidBody((b) => { bodiesBefore.add(b.handle); });
    const terrain = buildTerrain(scene, rapier, physics);
    buildScorch(scene); // marcas de quemado del accidente sobre el suelo
    const preSky = new Set(scene.children);
    const { sky, sun, fill, material } = buildSky(scene);
    const skyObjects = new Set(scene.children.filter((o) => !preSky.has(o)));
    this.fill = fill;
    this.sky = sky;
    this.sun = sun;
    this.skyMat = material;
    const b = new Builder(rapier, physics);
    buildRocks(b);
    buildDefenseZone(b);
    const cruiser = buildCruiserSite(scene, b); // crucero consular estrellado al fondo norte del valle (donde estaba la imitación de la Lucrehulk), con su surco, restos y rocas
    b.finish(scene);
    this.landmarks = new Landmarks(scene); // nave núcleo separatista al sur (solo para mirar)
    new Wreckage(scene, rapier, physics); // restos de la cañonera, chapas, muros de chapa y cajas de la República
    buildCaveWorld(scene, rapier, physics); // entrada de la cueva en la pared oeste (por ella huye el comando hacia la arena)
    buildContactDecals(scene, b.feet); // manchas de contacto bajo rocas, muros y cajas
    paintRock(terrain, b.spots); // el suelo se vuelve rocoso alrededor de las coberturas
    this.scatter = new Scatter(scene, b.spots); // lajas de piedra y piedrecitas (calidad media y alta)
    this.ledges = new Ledges(scene, rapier, physics); // repisas de roca en capas (calidad media y alta)
    if (wallDetailOn()) this.wallBlocks = new WallBlocks(scene); // bloques apilados y escombros en las paredes (calidad media y alta)
    this.atmosphere = new Atmosphere(scene, [...GUNSHIP_FIRES, ...CRUISER_FIRES], GUNSHIP_LIGHTS);
    this.skyLife = new SkyLife(scene, hooks.skyFire);
    // humo, columna de humo alta, brasas, chispas y llamas de la cañonera derribada (si falta el modelo, solo la columna desde el casco sencillo)
    this.crashFx = new CrashFx(scene, undefined, laatReady() ? undefined : { x: CRASH.x - 5, y: terrainHeight(CRASH.x - 5, CRASH.z) + 2.6, z: CRASH.z });
    if (cruiser) this.cruiserFx = new CruiserFx(scene); // humo negro, fuegos, chispas y polvo del crucero
    this.canyonObjects = scene.children.filter((o) => !before.has(o) && !skyObjects.has(o));
    physics.forEachCollider((c) => { if (!collidersBefore.has(c.handle)) this.canyonColliders.push(c.handle); });
    physics.forEachRigidBody((b) => { if (!bodiesBefore.has(b.handle)) this.canyonBodies.push(b.handle); });
    // polvo y viento del desierto: después de apuntar lo del cañón, porque sigue en la arena
    const desert = scene.fog as unknown as DesertFog;
    this.air = new DesertAir(scene, { desert, linear: new THREE.Fog(desert.color, desert.near, desert.far) });
  }

  /**
   * Borra el cañón entero (para pasar a la arena): quita del dibujo todas sus piezas, libera su memoria y quita sus cuerpos sólidos.
   * El cielo, el sol y las luces se quedan. Para volver al cañón se recarga el juego.
   */
  disposeCanyon(physics: RAPIER.World) {
    if (!this.canyon) return;
    this.canyon = false;
    for (const o of this.canyonObjects) {
      o.removeFromParent();
      o.traverse((c) => {
        const m = c as THREE.Mesh;
        m.geometry?.dispose();
        const mats = Array.isArray(m.material) ? m.material : m.material ? [m.material] : [];
        for (const mat of mats) mat.dispose(); // las texturas se comparten con la arena: no se borran
      });
    }
    this.canyonObjects = [];
    for (const h of this.canyonBodies) { const b = physics.getRigidBody(h); if (b) physics.removeRigidBody(b); }
    for (const h of this.canyonColliders) { const c = physics.getCollider(h); if (c) physics.removeCollider(c, false); }
    this.canyonBodies = [];
    this.canyonColliders = [];
    this.crashFx = null;
    this.cruiserFx = null;
    cruiserSiteOn.value = 0; // en la arena no hay crucero: la neblina vuelve a ser la de siempre
    this.wallBlocks = null;
  }

  /** Fuerza de la ráfaga de viento y arena (0 a 1), en el cañón y en la arena. */
  get gust() { return this.air.gust; }
  /** Si acaba de empezar una ráfaga, su fuerza (para el golpe de viento); si no, 0. */
  consumeGust() { return this.air.consumeGust(); }
  /** Si se acaba de programar la próxima ráfaga: su fuerza y dentro de cuántos segundos empieza. */
  consumeGustPlan() { return this.air.consumeGustPlan(); }

  setQuality(q: Quality) {
    const cfg = QUALITY[q];
    this.sun.castShadow = cfg.shadows;
    if (this.sun.shadow.mapSize.x !== cfg.shadowSize) {
      this.sun.shadow.mapSize.set(cfg.shadowSize, cfg.shadowSize);
      this.sun.shadow.map?.dispose();
      (this.sun.shadow as unknown as { map: unknown }).map = null;
    }
    this.air.setQuality(q, cfg.viewDistance); // niebla (la del desierto o, en Ultra, la de antes), polvo y ráfagas
    if (this.canyon) {
      this.crashFx?.setQuality(q);
      this.scatter.setQuality(q);
      this.ledges.setQuality(q);
      this.wallBlocks?.setQuality(q);
      this.cruiserFx?.setQuality(q);
      this.landmarks.setQuality(q);
    }
    setDroidMetal(q !== 'low'); // brillo metálico de los droides (en baja, mate)
    setWorldBump(q !== 'low');
    setWorldRich(q !== 'low'); // suelo de arena roja y roca en lajas (en baja se queda el de siempre) // el relieve de las texturas se apaga en calidad baja
  }

  /** Las nubes avanzan y los voladores giran. */
  tick(dt: number) {
    this.time += dt;
    this.skyMat.uniforms.time.value = this.time;
    this.air.tick(dt);
    if (!this.canyon) return;
    this.atmosphere.tick(dt);
    this.skyLife.update(dt);
    this.crashFx?.tick(dt);
    this.cruiserFx?.tick(dt);
    this.landmarks.update(dt);
  }

  /** El cielo y la luz del sol acompañan al jugador. */
  follow(p: THREE.Vector3) {
    this.sky.position.copy(p);
    this.air.follow(p);
    if (this.canyon) {
      this.atmosphere.follow(p);
      this.scatter.follow(p);
    }
    this.sun.target.position.copy(p);
    this.sun.position.copy(p).addScaledVector(SUN_DIR, 80);
    this.fill.target.position.copy(p);
    this.fill.position.set(p.x - SUN_DIR.x * 80, p.y + 18, p.z - SUN_DIR.z * 80); // desde el lado opuesto al sol, algo elevada
  }
}
