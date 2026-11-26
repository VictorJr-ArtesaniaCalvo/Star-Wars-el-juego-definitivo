import * as THREE from 'three';
import RAPIER from '@dimforge/rapier3d-compat';
import { loadB1Model } from '../enemies/B1Rig';
import { loadB2Model } from '../enemies/B2Rig';
import { loadDekaModel } from '../enemies/DroidekaRig';
import { loadWorldTextures } from '../world/materials';
import { loadParticleAtlas } from '../world/crashFx';
import { loadLaat } from '../world/laat';
import { loadCapitalShips } from '../world/skyLife';
import { loadConsular } from '../world/consular';
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
import { Wipe, WIPE_TIME } from '../ui/Wipe';
import { b1Params, b2Params, droidekaParams, WaveManager } from '../waves/WaveManager';
import { SPAWN } from '../world/defenseZone';
import { setWallDetail } from '../world/terrain';
import { Blaster, BLASTER } from '../weapons/Blaster';
import { GRENADE, GrenadeSystem } from '../weapons/Grenade';
import { MEDKIT, MedkitSystem } from '../weapons/Medkits';
import { Effects } from '../weapons/Effects';
import { ViewModel, loadBlasterModel, loadDetonatorModel } from '../weapons/ViewModel';
import { World } from '../world/World';
import { SUN_DIR } from '../world/sky';
import { QUALITY, Settings, type Quality } from './Settings';
import { Cinematic } from '../cinematic/Cinematic';
import { loadCommandoModel, loadTrooperModel } from '../player/commandoModel';
import { ANIM_CLIPS, loadClips } from '../anim/mixamo';
import { HandTuner } from '../ui/HandTuner';
import { VoiceTuner } from '../ui/VoiceTuner';
import { COMANDO } from '../cinematic/script';
import { currentZone, groundHeight, setZone } from '../world/zone';
import { addArenaPhysics, ArenaPrep } from '../world/arena/ArenaWorld';
import { ArenaCinematic } from '../cinematic/ArenaCinematic';
import { loadLaatSounds } from '../audio/CineSounds';
import { buildCave, CUEVA } from '../world/cave';
import { ARENA_B, ARENA_ENTRY, ARENA_ROUND, ARENA_SUN } from '../world/arena/layout';

