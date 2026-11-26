import * as THREE from 'three';
import type { AudioEngine } from '../audio/AudioEngine';
import { CineSounds } from '../audio/CineSounds';
import { Voices } from '../audio/Voices';
import type { Effects } from '../weapons/Effects';
import { buildFlyingLaat, CommandoModel } from './actors';
import { createB1, poseB1, type B1Bones } from '../enemies/B1Rig';
import { createDroideka, dekaBounds, poseDroideka, ROLL, type DekaBones } from '../enemies/DroidekaRig';
import { DROID_SCALE } from '../enemies/sizes';
import { withDroidWear } from '../enemies/droidWear';
import { withLightFloor } from '../world/lightFill';
import { groundHeight } from '../world/zone';
import { caveMouth } from '../world/cave';
import { commandoModelReady } from '../player/commandoModel';
import { clipDuration, getClip, type BakedClip } from '../anim/mixamo';
import { ARENA_B, ARENA_SUN } from '../world/arena/layout';
import { ARENA2, CARRERA, COMANDO2, DROIDES_CAÑON, SALIDA2, TOMAS2, VOCES2, VUELO2, type Evento2, type Toma2 } from './script2';

// ============================================================================
//  CINEMÁTICA DE PASO A LA ARENA: reproductor
// ============================================================================
// Sigue el guion de script2.ts segundo a segundo: cámaras, actores (comando con las animaciones de Mixamo, cañonera, droides B1,
// droidekas), disparos, polvo, sonidos, voces con subtítulos, y lo que va encima de la imagen (barras, fundidos, textos, omitir).
// Usa la misma pantalla que la cinemática inicial (#cine) y la cortinilla de la pantalla de inicio para pasar del cañón a la arena.
// Mientras se ve el cañón, la arena se va montando escondida, a trozos (deps.prepStep); con la pantalla en negro de la cortinilla
// se cambia una por otra (deps.swap).
// ============================================================================

const $ = (id: string) => document.getElementById(id)!;
const SKIP_FADE = 0.35;
const clamp01 = (v: number) => Math.min(1, Math.max(0, v));
const smooth = (k: number) => { const t = clamp01(k); return t * t * (3 - 2 * t); };
const lerp = (a: number, b: number, k: number) => a + (b - a) * k;
/** Velocidad a la que corre el comando en la animación «Rifle_Run» tal cual (m/s): sirve para que los pies no resbalen. */
const RUN_NATURAL = 4.6;

export interface ArenaCineDeps {
  scene: THREE.Scene;
  camera: THREE.PerspectiveCamera;
  renderer: THREE.WebGLRenderer;
  audio: AudioEngine;
  effects: Effects;
  /** Pasa la cortinilla negra; con la pantalla en negro llama a `covered`. */
  wipe: (covered: () => void) => void;
  /** Avanza la preparación de la arena (máximo `budgetMs` ms); devuelve true cuando está lista. */
  prepStep: (budgetMs: number) => boolean;
  /** Cambia el cañón por la arena (acaba de prepararla si hace falta). */
  swap: () => void;
  /** Fin (o se ha omitido): dónde queda el comando, para empezar a jugar desde ahí. */
  onEnd: (at: { x: number; z: number; yaw: number }) => void;
}

interface Scheduled { at: number; fire: () => void }
interface Sub { from: number; to: number; quien: string; texto: string }
interface Pending { at: number; p: THREE.Vector3; d: THREE.Vector3; kind: 'ground' | 'droid' | 'enemy' }
interface B1Actor { mesh: THREE.SkinnedMesh; bones: B1Bones; x: number; z: number; yaw: number; phase: number }
interface DekaActor { mesh: THREE.SkinnedMesh; bones: DekaBones; shield: THREE.Mesh; shieldR: number }

export class ArenaCinematic {
  active = false;
  readonly voices = new Voices();
  private sounds = new CineSounds();
  private starts: number[] = [];
  private total = 0;
  private t = 0;
  private shot = -1;
  private queue: Scheduled[] = [];
  private qi = 0;
  private subs: Sub[] = [];
  private subShown = -1;
  private impulse = 0;
  private skipT = -1;
  private held = false;
  private swapped = false;
  private wiping = false;
  private musicOn = false;
  private shieldsAt = -1;
  private pending: Pending[] = [];
  private nextDroidShot = 0;
  private nextOwnShot = 0;
  private burst = 0;
  private stepPhase = 0;
  private lastShipDist = -1;
  private endAt = { x: 0, z: 0, yaw: 0 };

  // actores (se crean al empezar y se quitan al acabar)
  private root: THREE.Group | null = null;
  private ship: THREE.Group | null = null;
  private cmd: CommandoModel | null = null;
  private canyonB1: B1Actor[] = [];
  private arenaB1: B1Actor[] = [];
  private dekas: DekaActor[] = [];
  private arenaFx: THREE.Group | null = null;
  private dust: THREE.Points | null = null;
  private clips: Record<'run' | 'stop' | 'crouch' | 'kneel' | 'idle' | 'aim', BakedClip> | null = null;
  private path: THREE.Vector3[] = [];
  private pathLen: number[] = [];
  private runStart = 0;
  private stopShift = new THREE.Vector3();

  // pantalla
  private rootEl = $('cine');
  private fadeEl = $('cineFade');
  private titleEl = $('cineTitle');
  private locEl = $('cineLoc');
  private subEl = $('cineSub');
  private subWho = $('cineWho');
  private subText = $('cineText');
  private skipBtn = $('btnSkip');
  private outroTimer = 0;

  private v1 = new THREE.Vector3();
  private v2 = new THREE.Vector3();
  private v3 = new THREE.Vector3();
  private up = new THREE.Vector3(0, 1, 0);

  constructor(private d: ArenaCineDeps) {
    let acc = 0;
    for (const s of TOMAS2) { this.starts.push(acc); acc += s.duracion; }
    this.total = acc;
    this.skipBtn.addEventListener('click', (e) => { e.stopPropagation(); if (this.active) this.skip(); });
    window.addEventListener('keydown', (e) => { if (this.active && (e.code === 'Enter' || e.code === 'NumpadEnter')) this.skip(); });
  }

  /** Archivos de voz de esta cinemática. */
  static voiceIds() { return VOCES2; }

