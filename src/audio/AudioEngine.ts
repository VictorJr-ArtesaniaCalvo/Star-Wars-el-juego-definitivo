import { Howl, Howler } from 'howler';
import { synthesizeAll, type SoundId, type SynthSet } from './Synth';

export type Sfx = 'b1' | 'b2' | 'droideka';

const rnd = (a: number, b: number) => a + Math.random() * (b - a);
/** La música ya está igualada de volumen; esto la deja por debajo de los efectos con el control a la mitad. */
const MUSIC_BASE = 0.7;

/**
 * Sonido del juego: ambiente (viento y cañonazos lejanos), disparos y granadas.
 * Los disparos enemigos y las explosiones suenan «con dirección» (si te disparan por la espalda, suena por detrás).
 * La música (public/audio/musica.mp3) va aparte de los efectos, con su propio volumen: se lee como un archivo en streaming (no se decodifica entera en memoria,
 * que en el iPhone pesaría más de 100 MB) y se pasa por un control de volumen de Web Audio, porque el volumen del propio <audio> no funciona en iOS.
 */
export class AudioEngine {
  private howls = {} as Record<SoundId, Howl[]>;
  // Disparos reales de los B1 (4 clips). Si alguno no carga, se usa el sonido sintético de respaldo.
  private b1Clips: Array<{ howl: Howl; ok: boolean }> = [];
  private lastB1 = -1;
  // Disparos reales del bláster del jugador (6 clips). Si alguno no carga, se usa el sonido sintético de respaldo.
  private clonClips: Array<{ howl: Howl; ok: boolean }> = [];
  private lastClon = -1;
  // Disparos reales del droideka (2 clips). Si no cargan, se usa el sonido sintético de respaldo.
  private dekaClips: Array<{ howl: Howl; ok: boolean }> = [];
  private lastDeka = -1;
  private loadSound: { howl: Howl; ok: boolean } | null = null;
  private lastAppear = 0;
  private wind: Howl | null = null;
  private windId: number | undefined;
  private started = false;
  private recentEnemyShots: number[] = [];
  private lastBoom = 0;
  private volume = 0.8; // general
  private sfxVol = 1;
  private musicVol = 0.5;
  private paused = false; // en pausa/menú: los efectos callan y la música baja
  private music: { el: HTMLAudioElement; gain: GainNode | null; graph: boolean; wanted: boolean } | null = null;
  /** Solo para pruebas */
  stats: SynthSet['stats'] = {};
  played: Record<string, number> = {};

  /** Genera los sonidos (unas décimas de segundo). Hay que llamarlo una vez al cargar. */
  init() {
    const set = synthesizeAll();
    this.stats = set.stats;
    for (const id of Object.keys(set.urls) as SoundId[]) {
      this.howls[id] = set.urls[id].map((url) => new Howl({ src: [url], format: ['wav'], preload: true, loop: id === 'wind' }));
    }
    this.wind = this.howls.wind[0];
    const base = import.meta.env.BASE_URL;
    for (let i = 1; i <= 6; i++) {
      const clip = { howl: null as unknown as Howl, ok: false };
      clip.howl = new Howl({ src: [`${base}audio/clon-${i}.mp3`], preload: true, onload: () => { clip.ok = true; }, onloaderror: () => { clip.ok = false; } });
      this.clonClips.push(clip);
    }
    for (let i = 1; i <= 2; i++) {
      const clip = { howl: null as unknown as Howl, ok: false };
      clip.howl = new Howl({ src: [`${base}audio/deka-${i}.mp3`], preload: true, onload: () => { clip.ok = true; }, onloaderror: () => { clip.ok = false; } });
      this.dekaClips.push(clip);
    }
    const ld = { howl: null as unknown as Howl, ok: false };
    ld.howl = new Howl({ src: [`${base}audio/b1-load.mp3`], preload: true, onload: () => { ld.ok = true; }, onloaderror: () => { ld.ok = false; } });
    this.loadSound = ld;
    for (let i = 1; i <= 4; i++) {
      const clip = { howl: null as unknown as Howl, ok: false };
      clip.howl = new Howl({ src: [`${base}audio/b1-${i}.mp3`], preload: true, onload: () => { clip.ok = true; }, onloaderror: () => { clip.ok = false; } });
      this.b1Clips.push(clip);
    }
    Howler.autoSuspend = false;
    // Música: archivo en streaming, en bucle; sin cargar hasta que se necesite
    const el = new Audio(`${base}audio/musica.mp3`);
    el.loop = true;
    el.preload = 'none';
    this.music = { el, gain: null, graph: false, wanted: false };
    // Al salir de la app (o cambiar de pestaña) la música se detiene; al volver, sigue
    document.addEventListener('visibilitychange', () => {
      const m = this.music;
      if (!m) return;
      if (document.hidden) m.el.pause();
      else if (m.wanted) void m.el.play().catch(() => undefined);
    });
    this.applyVolumes();
  }