type Mode = 'menu' | 'cinematic' | 'playing' | 'paused' | 'gameover' | 'transition';
/** Fundido a negro al cambiar de zona (segundos): bajar, texto en negro, subir. */
const ZONE_FADE_OUT = 1.6;
const ZONE_HOLD = 2.2;
/** La cinemática de paso a la arena ya se ha visto en esta sesión (al reintentar no se repite). */
const CINE2_SEEN = 'geonosis.cine2Seen';
/** Vista previa pendiente tras recargar (una toma del cañón pedida desde la arena). */
const PREVIEW_SHOT = 'geonosis.previewShot';
const ZONE_FADE_IN = 1.6;
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
  private wipe = new Wipe();
  private hud: Hud;
  private gameOver: GameOver;
  private waves!: WaveManager;
  private testMode = false;
  private cine!: Cinematic;
  /** Cinemática de paso a la arena (al acabar la ronda 6) y la arena que se va preparando mientras se ve. */
  private cine2!: ArenaCinematic;
  private activeCine: 'intro' | 'arena' = 'intro';
  private arenaPrep: ArenaPrep | null = null;
  private arenaRound = 0;
  /** A qué volver al acabar una vista previa de la cinemática (modo de pruebas). */
  private previewReturn: Mode = 'menu';
  private voiceTuner = new VoiceTuner({
    retune: () => this.cine.voices.retune(),
    play: (what) => { this.audio.resume(); this.cine.testVoice(what); },
  });
  private tuner = new HandTuner({
    toggleAim: () => { this.adsToggled = !this.adsToggled; },
    look: (d) => { this.pitch = d * 0.75; },
    close: () => this.closeHandTuner(),
    freezeGrenade: (on) => { this.viewModel.grenadeFreeze(on); return this.viewModel.grenadeFrozen; },
    previewGrenade: () => this.viewModel.grenadePreview(),
  });

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
  private swapT = 0;
  private prevFire = false;
  /** ¿Muestran los botones de disparo el icono de lanzar? (granada en la mano) */
  private nadeHud = false;
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
  private builtWallDetail = true; // con qué forma de paredes se construyó el escenario (baja = recta)
  private lastQuality: Quality | null = null;
  private dirty = true; // hay que volver a dibujar aunque esté en pausa

  constructor(private canvas: HTMLCanvasElement) {
    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: false, powerPreference: 'high-performance' });
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap; // bordes suaves en las sombras (Alta y Ultra)
    this.camera.rotation.order = 'YXZ';

    this.input = new InputManager(canvas, document.getElementById('touch')!);
    this.menu = new Menu(this.settings, {
      onPlay: () => (this.mode === 'paused' ? this.resume() : this.playFromMenu()),
      onTuneHands: () => this.openHandTuner(),
      onTuneVoice: () => { this.audio.resume(); this.voiceTuner.show(); },
      onCinematic: (shot) => { if (this.mode === 'menu' || this.mode === 'gameover') this.startRun(true, shot); },
      onArenaCinematic: (shot) => this.testArenaCinematic(shot),
      onQuit: () => this.quitToMenu(),
      onGoRound: (round) => this.jumpToRound(round),
      onArena: () => (this.mode === 'paused' ? this.jumpToRound(this.settings.data.testRound) : this.mode === 'menu' || this.mode === 'gameover' ? this.startRun(true) : undefined),
      onMusicTouch: () => (this.mode === 'menu' ? this.audio.startMenuMusic() : this.audio.startMusic()), // un toque del jugador: ya puede sonar (iOS)
      onSfxPreview: () => this.audio.previewSfx(),
    });
    this.hud = new Hud(() => this.pause());
    this.gameOver = new GameOver(() => this.startRun(), () => this.quitToMenu());

    // Música de la pantalla principal: empieza con el primer toque (iOS no deja sonar antes). Ojo: en el iPhone solo vale
    // al LEVANTAR el dedo (touchend/click); al apoyarlo (pointerdown/touchstart) iOS no deja que suene.
    const menuTouch = () => { if (this.mode === 'menu' && !this.wipe.busy) this.audio.startMenuMusic(); };
    for (const ev of ['touchend', 'pointerup', 'click', 'keydown']) document.addEventListener(ev, menuTouch, true);
    this.setupTapStart();

    this.settings.onChange(() => this.applySettings());
    window.addEventListener('resize', () => this.resize());
    window.addEventListener('orientationchange', () => setTimeout(() => this.resize(), 250));

    // Pausa automática al salir de la app o cambiar de pestaña.
    const auto = () => { if (document.hidden) this.pause(); else this.unholdCinematic(); };
    document.addEventListener('visibilitychange', auto);
    window.addEventListener('focus', () => this.unholdCinematic());
    // Ordenador: si al acabar la cinemática el ratón no quedó capturado, un clic en la imagen lo captura
    canvas.addEventListener('click', () => { if (this.mode === 'playing' && !this.input.hasTouch && !document.pointerLockElement) this.lockPointer(); });
    window.addEventListener('pagehide', () => this.pause());
    window.addEventListener('blur', () => this.pause());
    document.addEventListener('pointerlockchange', () => {
      // (en una cinemática se suelta el ratón a propósito: eso no es una pausa)
      if (!document.pointerLockElement && !this.input.hasTouch && !this.input.gamepadActive && !this.tuner.open && this.mode !== 'cinematic') this.pause();
    });
  }

  async init() {
    await RAPIER.init();
    await Promise.all([loadB1Model(`${import.meta.env.BASE_URL}models/b1.bin`), loadB2Model(`${import.meta.env.BASE_URL}models/b2.bin`), loadLaat(`${import.meta.env.BASE_URL}models/laat.bin`), loadBlasterModel(`${import.meta.env.BASE_URL}models/blaster.bin`), loadDekaModel(`${import.meta.env.BASE_URL}models/droideka.bin`), loadWorldTextures(import.meta.env.BASE_URL), loadParticleAtlas(import.meta.env.BASE_URL), loadCommandoModel(`${import.meta.env.BASE_URL}models/commando.glb`), loadTrooperModel('clone', `${import.meta.env.BASE_URL}models/clone/clone.fbx`), loadClips(import.meta.env.BASE_URL, ANIM_CLIPS), loadCapitalShips(import.meta.env.BASE_URL), loadDetonatorModel(`${import.meta.env.BASE_URL}models/detonator.glb`), loadConsular(import.meta.env.BASE_URL)]);
    this.physics = new RAPIER.World({ x: 0, y: -9.81, z: 0 });
    this.physics.timestep = TICK;
    this.audio.init();
    setWallDetail(this.settings.data.quality !== 'low'); // la forma de las paredes se fija al cargar (baja = recta)
    this.builtWallDetail = this.settings.data.quality !== 'low';
    this.world = new World(this.scene, RAPIER, this.physics, { skyFire: (x, y, z) => this.audio.distantBoom(x, y, z) });

    this.state.players.push({ id: 0, x: SPAWN.x, y: 0, z: SPAWN.z, yaw: 0, pitch: 0, crouching: false, health: 100, grenades: GRENADE.perGame });
    this.localPlayer = new PlayerController(RAPIER, this.physics, this.state.players[0]);
    this.effects = new Effects(this.scene);
    this.medkits = new MedkitSystem(this.scene);
    const pl = this.localPlayer;
    this.grenadeSys = new GrenadeSystem(this.scene, this.physics, pl.body, (at) => this.explodeGrenade(at), (at) => this.audio.grenadeBounce(at.x, at.y, at.z), {
      start: (at) => this.audio.grenadeArmed(at.x, at.y, at.z),
      move: (id, at) => this.audio.grenadeArmedMove(id, at.x, at.y, at.z),
      stop: (id) => this.audio.grenadeArmedStop(id),
    });
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
      onEnterArena: (round) => this.arenaReached(round),
      onBanner: (title, sub, sec) => this.hud.showBanner(title, sub, sec),
      onRoundCleared: () => {
        const p = this.state.players[0];
        p.health = Math.min(100, p.health + HEAL_BETWEEN_ROUNDS);
      },
    });
    this.scene.add(this.camera);
    this.viewModel = new ViewModel(this.camera, SUN_DIR);
    // la granada sale de la mano a mitad del gesto de lanzar (las pruebas del panel de ajuste no lanzan de verdad)
    this.viewModel.onGrenadeRelease = (at, preview) => { if (!preview) this.throwGrenade(at); };
    this.cine = new Cinematic({ scene: this.scene, camera: this.camera, renderer: this.renderer, audio: this.audio, effects: this.effects, onEnd: () => this.endCinematic() });
    this.cine.voices.preload(Cinematic.voiceIds()); // las voces que existan (public/audio/voces); si no hay, solo subtítulos
    this.cine2 = new ArenaCinematic({
      scene: this.scene, camera: this.camera, renderer: this.renderer, audio: this.audio, effects: this.effects,
      wipe: (covered) => this.wipe.run(covered),
      prepStep: (ms) => (this.arenaPrep ??= new ArenaPrep()).step(ms),
      swap: () => this.swapToArena(),
      onEnd: (at) => this.endArenaCinematic(at),
      onPreviewEnd: () => this.endArenaPreview(),
    });
    this.cine2.voices.preload(ArenaCinematic.voiceIds()); // c2_piloto_1, c2_piloto_2, c2_comando
    void loadLaatSounds(import.meta.env.BASE_URL); // sonidos grabados de la cañonera (pasada rasante e interior en vuelo)
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
    // Entre «baja» y las demás cambia la forma de las paredes (y su colisión): se recarga el juego, avisando si hay una partida en curso
    const wantDetail = this.settings.data.quality !== 'low';
    if (this.world && wantDetail !== this.builtWallDetail) {
      const idle = this.mode === 'menu' || this.mode === 'gameover';
      if (idle || window.confirm('Cambiar entre calidad Baja y las demás recarga el juego (las paredes cambian de forma) y se pierde la partida en curso. ¿Continuar?')) {
        window.location.reload();
        return;
      }
      if (this.lastQuality) this.settings.set({ quality: this.lastQuality });
      return;
    }
    this.lastQuality = this.settings.data.quality;
    const q = QUALITY[this.settings.data.quality];
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, q.pixelRatio));
    this.world?.setQuality(this.settings.data.quality);
    this.audio.setVolume(this.settings.data.volume);
    this.audio.setSfxVolume(this.settings.data.sfxVolume);
    this.audio.setMusicVolume(this.settings.data.musicVolume);
    this.audio.setNewAmbience(this.settings.data.newAmbience !== false); // modo de pruebas: comparar el ambiente nuevo con el de antes
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

  /**
   * Empieza una partida nueva desde cero (con las opciones del modo de pruebas, si las hay).
   * `fromMenu`: desde el botón JUGAR (la primera vez en esta apertura de la app va precedida de la cinemática; al reintentar, no).
   * `cineShot`: ver la cinemática desde esa toma (botón del menú o modo de pruebas), aunque ya se haya visto.
   */
  private startRun(fromMenu = false, cineShot?: number) {
    this.audio.fadeOutMenuMusic(0.6); // por si se empieza desde el modo de pruebas, sin cortinilla
    const s = this.settings.data;
    const arenaStart = s.testRound >= ARENA_ROUND && cineShot === undefined;
    // El cañón se borró al pasar a la arena: para volver a él se recarga el juego (el menú vuelve a salir; la cinemática no se repite).
    if (currentZone() === 'arena' && !arenaStart) { this.reloadForCanyon(); return; }
    this.testMode = s.invincible || s.testRound > 1;
    this.enemies.clear();
    this.effects.clear();
    const p = this.state.players[0];
    p.health = 100;
    if (currentZone() === 'arena') this.localPlayer.teleport(ARENA_ENTRY.x, ARENA_ENTRY.z);
    else this.localPlayer.teleport(SPAWN.x, SPAWN.z);
    this.yaw = 0;
    this.pitch = 0;
    this.wantCrouch = false;
    this.blaster = new Blaster();
    this.state.kills = 0;
    p.grenades = GRENADE.perGame;
    this.grenadeSys.clear();
    this.grenadeCd = 0;
    this.shake = 0;
    this.viewModel.grenadeReset();
    this.swapT = 0;
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
    // JUGAR en la pantalla principal empieza siempre con la cinemática (se puede omitir); reintentar, no
    const wantCine = cineShot !== undefined || (fromMenu && !this.testMode);
    if (wantCine) {
      this.beginCinematic(cineShot ?? 0);
      return;
    }
    // Modo de pruebas: empezar directamente en la arena (fundido, se borra el cañón y se monta la arena)
    if (arenaStart && currentZone() === 'canyon') {
      this.menu.hide();
      this.audio.start();
      this.audio.unlock(); // la música de la arena empezará en negro, ya montada la arena
      this.enterArena(s.testRound);
      return;
    }
    this.waves.start(s.testRound);
    this.resume();
  }

  /**
   * «TOCA PARA EMPEZAR»: lo primero al abrir. Ese toque arranca la música de la pantalla principal (el iPhone no deja sonar antes)
   * y la pantalla se funde dejando ver el menú. Sigue tapando unos instantes mientras se funde, para que el mismo toque no pulse un botón.
   */
  private setupTapStart() {
    const el = document.getElementById('tapStart');
    if (!el) return;
    if (!matchMedia('(pointer: coarse)').matches) document.getElementById('tapHint')!.textContent = 'PULSA PARA EMPEZAR';
    let done = false;
    const go = (e: Event) => {
      if (done) return;
      done = true;
      e.preventDefault();
      this.audio.unlock();
      this.audio.startMenuMusic();
      el.classList.add('out');
      document.removeEventListener('keydown', go);
      window.setTimeout(() => el.remove(), 750);
      // ¿se pidió ver una toma del cañón estando en la arena? (hubo que recargar): se pone ahora
      let pending: string | null = null;
      try { pending = sessionStorage.getItem(PREVIEW_SHOT); sessionStorage.removeItem(PREVIEW_SHOT); } catch { /* nada */ }
      if (pending !== null) window.setTimeout(() => this.testArenaCinematic(Number(pending)), 800);
    };
    el.addEventListener('touchend', go);
    el.addEventListener('click', go);
    document.addEventListener('keydown', go);
  }

  /**
   * JUGAR en la pantalla principal: cortinilla a negro de derecha a izquierda (al estilo Star Wars) y, ya en negro, empieza la partida.
   * El sonido se desbloquea en el mismo toque (iOS no deja sonar después).
   */
  private playFromMenu() {
    if (this.wipe.busy) return;
    this.audio.unlock();
    this.audio.fadeOutMenuMusic(WIPE_TIME); // la música baja poco a poco mientras cruza la cortina
    this.wipe.run(() => {
      if (this.mode === 'menu' || this.mode === 'gameover') this.startRun(true);
    });
  }

  /** Vuelve a cargar el juego para tener otra vez el cañón (se borró al pasar a la arena): sale la pantalla principal. */
  private reloadForCanyon() {
    window.location.reload();
  }

  /**
   * Se ha completado la última ronda del cañón. La primera vez en esta sesión: la cinemática de paso a la arena (si están el modelo
   * del comando y sus animaciones). Si no (al reintentar, o si faltan archivos): el fundido a negro de siempre.
   */
  private arenaReached(round: number) {
    let seen = false;
    try { seen = sessionStorage.getItem(CINE2_SEEN) === '1'; } catch { /* sin almacenamiento: se pone */ }
    if (!seen && ArenaCinematic.ready() && (this.mode === 'playing' || this.mode === 'paused')) {
      try { sessionStorage.setItem(CINE2_SEEN, '1'); } catch { /* nada */ }
      this.beginArenaCinematic(round, 0);
    }
    else this.enterArena(round);
  }

  /** Cinemática de paso a la arena: sin controles ni HUD; la arena se prepara mientras se ve el cañón. */
  private beginArenaCinematic(round: number, shot: number) {
    this.mode = 'cinematic';
    this.activeCine = 'arena';
    this.arenaRound = round;
    this.waves.stop();
    this.enemies.clear();
    this.effects.clear();
    this.grenadeSys.clear();
    this.menu.hide();
    this.gameOver.hide();
    this.hud.hideBanner();
    this.hud.setVisible(false, false);
    this.input.touch?.reset();
    if (document.pointerLockElement) document.exitPointerLock();
    this.viewModel.lowerNow();
    this.audio.start();
    if (!this.arenaPrep && currentZone() === 'canyon') this.arenaPrep = new ArenaPrep();
    this.cine2.start(shot);
    this.dirty = true;
  }

  /** Fin de la cinemática de paso (o se ha omitido): empieza la ronda en la arena desde donde se quedó el comando. */
  private endArenaCinematic(at: { x: number; z: number; yaw: number }) {
    this.resetForArena();
    this.localPlayer.teleport(at.x, at.z);
    this.yaw = at.yaw;
    this.pitch = 0;
    this.eye = EYE_STAND;
    this.camera.fov = FOV_HIP;
    this.camera.updateProjectionMatrix();
    this.viewModel.lowerNow();
    this.physics.step();
    this.mode = 'menu'; // para que resume() haga todo el arranque
    this.waves.start(this.arenaRound || ARENA_ROUND);
    this.resume();
    this.hud.fadeIn();
    this.syncCamera(1);
  }

  /** Vida llena, granadas repuestas y el bláster en la mano (al llegar a la arena). */
  private resetForArena() {
    const p = this.state.players[0];
    p.health = 100;
    p.grenades = GRENADE.perGame;
    this.hud.setHealth(p.health);
    this.hud.setGrenades(p.grenades);
    this.viewModel.grenadeReset();
    this.swapT = 0;
    this.hud.setWeapon('blaster');
    this.wantCrouch = false;
  }

  /**
   * Cambia el cañón por la arena (sin fundido; quien llama ya tiene la pantalla en negro): borra el cañón entero, pone la arena
   * (preparada poco a poco durante la cinemática, o de golpe si no lo estaba), sus cuerpos sólidos, su sol y la zona.
   */
  private swapToArena() {
    if (currentZone() === 'arena') return;
    const t0 = performance.now();
    const prep = this.arenaPrep ?? new ArenaPrep();
    const wasDone = prep.done;
    const built = prep.finishNow();
    this.arenaPrep = null;
    this.waves.stop();
    this.enemies.clear();
    this.effects.clear();
    this.medkits.clear();
    this.grenadeSys.clear();
    this.world.disposeCanyon(this.physics);
    this.scene.add(built.group);
    const obstacles = addArenaPhysics(built.group, RAPIER, this.physics);
    setZone('arena', obstacles);
    this.enemies.changeZone();
    SUN_DIR.set(ARENA_SUN.x, ARENA_SUN.y, ARENA_SUN.z).normalize();
    this.viewModel.setSun(SUN_DIR);
    this.world.setQuality(this.settings.data.quality);
    console.info(`Arena: ${Math.round(built.triangles)} triángulos · montada en ${Math.round(built.bakeMs)} ms de trabajo` + (wasDone ? ` (a trozos, en ${prep.frames} imágenes)` : ' (de golpe)') + ` · cambio ${Math.round(performance.now() - t0)} ms`);
  }

  /**
   * PASO A LA ARENA SIN CINEMÁTICA (al reintentar, en el modo de pruebas o si faltan archivos): fundido suave a negro con el nombre
   * de la arena; en negro se borra el cañón y se monta la arena; entras por la puerta sur con la vida y las granadas repuestas.
   */
  private enterArena(round: number) {
    if (currentZone() === 'arena') return;
    this.mode = 'transition';
    this.input.touch?.reset();
    this.hud.hideBanner();
    this.hud.setVisible(false, false);
    const fade = document.getElementById('zoneFade')!;
    this.audio.fadeOutGameMusic(ZONE_FADE_OUT); // la música del cañón se apaga con el fundido; en negro empieza la de la arena
    fade.hidden = false;
    fade.style.transitionDuration = `${ZONE_FADE_OUT}s`;
    void fade.offsetWidth;
    fade.classList.add('on');
    window.setTimeout(() => {
      fade.classList.add('text');
      // dos imágenes en negro antes del trabajo pesado (si no, el iPhone no llega a pintar el negro)
      requestAnimationFrame(() => requestAnimationFrame(() => {
        const t0 = performance.now();
        this.swapToArena();
        this.audio.setGameMusic('arena');
        this.audio.startMusic(); // «Jango's Escape», en bucle durante toda la arena
        this.resetForArena();
        this.localPlayer.teleport(ARENA_ENTRY.x, ARENA_ENTRY.z);
        this.yaw = ARENA_ENTRY.yaw;
        this.pitch = 0;
        this.physics.step();
        this.syncCamera(1);
        this.renderFrame();
        const spent = (performance.now() - t0) / 1000;
        window.setTimeout(() => {
          fade.style.transitionDuration = `${ZONE_FADE_IN}s`;
          fade.classList.remove('text');
          fade.classList.remove('on');
          this.mode = 'menu'; // para que resume() haga todo el arranque
          this.resume();
          this.hud.fadeIn();
          this.waves.start(round);
          window.setTimeout(() => { fade.hidden = true; }, ZONE_FADE_IN * 1000 + 100);
        }, Math.max(300, (ZONE_HOLD - spent) * 1000));
      }));
    }, ZONE_FADE_OUT * 1000);
  }

  /**
   * Modo de pruebas: VISTA PREVIA de una toma de la cinemática de paso a la arena. Solo esa toma, encima de lo que haya (la partida se
   * queda como estaba, escondida y quieta) y al acabar se vuelve al mismo menú. Las tomas del cañón necesitan el cañón: si ya estás en
   * la arena, se recarga el juego y se pone la toma al volver. Las de la arena, si estás en el cañón, pasan a la arena (sin vuelta atrás).
   */
  private testArenaCinematic(shot: number) {
    if (this.mode === 'cinematic' || this.mode === 'transition') return;
    const arenaShot = shot >= ArenaCinematic.arenaShot();
    if (!arenaShot && currentZone() === 'arena') {
      try { sessionStorage.setItem(PREVIEW_SHOT, String(shot)); } catch { /* nada */ }
      this.reloadForCanyon();
      return;
    }
    const prev: Mode = this.mode === 'paused' ? 'paused' : 'menu';
    const play = () => {
      this.previewReturn = prev;
      this.mode = 'cinematic';
      this.activeCine = 'arena';
      this.menu.hide();
      this.gameOver.hide();
      this.hud.hideBanner();
      this.hud.setVisible(false, false);
      this.input.touch?.reset();
      if (document.pointerLockElement) document.exitPointerLock();
      this.enemies.setShown(false);
      this.effects.clear();
      this.audio.start();
      this.audio.resume(); // en pausa el sonido está parado
      this.cine2.start(shot, { preview: true });
      this.dirty = true;
    };
    if (!arenaShot || currentZone() === 'arena') { play(); return; }
    // una toma de la arena desde el cañón: en negro se pasa a la arena (tarda un poco) y la partida sigue allí, en la ronda 7
    const fade = document.getElementById('zoneFade')!;
    this.mode = 'transition';
    this.menu.hide();
    fade.hidden = false;
    fade.style.transitionDuration = '0s';
    fade.classList.add('on', 'text');
    requestAnimationFrame(() => requestAnimationFrame(() => {
      this.waves.stop();
      this.swapToArena();
      this.resetForArena();
      this.localPlayer.teleport(0.3, ARENA_B - 1.5);
      this.yaw = 0;
      this.pitch = 0;
      this.physics.step();
      if (prev === 'paused') this.waves.start(ARENA_ROUND);
      this.mode = prev;
      play();
      fade.style.transitionDuration = '0.6s';
      fade.classList.remove('on', 'text');
      window.setTimeout(() => { fade.hidden = true; }, 700);
    }));
  }

  /** Fin de la vista previa: se vuelve al menú en el que estabas, con la partida tal cual. */
  private endArenaPreview() {
    this.enemies.setShown(true);
    this.camera.fov = FOV_HIP;
    this.camera.updateProjectionMatrix();
    this.syncCamera(1);
    if (this.previewReturn === 'paused') {
      this.mode = 'paused';
      this.audio.suspend();
      this.menu.show(true);
    } else {
      this.mode = 'menu';
      this.menu.show(false);
    }
  }

  /** Cinemática inicial: sin controles ni HUD; la música empieza ya y sigue en la partida. */
  private beginCinematic(shot: number) {
    this.mode = 'cinematic';
    this.medkits.clear();
    this.menu.hide();
    this.gameOver.hide();
    this.hud.hideBanner();
    this.hud.setVisible(false, false);
    this.input.touch?.reset();
    if (document.pointerLockElement) document.exitPointerLock();
    this.viewModel.lowerNow();
    this.audio.start(); // tras el toque en JUGAR: iOS ya deja sonar
    this.audio.startMusic();
    this.activeCine = 'intro';
    this.cine.start(shot);
    this.dirty = true;
  }

  /** Fin de la cinemática (o se ha omitido): el comando ya está de pie y empieza la ronda en primera persona desde su sitio. */
  private endCinematic() {
    this.localPlayer.teleport(COMANDO.x, COMANDO.z);
    this.yaw = 0; // mirando al norte, por donde venían los droides
    this.pitch = -0.03;
    this.wantCrouch = false;
    this.eye = EYE_STAND;
    this.camera.fov = FOV_HIP;
    this.camera.updateProjectionMatrix();
    this.viewModel.lowerNow(); // los brazos con el bláster suben a la imagen
    this.mode = 'menu'; // para que resume() haga todo el arranque
    this.waves.start(this.settings.data.testRound);
    this.resume();
    this.hud.fadeIn();
    this.syncCamera(1);
  }

  /** Modo de pruebas: panel para ajustar las manos en directo (sin droides mientras está abierto). */
  private openHandTuner() {
    if (this.mode === 'menu' || this.mode === 'gameover') this.startRun();
    else if (this.mode === 'paused') this.resume();
    this.waves.stop();
    this.enemies.clear();
    this.hud.hideBanner();
    if (document.pointerLockElement) document.exitPointerLock();
    this.tuner.show();
  }

  private closeHandTuner() {
    this.tuner.hide();
    if (this.viewModel.grenadeFrozen) this.viewModel.grenadeFreeze(false); // la mano vuelve al rifle sin lanzar
    this.waves.start(Math.max(1, this.waves.round));
  }

  /** La app vuelve a primer plano durante la cinemática: sigue donde estaba. */
  private unholdCinematic() {
    if (this.mode !== 'cinematic' || document.hidden) return;
    (this.activeCine === 'arena' ? this.cine2 : this.cine).hold(false);
    this.audio.resume();
  }

  private lockPointer() {
    try {
      const r = this.canvas.requestPointerLock?.() as unknown as Promise<void> | undefined;
      if (r && typeof r.catch === 'function') r.catch(() => undefined); // sin un clic reciente el navegador puede negarse: se captura con el siguiente clic
    } catch { /* ignorar */ }
  }

  /** Desde la pausa: salta directamente a otra ronda (vida y granadas al máximo). Cuenta como partida de pruebas. */
  private jumpToRound(round: number) {
    if (this.mode !== 'paused') return;
    // a una ronda del cañón desde la arena: hay que recargar; a una de la arena desde el cañón: se pasa a la arena
    if (round < ARENA_ROUND && currentZone() === 'arena') { this.reloadForCanyon(); return; }
    this.testMode = true;
    this.enemies.clear();
    this.effects.clear();
    this.grenadeSys.clear();
    const p = this.state.players[0];
    p.health = 100;
    p.grenades = GRENADE.perGame;
    this.viewModel.grenadeReset();
    this.swapT = 0;
    this.grenadeCd = 0;
    this.hud.setWeapon('blaster');
    this.hud.setHealth(p.health);
    this.hud.setGrenades(p.grenades);
    this.hud.setTestTag(true);
    if (round >= ARENA_ROUND && currentZone() === 'canyon') {
      this.menu.hide();
      this.arenaReached(round); // la cinemática de paso si aún no se ha visto en esta sesión; si no, el fundido
      return;
    }
    if (currentZone() === 'arena') this.localPlayer.teleport(ARENA_ENTRY.x, ARENA_ENTRY.z);
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
    this.audio.startMenuMusic(); // vuelve la música de la pantalla principal (para la de la partida)
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

  /** Botón de granada pulsado: la mano izquierda suelta el rifle y coge una granada del cinturón (se lanza al soltar el botón). */
  private startGrenade() {
    if (this.mode !== 'playing' || this.state.players[0].grenades <= 0 || this.grenadeCd > 0) return;
    this.viewModel.grenadeStart();
  }

  /** La granada sale de la mano (`from`, en el mundo; null = desde los ojos) hacia donde miras. */
  private throwGrenade(from: THREE.Vector3 | null) {
    const p = this.state.players[0];
    if (this.mode !== 'playing' || p.grenades <= 0) return;
    p.grenades--;
    this.grenadeCd = GRENADE.cooldown;
    this.hud.setGrenades(p.grenades);
    const eye = this.eyePos(this.v1);
    const cp = Math.cos(this.pitch);
    const dir = this.v2.set(-Math.sin(this.yaw) * cp, Math.sin(this.pitch), -Math.cos(this.yaw) * cp);
    if (from) {
      // desde la mano, hacia el punto al que apunta la mira (a 25 m), para que caiga donde miras aunque salga de la izquierda
      const aim = this.v3.copy(eye).addScaledVector(dir, 25);
      this.grenadeSys.throwFrom(from, dir.copy(aim).sub(from).normalize());
    } else this.grenadeSys.throwFrom(eye, dir);
    this.audio.grenadeThrow();
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
    this.hud.flash(Math.max(0, 1 - dp / 18)); // fogonazo en pantalla si estalla cerca
    this.audio.grenadeExplosion(at.x, at.y, at.z); // la explosión grabada del detonador, en el mismo instante
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
    this.audio.startMusic();
    this.menu.hide();
    this.hud.setVisible(true, this.input.hasTouch);
    this.acc = 0;
    if (!this.input.hasTouch && !this.tuner.open) this.lockPointer();
  }

  private pause() {
    if (this.mode === 'cinematic') { (this.activeCine === 'arena' ? this.cine2 : this.cine).hold(true); this.audio.suspend(); return; }
    if (this.mode === 'transition') return;
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
    // ambiente: cañón, túnel (en la toma del túnel del paso a la arena) o arena; el cambio se hace con fundido cruzado
    this.audio.setAmbienceScene(currentZone() === 'canyon' ? 'canyon' : this.mode === 'cinematic' && this.activeCine === 'arena' && this.cine2.shotId === 'tunel' ? 'tunnel' : 'arena');
    if (inp.pausePressed) {
      if (this.mode === 'playing') this.pause();
      else if (this.mode === 'paused' && this.input.gamepadActive) this.resume();
    }

    if (this.mode === 'cinematic') {
      const cine = this.activeCine === 'arena' ? this.cine2 : this.cine;
      if (inp.pausePressed || inp.jumpPressed) cine.skip(); // Esc / Espacio / botón del mando
      cine.update(dt);
      if (this.mode === 'cinematic') {
        this.effects.update(dt);
        this.world.tick(dt);
        this.audio.setWindLevel(this.world.gust);
        const gustHit = this.world.consumeGust(); // golpe de viento al empezar cada ráfaga
        if (gustHit > 0) this.audio.windGust(gustHit);
        const plan = this.world.consumeGustPlan(); // la próxima ráfaga: el sonido grabado empieza antes, con su subida
        if (plan) this.audio.windGustPlanned(plan.k, plan.inSec);
        this.world.follow(this.camera.position);
        const f = this.camera.getWorldDirection(this.v3);
        this.audio.listener(this.camera.position.x, this.camera.position.y, this.camera.position.z, Math.atan2(-f.x, -f.z), Math.asin(Math.max(-1, Math.min(1, f.y))));
        this.dirty = true;
      }
    }

    if (this.mode === 'playing') {
      // Apuntar: el botón alterna; el disparo principal apunta mientras se mantiene; mando/ratón: mantener.
      if (inp.aimToggled) this.adsToggled = !this.adsToggled;
      // Con la granada en la mano no se apunta con zoom ni se dispara el bláster.
      const ready = this.swapT <= 0;
      const nadeBusy = this.viewModel.grenadeBusy;
      this.ads = !nadeBusy && (this.adsToggled || inp.aimHeld || (inp.fire && ready));
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
      this.swapT = Math.max(0, this.swapT - dt);
      const fireNow = inp.fire || inp.fireHip;
      // Granada: el botón de granada la saca (la mano izquierda la coge del cinturón y la sujeta) o, si ya la tienes, la guarda;
      // con ella en la mano, disparar la lanza. (Con el panel de ajuste abierto, solo sus botones.)
      if (!this.tuner.open) {
        if (inp.grenadePressed) { if (this.viewModel.grenadeHolding) this.viewModel.grenadePutAway(); else this.startGrenade(); }
        if (this.viewModel.grenadeHolding && fireNow && !this.prevFire) { this.viewModel.grenadeRelease(); this.swapT = 0.45; }
      }
      this.prevFire = fireNow;
      // los botones de disparo cambian su icono por el de lanzar mientras tienes la granada en la mano
      if (this.viewModel.grenadeHolding !== this.nadeHud) { this.nadeHud = this.viewModel.grenadeHolding; this.hud.setWeapon(this.nadeHud ? 'grenade' : 'blaster'); }
      this.grenadeCd = Math.max(0, this.grenadeCd - dt);
      this.shake = Math.max(0, this.shake - dt * 2.6);
      // Saltar: si estás agachado, primero te levantas.
      if (inp.jumpPressed) { if (this.wantCrouch) this.wantCrouch = false; else this.jumpBuffer = 0.14; }
      this.jumpBuffer = Math.max(0, this.jumpBuffer - dt);

      const cmd: InputCommand = { moveX: inp.moveX * moveK, moveZ: inp.moveZ * moveK, yaw: this.yaw, pitch: this.pitch, crouch: this.wantCrouch, jump: this.jumpBuffer > 0, fire: fireNow && !nadeBusy && this.swapT <= 0 };
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
      this.audio.setWindLevel(this.world.gust);
      const gustHit = this.world.consumeGust(); // golpe de viento al empezar cada ráfaga
      if (gustHit > 0) this.audio.windGust(gustHit);
      const plan = this.world.consumeGustPlan(); // la próxima ráfaga: el sonido grabado empieza antes, con su subida
      if (plan) this.audio.windGustPlanned(plan.k, plan.inSec);
      this.viewModel.update(dt, this.blaster.heat, this.adsZoom);
      this.dirty = true;
    }

    if (this.dirty) {
      this.renderFrame();
      this.dirty = false;
    }
  }

  /** Dibuja el escenario y, encima, la capa de los brazos y el arma (que así nunca atraviesan paredes ni rocas). */
  private renderFrame() {
    if (this.composer) this.composer.render(); else this.renderer.render(this.scene, this.camera);
    if (this.mode === 'playing' || this.mode === 'paused') {
      this.viewModel.syncCamera(this.camera);
      const r = this.renderer;
      r.autoClear = false;
      r.clearDepth();
      r.render(this.viewModel.scene, this.viewModel.cam);
      r.autoClear = true;
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
    this.viewModel.syncCamera(this.camera);
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
    let kind: 'ground' | 'droid' | 'shield' = 'ground';
    if (hit) {
      this.effects.flash(end);
      const droid = this.enemies.find(hit.collider.handle);
      if (droid) {
        const killed = droid.hit(BLASTER.damage, this.enemies.context);
        this.hits++;
        if (killed) this.registerKill();
        this.hud.hit(killed, droid.lastShielded);
        kind = droid.lastShielded ? 'shield' : 'droid';
      }
      this.effects.impact(end, dir, kind);
    }
    this.camera.updateMatrixWorld();
    const muzzlePos = this.viewModel.muzzle.getWorldPosition(this.v1);
    this.effects.muzzle(muzzlePos, 'player');
    this.effects.bolt(muzzlePos, end);
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
    return groundHeight(x, z);
  }

  /** Solo para pruebas: pone (o quita, con null) la maqueta de la entrada de la cueva (src/world/cave.ts). */
  private caveMock: THREE.Group | null = null;
  debugCave(opts: Partial<typeof CUEVA> | null = {}) {
    if (this.caveMock) { this.scene.remove(this.caveMock); this.caveMock = null; }
    if (!opts) return null;
    const c = buildCave(opts);
    this.caveMock = c.group;
    this.scene.add(c.group);
    return { triangulos: c.triangles, boca: c.mouth.toArray().map((v) => +v.toFixed(2)) };
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
    return { cine: this.activeCine === 'arena' ? this.cine2?.debug() : this.cine?.debug(), kits: this.medkits.list().length, audio: { jugados: this.audio.played, estadisticas: this.audio.stats }, arma: this.viewModel?.grenadeBusy ? 'granada' : 'blaster', grenades: this.state.players[0].grenades, grenadesInFlight: this.grenadeSys?.inFlight ?? 0, shake: this.shake, ads: this.ads, adsToggled: this.adsToggled, fov: this.camera.fov, round: this.waves?.round, phase: this.waves?.phase, remaining: this.waves?.remaining, kills: this.state.kills, health: this.state.players[0].health, testMode: this.testMode, heat: this.blaster.heat, locked: this.blaster.locked, shots: this.shots, hits: this.hits, enemies: this.state.enemies.map((e) => ({ ...e })), mode: this.mode, player: { ...this.localPlayer.state }, eye: this.eye, gamepad: this.input.gamepadActive };
  }
}