  /** ¿Se puede poner? (hace falta el modelo del comando y sus animaciones; si no, el juego hace el fundido de siempre). */
  static ready() {
    return commandoModelReady() && ['Rifle_Run', 'Rifle_Run_To_Stop', 'Crouch_Rapid_Fire', 'Rifle_Kneel_To_Stand', 'Rifle_Idle', 'Rifle_Aiming_Idle'].every((n) => !!getClip(n));
  }

  get duration() { return this.total; }
  /** ¿Ya se ha pasado a la arena? */
  get inArena() { return this.swapped; }

  // ---------- Actores ----------
  private build() {
    const { scene } = this.d;
    const root = new THREE.Group();
    root.name = 'cinematica-arena';
    this.root = root;
    this.clips = {
      run: getClip('Rifle_Run')!, stop: getClip('Rifle_Run_To_Stop')!, crouch: getClip('Crouch_Rapid_Fire')!,
      kneel: getClip('Rifle_Kneel_To_Stand')!, idle: getClip('Rifle_Idle')!, aim: getClip('Rifle_Aiming_Idle')!,
    };
    // comando (con el agarre del arma calculado con la postura de disparo agachado)
    const cmd = new CommandoModel(1.85);
    cmd.calibrateGrip(this.clips.crouch, 0);
    for (const m of cmd.group.children) m.traverse((o) => { o.castShadow = true; });
    root.add(cmd.group);
    this.cmd = cmd;
    // cuánto avanza «correr y pararse» (al pasar luego a la de reposo, el comando se queda donde frenó)
    cmd.group.position.set(0, 0, 0); cmd.group.rotation.set(0, 0, 0);
    cmd.animateMix({ clip: this.clips.stop, t: clipDuration(this.clips.stop) }, null);
    const a = cmd.hipsWorld(new THREE.Vector3());
    cmd.animateMix({ clip: this.clips.idle, t: 0 }, null);
    const b = cmd.hipsWorld(new THREE.Vector3());
    this.stopShift.set(a.x - b.x, 0, a.z - b.z);
    // cañonera en vuelo (la misma de la cinemática inicial)
    this.ship = buildFlyingLaat();
    root.add(this.ship);
    // droides: material como en la partida
    const mat = withDroidWear(withLightFloor(new THREE.MeshPhongMaterial({ vertexColors: true, shininess: 28, specular: 0x3a342e })));
    const b1 = (x: number, z: number, lod: number): B1Actor => {
      const { mesh, bones } = createB1(mat);
      if (bones.lods?.[lod]) mesh.geometry = bones.lods[lod];
      mesh.scale.setScalar(DROID_SCALE.b1);
      mesh.rotation.order = 'YXZ';
      mesh.castShadow = true;
      root.add(mesh);
      return { mesh, bones, x, z, yaw: 0, phase: Math.random() * 6 };
    };
    this.canyonB1 = DROIDES_CAÑON.map(([x, z]) => b1(x, z, 1));
    this.arenaB1 = ARENA2.b1.map((p) => b1(p.x, p.z, 0));
    const dekaMat = withDroidWear(withLightFloor(new THREE.MeshPhongMaterial({ vertexColors: true, shininess: 30, specular: 0x4a443c })));
    this.dekas = ARENA2.dekas.map(() => {
      const { mesh, bones } = createDroideka(dekaMat);
      mesh.scale.setScalar(DROID_SCALE.droideka);
      mesh.rotation.order = 'YXZ';
      mesh.castShadow = true;
      const bd = bones.lods ? dekaBounds(bones.lods[1]) : { y: 0.95, z: 0, r: 1 };
      const shield = new THREE.Mesh(
        new THREE.SphereGeometry(1, 24, 16),
        new THREE.MeshBasicMaterial({ color: 0x3aa8ff, transparent: true, opacity: 0, depthWrite: false, side: THREE.DoubleSide, fog: false }),
      );
      shield.position.set(0, bd.y, bd.z);
      shield.visible = false;
      mesh.add(shield);
      root.add(mesh);
      return { mesh, bones, shield, shieldR: bd.r };
    });
    // polvo en el aire de la arena y haces de luz que entran por arriba
    this.arenaFx = this.buildArenaFx();
    root.add(this.arenaFx);
    // camino de la carrera: los puntos del guion, la boca de la cueva y unos metros dentro
    const m = caveMouth();
    const pts = CARRERA.puntos.map(([x, z]) => new THREE.Vector3(x, 0, z));
    pts.push(new THREE.Vector3(m.x + m.out[0] * 1.6, 0, m.z), new THREE.Vector3(m.x, 0, m.z), new THREE.Vector3(m.x - m.out[0] * CARRERA.dentro, 0, m.z));
    this.path = pts;
    this.pathLen = [0];
    for (let i = 1; i < pts.length; i++) this.pathLen.push(this.pathLen[i - 1] + pts[i].distanceTo(pts[i - 1]));
    // la carrera empieza de forma que cruce la boca 0,85 s después de empezar la toma 6 (justo antes de que tape la cortinilla)
    const mouthS = this.pathLen[pts.length - 2];
    const iRun = TOMAS2.findIndex((s) => s.id === 'carrera'), iIn = TOMAS2.findIndex((s) => s.id === 'entrada');
    const runTime = this.starts[iIn] - this.starts[iRun] + 0.85;
    this.runStart = mouthS - CARRERA.velocidad * runTime;
    for (const o of root.children) o.visible = false;
    this.arenaFx.visible = false;
    scene.add(root);
  }

