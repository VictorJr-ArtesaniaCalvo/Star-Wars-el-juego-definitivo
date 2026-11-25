import * as THREE from 'three';
import { terrainHeight } from '../world/terrain';
import type { AudioEngine } from '../audio/AudioEngine';
import { CineSounds } from '../audio/CineSounds';
import { RAFAGA_ESTATICA, Voices } from '../audio/Voices';
import type { Effects } from '../weapons/Effects';
import { B1Walkers, buildCloneLegs, buildFlyingLaat, buildShipTroopers, Commando, CommandoModel } from './actors';
import { commandoModelReady } from '../player/commandoModel';
import { COMANDO, DROIDES, ESTATURA, PIERNAS, SALIDA, TOMAS, VUELO, type Actor, type Camara, type Evento, type Postura, type Punto, type Toma, type Vista } from './script';

// Reproductor de la cinemática inicial: sigue el guion (script.ts) segundo a segundo.
// Mueve la cámara, enseña y anima los «actores», lanza sonidos y efectos, y maneja lo que va por encima de la imagen
// (barras negras, fundidos, título, subtítulos y el botón de omitir).

const $ = (id: string) => document.getElementById(id)!;
const SKIP_FADE = 0.35; // al omitir: fundido a negro rápido
const smooth = (k: number) => k * k * (3 - 2 * k);
const clamp01 = (v: number) => Math.min(1, Math.max(0, v));
const lerp = (a: number, b: number, k: number) => a + (b - a) * k;

export interface CinematicDeps {
  scene: THREE.Scene;
  camera: THREE.PerspectiveCamera;
  renderer: THREE.WebGLRenderer;
  audio: AudioEngine;
  effects: Effects;
  /** La cinemática ha acabado (o se ha omitido): empieza la partida. */
  onEnd: () => void;
}

interface Scheduled { at: number; fire: () => void }
interface Sub { from: number; to: number; quien: string; texto: string }

export class Cinematic {
  active = false;
  readonly voices = new Voices();
  private sounds = new CineSounds();
  private starts: number[] = [];
  private flightStart = 0;
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
  private fire: { until: number; every: number; next: number } | null = null;
  private savedFog: { near: number; far: number } | null = null;

  // actores (se crean la primera vez)
  private ship: THREE.Group | null = null;
  private legs: { group: THREE.Group; sway: (t: number, ft?: number) => void } | null = null;
  private commando: Commando | CommandoModel | null = null;
  private droids: B1Walkers | null = null;
  private poseNow = { agachado: 1, asoma: 0, golpe: 0 };

  // pantalla
  private root = $('cine');
  private fadeEl = $('cineFade');
  private titleEl = $('cineTitle');
  private subEl = $('cineSub');
  private subWho = $('cineWho');
  private subText = $('cineText');
  private skipBtn = $('btnSkip');
  private outroTimer = 0;

  private m = new THREE.Matrix4();
  private q = new THREE.Quaternion();
  private v1 = new THREE.Vector3();
  private v2 = new THREE.Vector3();
  private up = new THREE.Vector3(0, 1, 0);

  constructor(private d: CinematicDeps) {
    let acc = 0;
    for (const s of TOMAS) { this.starts.push(acc); acc += s.duracion; }
    this.flightStart = this.starts[Math.max(0, TOMAS.findIndex((s) => s.camara?.tipo === 'canonera'))];
    this.total = acc;
    this.skipBtn.addEventListener('click', (e) => { e.stopPropagation(); this.skip(); });
    window.addEventListener('keydown', (e) => { if (this.active && (e.code === 'Enter' || e.code === 'NumpadEnter')) this.skip(); });
  }

  /** Nombres de los archivos de voz del guion (para descargarlos al cargar el juego). */
  static voiceIds() { return TOMAS.flatMap((s) => (s.dialogos ?? []).map((d) => d.voz)); }

  /** Duración total (s). */
  get duration() { return this.total; }

  private ensureActors() {
    if (this.ship) return;
    const { scene } = this.d;
    this.ship = buildFlyingLaat();
    // los dos soldados de la puerta: los modelos de verdad (clon normal y comando); si no cargaron, las piernas provisionales
    const troopers = buildShipTroopers(ESTATURA, PIERNAS.separacion);
    this.legs = troopers.ready ? troopers : buildCloneLegs(ESTATURA.clon, PIERNAS.separacion);
    this.legs.group.position.set(PIERNAS.x, PIERNAS.suelo, PIERNAS.z); // en el suelo de la bahía, junto a la puerta
    this.ship.add(this.legs.group);
    this.commando = commandoModelReady() ? new CommandoModel(ESTATURA.comando) : new Commando(ESTATURA.comando);
    this.commando.group.position.set(COMANDO.x, terrainHeight(COMANDO.x, COMANDO.z), COMANDO.z);
    this.droids = new B1Walkers(DROIDES);
    for (const o of [this.ship, this.commando.group, this.droids.group]) { o.visible = false; scene.add(o); }
  }

