import { Howl, Howler } from 'howler';
import { synthesizeAll, type SoundId, type SynthSet } from './Synth';

export type Sfx = 'b1' | 'b2' | 'droideka';

const rnd = (a: number, b: number) => a + Math.random() * (b - a);

/**
 * Sonido del juego: ambiente (viento y cañonazos lejanos), disparos y granadas.
 * Los disparos enemigos y las explosiones suenan «con dirección» (si te disparan por la espalda, suena por detrás).
 * La música no está incluida: se añadirá aparte.
 */
export class AudioEngine {
  private howls = {} as Record<SoundId, Howl[]>;
  private wind: Howl | null = null;
  private windId: number | undefined;
  private started = false;
  private suspended = false;
  private recentEnemyShots: number[] = [];
  private lastBoom = 0;
  private volume = 0.8;
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
    Howler.autoSuspend = false;
    this.setVolume(this.volume);
  }

  setVolume(v: number) {
    this.volume = Math.max(0, Math.min(1, v));
    Howler.volume(this.volume);
  }

  /** Arranca el ambiente. Debe llamarse tras un toque del jugador (iOS no deja sonar antes). */
  start() {
    if (!this.wind) return;
    if (this.suspended) this.resume();
    if (!this.started) {
      this.started = true;
      this.wind.volume(0.2);
      this.windId = this.wind.play();
    } else if (this.windId !== undefined && !this.wind.playing(this.windId)) {
      this.windId = this.wind.play();
    }
  }

  /** Pausa todo el sonido (al pausar la partida o salir de la app). */
  suspend() {
    const ctx = Howler.ctx;
    if (ctx && ctx.state === 'running') { ctx.suspend(); this.suspended = true; }
  }

  resume() {
    const ctx = Howler.ctx;
    if (ctx && ctx.state !== 'running') ctx.resume();
    this.suspended = false;
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
  playerShot() { this.play('blaster', 0.62, rnd(0.95, 1.06)); }
  overheat() { this.play('overheat', 0.55); }
  ready() { this.play('ready', 0.35); }
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
    const id: SoundId = kind === 'b2' ? 'b2' : kind === 'droideka' ? 'deka' : 'b1';
    const vol = kind === 'b2' ? 0.7 : kind === 'droideka' ? 0.45 : 0.5;
    this.play(id, vol, rnd(0.93, 1.08), [x, y, z], kind === 'b2' ? 9 : 7);
  }

  /** Cañonazo de las naves del cielo (como mucho uno cada pocos segundos, para que sea ambiente y no ruido). */
  distantBoom(x: number, y: number, z: number) {
    const now = performance.now();
    if (now - this.lastBoom < 3500 || Math.random() < 0.45) return;
    this.lastBoom = now;
    this.play('boom', rnd(0.3, 0.5), rnd(0.85, 1.1), [x, y, z], 60);
  }
}