  private buildArenaFx() {
    const g = new THREE.Group();
    // motas de polvo flotando (puntos suaves)
    const N = 420, pos = new Float32Array(N * 3);
    for (let i = 0; i < N; i++) pos.set([(Math.random() * 2 - 1) * 30, 0.4 + Math.random() * 14, (Math.random() * 2 - 1) * 38], i * 3);
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    const cv = document.createElement('canvas');
    cv.width = cv.height = 32;
    const cx = cv.getContext('2d')!;
    const grd = cx.createRadialGradient(16, 16, 0, 16, 16, 16);
    grd.addColorStop(0, 'rgba(255,240,215,1)'); grd.addColorStop(1, 'rgba(255,240,215,0)');
    cx.fillStyle = grd; cx.fillRect(0, 0, 32, 32);
    const dust = new THREE.Points(geo, new THREE.PointsMaterial({ map: new THREE.CanvasTexture(cv), size: 0.16, transparent: true, opacity: 0.55, depthWrite: false, color: 0xffe2bd }));
    dust.frustumCulled = false;
    this.dust = dust;
    g.add(dust);
    // haces de luz: franjas alargadas y casi transparentes, inclinadas como el sol de la arena
    const sv = document.createElement('canvas');
    sv.width = 8; sv.height = 128;
    const sx = sv.getContext('2d')!;
    const lg = sx.createLinearGradient(0, 0, 0, 128);
    lg.addColorStop(0, 'rgba(255,236,200,0.9)'); lg.addColorStop(0.6, 'rgba(255,236,200,0.35)'); lg.addColorStop(1, 'rgba(255,236,200,0)');
    sx.fillStyle = lg; sx.fillRect(0, 0, 8, 128);
    const tex = new THREE.CanvasTexture(sv);
    const sun = new THREE.Vector3(ARENA_SUN.x, ARENA_SUN.y, ARENA_SUN.z).normalize();
    for (const [x, z, w] of [[-8, -6, 7], [6, 4, 9], [-2, 16, 6], [12, -16, 6]] as const) {
      const shaft = new THREE.Mesh(new THREE.PlaneGeometry(w, 70), new THREE.MeshBasicMaterial({ map: tex, transparent: true, opacity: 0.11, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide, fog: false }));
      // a lo largo del rayo de sol (de arriba hacia el suelo), de cara a quien mira de lado al sol
      const Y = sun.clone(), X = new THREE.Vector3().crossVectors(sun, new THREE.Vector3(0, 1, 0)).normalize(), Z = new THREE.Vector3().crossVectors(X, Y);
      shaft.quaternion.setFromRotationMatrix(new THREE.Matrix4().makeBasis(X, Y, Z));
      shaft.position.set(x, 0, z).addScaledVector(sun, 35);
      g.add(shaft);
    }
    return g;
  }

  // ---------- Empezar, omitir, acabar ----------
  /** Empieza (desde la toma `from`; las demás sirven para revisar una toma en el modo de pruebas). */
  start(from = 0) {
    if (!this.root) this.build();
    from = Math.max(0, Math.min(TOMAS2.length - 1, from));
    this.active = true;
    this.held = false;
    this.t = this.starts[from];
    this.shot = -1;
    this.skipT = -1;
    this.impulse = 0;
    this.subs = [];
    this.subShown = -1;
    this.pending = [];
    this.wiping = false;
    this.musicOn = false;
    this.shieldsAt = -1;
    this.lastShipDist = -1;
    // revisar desde una toma de la arena: se pasa ya
    const arenaFrom = TOMAS2.findIndex((s) => s.id === 'tunel');
    if (from >= arenaFrom && !this.swapped) this.doSwap();
    // eventos y diálogos ordenados por tiempo (los de antes del punto de inicio se saltan)
    this.queue = [];
    TOMAS2.forEach((s, i) => {
      const t0 = this.starts[i];
      for (const e of s.eventos ?? []) this.queue.push({ at: t0 + e.en, fire: () => this.event(e) });
      for (const dl of s.dialogos ?? []) {
        this.queue.push({
          at: t0 + dl.en,
          fire: () => {
            const dur = this.voices.say(dl.voz, dl.filtro, dl.dura);
            this.subs.push({ from: this.t, to: this.t + dur + 0.2, quien: dl.quien, texto: dl.texto });
          },
        });
      }
    });
    this.queue.sort((a, b) => a.at - b.at);
    this.qi = this.queue.findIndex((q) => q.at >= this.t);
    if (this.qi < 0) this.qi = this.queue.length;
    // pantalla: negro, barras, botón de omitir
    clearTimeout(this.outroTimer);
    this.rootEl.hidden = false;
    this.rootEl.classList.remove('outro');
    this.rootEl.classList.add('on');
    this.fadeEl.style.transition = '';
    this.fadeEl.style.opacity = '1';
    this.titleEl.style.opacity = '0';
    this.locEl.style.opacity = '0';
    this.subEl.classList.remove('show');
    this.skipBtn.hidden = false;
    this.d.camera.near = 0.05;
    this.d.camera.updateProjectionMatrix();
    // la música de la arena empieza con la cinemática (la del cañón se apaga antes, poco a poco)
    this.d.audio.fadeOutGameMusic(0.9);
    if (!this.swapped) this.sounds.startEngine(0.0001, 0.2);
    // prepara de una vez los sombreadores de lo que va a salir (evita tirones al cambiar de toma)
    for (const o of this.root!.children) o.visible = true;
    this.d.renderer.compile(this.d.scene, this.d.camera);
    this.hideAll();
    this.update(0);
  }

  skip() {
    if (!this.active || this.skipT >= 0) return;
    this.skipT = 0;
    this.skipBtn.hidden = true;
    this.voices.stopAll();
    this.sounds.stopAll();
  }

  hold(on: boolean) { this.held = on; }

  private doSwap() {
    if (this.swapped) return;
    this.swapped = true;
    this.d.swap();
    this.d.effects.clear();
    // con la pantalla en negro se salta al principio de la toma del túnel (así todo cuadra aunque el móvil vaya lento)
    const tunnelAt = this.starts[TOMAS2.findIndex((q) => q.id === 'tunel')];
    if (this.active && this.t < tunnelAt) this.t = tunnelAt;
    this.pending = [];
    this.sounds.stopEngine(0.2);
  }

  private finish() {
    if (!this.active) return;
    this.active = false;
    if (!this.swapped) this.doSwap();
    this.startMusic();
    // se empieza a jugar donde se queda el comando: a la salida del túnel sur, mirando a la arena (también si se ha omitido)
    const end = this.stopEnd();
    this.endAt = { x: end.x, z: end.z, yaw: 0 };
    this.d.camera.up.set(0, 1, 0);
    this.d.camera.near = 0.08;
    this.d.camera.updateProjectionMatrix();
    this.subEl.classList.remove('show');
    this.titleEl.style.opacity = '0';
    this.locEl.style.opacity = '0';
    this.skipBtn.hidden = true;
    this.fadeEl.style.opacity = '1';
    this.sounds.stopAll();
    // fuera los actores (sus formas se comparten con el resto del juego: no se borran de la memoria)
    if (this.root) {
      this.d.scene.remove(this.root);
      this.root = null;
      this.cmd = null;
    }
    this.d.onEnd(this.endAt);
    void this.fadeEl.offsetWidth;
    this.rootEl.classList.add('outro');
    this.rootEl.classList.remove('on');
    this.fadeEl.style.transition = `opacity ${SALIDA2.fundido}s ease-out`;
    this.fadeEl.style.opacity = '0';
    this.outroTimer = window.setTimeout(() => {
      this.rootEl.hidden = true;
      this.rootEl.classList.remove('outro');
      this.fadeEl.style.transition = '';
    }, SALIDA2.fundido * 1000 + 700);
  }

