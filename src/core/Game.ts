import * as THREE from 'three';
import RAPIER from '@dimforge/rapier3d-compat';
import { EnemyManager } from '../enemies/EnemyManager';
import { InputManager } from '../input/InputManager';
import { EYE_CROUCH, EYE_STAND, PlayerController } from '../player/PlayerController';
import { TICK, type GameState, type InputCommand } from '../sim/types';
import { GameOver } from '../ui/GameOver';
import { Hud } from '../ui/Hud';
import { Menu } from '../ui/Menu';
import { WaveManager } from '../waves/WaveManager';
import { SPAWN } from '../world/defenseZone';
import { terrainHeight } from '../world/terrain';
import { Blaster, BLASTER } from '../weapons/Blaster';
import { Effects } from '../weapons/Effects';
import { ViewModel } from '../weapons/ViewModel';
import { World } from '../world/World';
import { QUALITY, Settings } from './Settings';

type Mode = 'menu' | 'playing' | 'paused' | 'gameover';
const HEAL_BETWEEN_ROUNDS = 30;
const KILLS_PER_HEAL = 3;
const HEAL_PER_STREAK = 10;
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
  private killsSinceHeal = 0;
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
    this.camera.rotation.order = 'YXZ';

    this.input = new InputManager(canvas, document.getElementById('touch')!);
    this.menu = new Menu(this.settings, {
      onPlay: () => (this.mode === 'paused' ? this.resume() : this.startRun()),
      onQuit: () => this.quitToMenu(),
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
    this.physics = new RAPIER.World({ x: 0, y: -9.81, z: 0 });
    this.physics.timestep = TICK;
    this.world = new World(this.scene, RAPIER, this.physics);

    this.state.players.push({ id: 0, x: SPAWN.x, y: 0, z: SPAWN.z, yaw: 0, pitch: 0, crouching: false, health: 100 });
    this.localPlayer = new PlayerController(RAPIER, this.physics, this.state.players[0]);
    this.effects = new Effects(this.scene);
    const pl = this.localPlayer;
    this.enemies = new EnemyManager(this.scene, RAPIER, this.physics, this.state, {
      effects: this.effects,
      player: () => pl.state,
      playerCollider: () => pl.collider.handle,
      damagePlayer: (amount, fx, fz) => this.damagePlayer(amount, fx, fz),
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
        ? 'Izquierda: moverse · Derecha: deslizar para mirar · Puedes apuntar sin soltar DISPARAR\nCon mando Bluetooth los botones táctiles se ocultan solos.\nPara pantalla completa: Compartir → «Añadir a pantalla de inicio».'
        : 'WASD moverse · Ratón mirar · Clic disparar · Espacio saltar · C agacharse · P pausa\nMando: sticks moverse y mirar · RT/R2 disparar · A/Cruz saltar · B/Círculo agacharse · Options pausa',
    );
    this.menu.ready();
    this.syncCamera(1);
    requestAnimationFrame((t) => this.frame(t));
  }

  private applySettings() {
    const q = QUALITY[this.settings.data.quality];
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, q.pixelRatio));
    this.world?.setQuality(this.settings.data.quality);
    this.hud?.setFpsVisible(this.settings.data.showFps);
    this.dirty = true;
  }

  private resize() {
    const w = window.innerWidth, h = window.innerHeight;
    this.renderer.setSize(w, h, false);
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
    this.killsSinceHeal = 0;
    this.jumpBuffer = 0;
    this.hud.setKillPips(0);
    this.shots = 0;
    this.hits = 0;
    this.gameOver.hide();
    this.hud.setTestTag(this.testMode);
    this.hud.setHealth(p.health);
    this.waves.start(s.testRound);
    this.resume();
  }

  private quitToMenu() {
    this.waves.stop();
    this.enemies.clear();
    this.effects.clear();
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

  /** Una baja más. Cada 3 bajas te curas 10 puntos de vida. */
  private registerKill() {
    this.state.kills++;
    this.killsSinceHeal++;
    if (this.killsSinceHeal >= KILLS_PER_HEAL) {
      this.killsSinceHeal = 0;
      const p = this.state.players[0];
      if (p.health < 100) p.health = Math.min(100, p.health + HEAL_PER_STREAK);
      this.hud.healPop(`+${HEAL_PER_STREAK} VIDA`);
    }
    this.hud.setKillPips(this.killsSinceHeal);
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
      else if (this.mode === 'paused' && this.input.gamepadActive) this.resume();
    }

    if (this.mode === 'playing') {
      if (inp.touchAim && this.settings.data.aimAssist) this.aimAssist(inp, dt);
      this.yaw -= inp.yaw;
      this.pitch = Math.max(-PITCH_LIMIT, Math.min(PITCH_LIMIT, this.pitch - inp.pitch));
      if (inp.crouchPressed) this.wantCrouch = !this.wantCrouch;
      // Saltar: si estás agachado, primero te levantas.
      if (inp.jumpPressed) { if (this.wantCrouch) this.wantCrouch = false; else this.jumpBuffer = 0.14; }
      this.jumpBuffer = Math.max(0, this.jumpBuffer - dt);

      const cmd: InputCommand = { moveX: inp.moveX, moveZ: inp.moveZ, yaw: this.yaw, pitch: this.pitch, crouch: this.wantCrouch, jump: this.jumpBuffer > 0, fire: inp.fire };
      this.acc += dt;
      let steps = 0;
      while (this.acc >= TICK && steps < 5) {
        this.localPlayer.step(cmd, TICK);
        if (this.localPlayer.didJump) { this.localPlayer.didJump = false; this.jumpBuffer = 0; cmd.jump = false; }
        this.enemies.update(TICK);
        this.physics.step();
        if (this.blaster.update(TICK, cmd.fire)) this.shoot();
        this.waves.update(TICK);
        if (this.mode !== 'playing') break; // la partida acaba en mitad del paso
        this.acc -= TICK;
        steps++;
      }
      if (steps === 5) this.acc = 0;
      // Si no había sitio para levantarse, el botón refleja la postura real.
      if (steps > 0) this.wantCrouch = this.localPlayer.state.crouching;

      this.hud.setCrouching(this.localPlayer.state.crouching);
      this.hud.setHeat(this.blaster.heat, this.blaster.locked);
      this.hud.setHealth(this.state.players[0].health);
      this.hud.setHeading(this.yaw);
      this.hud.setRound(this.waves.round, this.waves.remaining);
      this.state.round = this.waves.round;
      this.hud.update(dt);
      this.syncCamera(dt);
      this.effects.update(dt);
      this.world.tick(dt);
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
        const killed = droid.hit(BLASTER.damage, this.enemies.context);
        this.hits++;
        if (killed) this.registerKill();
        this.hud.hit(killed);
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
      this.physics.step();
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
    return { round: this.waves?.round, phase: this.waves?.phase, remaining: this.waves?.remaining, kills: this.state.kills, health: this.state.players[0].health, testMode: this.testMode, heat: this.blaster.heat, locked: this.blaster.locked, shots: this.shots, hits: this.hits, enemies: this.state.enemies.map((e) => ({ ...e })), mode: this.mode, player: { ...this.localPlayer.state }, eye: this.eye, gamepad: this.input.gamepadActive };
  }
}