  private applyVolumes() {
    Howler.volume(this.paused ? 0 : this.volume * this.sfxVol);
    const m = this.music;
    if (m) {
      const g = Math.min(1, this.volume * this.musicVol * MUSIC_BASE * (this.paused ? 0.6 : 1));
      if (m.gain) m.gain.gain.value = g;
      else m.el.volume = g; // si no hay Web Audio (en iOS esto no tendría efecto, pero allí sí hay)
    }
  }

  /** Volumen general. */
  setVolume(v: number) {
    this.volume = Math.max(0, Math.min(1, v));
    this.applyVolumes();
  }

  /** Volumen de los efectos (disparos, explosiones, viento…). */
  setSfxVolume(v: number) {
    this.sfxVol = Math.max(0, Math.min(1, v));
    this.applyVolumes();
  }

  /** Volumen de la música. */
  setMusicVolume(v: number) {
    this.musicVol = Math.max(0, Math.min(1, v));
    this.applyVolumes();
  }

  /** Arranca la música (en bucle). Debe llamarse tras un toque del jugador: iOS no deja sonar antes. */
  startMusic() {
    const m = this.music;
    if (!m) return;
    const ctx = Howler.ctx;
    if (!m.graph) {
      m.graph = true;
      try {
        if (ctx) {
          const src = ctx.createMediaElementSource(m.el);
          const gain = ctx.createGain();
          src.connect(gain);
          gain.connect(ctx.destination);
          m.gain = gain;
          m.el.volume = 1; // el volumen lo manda ahora el control de Web Audio (si no, se multiplicaría dos veces)
        }
      } catch {
        m.gain = null; // sin Web Audio: se usa el volumen del propio <audio>
      }
    }
    m.wanted = true;
    this.applyVolumes();
    if (ctx && ctx.state !== 'running') void ctx.resume();
    if (m.el.paused && !document.hidden) void m.el.play().catch(() => undefined);
  }

  /** Suena un disparo con el volumen de efectos actual (para oírlo al mover el control del menú, aunque esté en pausa). */
  previewSfx() {
    this.start();
    Howler.volume(this.volume * this.sfxVol);
    this.play('blaster', 0.62, 1);
    window.setTimeout(() => this.applyVolumes(), 650);
  }

  /** El viento suena más fuerte durante las ráfagas de tormenta de arena (`k` de 0 a 1). */
  setWindLevel(k: number) {
    if (this.wind && this.windId !== undefined) this.wind.volume(0.2 + 0.3 * k, this.windId);
  }

  /** Arranca el ambiente. Debe llamarse tras un toque del jugador (iOS no deja sonar antes). */
  start() {
    if (!this.wind) return;
    if (this.paused) this.resume();
    if (!this.started) {
      this.started = true;
      this.wind.volume(0.2);
      this.windId = this.wind.play();
    } else if (this.windId !== undefined && !this.wind.playing(this.windId)) {
      this.windId = this.wind.play();
    }
  }