  private showActors(list: Actor[] = []) {
    this.ship!.visible = list.includes('canonera');
    this.legs!.group.visible = list.includes('piernas');
    this.commando!.group.visible = list.includes('comando');
    this.droids!.group.visible = list.includes('droides');
  }

  /** Empieza la cinemática (desde la toma `from`, 0 = el principio; las demás sirven para revisar una toma). */
  start(from = 0) {
    this.ensureActors();
    from = Math.max(0, Math.min(TOMAS.length - 1, from));
    this.active = true;
    this.held = false;
    this.t = this.starts[from];
    this.shot = -1;
    this.skipT = -1;
    this.impulse = 0;
    this.fire = null;
    this.subs = [];
    this.subShown = -1;
    this.poseNow = { agachado: 1, asoma: 0, golpe: 0 };
    // eventos y diálogos de todo el guion, ordenados por tiempo (los anteriores al punto de inicio se saltan)
    this.queue = [];
    TOMAS.forEach((s, i) => {
      const t0 = this.starts[i];
      for (const e of s.eventos ?? []) this.queue.push({ at: t0 + e.en, fire: () => this.event(e) });
      for (const dl of s.dialogos ?? []) {
        this.queue.push({
          at: t0 + dl.en,
          fire: () => {
            const est = dl.dura ?? Math.max(2, dl.texto.length / 15 + 0.5);
            const dur = this.voices.say(dl.voz, dl.filtro, est);
            this.subs.push({ from: this.t, to: this.t + dur + 0.2, quien: dl.quien, texto: dl.texto });
          },
        });
      }
    });
    this.queue.sort((a, b) => a.at - b.at);
    this.qi = this.queue.findIndex((q) => q.at >= this.t);
    if (this.qi < 0) this.qi = this.queue.length;

    // pantalla: negro, barras puestas, botón de omitir
    clearTimeout(this.outroTimer);
    this.root.hidden = false;
    this.root.classList.remove('outro');
    this.root.classList.add('on');
    this.fadeEl.style.opacity = '1';
    this.titleEl.style.opacity = '0';
    this.subEl.classList.remove('show');
    this.skipBtn.hidden = false;
    this.d.camera.near = 0.05; // dentro de la cañonera la cámara está muy cerca de las paredes
    this.d.camera.updateProjectionMatrix();

    // Prepara de una vez los sombreadores de todo lo que va a salir (evita tirones al cambiar de toma)
    for (const o of [this.ship!, this.commando!.group, this.droids!.group]) o.visible = true;
    this.legs!.group.visible = true;
    this.droids!.update(0);
    this.d.renderer.compile(this.d.scene, this.d.camera);
    this.showActors([]);
    this.update(0);
  }

  /** Omitir: fundido rápido a negro y a jugar. */
  skip() {
    if (!this.active || this.skipT >= 0) return;
    this.skipT = 0;
    this.skipBtn.hidden = true;
    this.voices.stopAll();
    this.sounds.stopAll();
  }

  /** La app pasa a segundo plano: la cinemática se queda quieta hasta volver. */
  hold(on: boolean) { this.held = on; }

  private event(e: Evento) {
    const { audio, effects } = this.d;
    switch (e.tipo) {
      case 'disparosLejanos': this.fire = { until: this.t + e.dura, every: e.cada ?? 0.5, next: this.t }; break;
      case 'cañonazo': audio.boomNow(0.25 + 0.5 * (e.fuerza ?? 0.5)); this.impulse = Math.max(this.impulse, 0.25 * (e.fuerza ?? 0.5)); break;
      case 'explosion': {
        const [x, h, z] = e.donde;
        const y = terrainHeight(x, z) + h;
        effects.deathBurst(x, y, z);
        effects.smokePuff(x, y + 0.4, z);
        audio.explosion(x, y, z);
        this.impulse = Math.max(this.impulse, e.fuerza ?? 0.5);
        break;
      }
      case 'sacudida': this.impulse = Math.max(this.impulse, e.fuerza); break;
      case 'motor': if (e.encender) this.sounds.startEngine(); else this.sounds.stopEngine(0.5); break;
      case 'fuego': this.sounds.crackle(e.dura); break;
      case 'golpeCasco': this.sounds.knock(2); break;
      case 'estatica': this.voices.static(e.filtro ?? 'casco', e.dura, RAFAGA_ESTATICA, undefined, true); this.voices.click(e.filtro ?? 'casco', true); break;
    }
  }

