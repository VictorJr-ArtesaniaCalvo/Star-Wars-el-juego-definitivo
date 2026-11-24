import * as THREE from 'three';
import RAPIER from '@dimforge/rapier3d-compat';
import { loadB1Model } from '../enemies/B1Rig';
import { EnemyManager } from '../enemies/EnemyManager';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';
import { AudioEngine } from '../audio/AudioEngine';
import { InputManager } from '../input/InputManager';
import { EYE_CROUCH, EYE_STAND, PlayerController } from '../player/PlayerController';
import { TICK, type GameState, type InputCommand } from '../sim/types';
import { GameOver } from '../ui/GameOver';
import { Hud } from '../ui/Hud';
import { Menu } from '../ui/Menu';
import { b1Params, b2Params, droidekaParams, WaveManager } from '../waves/WaveManager';
import { SPAWN } from '../world/defenseZone';
import { terrainHeight } from '../world/terrain';
import { Blaster, BLASTER } from '../weapons/Blaster';
import { GRENADE, GrenadeSystem } from '../weapons/Grenade';
import { MEDKIT, MedkitSystem } from '../weapons/Medkits';
import { Effects } from '../weapons/Effects';
import { ViewModel } from '../weapons/ViewModel';
import { World } from '../world/World';
import { QUALITY, Settings } from './Settings';

type Mode = 'menu' | 'playing' | 'paused' | 'gameover';
// Apuntar: acerca la vista y afina la puntería; desde la cadera se mueve más rápido pero el disparo se abre.
const FOV_HIP = 72;
const FOV_ADS = 42;
const ADS_SENSITIVITY = 0.55; // sensibilidad de la mira al apuntar (multiplicador)
const ADS_MOVE = 0.7; // velocidad al apuntar (multiplicador)
const SPREAD_HIP = (1.6 * Math.PI) / 180; // desvío máximo de un disparo desde la cadera
const SPREAD_ADS = (0.12 * Math.PI) / 180;
const HEAL_BETWEEN_ROUNDS = 30;
const PITCH_LIMIT = (85 * Math.PI) / 180;
const ASSIST_CONE = (6 * Math.PI) / 180;
const wrap = (a: number) => Math.atan2(Math.sin(a), Math.cos(a));

export class Game {
  private settings = new Settings();
  private renderer: THREE.WebGLRenderer;
  private scene = new THREE.Scene();
  private camera = new THREE.PerspectiveCamera(72, 1, 0.08, 800);
  private physics!: RAPIER.World;
  private world!: World;
  private input: InputManager;
  private menu: Menu;
  private hud: Hud;
  private gameOver: GameOver;
  private waves!: WaveManager;
  private testMode = false;

  private state: GameState = { players: [], enemies: [], round: 0, kills: 0 };
  private enemies!: EnemyManager;
  private blaster = new Blaster();
  private effects!: Effects;
  private viewModel!: ViewModel;
  private adsToggled = false;
  private ads = false;
  private adsZoom = 0;
  private audio = new AudioEngine();
  private composer: EffectComposer | null = null;
  private prevLocked = false;
  private grenadeSys!: GrenadeSystem;
  private grenadeCd = 0;
  private weapon: 'blaster' | 'grenade' = 'blaster';
  private swapT = 0;
  private prevFire = false;
  private shake = 0;
  private medkits!: MedkitSystem;
  private jumpBuffer = 0;
  private shots = 0;
  private hits = 0;
  private localPlayer!: PlayerController;
  private wantCrouch = false;
  private yaw = 0;
  private pitch = 0;
  private eye = EYE_STAND;

  private mode: Mode = 'menu';
  private last = 0;
  private acc = 0;
  private v1 = new THREE.Vector3();
  private v2 = new THREE.Vector3();
  private v3 = new THREE.Vector3();
  private dirty = true; // hay que volver a dibujar aunque esté en pausa