  /** En pausa: los efectos callan y la música baja un poco (así se oye al ajustar el volumen en el menú). */
  suspend() {
    this.paused = true;
    this.applyVolumes();
  }

  resume() {
    const ctx = Howler.ctx;
    if (ctx && ctx.state !== 'running') void ctx.resume();
    this.paused = false;
    this.applyVolumes();
  }

  /** Coloca al oyente donde está la cámara y mirando hacia donde mira. */
  listener(x: number, y: number, z: number, yaw: number, pitch: number) {
    Howler.pos(x, y, z);
    const cp = Math.cos(pitch);
    Howler.orientation(-Math.sin(yaw) * cp, Math.sin(pitch), -Math.cos(yaw) * cp, 0, 1, 0);
  }

  private pick(id: SoundId) {
    const list = this.howls[id];
    return list[Math.floor(Math.random() * list.length)];
  }

  private play(id: SoundId, volume: number, rate = 1, pos?: [number, number, number], ref = 8) {
    if (!this.started) return undefined;
    const h = this.pick(id);
    const sid = h.play();
    h.volume(volume, sid);
    h.rate(rate, sid);
    if (pos) {
      h.pos(pos[0], pos[1], pos[2], sid);
      h.pannerAttr({ panningModel: 'HRTF', distanceModel: 'inverse', refDistance: ref, rolloffFactor: 1.15, maxDistance: 400 }, sid);
    }
    this.played[id] = (this.played[id] ?? 0) + 1;
    return sid;
  }

  /** Tu bláster. */
  playerShot() {
    const ok = this.clonClips.map((c, i) => (c.ok ? i : -1)).filter((i) => i >= 0);
    const pool = ok.filter((i) => i !== this.lastClon);
    const list = pool.length ? pool : ok;
    if (!list.length) { this.play('blaster', 0.62, rnd(0.95, 1.06)); return; } // respaldo
    if (!this.started) return;
    const i = list[Math.floor(Math.random() * list.length)];
    this.lastClon = i;
    const h = this.clonClips[i].howl;
    const sid = h.play();
    h.volume(0.55, sid);
    h.rate(rnd(0.97, 1.04), sid);
    this.played[`clon-clip${i + 1}`] = (this.played[`clon-clip${i + 1}`] ?? 0) + 1;
  }
  overheat() { this.play('overheat', 0.55); }
  ready() { this.play('ready', 0.35); }
  /** Recoger un kit médico: dos notas suaves ascendentes. */
  pickup() { this.play('ready', 0.55, 1.35); }
  grenadeThrow() { this.play('whoosh', 0.5, rnd(0.95, 1.05)); }
  grenadeBounce(x: number, y: number, z: number) { this.play('tink', 0.45, rnd(0.9, 1.15), [x, y, z], 4); }
  explosion(x: number, y: number, z: number) { this.play('explosion', 1.0, rnd(0.94, 1.04), [x, y, z], 12); }

  /** Disparo de un droide, desde su posición. Se limita cuántos suenan a la vez para cuidar el móvil. */
  enemyShot(kind: Sfx, x: number, y: number, z: number, dist: number) {
    const now = performance.now();
    this.recentEnemyShots = this.recentEnemyShots.filter((t) => now - t < 250);
    if (this.recentEnemyShots.length >= 6) return; // demasiados a la vez
    if (dist > 140) return; // demasiado lejos para oírse
    this.recentEnemyShots.push(now);
    // Los B1 y los B2 comparten los mismos disparos (los 4 clips reales); si no cargaron, suena el sintético de cada uno
    if ((kind === 'b1' || kind === 'b2') && this.playB1Clip(x, y, z)) return;
    if (kind === 'droideka' && this.playDekaClip(x, y, z)) return;
    const id: SoundId = kind === 'b2' ? 'b2' : kind === 'droideka' ? 'deka' : 'b1';
    const vol = kind === 'b2' ? 0.7 : kind === 'droideka' ? 0.45 : 0.5;
    this.play(id, vol, rnd(0.93, 1.08), [x, y, z], kind === 'b2' ? 9 : 7);
  }

