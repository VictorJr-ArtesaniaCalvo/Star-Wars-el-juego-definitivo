import { Howler } from 'howler';

// Ambiente con los audios de Víctor (ElevenLabs), preparados con tools/prepare-ambience.py → public/audio/ambiente/.
//
// SIN CORTES NI BAJONES (pedido por Víctor):
//  · Los fondos ya vienen sin silencio ni fundidos (solo la parte a volumen completo).
//  · Bucle: no se usa la repetición del archivo. Antes de que acabe una pasada empieza la siguiente (otra versión del mismo fondo,
//    al azar) y se cruzan durante CROSS s con curvas de igual potencia (seno y coseno): el volumen se mantiene igual todo el rato.
//  · Cambio de escena (cañón → túnel → arena): los fondos de las dos escenas suenan a la vez y se cruzan durante SCENE_FADE s,
//    también con igual potencia. Nunca hay silencio entre uno y otro.
//  · Las ráfagas conservan su subida y su bajada y suenan por encima; su golpe más fuerte coincide con la ráfaga de polvo que se ve.
// Todo pasa por el volumen general del juego (Howler): se calla en pausa y respeta el volumen de efectos.

export type AmbScene = 'canyon' | 'tunnel' | 'arena';

/** Fondos de cada escena y su volumen. Si un fondo no existe (aún no hay audio), simplemente no suena. */
const SCENES: Record<AmbScene, Array<{ grupo: string; vol: number; respaldo?: string }>> = {
  canyon: [{ grupo: 'amb_canon_viento', vol: 1 }, { grupo: 'amb_polvo_arrastre', vol: 0.6 }, { grupo: 'amb_batalla_lejana', vol: 0.5 }],
  // el túnel: su propio fondo; si aún no está, el viento de la arena más bajo (amortiguado por las paredes)
  tunnel: [{ grupo: 'amb_tunel', vol: 1, respaldo: 'amb_arena_viento' }],
  arena: [{ grupo: 'amb_arena_viento', vol: 1 }, { grupo: 'amb_polvo_arrastre', vol: 0.5 }],
};
/** Volumen de todo el ambiente (por debajo de voces, disparos y música). */
const AMB_VOLUME = 0.55;
/** Volumen de las ráfagas (por encima del fondo, pero por debajo de los disparos). */
const GUST_LEVEL = 0.75;
/** Segundos del fundido cruzado al repetir un fondo y al cambiar de escena. */
const CROSS = 2.5;
const SCENE_FADE = 3;
/** Cuánto sube el fondo mientras sopla una ráfaga (0,25 = un 25 %). */
const SWELL = 0.25;

interface Info { tipo: 'fondo' | 'rafaga'; grupo: string; dura: number; golpe?: number }
interface Clip { name: string; buf: AudioBuffer; golpe: number }
interface Bed { grupo: string; clips: Clip[]; gain: GainNode; next: number; cur: { src: AudioBufferSourceNode; g: GainNode } | null; last: string }

/** Curvas de igual potencia (de 0 a 1 y de 1 a 0). */
const N = 64;
const UP = new Float32Array(N), DOWN = new Float32Array(N);
for (let i = 0; i < N; i++) { const a = (i / (N - 1)) * Math.PI / 2; UP[i] = Math.sin(a); DOWN[i] = Math.cos(a); }
const curve = (p: AudioParam, c: Float32Array, at: number, dur: number, k = 1) => {
  try {
    if (p.cancelAndHoldAtTime) p.cancelAndHoldAtTime(at); else p.cancelScheduledValues(at);
    p.setValueCurveAtTime(k === 1 ? c : c.map((v) => v * k), at, dur);
  } catch {
    // si aún había otro fundido en marcha: se acerca suavemente al valor final (sin saltos)
    p.cancelScheduledValues(at);
    p.setTargetAtTime(c[c.length - 1] * k, at, dur / 3);
  }
};