  private startMusic() {
    if (this.musicOn) return;
    this.musicOn = true;
    this.d.audio.setGameMusic('arena');
    this.d.audio.startMusic();
  }

  private event(e: Evento2) {
    switch (e.tipo) {
      case 'chisporroteo': this.voices.static('casco', e.dura, 0.05, undefined, true); this.voices.click('casco', true); break;
      case 'radioVuelve': this.voices.staticFade('piloto', e.dura, 0.11, 0.012); this.voices.click('piloto', false); break;
      case 'escudos': this.shieldsAt = this.t; this.sounds.shieldOn(1); break;
      case 'cañonazo': this.d.audio.boomNow(0.25 + 0.5 * e.fuerza); this.impulse = Math.max(this.impulse, 0.25 * e.fuerza); break;
      case 'cortinilla':
        if (this.swapped || this.wiping) break;
        this.wiping = true;
        this.d.wipe(() => { if (this.active) this.doSwap(); });
        break;
    }
  }

  // ---------- Bucle ----------
  update(dt: number) {
    if (!this.active || this.held) return;
    if (this.skipT >= 0) {
      this.skipT += dt;
      this.fadeEl.style.opacity = String(clamp01(this.skipT / SKIP_FADE));
      if (this.skipT >= SKIP_FADE + 0.05) this.finish();
      return;
    }
    this.t += dt;
    // la toma del túnel ya es en la arena: hasta que la cortinilla no tape la pantalla y se haga el cambio, se espera al final de la toma 6
    const tunnelAt = this.starts[TOMAS2.findIndex((q) => q.id === 'tunel')];
    if (!this.swapped && this.t >= tunnelAt) this.t = tunnelAt - 0.0005;
    if (!this.musicOn && this.t > 0.95) this.startMusic();
    if (this.t >= this.total) { this.finish(); return; }
    let i = this.starts.length - 1;
    while (i > 0 && this.starts[i] > this.t) i--;
    const s = TOMAS2[i];
    if (i !== this.shot) this.enterShot(i);
    const u = this.t - this.starts[i];
    while (this.qi < this.queue.length && this.queue[this.qi].at <= this.t) this.queue[this.qi++].fire();
    // la arena se va montando escondida (unos milisegundos por imagen) mientras se ve el cañón
    if (!this.swapped) this.d.prepStep(5);
    this.impulse = Math.max(0, this.impulse - dt * 1.6);
    this.flushImpacts();
    this.animate(s, u, dt);
    this.shake(s);
    this.overlay(s, u);
  }

  private enterShot(i: number) {
    this.shot = i;
    const s = TOMAS2[i];
    const cam = this.d.camera;
    if (cam.fov !== s.angulo) { cam.fov = s.angulo; cam.updateProjectionMatrix(); }
    this.hideAll();
  }

  private hideAll() {
    if (!this.root) return;
    for (const o of this.root.children) o.visible = false;
  }

  // ---------- Ayudas ----------
  private gh(x: number, z: number) { return groundHeight(x, z); }
  private place(o: THREE.Object3D, x: number, z: number, yaw: number) {
    o.position.set(x, this.gh(x, z), z);
    o.rotation.y = yaw;
    o.visible = true;
  }
  private look(pos: THREE.Vector3, at: THREE.Vector3) {
    const cam = this.d.camera;
    cam.up.set(0, 1, 0);
    cam.position.copy(pos);
    cam.lookAt(at);
  }
  /** Punto a `h` metros sobre el suelo. */
  private G(x: number, h: number, z: number, out = new THREE.Vector3()) { return out.set(x, this.gh(x, z) + h, z); }
  /** Ángulo de giro (yaw) para mirar de (x, z) hacia (tx, tz): el modelo mira a −Z cuando el giro es 0. */
  private yawTo(x: number, z: number, tx: number, tz: number) { return Math.atan2(-(tx - x), -(tz - z)); }

  /** Punto del camino de la carrera a `s` metros (antes del primer punto, siguiendo el primer tramo hacia atrás) y hacia dónde va. */
  private pathAt(s: number, out: THREE.Vector3, dir: THREE.Vector3) {
    const P = this.path, L = this.pathLen;
    let i = 0;
    while (i < P.length - 2 && L[i + 1] < s) i++;
    const seg = L[i + 1] - L[i];
    const k = (s - L[i]) / seg;
    dir.copy(P[i + 1]).sub(P[i]).normalize();
    out.copy(P[i]).lerp(P[i + 1], k);
    // esquinas suaves: cerca del final de un tramo, la dirección se va girando hacia la del siguiente
    if (i < P.length - 2) {
      const next = this.v3.copy(P[i + 2]).sub(P[i + 1]).normalize();
      const blend = smooth((s - (L[i + 1] - 2.5)) / 5);
      dir.lerp(next, blend * 0.5).normalize();
    }
    return out;
  }