  /** Un droide aparece: suena el «cargar el arma» (con dirección, y se oye desde lejos porque aparecen a 35–90 m). */
  droidAppear(x: number, y: number, z: number) {
    const l = this.loadSound;
    if (!l || !l.ok || !this.started) return;
    const now = performance.now();
    if (now - this.lastAppear < 180) return; // si aparecen varios a la vez, no se amontonan
    this.lastAppear = now;
    const sid = l.howl.play();
    l.howl.volume(0.55, sid);
    l.howl.rate(rnd(0.96, 1.05), sid);
    l.howl.pos(x, y, z, sid);
    l.howl.pannerAttr({ panningModel: 'HRTF', distanceModel: 'inverse', refDistance: 22, rolloffFactor: 1.0, maxDistance: 400 }, sid);
    this.played['b1-carga'] = (this.played['b1-carga'] ?? 0) + 1;
  }

  /** Disparo del droideka con uno de los dos clips reales; con solo dos, el tono varía algo más para que las ráfagas no suenen repetidas. */
  private playDekaClip(x: number, y: number, z: number): boolean {
    const ok = this.dekaClips.map((c, i) => (c.ok ? i : -1)).filter((i) => i >= 0);
    if (!ok.length) return false;
    const pool = ok.filter((i) => i !== this.lastDeka);
    const list = pool.length ? pool : ok;
    const i = list[Math.floor(Math.random() * list.length)];
    this.lastDeka = i;
    const h = this.dekaClips[i].howl;
    const sid = h.play();
    h.volume(0.42, sid);
    h.rate(rnd(0.93, 1.1), sid);
    h.pos(x, y, z, sid);
    h.pannerAttr({ panningModel: 'HRTF', distanceModel: 'inverse', refDistance: 7, rolloffFactor: 1.15, maxDistance: 400 }, sid);
    this.played[`deka-clip${i + 1}`] = (this.played[`deka-clip${i + 1}`] ?? 0) + 1;
    return true;
  }

  /** Disparo del B1 con uno de los cuatro clips reales (nunca el mismo dos veces seguidas). Devuelve false si no hay ninguno cargado. */
  private playB1Clip(x: number, y: number, z: number): boolean {
    const ready = this.b1Clips.map((c, i) => (c.ok ? i : -1)).filter((i) => i >= 0 && i !== this.lastB1);
    const pool = ready.length ? ready : this.b1Clips.map((c, i) => (c.ok ? i : -1)).filter((i) => i >= 0);
    if (!pool.length) return false;
    const i = pool[Math.floor(Math.random() * pool.length)];
    this.lastB1 = i;
    const h = this.b1Clips[i].howl;
    const sid = h.play();
    h.volume(0.5, sid);
    h.rate(rnd(0.96, 1.05), sid);
    h.pos(x, y, z, sid);
    h.pannerAttr({ panningModel: 'HRTF', distanceModel: 'inverse', refDistance: 7, rolloffFactor: 1.15, maxDistance: 400 }, sid);
    this.played[`b1-clip${i + 1}`] = (this.played[`b1-clip${i + 1}`] ?? 0) + 1;
    return true;
  }

  /** Cañonazo de las naves del cielo (como mucho uno cada pocos segundos, para que sea ambiente y no ruido). */
  distantBoom(x: number, y: number, z: number) {
    const now = performance.now();
    if (now - this.lastBoom < 3500 || Math.random() < 0.45) return;
    this.lastBoom = now;
    this.play('boom', rnd(0.3, 0.5), rnd(0.85, 1.1), [x, y, z], 60);
  }
}
