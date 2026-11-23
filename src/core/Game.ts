import * as THREE from 'three';
import RAPIER from '@dimforge/rapier3d-compat';
import { InputManager } from '../input/InputManager';
import { EYE_CROUCH, EYE_STAND, PlayerController } from '../player/PlayerController';
import { TICK, type GameState, type InputCommand } from '../sim/types';
import { Hud } from '../ui/Hud';
import { Menu } from '../ui/Menu';
import { SPAWN } from '../world/defenseZone';
import { World } from '../world/World';
import { QUALITY, Settings } from './Settings';

type Mode = 'menu' | 'playing' | 'paused';
const PITCH_LIMIT = (85 * Math.PI) / 180;

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

  private state: GameState = { players: [] };
  private localPlayer!: PlayerController;
  private wantCrouch = false;
  private yaw = 0;
  private pitch = 0;
  private eye = EYE_STAND;

  private mode: Mode = 'menu';
  private last = 0;
  private acc = 0;
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
    this.physics.step();

    this.applySettings();
    this.resize();
    this.menu.setHelp(
      this.input.hasTouch
        ? 'Izquierda: moverse · Derecha: deslizar para mirar\nCon mando Bluetooth los botones táctiles se ocultan solos.\nPara pantalla completa: Compartir → «Añadir a pantalla de inicio».'
        : 'WASD moverse · Ratón o flechas mirar · C agacharse · P pausa\nMando: sticks para moverse y mirar · B/Círculo agacharse · Options pausa',
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
      this.yaw -= inp.yaw;
      this.pitch = Math.max(-PITCH_LIMIT, Math.min(PITCH_LIMIT, this.pitch - inp.pitch));
      if (inp.crouchPressed) this.wantCrouch = !this.wantCrouch;

      const cmd: InputCommand = { moveX: inp.moveX, moveZ: inp.moveZ, yaw: this.yaw, pitch: this.pitch, crouch: this.wantCrouch };
      this.acc += dt;
      let steps = 0;
      while (this.acc >= TICK && steps < 5) {
        this.localPlayer.step(cmd, TICK);
        this.physics.step();
        this.acc -= TICK;
        steps++;
      }
      if (steps === 5) this.acc = 0;
      // Si no había sitio para levantarse, el botón refleja la postura real.
      if (steps > 0) this.wantCrouch = this.localPlayer.state.crouching;

      this.hud.setCrouching(this.localPlayer.state.crouching);
      this.syncCamera(dt);
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

  /** Solo para pruebas: coloca la cámara en un punto cualquiera y dibuja una imagen. */
  debugShot(x: number, y: number, z: number, yaw: number, pitch: number) {
    this.camera.position.set(x, y, z);
    this.camera.rotation.set(pitch, yaw, 0);
    this.world.follow(this.camera.position);
    this.renderer.render(this.scene, this.camera);
  }

  /** Solo para pruebas automáticas. */
  debug() {
    return { mode: this.mode, player: { ...this.localPlayer.state }, eye: this.eye, gamepad: this.input.gamepadActive };
  }
}