  // ---------- Disparos ----------
  private shootBolt(from: THREE.Vector3, to: THREE.Vector3, enemy: boolean, kind: Pending['kind']) {
    const fx = this.d.effects;
    if (enemy) { fx.enemyBolt(from, to); fx.muzzle(from, 'enemy'); } else { fx.bolt(from, to); fx.muzzle(from, 'player'); }
    const dist = from.distanceTo(to);
    this.pending.push({ at: this.t + dist / (enemy ? 95 : 170), p: to.clone(), d: to.clone().sub(from).normalize(), kind });
    const cam = this.d.camera.position;
    if (enemy) this.d.audio.enemyShot('b1', from.x, from.y, from.z, from.distanceTo(cam));
    else this.d.audio.playerShot();
  }
  private flushImpacts() {
    for (let k = this.pending.length - 1; k >= 0; k--) {
      const q = this.pending[k];
      if (q.at > this.t) continue;
      this.d.effects.impact(q.p, q.d, q.kind);
      this.pending.splice(k, 1);
    }
  }
  /** Un B1 del cañón dispara hacia `target` (con algo de error). */
  private droidFires(target: THREE.Vector3, spread: number, groundHit = false) {
    const b = this.canyonB1[Math.floor(Math.random() * this.canyonB1.length)];
    const from = this.G(b.x, 1.32, b.z);
    from.x += 0.25; from.z += 0.45;
    const to = target.clone().add(new THREE.Vector3((Math.random() - 0.5) * spread, (Math.random() - 0.3) * spread * 0.6, (Math.random() - 0.5) * spread));
    if (groundHit) to.y = this.gh(to.x, to.z) + 0.02;
    this.shootBolt(from, to, true, groundHit ? 'ground' : 'enemy');
  }

