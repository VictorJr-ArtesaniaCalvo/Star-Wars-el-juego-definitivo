import * as THREE from 'three';
import RAPIER from '@dimforge/rapier3d-compat';
import { EnemyManager } from '../enemies/EnemyManager';
import { InputManager } from '../input/InputManager';
import { EYE_CROUCH, EYE_STAND, PlayerController } from '../player/PlayerController';
import { TICK, type GameState, type InputCommand } from '../sim/types';
import { Hud } from '../ui/Hud';
import { Menu } from '../ui/Menu';
import { SPAWN } from '../world/defenseZone';
import { Blaster, BLASTER } from '../weapons/Blaster';
import { Effects } from '../weapons/Effects';
import { ViewModel } from '../weapons/ViewModel';
import { World } from '../world/World';
import { QUALITY, Settings } from './Settings';

type Mode = 'menu' | 'playing' | 'paused';
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

  private state: GameState = { players: [], enemies: [] };
  private enemies!: EnemyManager;
  private blaster = new Blaster();
  private effects!: Effects;
  private viewModel!: ViewModel;
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
    this.camera.rotation.order = 'YXZ';

    this.input = new InputManager(canvas, document.getElementById('touch')!);
    this.menu = new Menu(this.settings, () => this.play());
    this.hud = new Hud(() => this.pause());

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
    this.physics = new RAPIER.World({ x: 0, y: -9.81, z: 0 });
    this.physics.timestep = TICK;
    this.world = new World(this.scene, RAPIER, this.physics);

    this.state.players.push({ id: 0, x: SPAWN.x, y: 0, z: SPAWN.z, yaw: 0, pitch: 0, crouching: false, health: 100 });
    this.localPlayer = new PlayerController(RAPIER, this.physics, this.state.players[0]);
    this.enemies = new EnemyManager(this.scene, RAPIER, this.physics, this.state);
    this.enemies.spawnTestDroid();
    this.effects = new Effects(this.scene);
    this.scene.add(this.camera);
    this.viewModel = new ViewModel(this.camera);
    this.physics.step();

    this.applySettings();
    this.resize();
    this.menu.setHelp(
      this.input.hasTouch
        ? 'Izquierda: moverse · Derecha: deslizar para mirar · Puedes apuntar sin soltar DISPARAR\nCon mando Bluetooth los botones táctiles se ocultan solos.\nPara pantalla completa: Compartir → «Añadir a pantalla de inicio».'
        : 'WASD moverse · Ratón mirar · Clic disparar · C agacharse · P pausa\nMando: sticks moverse y mirar · RT/R2 disparar · B/Círculo agacharse · Options pausa',
    );
    this.menu.ready();
    this.syncCamera(1);
    requestAnimationFrame((t) => this.frame(t));
  }

  private applySettings() {
    const q = QUALITY[this.settings.data.quality];
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, q.pixelRatio));
    this.world?.setQuality(this.settings.data.quality);
    this.dirty = true;
  }

  private resize() {
    const w = window.innerWidth, h = window.innerHeight;
    this.renderer.setSize(w, h, false);
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
    this.dirty = true;
  }

  private play() {
    if (this.mode === 'playing') return;
    this.mode = 'playing';
    this.menu.hide();
    this.hud.setVisible(true, this.input.hasTouch);
    this.acc = 0;
    if (!this.input.hasTouch) this.canvas.requestPointerLock?.();
  }

  private pause() {
    if (this.mode !== 'playing') return;
    this.mode = 'paused';
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
      else if (this.mode === 'paused' && this.input.gamepadActive) this.play();
    }

    if (this.mode === 'playing') {
      if (inp.touchAim && this.settings.data.aimAssist) this.aimAssist(inp, dt);
      this.yaw -= inp.yaw;
      this.pitch = Math.max(-PITCH_LIMIT, Math.min(PITCH_LIMIT, this.pitch - inp.pitch));
      if (inp.crouchPressed) this.wantCrouch = !this.wantCrouch;

      const cmd: InputCommand = { moveX: inp.moveX, moveZ: inp.moveZ, yaw: this.yaw, pitch: this.pitch, crouch: this.wantCrouch, fire: inp.fire };
      this.acc += dt;
      let steps = 0;
      while (this.acc >= TICK && steps < 5) {
        this.localPlayer.step(cmd, TICK);
        this.enemies.update(TICK);
        this.physics.step();
        if (this.blaster.update(TICK, cmd.fire)) this.shoot();
        this.acc -= TICK;
        steps++;
      }
      if (steps === 5) this.acc = 0;
      // Si no había sitio para levantarse, el botón refleja la postura real.
      if (steps > 0) this.wantCrouch = this.localPlayer.state.crouching;

      this.hud.setCrouching(this.localPlayer.state.crouching);
      this.hud.setHeat(this.blaster.heat, this.blaster.locked);
      this.hud.update(dt);
      this.syncCamera(dt);
      this.effects.update(dt);
      this.viewModel.update(dt, this.blaster.heat);
      this.dirty = true;
    }

    if (this.dirty) {
      this.renderer.render(this.scene, this.camera);
      this.dirty = false;
    }
  }

  private syncCamera(dt: number) {
    const p = this.localPlayer.state;
    const target = p.crouching ? EYE_CROUCH : EYE_STAND;
    this.eye += (target - this.eye) * Math.min(1, dt * 12);
    this.camera.position.set(p.x, p.y + this.eye, p.z);
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
    const cp = Math.cos(this.pitch);
    const dir = this.v2.set(-Math.sin(this.yaw) * cp, Math.sin(this.pitch), -Math.cos(this.yaw) * cp);
    const hit = this.physics.castRay(new RAPIER.Ray(eye, dir), BLASTER.range, true, undefined, undefined, undefined, this.localPlayer.body);
    const dist = hit ? hit.timeOfImpact : BLASTER.range;
    const end = this.v3.copy(eye).addScaledVector(dir, dist);

    this.shots++;
    if (hit) {
      this.effects.flash(end);
      const droid = this.enemies.find(hit.collider.handle);
      if (droid) {
        droid.hit(BLASTER.damage);
        this.hits++;
        this.hud.hit(!droid.state.alive);
      }
    }
    this.camera.updateMatrixWorld();
    this.effects.bolt(this.viewModel.muzzle.getWorldPosition(this.v1), end);
    this.viewModel.shot();
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

  /** Solo para pruebas: deja quietos a los droides. */
  debugFreeze(frozen: boolean) {
    for (const d of this.enemies.droids) d.patrol = !frozen;
  }

  /** Solo para pruebas automáticas. */
  debug() {
    return { heat: this.blaster.heat, locked: this.blaster.locked, shots: this.shots, hits: this.hits, enemies: this.state.enemies.map((e) => ({ ...e })), mode: this.mode, player: { ...this.localPlayer.state }, eye: this.eye, gamepad: this.input.gamepadActive };
  }
}