  constructor(private canvas: HTMLCanvasElement) {
    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: false, powerPreference: 'high-performance' });
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap; // bordes suaves en las sombras (Alta y Ultra)
    this.camera.rotation.order = 'YXZ';

    this.input = new InputManager(canvas, document.getElementById('touch')!);
    this.menu = new Menu(this.settings, {
      onPlay: () => (this.mode === 'paused' ? this.resume() : this.startRun()),
      onQuit: () => this.quitToMenu(),
      onGoRound: (round) => this.jumpToRound(round),
    });
    this.hud = new Hud(() => this.pause());
    this.gameOver = new GameOver(() => this.startRun(), () => this.quitToMenu());

    this.settings.onChange(() => this.applySettings());
    window.addEventListener('resize', () => this.resize());
    window.addEventListener('orientationchange', () => setTimeout(() => this.resize(), 250));

    // Pausa automática al salir de la app o cambiar de pestaña.
    const auto = () => { if (document.hidden) this.pause(); };
    document.addEventListener('visibilitychange', auto);
    window.addEventListener('pagehide', () => this.pause());
    window.addEventListener('blur', () => this.pause());
    document.addEventListener('pointerlockchange', () => {
      if (!document.pointerLockElement && !this.input.hasTouch && !this.input.gamepadActive) this.pause();
    });
  }

  async init() {
    await RAPIER.init();
    await loadB1Model(`${import.meta.env.BASE_URL}models/b1.bin`);
    this.physics = new RAPIER.World({ x: 0, y: -9.81, z: 0 });
    this.physics.timestep = TICK;
    this.audio.init();
    this.world = new World(this.scene, RAPIER, this.physics, { skyFire: (x, y, z) => this.audio.distantBoom(x, y, z) });

    this.state.players.push({ id: 0, x: SPAWN.x, y: 0, z: SPAWN.z, yaw: 0, pitch: 0, crouching: false, health: 100, grenades: GRENADE.perGame });
    this.localPlayer = new PlayerController(RAPIER, this.physics, this.state.players[0]);
    this.effects = new Effects(this.scene);
    this.medkits = new MedkitSystem(this.scene);
    const pl = this.localPlayer;
    this.grenadeSys = new GrenadeSystem(this.scene, this.physics, pl.body, (at) => this.explodeGrenade(at), (at) => this.audio.grenadeBounce(at.x, at.y, at.z));
    this.enemies = new EnemyManager(this.scene, RAPIER, this.physics, this.state, {
      effects: this.effects,
      player: () => pl.state,
      playerCollider: () => pl.collider.handle,
      damagePlayer: (amount, fx, fz) => this.damagePlayer(amount, fx, fz),
      audio: (kind, x, y, z, dist) => this.audio.enemyShot(kind, x, y, z, dist),
      died: (kind, x, z) => { if (Math.random() < MEDKIT.chance[kind]) this.medkits.drop(x, z, MEDKIT.heal[kind]); },
      appear: (kind, x, y, z) => { if (kind === 'b1' || kind === 'b2') this.audio.droidAppear(x, y, z); },
    });
    this.waves = new WaveManager(this.enemies, {
      onBanner: (title, sub, sec) => this.hud.showBanner(title, sub, sec),
      onRoundCleared: () => {
        const p = this.state.players[0];
        p.health = Math.min(100, p.health + HEAL_BETWEEN_ROUNDS);
      },
    });
    this.scene.add(this.camera);
    this.viewModel = new ViewModel(this.camera);
    this.physics.step();

    this.applySettings();
    this.resize();
    this.menu.setHelp(
      this.input.hasTouch
        ? 'Izquierda: moverse · Derecha: deslizar para mirar · Puedes apuntar sin soltar el botón grande de disparo\nCon mando Bluetooth los botones táctiles se ocultan solos.\nPara pantalla completa: Compartir → «Añadir a pantalla de inicio».'
        : 'WASD moverse · Ratón mirar · Clic izq. disparar (cadera) · F disparar apuntando · Clic der./Q apuntar\nEspacio saltar · C agacharse · P pausa · Mando: RT disparar apuntando · RB cadera · LT apuntar · A saltar · B agacharse',
    );
    this.menu.ready();
    this.syncCamera(1);
    requestAnimationFrame((t) => this.frame(t));
  }

  private applySettings() {
    const q = QUALITY[this.settings.data.quality];
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, q.pixelRatio));
    this.world?.setQuality(this.settings.data.quality);
    this.audio.setVolume(this.settings.data.volume);
    // Ultra: se dibuja con resplandor (bloom) en las luces fuertes
    if (q.bloom && !this.composer) {
      const w = window.innerWidth, h = window.innerHeight;
      const c = new EffectComposer(this.renderer);
      c.addPass(new RenderPass(this.scene, this.camera));
      c.addPass(new UnrealBloomPass(new THREE.Vector2(w, h), 0.55, 0.6, 0.86));
      c.addPass(new OutputPass());
      this.composer = c;
    } else if (!q.bloom && this.composer) {
      this.composer.dispose();
      this.composer = null;
    }
    this.composer?.setPixelRatio(this.renderer.getPixelRatio());
    this.composer?.setSize(window.innerWidth, window.innerHeight);
    this.hud?.setFpsVisible(this.settings.data.showFps);
    this.dirty = true;
  }

  private resize() {
    const w = window.innerWidth, h = window.innerHeight;
    this.renderer.setSize(w, h, false);
    this.composer?.setSize(w, h);
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
    this.dirty = true;
  }

  /** Empieza una partida nueva desde cero (con las opciones del modo de pruebas, si las hay). */
  private startRun() {
    const s = this.settings.data;
    this.testMode = s.invincible || s.testRound > 1;
    this.enemies.clear();
    this.effects.clear();
    const p = this.state.players[0];
    p.health = 100;
    this.localPlayer.teleport(SPAWN.x, SPAWN.z);
    this.yaw = 0;
    this.pitch = 0;
    this.wantCrouch = false;
    this.blaster = new Blaster();
    this.state.kills = 0;
    p.grenades = GRENADE.perGame;
    this.grenadeSys.clear();
    this.grenadeCd = 0;
    this.shake = 0;
    this.weapon = 'blaster';
    this.swapT = 0;
    this.prevFire = false;
    this.hud.setWeapon('blaster');
    this.hud.setGrenades(p.grenades);
    this.adsToggled = false;
    this.ads = false;
    this.adsZoom = 0;
    this.camera.fov = FOV_HIP;
    this.camera.updateProjectionMatrix();
    this.jumpBuffer = 0;
    this.shots = 0;
    this.hits = 0;
    this.gameOver.hide();
    this.hud.setTestTag(this.testMode);
    this.hud.setHealth(p.health);
    this.waves.start(s.testRound);
    this.resume();
  }

  /** Desde la pausa: salta directamente a otra ronda (vida y granadas al máximo). Cuenta como partida de pruebas. */
  private jumpToRound(round: number) {
    if (this.mode !== 'paused') return;
    this.testMode = true;
    this.enemies.clear();
    this.effects.clear();
    this.grenadeSys.clear();
    const p = this.state.players[0];
    p.health = 100;
    p.grenades = GRENADE.perGame;
    this.weapon = 'blaster';
    this.swapT = 0;
    this.grenadeCd = 0;
    this.hud.setWeapon('blaster');
    this.hud.setHealth(p.health);
    this.hud.setGrenades(p.grenades);
    this.hud.setTestTag(true);
    this.waves.start(round);
    this.resume();
  }

  private quitToMenu() {
    this.waves.stop();
    this.enemies.clear();
    this.effects.clear();
    this.grenadeSys.clear();
    this.medkits.clear();
    this.hud.hideBanner();
    this.hud.setVisible(false, false);
    this.gameOver.hide();
    this.mode = 'menu';
    this.menu.show(false);
    this.dirty = true;
  }

  private endRun() {
    this.mode = 'gameover';
    this.waves.stop();
    this.input.touch?.reset();
    if (document.pointerLockElement) document.exitPointerLock();
    this.hud.setVisible(false, false);
    const round = this.waves.round;
    const record = !this.testMode && round > this.settings.data.best;
    if (record) this.settings.set({ best: round });
    this.gameOver.show(round, this.state.kills, this.settings.data.best, record, this.testMode);
  }

  /** Dirección y distancia de cada droide vivo (para las marcas rojas de la brújula). */
  private compassMarkers() {
    const p = this.localPlayer.state;
    const out: Array<{ bearing: number; dist: number; kind: string }> = [];
    for (const k of this.medkits.list()) {
      const dx = k.x - p.x, dz = k.z - p.z, dist = Math.hypot(dx, dz);
      if (dist > 140) continue;
      out.push({ bearing: (((-Math.atan2(-dx, -dz) * 180) / Math.PI) % 360 + 360) % 360, dist: Math.min(dist, 60), kind: 'medkit' });
    }
    for (const d of this.enemies.droids) {
      if (!d.state.alive) continue;
      const dx = d.state.x - p.x, dz = d.state.z - p.z;
      const dist = Math.hypot(dx, dz);
      if (dist > 140) continue;
      const bearing = (((-Math.atan2(-dx, -dz) * 180) / Math.PI) % 360 + 360) % 360;
      out.push({ bearing, dist, kind: d.kind });
    }
    return out;
  }

  /** Saca la granada (o la guarda y vuelve al bláster si ya la llevas). */
  private toggleGrenade() {
    if (this.mode !== 'playing') return;
    if (this.weapon === 'grenade') { this.setWeapon('blaster'); return; }
    if (this.state.players[0].grenades > 0 && this.grenadeCd <= 0) this.setWeapon('grenade');
  }

  private setWeapon(w: 'blaster' | 'grenade') {
    this.weapon = w;
    this.swapT = 0.3;
    this.hud.setWeapon(w);
  }

  /** Lanza la granada que llevas en la mano hacia donde miras y vuelve al bláster. */
  private throwGrenade() {
    const p = this.state.players[0];
    if (this.mode !== 'playing' || p.grenades <= 0 || this.grenadeCd > 0) return;
    p.grenades--;
    this.grenadeCd = GRENADE.cooldown;
    this.hud.setGrenades(p.grenades);
    const eye = this.eyePos(this.v1);
    const cp = Math.cos(this.pitch);
    const dir = this.v2.set(-Math.sin(this.yaw) * cp, Math.sin(this.pitch), -Math.cos(this.yaw) * cp);
    this.grenadeSys.throwFrom(eye, dir);
    this.audio.grenadeThrow();
    this.viewModel.throwAnim();
    this.setWeapon('blaster');
    this.swapT = 0.45; // el bláster tarda un poco en volver a estar listo
  }

  /** Explosión de área: daño a los droides (y a ti si estás cerca), menos si hay rocas o muros por medio. */
  private explodeGrenade(at: THREE.Vector3) {
    const R = GRENADE.radius;
    const origin = new THREE.Vector3(at.x, at.y + 0.25, at.z);
    // Solo cuentan las rocas y el terreno como pantalla (los droides no tapan la onda).
    const covered = (to: THREE.Vector3, dist: number) => {
      const dir = to.clone().sub(origin).normalize();
      const hit = this.physics.castRay(new RAPIER.Ray(origin, dir), dist, true, undefined, undefined, undefined, this.localPlayer.body, (c) => !this.enemies.find(c.handle));
      return !!hit && hit.timeOfImpact < dist - 0.35;
    };
    const falloff = (d: number) => Math.max(0, 1 - d / R);

    for (const d of this.enemies.droids) {
      if (!d.state.alive) continue;
      const chest = d.aimPoint(new THREE.Vector3());
      const dist = chest.distanceTo(origin);
      if (dist >= R) continue;
      let dmg = GRENADE.maxDamage * falloff(dist);
      if (dist > 1 && covered(chest, dist)) dmg *= 0.4;
      if (dmg < 1) continue;
      const killed = d.hit(dmg, this.enemies.context, true); // las granadas atraviesan el escudo
      this.hud.hit(killed);
      if (killed) this.registerKill();
    }

    const p = this.localPlayer.state;
    const body = new THREE.Vector3(p.x, p.y + (p.crouching ? 0.6 : 1.2), p.z);
    const dp = body.distanceTo(origin);
    if (dp < R) {
      let dmg = GRENADE.selfDamage * falloff(dp);
      if (dp > 1 && covered(body, dp)) dmg *= 0.4;
      if (dmg >= 1) this.damagePlayer(dmg, at.x, at.z);
    }
    this.shake = Math.max(this.shake, Math.min(1, 1.2 - dp / 28));
    this.effects.explosion(at.x, at.y, at.z, R);
    this.audio.explosion(at.x, at.y, at.z);
  }

  /** Una baja más. */
  private registerKill() {
    this.state.kills++;
  }

  /** El jugador recibe un disparo. `fx, fz` = de dónde viene. */
  private damagePlayer(amount: number, fx: number, fz: number) {
    if (this.mode !== 'playing') return;
    const p = this.state.players[0];
    // Dirección de donde viene el disparo, respecto a hacia dónde mira el jugador.
    const dx = fx - p.x, dz = fz - p.z;
    const fwd = dx * -Math.sin(this.yaw) + dz * -Math.cos(this.yaw);
    const right = dx * Math.cos(this.yaw) + dz * -Math.sin(this.yaw);
    this.hud.damaged(amount, (Math.atan2(right, fwd) * 180) / Math.PI);
    if (this.settings.data.invincible) return;
    p.health = Math.max(0, p.health - amount);
    if (p.health <= 0) this.endRun();
  }

  private resume() {
    if (this.mode === 'playing') return;
    this.mode = 'playing';
    this.audio.start(); // tras un toque del jugador: iOS no deja sonar antes
    this.menu.hide();
    this.hud.setVisible(true, this.input.hasTouch);
    this.acc = 0;
    if (!this.input.hasTouch) this.canvas.requestPointerLock?.();
  }

  private pause() {
    if (this.mode !== 'playing') return;
    this.mode = 'paused';
    this.audio.suspend();
    this.input.touch?.reset();
    if (document.pointerLockElement) document.exitPointerLock();
    this.hud.setVisible(false, false);
    this.menu.show(true);
  }

  private frame(t: number) {
    requestAnimationFrame((n) => this.frame(n));
    const dt = Math.min(0.1, (t - this.last) / 1000 || 0);
    this.last = t;

    const inp = this.input.poll(dt, this.settings.data.sensitivity);
    if (inp.pausePressed) {
      if (this.mode === 'playing') this.pause();
      else if (this.mode === 'paused' && this.input.gamepadActive) this.resume();
    }

    if (this.mode === 'playing') {
      // Apuntar: el botón alterna; el disparo principal apunta mientras se mantiene; mando/ratón: mantener.
      if (inp.aimToggled) this.adsToggled = !this.adsToggled;
      // Con la granada en la mano no se apunta con zoom ni se dispara el bláster.
      const ready = this.swapT <= 0;
      this.ads = this.weapon === 'blaster' && (this.adsToggled || inp.aimHeld || (inp.fire && ready));
      this.adsZoom += ((this.ads ? 1 : 0) - this.adsZoom) * Math.min(1, dt * 14);
      if (Math.abs(this.adsZoom - (this.ads ? 1 : 0)) < 0.002) this.adsZoom = this.ads ? 1 : 0;
      const fov = FOV_HIP + (FOV_ADS - FOV_HIP) * this.adsZoom;
      if (Math.abs(this.camera.fov - fov) > 0.01) { this.camera.fov = fov; this.camera.updateProjectionMatrix(); }
      const lookK = 1 + (ADS_SENSITIVITY - 1) * this.adsZoom;
      inp.yaw *= lookK;
      inp.pitch *= lookK;
      const moveK = 1 + (ADS_MOVE - 1) * this.adsZoom;

      if (inp.touchAim && this.settings.data.aimAssist) this.aimAssist(inp, dt);
      this.yaw -= inp.yaw;
      this.pitch = Math.max(-PITCH_LIMIT, Math.min(PITCH_LIMIT, this.pitch - inp.pitch));
      if (inp.crouchPressed) this.wantCrouch = !this.wantCrouch;
      if (inp.grenadePressed) this.toggleGrenade();
      this.swapT = Math.max(0, this.swapT - dt);
      const fireNow = inp.fire || inp.fireHip;
      // Con la granada en la mano, cada pulsación de disparo la lanza (y vuelve el bláster).
      if (this.weapon === 'grenade' && this.swapT <= 0 && fireNow && !this.prevFire) this.throwGrenade();
      this.prevFire = fireNow;
      this.grenadeCd = Math.max(0, this.grenadeCd - dt);
      this.shake = Math.max(0, this.shake - dt * 2.6);
      // Saltar: si estás agachado, primero te levantas.
      if (inp.jumpPressed) { if (this.wantCrouch) this.wantCrouch = false; else this.jumpBuffer = 0.14; }
      this.jumpBuffer = Math.max(0, this.jumpBuffer - dt);

      const cmd: InputCommand = { moveX: inp.moveX * moveK, moveZ: inp.moveZ * moveK, yaw: this.yaw, pitch: this.pitch, crouch: this.wantCrouch, jump: this.jumpBuffer > 0, fire: fireNow && this.weapon === 'blaster' && this.swapT <= 0 };
      this.acc += dt;
      let steps = 0;
      while (this.acc >= TICK && steps < 5) {
        this.localPlayer.step(cmd, TICK);
        if (this.localPlayer.didJump) { this.localPlayer.didJump = false; this.jumpBuffer = 0; cmd.jump = false; }
        this.enemies.update(TICK);
        this.medkits.update(TICK, this.localPlayer.state.x, this.localPlayer.state.y, this.localPlayer.state.z, true, (heal) => {
          const pl = this.state.players[0];
          pl.health = Math.min(100, pl.health + heal);
          this.hud.healPop(`+${heal} VIDA`);
          this.audio.pickup();
        });
        this.grenadeSys.update(TICK);
        this.physics.step();
        if (this.blaster.update(TICK, cmd.fire)) this.shoot();
        if (this.blaster.locked !== this.prevLocked) {
          this.prevLocked = this.blaster.locked;
          if (this.blaster.locked) this.audio.overheat(); else this.audio.ready();
        }
        this.waves.update(TICK);
        if (this.mode !== 'playing') break; // la partida acaba en mitad del paso
        this.acc -= TICK;
        steps++;
      }
      if (steps === 5) this.acc = 0;
      // Si no había sitio para levantarse, el botón refleja la postura real.
      if (steps > 0) this.wantCrouch = this.localPlayer.state.crouching;

      this.hud.setAds(this.adsToggled, this.ads);
      this.hud.setCrouching(this.localPlayer.state.crouching);
      this.hud.setHeat(this.blaster.heat, this.blaster.locked);
      this.hud.setHealth(this.state.players[0].health);
      this.hud.setHeading(this.yaw, this.compassMarkers());
      this.hud.setRound(this.waves.round, this.waves.remaining);
      this.state.round = this.waves.round;
      this.hud.update(dt);
      this.syncCamera(dt);
      this.audio.listener(this.camera.position.x, this.camera.position.y, this.camera.position.z, this.yaw, this.pitch);
      this.effects.update(dt);
      this.world.tick(dt);
      this.viewModel.update(dt, this.blaster.heat, this.adsZoom, this.weapon);
      this.dirty = true;
    }

    if (this.dirty) {
      if (this.composer) this.composer.render(); else this.renderer.render(this.scene, this.camera);
      this.dirty = false;
    }
  }

  private syncCamera(dt: number) {
    const p = this.localPlayer.state;
    const target = p.crouching ? EYE_CROUCH : EYE_STAND;
    this.eye += (target - this.eye) * Math.min(1, dt * 12);
    this.camera.position.set(p.x, p.y + this.eye, p.z);
    if (this.shake > 0.001) {
      const k = this.shake * this.shake * 0.35;
      this.camera.position.x += (Math.random() - 0.5) * k;
      this.camera.position.y += (Math.random() - 0.5) * k;
      this.camera.position.z += (Math.random() - 0.5) * k;
    }
    this.camera.rotation.set(this.pitch, this.yaw, 0);
    this.world.follow(this.camera.position);
  }

  private eyePos(out: THREE.Vector3) {
    const p = this.localPlayer.state;
    return out.set(p.x, p.y + (p.crouching ? EYE_CROUCH : EYE_STAND), p.z);
  }

  /** Dispara un rayo en línea recta desde los ojos hacia donde se mira. */
  private shoot() {
    const eye = this.eyePos(this.v1);
    const dir = this.aimDirection(this.v2);
    const hit = this.physics.castRay(new RAPIER.Ray(eye, dir), BLASTER.range, true, undefined, undefined, undefined, this.localPlayer.body);
    const dist = hit ? hit.timeOfImpact : BLASTER.range;
    const end = this.v3.copy(eye).addScaledVector(dir, dist);

    this.shots++;
    if (hit) {
      this.effects.flash(end);
      const droid = this.enemies.find(hit.collider.handle);
      if (droid) {
        const killed = droid.hit(BLASTER.damage, this.enemies.context);
        this.hits++;
        if (killed) this.registerKill();
        this.hud.hit(killed, droid.lastShielded);
      }
    }
    this.camera.updateMatrixWorld();
    this.effects.bolt(this.viewModel.muzzle.getWorldPosition(this.v1), end);
    this.viewModel.shot();
    this.audio.playerShot();
  }

  /** Hacia dónde sale el disparo: donde miras, con un pequeño desvío al azar si disparas desde la cadera. */
  private aimDirection(out: THREE.Vector3) {
    const cp = Math.cos(this.pitch);
    out.set(-Math.sin(this.yaw) * cp, Math.sin(this.pitch), -Math.cos(this.yaw) * cp);
    const spread = this.ads ? SPREAD_ADS : SPREAD_HIP;
    const r = spread * Math.sqrt(Math.random());
    const a = Math.random() * Math.PI * 2;
    // vectores "derecha" y "arriba" respecto a la mirada
    const rx = Math.cos(this.yaw), rz = -Math.sin(this.yaw);
    const ux = -Math.sin(this.pitch) * -Math.sin(this.yaw), uy = cp, uz = -Math.sin(this.pitch) * -Math.cos(this.yaw);
    const k1 = Math.tan(r) * Math.cos(a), k2 = Math.tan(r) * Math.sin(a);
    out.x += rx * k1 + ux * k2;
    out.y += uy * k2;
    out.z += rz * k1 + uz * k2;
    return out.normalize();
  }

  /**
   * Ayuda ligera al apuntar (solo táctil): cerca de un enemigo visible la mira se mueve
   * más despacio y se acerca un poco a él.
   */
  private aimAssist(inp: { yaw: number; pitch: number }, dt: number) {
    const eye = this.eyePos(this.v1);
    let best = ASSIST_CONE, bestYaw = 0, bestPitch = 0;
    for (const d of this.enemies.droids) {
      if (!d.state.alive) continue;
      const to = d.aimPoint(this.v2).sub(eye);
      const dist = to.length();
      if (dist > 90) continue;
      const yawErr = wrap(Math.atan2(-to.x, -to.z) - this.yaw);
      const pitchErr = Math.asin(to.y / dist) - this.pitch;
      const ang = Math.hypot(yawErr, pitchErr);
      if (ang >= best) continue;
      // ¿Hay algo en medio?
      const hit = this.physics.castRay(new RAPIER.Ray(eye, to.divideScalar(dist)), dist, true, undefined, undefined, undefined, this.localPlayer.body);
      if (hit && hit.collider.handle !== d.collider.handle) continue;
      best = ang; bestYaw = yawErr; bestPitch = pitchErr;
    }
    if (best >= ASSIST_CONE) return;
    inp.yaw *= 0.6;
    inp.pitch *= 0.6;
    const pull = Math.min(1, dt * 2.2);
    inp.yaw -= bestYaw * pull;
    inp.pitch -= bestPitch * pull;
  }

  /** Solo para pruebas: coloca la cámara en un punto cualquiera y dibuja una imagen. */
  debugShot(x: number, y: number, z: number, yaw: number, pitch: number) {
    this.camera.position.set(x, y, z);
    this.camera.rotation.set(pitch, yaw, 0);
    this.world.follow(this.camera.position);
    this.renderer.render(this.scene, this.camera);
  }

  /** Solo para pruebas: mueve al jugador y fija hacia dónde mira. */
  debugPlace(x: number | null, z: number | null, yaw: number, pitch: number) {
    if (x !== null && z !== null) this.localPlayer.teleport(x, z);
    this.yaw = yaw;
    this.pitch = pitch;
  }

  /** Solo para pruebas: hace daño al jugador desde un punto del mapa. */
  debugHurt(amount: number, fx = 0, fz = -20) {
    this.damagePlayer(amount, fx, fz);
  }

  /** Solo para pruebas: altura del terreno en un punto. */
  debugHeight(x: number, z: number) {
    return terrainHeight(x, z);
  }

  /** Solo para pruebas: dibuja el mapa visto desde arriba (arriba = hacia el enemigo). */
  debugTopDown(cx: number, cz: number, halfWidth: number) {
    const aspect = this.camera.aspect;
    const hh = halfWidth / aspect;
    const cam = new THREE.OrthographicCamera(-halfWidth, halfWidth, hh, -hh, 1, 800);
    cam.position.set(cx, 300, cz);
    cam.up.set(0, 0, -1);
    cam.lookAt(cx, 0, cz);
    const fog = this.scene.fog;
    this.scene.fog = null;
    this.world.sky.visible = false;
    this.viewModel.group.visible = false;
    this.renderer.setClearColor(0x2a1a14);
    this.renderer.render(this.scene, cam);
    this.scene.fog = fog;
    this.world.sky.visible = true;
    this.viewModel.group.visible = true;
  }

  /** Solo para pruebas: deja un kit médico en un punto. */
  debugKit(x: number, z: number, heal = 25) {
    this.medkits.drop(x, z, heal);
  }

  /** Solo para pruebas: hace aparecer un droide de un tipo en un punto. */
  debugSpawn(kind: 'b1' | 'b2' | 'droideka', x: number, z: number) {
    const params = kind === 'b2' ? b2Params(this.waves.round || 1) : kind === 'droideka' ? droidekaParams(this.waves.round || 1) : b1Params(this.waves.round || 1);
    return this.enemies.spawnAt(kind, params, x, z);
  }

  /** Solo para pruebas: qué objeto se ve en un punto de la pantalla (-1..1). */
  debugPick(nx: number, ny: number) {
    this.camera.updateMatrixWorld();
    const rc = new THREE.Raycaster();
    rc.setFromCamera(new THREE.Vector2(nx, ny), this.camera);
    return rc.intersectObjects(this.scene.children, true).slice(0, 3).map((h) => ({
      dist: +h.distance.toFixed(1),
      type: (h.object as THREE.Mesh).geometry?.type,
      verts: (h.object as THREE.Mesh).geometry?.attributes?.position?.count,
      point: h.point.toArray().map((v) => +v.toFixed(1)),
    }));
  }

  /** Solo para pruebas: avanza la simulación unos segundos de golpe, sin dibujar (jugador quieto). */
  debugSim(seconds: number, crouch = false, moveX = 0, moveZ = 0) {
    const cmd: InputCommand = { moveX, moveZ, yaw: this.yaw, pitch: this.pitch, crouch, jump: false, fire: false };
    const t0 = performance.now();
    let n = 0;
    for (; n < Math.round(seconds / TICK) && this.mode === 'playing'; n++) {
      this.localPlayer.step(cmd, TICK);
      this.enemies.update(TICK);
      this.medkits.update(TICK, this.localPlayer.state.x, this.localPlayer.state.y, this.localPlayer.state.z, true, (heal) => {
        const pl = this.state.players[0];
        pl.health = Math.min(100, pl.health + heal);
        this.hud.healPop(`+${heal} VIDA`);
        this.audio.pickup();
      });
      this.physics.step();
      this.grenadeSys.update(TICK);
      this.waves.update(TICK);
      this.effects.update(TICK);
    }
    return { ticks: n, msPerTick: (performance.now() - t0) / Math.max(1, n) };
  }

  /** Solo para pruebas: destruye a todos los droides vivos. */
  debugKillAll() {
    for (const d of this.enemies.droids) if (d.state.alive) { d.hit(9999, this.enemies.context); this.registerKill(); }
  }

  /** Solo para pruebas automáticas. */
  debug() {
    return { kits: this.medkits.list().length, audio: { jugados: this.audio.played, estadisticas: this.audio.stats }, arma: this.weapon, grenades: this.state.players[0].grenades, grenadesInFlight: this.grenadeSys?.inFlight ?? 0, shake: this.shake, ads: this.ads, adsToggled: this.adsToggled, fov: this.camera.fov, round: this.waves?.round, phase: this.waves?.phase, remaining: this.waves?.remaining, kills: this.state.kills, health: this.state.players[0].health, testMode: this.testMode, heat: this.blaster.heat, locked: this.blaster.locked, shots: this.shots, hits: this.hits, enemies: this.state.enemies.map((e) => ({ ...e })), mode: this.mode, player: { ...this.localPlayer.state }, eye: this.eye, gamepad: this.input.gamepadActive };
  }
}