  // ---------- Lo que pasa en cada toma ----------
  private animate(s: Toma2, u: number, dt: number) {
    const C = this.clips!, cmd = this.cmd!;
    const cx = COMANDO2.x, cz = COMANDO2.z;
    const head = (x: number, z: number) => this.G(x, 1.15, z);
    switch (s.id) {
      case 'pasada': {
        this.flyPass(this.t - this.starts[this.shot]);
        const cam = this.G(VUELO2.camara[0], VUELO2.camara[1], VUELO2.camara[2]);
        // la cámara sigue a la nave con algo de retraso (sin llegar a mirar justo arriba)
        const target = this.ship!.position.clone();
        target.y = Math.min(target.y, cam.y + 16);
        const k = smooth(u / 1.2);
        const start = this.G(VUELO2.camara[0] - 2, 6, VUELO2.camara[2] + 30);
        this.look(cam, start.lerp(target, 0.35 + 0.65 * k));
        this.engineByDistance(dt);
        break;
      }
      case 'combate': {
        this.place(cmd.group, cx, cz, 0);
        cmd.animateMix({ clip: C.crouch, t: u, loop: true }, null);
        this.showCanyonDroids(this.t);
        this.ownFire(u, 0.55);
        this.enemyFire(head(cx, cz), 2.2, 0.1, 0.28);
        // de lado, algo girada hacia el norte: los disparos azules y rojos cruzan la imagen
        this.look(this.G(cx + 3.7, 1.15, cz + 0.7), this.G(cx - 0.4, 1.05, cz - 2.5));
        this.orbitShip(u - 4, true); // la cañonera, lejos, ya vuelve hacia aquí
        break;
      }
      case 'radioA': case 'radioB': {
        const k = s.id === 'radioA' ? u : 4 + u;
        this.place(cmd.group, cx, cz, 0);
        this.showCanyonDroids(this.t);
        // deja de disparar: de la postura de disparo pasa a la de rodilla en tierra; la mano al casco; mira al cielo siguiendo a la nave
        const shipP = this.orbitShip(k, true);
        const me = head(cx, cz);
        const rel = shipP.clone().sub(me);
        const elev = Math.atan2(rel.y, Math.hypot(rel.x, rel.z));
        const az = Math.atan2(-rel.x, -rel.z); // 0 = al frente (norte), + = a su izquierda
        const lookK = smooth((k - 1.0) / 1.2);
        cmd.animateMix({ clip: C.kneel, t: 0.02 }, { clip: C.crouch, t: 4 + k, loop: true, w: 1 - smooth(k / 0.45) }, {
          helmet: smooth((k - 0.3) / 0.5),
          lookUp: lookK * Math.min(0.8, elev * 0.85),
          lookSide: lookK * Math.max(-0.9, Math.min(0.9, az * 0.6)),
        });
        if (k < 2.5) this.enemyFire(head(cx, cz), 3.0, 0.55, 1.2); else this.distantFire(dt);
        if (s.id === 'radioA') {
          const e = smooth(u / s.duracion);
          this.look(this.G(cx + 1.25 - 0.25 * e, 1.38, cz - 2.75 + 0.4 * e), this.G(cx, 1.12, cz));
        } else {
          // desde abajo, junto al comando: la cañonera da vueltas sobre el cañón
          const cam = this.G(cx - 0.75, 0.45, cz + 1.1);
          const tgt = shipP.clone().lerp(this.G(cx, 1.3, cz), 0.12);
          this.look(cam, tgt);
        }
        this.engineByDistance(dt);
        break;
      }
      case 'respuesta': {
        this.showCanyonDroids(this.t);
        this.orbitShip(8 + u, true);
        this.distantFire(dt);
        // se levanta (la mano baja del casco) y arranca a correr hacia la cueva
        const kt = Math.max(0, u - 0.3);
        const standDur = clipDuration(C.kneel);
        const runW = smooth((u - 1.7) / 0.35);
        const first = this.v2;
        this.pathAt(this.runStart, this.v1, first);
        const yaw = lerp(0, Math.atan2(-first.x, -first.z), smooth((u - 1.35) / 0.7));
        const pos = this.v1.set(cx, 0, cz).addScaledVector(first, Math.max(0, u - 1.75) * CARRERA.velocidad * 0.6);
        this.place(cmd.group, pos.x, pos.z, yaw);
        cmd.animateMix({ clip: C.kneel, t: Math.min(standDur, kt) }, runW > 0 ? { clip: C.run, t: (u - 1.7) * CARRERA.velocidad / RUN_NATURAL, loop: true, w: runW } : null,
          { helmet: 1 - smooth((u - 0.05) / 0.45), lookUp: 0.5 * (1 - smooth(u / 0.6)) });
        this.look(this.G(cx + 2.5, 1.4, cz + 2.7), this.G(cx - 0.3, 1.05 + 0.25 * smooth((u - 0.4) / 1.2), cz - 0.4));
        this.engineByDistance(dt);
        break;
      }
      case 'carrera': case 'entrada': {
        const T = this.t - this.starts[TOMAS2.findIndex((q) => q.id === 'carrera')];
        const sPath = this.runStart + T * CARRERA.velocidad;
        const p = this.pathAt(sPath, this.v1, this.v2).clone();
        const dir = this.v2.clone();
        this.place(cmd.group, p.x, p.z, Math.atan2(-dir.x, -dir.z));
        cmd.animateMix({ clip: C.run, t: T * CARRERA.velocidad / RUN_NATURAL, loop: true }, null);
        const m = caveMouth();
        const inside = (m.x - p.x) * m.out[0]; // metros dentro de la cueva
        cmd.setShade(lerp(1, 0.18, smooth(inside / 2.5)));
        this.showCanyonDroids(this.t);
        if (s.id === 'carrera') {
          // impactos levantando arena a su alrededor y algún disparo que pasa
          if (this.t >= this.nextDroidShot) {
            this.nextDroidShot = this.t + 0.13 + Math.random() * 0.22;
            const ahead = p.clone().addScaledVector(dir, 1 + Math.random() * 3);
            ahead.x += (Math.random() - 0.5) * 4; ahead.z += (Math.random() - 0.5) * 4;
            this.droidFires(ahead, 0.5, true);
          }
          // detrás de él y algo de lado (por el mismo camino que ha corrido: ahí no hay rocas que tapen)
          const side = new THREE.Vector3(-dir.z, 0, dir.x); // a su derecha
          const cam = p.clone().addScaledVector(dir, -4.2).addScaledVector(side, 1.0);
          cam.y = this.gh(cam.x, cam.z) + 1.85;
          const at = p.clone().addScaledVector(dir, 6);
          at.y = this.gh(at.x, at.z) + 1.05;
          this.look(cam, at);
        } else {
          // desde fuera: entra en la oscuridad de la cueva
          const along = new THREE.Vector3(0, 0, 1);
          const cam = new THREE.Vector3(m.x + m.out[0] * 9.5, 0, m.z).addScaledVector(along, 3.6);
          cam.y = this.gh(cam.x, cam.z) + 1.7;
          this.look(cam, new THREE.Vector3(m.x - m.out[0] * 1.0, m.y + 1.9, m.z));
        }
        break;
      }
      case 'tunel': {
        const A = ARENA2.tunel;
        const z = lerp(A.desde, A.hasta, u / s.duracion);
        const speed = (A.desde - A.hasta) / s.duracion;
        this.place(cmd.group, A.x, z, 0);
        cmd.animateMix({ clip: C.run, t: u * speed / RUN_NATURAL * 1.15, loop: true }, null);
        cmd.setShade(0.1); // silueta a contraluz
        // pasos con eco: dos por cada vuelta de la animación de correr
        const phase = (u * speed / RUN_NATURAL * 1.15) / clipDuration(C.run) * 2;
        if (Math.floor(phase) !== Math.floor(this.stepPhase)) this.sounds.echoStep(0.9);
        this.stepPhase = phase;
        this.look(new THREE.Vector3(A.x + 0.55, 1.45, z + 3.1), new THREE.Vector3(0, 1.5, ARENA_B - 8));
        this.showArenaFx(dt);
        this.showArenaB1(0, false);
        break;
      }
      case 'arena': {
        const e = smooth(u / s.duracion);
        this.look(new THREE.Vector3(lerp(-37, -30, e), lerp(27, 23.5, e), lerp(38, 33, e)), new THREE.Vector3(lerp(0, 2, e), 0, lerp(3, 0, e)));
        this.showArenaFx(dt);
        this.showArenaB1(0, false);
        break;
      }
      case 'droides': {
        const A = ARENA2;
        this.place(cmd.group, A.tunel.x, A.frena, 0);
        cmd.setShade(1);
        const stopDur = clipDuration(C.stop);
        if (u < stopDur) cmd.animateMix({ clip: C.stop, t: u }, null);
        else this.idleAfterStop(u - stopDur, u);
        this.showArenaB1(u, true);
        this.look(new THREE.Vector3(A.tunel.x + 0.9, 1.75, A.frena + 1.6), new THREE.Vector3(0, 1.2, 30));
        this.showArenaFx(dt);
        break;
      }
      case 'dekas': case 'escudos': case 'cierre': {
        const T = this.t - this.starts[TOMAS2.findIndex((q) => q.id === 'dekas')];
        const tDroides = TOMAS2.find((q) => q.id === 'droides')!.duracion;
        const stopDur = clipDuration(C.stop);
        const end = this.stopEnd();
        if (s.id === 'cierre') {
          this.place(cmd.group, end.x, end.z, 0);
          const w = smooth(u / 0.45);
          cmd.animateMix({ clip: C.aim, t: u, loop: true }, { clip: C.idle, t: tDroides - stopDur + T, loop: true, w: 1 - w });
        } else this.idleAfterStop(tDroides - stopDur + T, tDroides + T);
        this.showArenaB1(tDroides + T, true);
        const P = this.dekaUpdate(T);
        if (s.id === 'dekas') this.look(new THREE.Vector3(end.x + 1.5, 1.3, end.z + 2.3), new THREE.Vector3(1.5, 0.6, 28));
        else if (s.id === 'escudos') {
          // primer plano del primer droideka; el otro, detrás y desenfocado por la distancia
          const p0 = P[0], toCmd = new THREE.Vector3(end.x - p0.x, 0, end.z - p0.z).normalize();
          const side = new THREE.Vector3(-toCmd.z, 0, toCmd.x);
          const cam = p0.clone().addScaledVector(toCmd, 3.6).addScaledVector(side, -1.2);
          cam.y = 1.15;
          this.look(cam, new THREE.Vector3(p0.x, 0.92, p0.z).addScaledVector(side, 0.25));
        } else this.look(new THREE.Vector3(end.x + 1.2, 1.7, end.z + 2.4), new THREE.Vector3(1.5, 1.0, 29));
        this.showArenaFx(dt);
        break;
      }
      case 'ronda':
        break;
    }
  }

  /** Dónde se queda el comando al acabar de frenar a la salida del túnel. */
  private stopEnd() { return { x: ARENA2.tunel.x + this.stopShift.x, z: ARENA2.frena + this.stopShift.z }; }

  /** De pie en reposo donde frenó (con un paso suave desde la última postura de «correr y pararse»). */
  private idleAfterStop(ti: number, _total: number) {
    const C = this.clips!, cmd = this.cmd!;
    const end = this.stopEnd();
    this.place(cmd.group, end.x, end.z, 0);
    const w = 1 - smooth(ti / 0.35);
    cmd.animateMix({ clip: C.idle, t: ti, loop: true }, w > 0 ? { clip: C.stop, t: clipDuration(C.stop), w, hips: false } : null);
    this.endAt = { x: end.x, z: end.z, yaw: 0 };
  }