export class Ambience {
  private ctx: AudioContext | null = null;
  private out: GainNode | null = null; // fondos (se apaga con el botón de comparar)
  private swellNode: GainNode | null = null; // sube un poco con las ráfagas
  private gustOut: GainNode | null = null; // ráfagas
  private clips = new Map<string, Clip[]>();
  private beds = new Map<string, Bed>(); // por escena y grupo: `${escena}:${grupo}`
  private scene: AmbScene | null = null;
  private timer = 0;
  private lastGust = '';
  private enabled = true;
  private swell = 0;
  ready = false;
  /** Solo para pruebas: qué ha sonado. */
  played: Record<string, number> = {};

  /** Descarga los audios (no suenan hasta `setScene`). */
  async load(base: string) {
    const ctx = Howler.ctx as AudioContext | undefined;
    if (!ctx || !Howler.masterGain) return;
    this.ctx = ctx;
    this.out = ctx.createGain();
    this.out.gain.value = AMB_VOLUME;
    this.swellNode = ctx.createGain();
    this.out.connect(this.swellNode).connect(Howler.masterGain);
    this.gustOut = ctx.createGain();
    this.gustOut.gain.value = GUST_LEVEL;
    this.gustOut.connect(Howler.masterGain);
    try {
      const info = (await (await fetch(`${base}audio/ambiente/ambiente.json`)).json()) as Record<string, Info>;
      await Promise.all(Object.entries(info).map(async ([name, it]) => {
        const data = await (await fetch(`${base}audio/ambiente/${name}.mp3`)).arrayBuffer();
        const buf = await ctx.decodeAudioData(data);
        const list = this.clips.get(it.grupo) ?? [];
        list.push({ name, buf, golpe: it.golpe ?? 0 });
        this.clips.set(it.grupo, list);
      }));
      this.ready = true;
    } catch (e) {
      console.warn('No se pudo cargar el ambiente nuevo; queda el de antes.', e);
    }
    this.timer = window.setInterval(() => this.pump(), 250);
  }

  /** ¿Hay ráfagas grabadas para esta escena? (si no, suena la generada de antes) */
  hasGusts(scene: AmbScene) { return this.enabled && this.ready && !!this.clips.get(scene === 'canyon' ? 'amb_canon_rafaga' : 'amb_arena_rafaga')?.length; }
  /** ¿Suena el ambiente nuevo? (si no, el viento generado de antes) */
  get active() { return this.enabled && this.ready; }

  /** Modo de pruebas: alterna entre los audios nuevos y los sonidos generados de antes (con fundido, sin cortes). */
  setEnabled(on: boolean) {
    this.enabled = on;
    if (!this.ctx || !this.out) return;
    const t = this.ctx.currentTime;
    for (const [node, to] of [[this.out, on ? AMB_VOLUME : 0], [this.gustOut!, on ? GUST_LEVEL : 0]] as const) {
      const v = node.gain.value;
      node.gain.cancelScheduledValues(t);
      node.gain.setValueAtTime(v, t);
      node.gain.linearRampToValueAtTime(to, t + 1.5);
    }
  }

  /** Cambia de escena con fundido cruzado (la primera vez, entra con un fundido suave desde el silencio). */
  setScene(scene: AmbScene) {
    if (scene === this.scene || !this.ready || !this.ctx) return;
    const ctx = this.ctx, t = ctx.currentTime + 0.05;
    const first = this.scene === null;
    // lo que sonaba se va apagando (igual potencia) y deja de repetirse
    for (const [key, bed] of this.beds) {
      if (!key.startsWith(`${this.scene}:`)) continue;
      const v = bed.gain.gain.value;
      curve(bed.gain.gain, DOWN, t, SCENE_FADE, v);
      bed.next = Infinity;
      const cur = bed.cur;
      window.setTimeout(() => { try { cur?.src.stop(); } catch { /* ya parado */ } }, (SCENE_FADE + 0.3) * 1000);
      this.beds.delete(key);
    }
    this.scene = scene;
    for (const s of SCENES[scene]) {
      let grupo = s.grupo, vol = s.vol;
      if (!this.clips.get(grupo)?.length && s.respaldo) { grupo = s.respaldo; vol *= 0.8; }
      const clips = this.clips.get(grupo);
      if (!clips?.length) continue;
      const gain = ctx.createGain();
      gain.connect(this.out!);
      curve(gain.gain, UP, t, first ? 2 : SCENE_FADE, vol);
      const bed: Bed = { grupo, clips, gain, next: t, cur: null, last: '' };
      this.beds.set(`${scene}:${grupo}`, bed);
      this.startPass(bed, t, false); // empieza ya a volumen completo: el fundido lo hace `gain`
    }
  }