  private enterShot(i: number) {
    const s = TOMAS[i];
    this.shot = i;
    const fog = this.d.scene.fog as THREE.Fog;
    if (this.savedFog) { fog.near = this.savedFog.near; fog.far = this.savedFog.far; this.savedFog = null; }
    if (s.neblina) { this.savedFog = { near: fog.near, far: fog.far }; fog.near = s.neblina.cerca; fog.far = s.neblina.lejos; }
    this.showActors(s.negro ? [] : s.actores);
    const cam = this.d.camera;
    const fov = s.angulo ?? 60;
    if (cam.fov !== fov) { cam.fov = fov; cam.updateProjectionMatrix(); }
  }

  // ---------- Cámara ----------
  private ground(p: Punto, out: THREE.Vector3) { return out.set(p[0], terrainHeight(p[0], p[2]) + p[1], p[2]); }

  /** Coloca la cañonera en vuelo `ft` segundos después de empezar su pasada (tomas 2A y 2B seguidas). */
  private placeShip(ft: number) {
    const V = VUELO;
    const k = ft / V.duracion;
    const dir = this.v2.set(V.fin[0] - V.inicio[0], 0, V.fin[1] - V.inicio[1]);
    const cy = terrainHeight(COMANDO.x, COMANDO.z) + V.altura;
    const pos = this.v1.set(V.inicio[0] + dir.x * k, cy + Math.sin(ft * 1.1) * 0.3, V.inicio[1] + dir.z * k);
    const X = dir.normalize();
    const Z = new THREE.Vector3().crossVectors(X, this.up).normalize();
    const Y = new THREE.Vector3().crossVectors(Z, X);
    this.m.makeBasis(X, Y, Z);
    this.q.setFromRotationMatrix(this.m);
    const roll = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(1, 0, 0), THREE.MathUtils.degToRad(-V.alabeo) + Math.sin(ft * 0.8) * 0.02);
    this.q.multiply(roll);
    this.ship!.position.copy(pos);
    this.ship!.quaternion.copy(this.q);
    this.ship!.updateMatrixWorld(true);
  }

  /** Segundos desde que empezó la pasada de la cañonera (la primera toma con la cámara en la nave). */
  private flightTime() { return Math.max(0, this.t - this.flightStart); }

  private placeCamera(s: Toma, u: number) {
    const cam = this.d.camera;
    const c = s.camara as Camara;
    const k = clamp01(u / s.duracion);
    cam.up.set(0, 1, 0);
    if (c.tipo === 'recorrido') {
      const e = c.suave === false ? k : smooth(k);
      const a = this.ground(c.desde.pos, this.v1), b = this.ground(c.hasta.pos, this.v2);
      cam.position.lerpVectors(a, b, e);
      const la = this.ground(c.desde.mira, new THREE.Vector3()), lb = this.ground(c.hasta.mira, new THREE.Vector3());
      cam.lookAt(la.lerp(lb, e));
    } else if (c.tipo === 'orbita') {
      const e = 0.6 * k + 0.4 * smooth(k);
      const a = THREE.MathUtils.degToRad(lerp(c.giroDesde, c.giroHasta, e));
      const r = lerp(c.radio, c.radioHasta ?? c.radio, e);
      const x = c.centro[0] + Math.cos(a) * r, z = c.centro[2] + Math.sin(a) * r;
      cam.position.set(x, terrainHeight(x, z) + c.altura, z);
      cam.lookAt(this.ground(c.centro, this.v2));
    } else {
      this.placeShip(Math.max(0, this.starts[TOMAS.indexOf(s)] + u - this.flightStart));
      const e = smooth(k);
      const lv = (v: Vista, out: THREE.Vector3, which: 'pos' | 'mira') => out.set(...v[which]);
      const p = lv(c.desde, this.v1, 'pos').lerp(lv(c.hasta, new THREE.Vector3(), 'pos'), e).applyMatrix4(this.ship!.matrixWorld);
      const l = lv(c.desde, this.v2, 'mira').lerp(lv(c.hasta, new THREE.Vector3(), 'mira'), e).applyMatrix4(this.ship!.matrixWorld);
      cam.position.copy(p);
      cam.up.set(0, 1, 0).applyQuaternion(this.ship!.quaternion); // la cámara se inclina con la nave
      cam.lookAt(l);
    }
    // Temblor: suave y continuo (como cámara al hombro o en vuelo) + sacudidas de las explosiones
    const A = (s.temblor ?? 0) + this.impulse * 2.2;
    if (A > 0.001) {
      const T = this.t;
      const n1 = Math.sin(T * 7.3) * 0.6 + Math.sin(T * 13.1 + 1) * 0.4;
      const n2 = Math.sin(T * 6.1 + 2) * 0.6 + Math.sin(T * 11.7 + 4) * 0.4;
      const j = this.impulse > 0.01 ? Math.sin(T * 41) * this.impulse : 0;
      cam.rotateX((n1 * 0.006 + j * 0.02) * A);
      cam.rotateY((n2 * 0.006 + j * 0.015) * A);
      cam.position.y += (Math.sin(T * 9.7) * 0.012 + j * 0.03) * A;
    }
  }

  // ---------- Postura del comando ----------
  private updatePose(s: Toma, u: number) {
    if (!s.posturas || !this.commando) return;
    // cada valor se interpola entre la última postura que lo fija y la siguiente
    const key = (name: keyof Omit<Postura, 'en'>) => {
      let prev: Postura | null = null, next: Postura | null = null;
      for (const p of s.posturas!) {
        if (p[name] === undefined) continue;
        if (p.en <= u) prev = p; else { next = p; break; }
      }
      if (!prev) return next ? next[name]! : this.poseNow[name];
      if (!next) return prev[name]!;
      return lerp(prev[name]!, next[name]!, smooth(clamp01((u - prev.en) / (next.en - prev.en))));
    };
    this.poseNow = { agachado: key('agachado'), asoma: key('asoma'), golpe: key('golpe') };
    this.commando.pose(this.poseNow.agachado, this.poseNow.asoma, this.poseNow.golpe, this.t);
  }

  // ---------- Bucle ----------
  /** Avanza la cinemática (llamar cada imagen). */
  update(dt: number) {
    if (!this.active || this.held) return;
    if (this.skipT >= 0) {
      this.skipT += dt;
      this.fadeEl.style.opacity = String(clamp01(this.skipT / SKIP_FADE));
      if (this.skipT >= SKIP_FADE + 0.05) this.finish();
      return;
    }
    this.t += dt;
    if (this.t >= this.total) { this.finish(); return; }
    let i = this.starts.length - 1;
    while (i > 0 && this.starts[i] > this.t) i--;
    if (i !== this.shot) this.enterShot(i);
    const s = TOMAS[i];
    const u = this.t - this.starts[i];

    while (this.qi < this.queue.length && this.queue[this.qi].at <= this.t) this.queue[this.qi++].fire();
    if (this.fire && this.t >= this.fire.next && this.t < this.fire.until) {
      this.d.audio.distantFire();
      // a veces una ráfaga: dos o tres disparos seguidos
      this.fire.next = this.t + (Math.random() < 0.35 ? 0.09 + Math.random() * 0.06 : this.fire.every * (0.4 + Math.random() * 1.4));
    }
    this.impulse = Math.max(0, this.impulse - dt * 1.6);

    // En las tomas en negro se coloca ya la cámara de la toma siguiente (así se preparan el escenario y las sombras)
    const view = s.negro ? (TOMAS[i + 1] ?? s) : s;
    if (view.camara) {
      if (view !== s) { this.enterShotView(view); }
      this.placeCamera(view, view === s ? u : 0);
    }
    this.legs?.sway(this.t, this.flightTime());
    if (s.actores?.includes('droides')) this.droids!.update(u);
    this.updatePose(s, u);

    // Lo que va encima de la imagen
    let fade = s.negro ? 1 : 0;
    if (s.fundidoEntrada && u < s.fundidoEntrada) fade = Math.max(fade, 1 - u / s.fundidoEntrada);
    if (s.fundidoSalida && u > s.duracion - s.fundidoSalida) fade = Math.max(fade, (u - (s.duracion - s.fundidoSalida)) / s.fundidoSalida);
    this.fadeEl.style.opacity = fade.toFixed(3);
    if (s.titulo) {
      const a = clamp01((u - s.titulo.entra) / 0.7) * (1 - clamp01((u - s.titulo.sale) / 0.5));
      this.titleEl.textContent = s.titulo.texto;
      this.titleEl.style.opacity = a.toFixed(3);
      this.titleEl.style.letterSpacing = (0.5 + 0.12 * u) + 'em';
    } else this.titleEl.style.opacity = '0';
    // subtítulo actual (el último que haya empezado y siga vigente)
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

  /** En la toma en negro, prepara la vista de la siguiente (ángulo y actores) sin cambiar de toma. */
  private enterShotView(view: Toma) {
    const cam = this.d.camera;
    const fov = view.angulo ?? 60;
    if (cam.fov !== fov) { cam.fov = fov; cam.updateProjectionMatrix(); }
    this.showActors(view.actores);
  }

  /** Fin (o se ha omitido): se recoge todo y la partida empieza detrás de un fundido desde negro. */
  private finish() {
    if (!this.active) return;
    this.active = false;
    const fog = this.d.scene.fog as THREE.Fog;
    if (this.savedFog) { fog.near = this.savedFog.near; fog.far = this.savedFog.far; this.savedFog = null; }
    this.showActors([]);
    this.fire = null;
    this.d.camera.up.set(0, 1, 0);
    this.d.camera.near = 0.08;
    this.d.camera.updateProjectionMatrix();
    this.subEl.classList.remove('show');
    this.titleEl.style.opacity = '0';
    this.skipBtn.hidden = true;
    this.fadeEl.style.opacity = '1';
    this.d.onEnd();
    // fundido desde negro y barras fuera (lo hace la hoja de estilos, con transiciones)
    void this.fadeEl.offsetWidth;
    this.root.classList.add('outro');
    this.root.classList.remove('on');
    this.fadeEl.style.transition = `opacity ${SALIDA.fundido}s ease-out`;
    this.fadeEl.style.opacity = '0';
    this.outroTimer = window.setTimeout(() => {
      this.root.hidden = true;
      this.root.classList.remove('outro');
      this.fadeEl.style.transition = '';
    }, SALIDA.fundido * 1000 + 700);
  }

  /** Solo para pruebas: dentro de la cañonera (en su marco, metros reales), distancia hasta el casco desde `from` en la dirección `dir`. */
  debugProbe(from: Punto, dir: Punto) {
    this.ensureActors();
    const ship = this.ship!;
    const keep = { p: ship.position.clone(), q: ship.quaternion.clone(), v: ship.visible, l: this.legs!.group.visible };
    ship.position.set(0, 0, 0); ship.quaternion.identity(); ship.visible = true; this.legs!.group.visible = false;
    ship.updateMatrixWorld(true);
    const rc = new THREE.Raycaster(new THREE.Vector3(...from), new THREE.Vector3(...dir).normalize());
    const hit = rc.intersectObject(ship, true).find((h) => h.object.visible);
    ship.position.copy(keep.p); ship.quaternion.copy(keep.q); ship.visible = keep.v; this.legs!.group.visible = keep.l;
    ship.updateMatrixWorld(true);
    return hit ? +hit.distance.toFixed(3) : null;
  }

  /** Solo para pruebas: qué pieza de la nave y qué triángulo hay en esa dirección. */
  debugProbeHit(from: Punto, dir: Punto) {
    this.ensureActors();
    const ship = this.ship!;
    const keep = { p: ship.position.clone(), q: ship.quaternion.clone(), v: ship.visible };
    ship.position.set(0, 0, 0); ship.quaternion.identity(); ship.visible = true; ship.updateMatrixWorld(true);
    const rc = new THREE.Raycaster(new THREE.Vector3(...from), new THREE.Vector3(...dir).normalize());
    const hit = rc.intersectObject(ship, true)[0];
    ship.position.copy(keep.p); ship.quaternion.copy(keep.q); ship.visible = keep.v; ship.updateMatrixWorld(true);
    return hit ? { d: +hit.distance.toFixed(2), part: hit.object.name, face: hit.face ? [hit.face.a, hit.face.b, hit.face.c] : null, point: hit.point.toArray().map((v) => +v.toFixed(2)) } : null;
  }

  /** Panel de ajuste del filtro: reproduce una frase con su filtro, o el golpe al casco con la ráfaga de estática. */
  testVoice(what: 'soldado' | 'comandante' | 'comando' | 'golpe') {
    this.voices.stopAll();
    if (what === 'golpe') {
      this.sounds.knock(2);
      setTimeout(() => { this.voices.static('casco', 0.6, RAFAGA_ESTATICA, undefined, true); this.voices.click('casco', true); }, 150);
      return;
    }
    const line = TOMAS.flatMap((s) => s.dialogos ?? []).find((d) => d.voz === `${what}-1`);
    if (line) this.voices.say(line.voz, line.filtro, line.dura ?? 3);
  }

  /** Solo para pruebas: estado actual. */
  debug() { return { active: this.active, t: +this.t.toFixed(2), toma: this.shot + 1, nombre: TOMAS[this.shot]?.nombre, total: this.total, pose: this.poseNow }; }
}