  /** B1 del tiroteo del cañón, de pie disparando (se balancean un poco). */
  private showCanyonDroids(t: number) {
    for (const b of this.canyonB1) {
      b.mesh.visible = true;
      b.mesh.position.set(b.x, this.gh(b.x, b.z), b.z);
      b.mesh.rotation.y = this.yawTo(b.x, b.z, COMANDO2.x, COMANDO2.z);
      poseB1(b.bones, 1, 0.15, b.phase + t * 1.3);
    }
  }

  /** B1 de la arena: de espaldas; a partir de su segundo `gira` se vuelven hacia el comando, dando unos pasos y subiendo el arma. */
  private showArenaB1(u: number, turning: boolean) {
    const end = this.stopEnd();
    ARENA2.b1.forEach((p, i) => {
      const b = this.arenaB1[i];
      b.mesh.visible = true;
      const k = turning ? smooth((u - p.gira) / 0.6) : 0;
      const away = Math.PI * 0 + (i % 2 ? 0.25 : -0.2); // mirando al norte (de espaldas al túnel), cada uno algo distinto
      const face = this.yawTo(p.x, p.z, end.x, end.z);
      let dy = face - away;
      dy = Math.atan2(Math.sin(dy), Math.cos(dy));
      b.mesh.position.set(p.x, 0, p.z);
      b.mesh.rotation.y = away + dy * k;
      const walk = turning ? Math.sin(Math.PI * clamp01((u - p.gira) / 0.6)) * 0.8 : 0;
      poseB1(b.bones, lerp(0.84, 1, k), walk, b.phase + u * 4);
    });
  }

  /** Droidekas: ruedan hasta su sitio, frenan, se despliegan y encienden el escudo. Devuelve dónde están. */
  private dekaUpdate(T: number) {
    const A = ARENA2;
    const end = this.stopEnd();
    const ring = ROLL.ring * DROID_SCALE.droideka;
    const out: THREE.Vector3[] = [];
    A.dekas.forEach((dk, i) => {
      const a = this.dekas[i];
      a.mesh.visible = true;
      const [x0, z0] = dk.desde, [x1, z1] = dk.hasta;
      const k = clamp01(T / A.rueda);
      const e = 1 - (1 - k) * (1 - k); // frena al llegar
      const x = lerp(x0, x1, e), z = lerp(z0, z1, e);
      const dist = Math.hypot(x1 - x0, z1 - z0) * e;
      const dep = clamp01((T - A.rueda - 0.05) / A.despliega);
      const rollYaw = this.yawTo(x0, z0, x1, z1), faceYaw = this.yawTo(x1, z1, end.x, end.z);
      let dy = faceYaw - rollYaw; dy = Math.atan2(Math.sin(dy), Math.cos(dy));
      a.mesh.position.set(x, 0, z);
      a.mesh.rotation.y = rollYaw + dy * smooth(dep * 1.6);
      poseDroideka(a.bones, smooth(dep), dist / ring, this.t);
      // escudo: aparece de golpe y se asienta
      if (this.shieldsAt >= 0) {
        const st = this.t - this.shieldsAt;
        const pop = clamp01(st / 0.22);
        a.shield.visible = true;
        a.shield.scale.setScalar(a.shieldR * lerp(0.55, 1, 1 - (1 - pop) * (1 - pop)) * (1 + 0.05 * Math.exp(-st * 5) * Math.sin(st * 40)));
        (a.shield.material as THREE.MeshBasicMaterial).opacity = (0.13 + 0.45 * Math.exp(-st * 3.2)) * 0.8;
      } else a.shield.visible = false;
      out.push(new THREE.Vector3(x, 0, z));
    });
    return out;
  }

  /** Disparos del comando (ráfagas de 3) hacia los B1 del cañón. */
  private ownFire(_u: number, every: number) {
    if (this.t < this.nextOwnShot) return;
    const cmd = this.cmd!;
    const b = this.canyonB1[Math.floor(Math.random() * this.canyonB1.length)];
    const from = cmd.muzzle(new THREE.Vector3());
    const to = this.G(b.x + (Math.random() - 0.5) * 0.6, 1.0 + Math.random() * 0.6, b.z);
    this.shootBolt(from, to, false, Math.random() < 0.6 ? 'droid' : 'ground');
    this.burst = (this.burst + 1) % 3;
    this.nextOwnShot = this.t + (this.burst === 0 ? every * (0.7 + Math.random() * 0.5) : 0.12);
  }

  /** Disparos de los B1 hacia el comando (fallan y dan en la caja o en el suelo). */
  private enemyFire(target: THREE.Vector3, spread: number, minGap: number, maxGap: number) {
    if (this.t < this.nextDroidShot) return;
    this.nextDroidShot = this.t + minGap + Math.random() * (maxGap - minGap);
    const tg = target.clone();
    tg.z -= 1.0; // la caja de delante
    this.droidFires(tg, spread, Math.random() < 0.35);
  }

  private distantFire(dt: number) {
    if (Math.random() < dt * 2.2) this.d.audio.distantFire();
  }

  // ---------- Cañonera ----------
  /** Pasada rasante de sur a norte (toma 1): `u` segundos desde que empieza la toma. */
  private flyPass(u: number) {
    const V = VUELO2.pasada, ship = this.ship!;
    const k = (u - V.empieza) / V.dura;
    const base = this.gh(COMANDO2.x, COMANDO2.z);
    const a = new THREE.Vector3(V.desde[0], base + V.desde[1], V.desde[2]);
    const b = new THREE.Vector3(V.hasta[0], base + V.hasta[1], V.hasta[2]);
    const pos = a.clone().lerp(b, k);
    pos.y += Math.sin(u * 1.3) * 0.3;
    this.orient(ship, pos, b.clone().sub(a).normalize(), THREE.MathUtils.degToRad(-4) + Math.sin(u * 0.9) * 0.03);
    ship.visible = true;
    // polvo levantado bajo la nave (más cuanto más baja va)
    const gy = this.gh(pos.x, pos.z);
    if (pos.y - gy < 22) this.d.effects.groundDust(pos.x + (Math.random() - 0.5) * 6, this.gh(pos.x, pos.z), pos.z + (Math.random() - 0.5) * 8, 3, 6, 7);
    // la cámara tiembla cuando pasa por encima
    const near = this.d.camera.position.distanceTo(pos);
    this.impulse = Math.max(this.impulse, 0.5 * clamp01(1 - (near - 12) / 22));
    return pos;
  }