  /** Una pasada de un fondo: entra cruzándose con la anterior (si la hay) y se programa la siguiente CROSS s antes de que acabe. */
  private startPass(bed: Bed, at: number, cross: boolean) {
    const ctx = this.ctx!;
    const choices = bed.clips.length > 1 ? bed.clips.filter((c) => c.name !== bed.last) : bed.clips;
    const clip = choices[Math.floor(Math.random() * choices.length)];
    bed.last = clip.name;
    const src = ctx.createBufferSource();
    src.buffer = clip.buf;
    const g = ctx.createGain();
    src.connect(g).connect(bed.gain);
    if (cross) {
      curve(g.gain, UP, at, CROSS);
      const prev = bed.cur;
      if (prev) { curve(prev.g.gain, DOWN, at, CROSS); try { prev.src.stop(at + CROSS + 0.05); } catch { /* nada */ } }
    } else g.gain.setValueAtTime(1, at);
    src.start(at);
    bed.cur = { src, g };
    bed.next = at + clip.buf.duration - CROSS - 0.1;
    this.played[clip.name] = (this.played[clip.name] ?? 0) + 1;
  }

  /** Cada cuarto de segundo: programa con tiempo la siguiente pasada de cada fondo (así nunca hay hueco). */
  private pump() {
    if (!this.ctx) return;
    const now = this.ctx.currentTime;
    for (const bed of this.beds.values()) if (bed.next < now + 1.5) this.startPass(bed, Math.max(bed.next, now + 0.05), true);
  }

  /** El fondo sube un poco mientras sopla una ráfaga (k de 0 a 1). */
  setGust(k: number) {
    if (!this.ctx || !this.swellNode || Math.abs(k - this.swell) < 0.02) return;
    this.swell = k;
    this.swellNode.gain.setTargetAtTime(1 + SWELL * k, this.ctx.currentTime, 0.4);
  }

  /**
   * Ráfaga grabada: `inSec` = cuándo empieza la ráfaga de polvo que se ve; su golpe más fuerte cae cuando la ráfaga de polvo ya ha
   * subido (0,6 s después). Si no da tiempo a toda su subida, empieza más adelantada. Alterna versiones y cambia un poco el tono.
   */
  gust(scene: AmbScene, k: number, inSec: number) {
    if (!this.ctx || !this.gustOut || !this.hasGusts(scene)) return;
    const list = this.clips.get(scene === 'canyon' ? 'amb_canon_rafaga' : 'amb_arena_rafaga')!;
    const choices = list.length > 1 ? list.filter((c) => c.name !== this.lastGust) : list;
    const clip = choices[Math.floor(Math.random() * choices.length)];
    this.lastGust = clip.name;
    const rate = 0.95 + Math.random() * 0.1;
    const now = this.ctx.currentTime;
    let at = now + inSec + 0.6 - clip.golpe / rate, offset = 0;
    if (at < now + 0.02) { offset = (now + 0.02 - at) * rate; at = now + 0.02; }
    const src = this.ctx.createBufferSource();
    src.buffer = clip.buf;
    src.playbackRate.value = rate;
    const g = this.ctx.createGain();
    const level = Math.min(1, 0.55 + 0.45 * k); // según la fuerza de la ráfaga de polvo
    g.gain.setValueAtTime(offset > 0 ? 0 : level, at);
    if (offset > 0) g.gain.linearRampToValueAtTime(level, at + 0.4); // empezada a medias: entra con un fundido corto
    src.connect(g).connect(this.gustOut);
    src.start(at, offset);
    this.played[clip.name] = (this.played[clip.name] ?? 0) + 1;
  }

  dispose() { window.clearInterval(this.timer); }
}