  /** Vueltas sobre el cañón (tomas 2 a 4): `k` segundos desde que empezó la toma 3A (antes, negativo). Devuelve dónde está. */
  private orbitShip(k: number, show: boolean) {
    const O = VUELO2.orbita, ship = this.ship!;
    const e = k / 8; // de 3A a 3B
    const ang = THREE.MathUtils.degToRad(lerp(O.giroDesde, O.giroHasta, e));
    const [cxo, czo] = O.centro;
    const pos = new THREE.Vector3(cxo + Math.cos(ang) * O.radio, this.gh(COMANDO2.x, COMANDO2.z) + O.altura + Math.sin(k * 0.7) * 0.6, czo + Math.sin(ang) * O.radio);
    const dirSign = O.giroHasta >= O.giroDesde ? 1 : -1;
    const tangent = new THREE.Vector3(-Math.sin(ang), 0, Math.cos(ang)).multiplyScalar(dirSign);
    this.orient(ship, pos, tangent, -dirSign * THREE.MathUtils.degToRad(O.alabeo));
    ship.visible = show;
    return pos;
  }

  /** Coloca la nave en `pos` con el morro hacia `dir` y ladeada `roll` radianes. */
  private orient(ship: THREE.Object3D, pos: THREE.Vector3, dir: THREE.Vector3, roll: number) {
    const X = dir.clone().normalize();
    const Z = new THREE.Vector3().crossVectors(X, this.up).normalize();
    const Y = new THREE.Vector3().crossVectors(Z, X);
    const q = new THREE.Quaternion().setFromRotationMatrix(new THREE.Matrix4().makeBasis(X, Y, Z));
    q.multiply(new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(1, 0, 0), roll));
    ship.position.copy(pos);
    ship.quaternion.copy(q);
    ship.updateMatrixWorld(true);
  }

  /** El motor suena según lo cerca que esté la nave, y más agudo al acercarse y más grave al alejarse. */
  private engineByDistance(dt: number) {
    if (!this.ship?.visible) { this.sounds.setEngine(0.0001, 1); return; }
    const dist = this.d.camera.position.distanceTo(this.ship.position);
    const v = this.lastShipDist < 0 || dt <= 0 ? 0 : (dist - this.lastShipDist) / dt;
    this.lastShipDist = dist;
    const level = Math.min(1, Math.pow(26 / Math.max(6, dist), 1.3));
    const pitch = Math.max(0.78, Math.min(1.3, 1 - v / 90));
    this.sounds.setEngine(level, pitch);
  }

  // ---------- Arena ----------
  private showArenaFx(dt: number) {
    const fx = this.arenaFx!;
    fx.visible = true;
    for (const c of fx.children) c.visible = true;
    // el polvo flota despacio con el aire
    const p = this.dust!.geometry.attributes.position as THREE.BufferAttribute;
    for (let i = 0; i < p.count; i++) {
      let x = p.getX(i) + dt * (0.35 + 0.2 * Math.sin(i)), y = p.getY(i) + dt * 0.08 * Math.sin(i * 1.7 + this.t);
      if (x > 30) x -= 60;
      if (y > 14.5) y = 0.4;
      p.setXY(i, x, y);
    }
    p.needsUpdate = true;
  }

  // ---------- Encima de la imagen ----------
  private shake(s: Toma2) {
    const cam = this.d.camera;
    const A = (s.temblor ?? 0) + this.impulse * 2.2;
    if (A <= 0.001) return;
    const T = this.t;
    const n1 = Math.sin(T * 7.3) * 0.6 + Math.sin(T * 13.1 + 1) * 0.4;
    const n2 = Math.sin(T * 6.1 + 2) * 0.6 + Math.sin(T * 11.7 + 4) * 0.4;
    const j = this.impulse > 0.01 ? Math.sin(T * 41) * this.impulse : 0;
    cam.rotateX((n1 * 0.006 + j * 0.02) * A);
    cam.rotateY((n2 * 0.006 + j * 0.015) * A);
    cam.position.y += (Math.sin(T * 9.7) * 0.012 + j * 0.03) * A;
  }

  private overlay(s: Toma2, u: number) {
    let fade = s.negro ? 1 : 0;
    if (s.fundidoEntrada && u < s.fundidoEntrada) fade = Math.max(fade, 1 - u / s.fundidoEntrada);
    if (s.fundidoSalida && u > s.duracion - s.fundidoSalida) fade = Math.max(fade, (u - (s.duracion - s.fundidoSalida)) / s.fundidoSalida);
    this.fadeEl.style.opacity = fade.toFixed(3);
    if (s.titulo) {
      const a = clamp01((u - s.titulo.entra) / 0.35) * (1 - clamp01((u - s.titulo.sale) / 0.3));
      this.titleEl.textContent = s.titulo.texto;
      this.titleEl.style.opacity = a.toFixed(3);
      this.titleEl.style.letterSpacing = (0.5 + 0.08 * u) + 'em';
    } else this.titleEl.style.opacity = '0';
    if (s.rotulo) {
      const a = clamp01((u - s.rotulo.entra) / 0.6) * (1 - clamp01((u - s.rotulo.sale) / 0.5));
      this.locEl.textContent = s.rotulo.texto;
      this.locEl.style.opacity = a.toFixed(3);
    } else this.locEl.style.opacity = '0';
    let cur = -1;
    for (let k = 0; k < this.subs.length; k++) if (this.subs[k].from <= this.t && this.t < this.subs[k].to) cur = k;
    if (cur !== this.subShown) {
      this.subShown = cur;
      if (cur >= 0) {
        this.subWho.textContent = this.subs[cur].quien;
        this.subText.textContent = this.subs[cur].texto;
        this.subEl.classList.add('show');
      } else this.subEl.classList.remove('show');
    }
  }

  /** Solo para pruebas. */
  debug() { return { active: this.active, t: +this.t.toFixed(2), toma: this.shot + 1, nombre: TOMAS2[this.shot]?.nombre, total: +this.total.toFixed(1), arena: this.swapped }; }
}
