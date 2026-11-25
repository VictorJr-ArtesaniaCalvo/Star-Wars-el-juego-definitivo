import { Howler } from 'howler';

// Voces de los personajes con filtro de radio de casco clon.
//
// Los archivos de voz van en public/audio/voces/<nombre>.mp3 (el nombre lo pone cada frase del guion de la cinemática, campo `voz`).
// Si un archivo no existe, la frase sale solo con subtítulo y suenan igualmente el chasquido y la estática de la radio.
//
// El filtro se hace con el propio navegador (Web Audio), sin archivos ni librerías:
//   voz → corta graves y agudos (suena a walkie) → realza los medios (metálico) → saturación suave → compresor → salida
//   y, en paralelo, un siseo de estática con chasquidos sueltos, más un «clic» de la radio al empezar y al acabar cada frase.
// Hay dos intensidades: `radio` (comunicaciones entre naves: más sucia) y `casco` (lo que dice el protagonista dentro de su casco: más limpia).

export type VoiceFilter = 'radio' | 'casco';

/** Ajustes de cada filtro (fáciles de cambiar al oírlo). */
export interface FilterSetup { graves: number; agudos: number; medios: number; saturacion: number; compresion: number; estatica: number; clic: number; volumen: number }
export const RADIO_FILTERS: Record<VoiceFilter, FilterSetup> = {
  // graves/agudos: frecuencias de corte (Hz) · medios: realce en dB (suena metálico) · saturación: 1 = nada, 6 = mucha · compresión: 1 = nada, 20 = mucha
  // estática: volumen del siseo de fondo · clic: volumen del clic de la radio · volumen: de la voz ya filtrada
  // radio: comunicaciones de la cañonera (tomas 2A y 2B), más marcado · casco: el comando dentro de su casco (toma 5), más suave
  radio: { graves: 480, agudos: 3000, medios: 8, saturacion: 2.6, compresion: 10, estatica: 0.055, clic: 1, volumen: 0.95 },
  casco: { graves: 260, agudos: 4600, medios: 4, saturacion: 1.5, compresion: 6, estatica: 0.018, clic: 0.6, volumen: 1 },
};

interface Chain { input: GainNode; out: GainNode }

export class Voices {
  private buffers = new Map<string, AudioBuffer | null>();
  private chains = new Map<VoiceFilter, Chain>();
  private noise: AudioBuffer | null = null;
  private live: AudioScheduledSourceNode[] = [];

  private get ctx(): AudioContext | null { return Howler.ctx ?? null; }

  /** Intenta descargar las voces (las que no existan se quedan en silencio, solo con subtítulo). */
  preload(ids: string[]) {
    const ctx = this.ctx;
    if (!ctx) return;
    const base = import.meta.env.BASE_URL;
    for (const id of ids) {
      if (this.buffers.has(id)) continue;
      this.buffers.set(id, null);
      fetch(`${base}audio/voces/${id}.mp3`)
        .then((r) => {
          const type = r.headers.get('content-type') ?? '';
          if (!r.ok || type.includes('html')) throw new Error('sin archivo');
          return r.arrayBuffer();
        })
        .then((data) => ctx.decodeAudioData(data))
        .then((buf) => { this.buffers.set(id, buf); })
        .catch(() => { /* sin voz: solo subtítulo */ });
    }
  }

  /** Duración del archivo de voz (s), o null si no hay. */
  duration(id: string | undefined): number | null {
    const b = id ? this.buffers.get(id) : null;
    return b ? b.duration : null;
  }

  private noiseBuffer(ctx: AudioContext) {
    if (this.noise) return this.noise;
    const n = ctx.sampleRate * 2;
    const b = ctx.createBuffer(1, n, ctx.sampleRate);
    const d = b.getChannelData(0);
    for (let i = 0; i < n; i++) d[i] = Math.random() * 2 - 1;
    this.noise = b;
    return b;
  }

  /** Cadena de filtros de un tipo (se crea una vez). */
  private chain(kind: VoiceFilter): Chain | null {
    const ctx = this.ctx;
    if (!ctx) return null;
    const have = this.chains.get(kind);
    if (have) return have;
    const f = RADIO_FILTERS[kind];
    const input = ctx.createGain();
    const hp = ctx.createBiquadFilter(); hp.type = 'highpass'; hp.frequency.value = f.graves; hp.Q.value = 0.9;
    const hp2 = ctx.createBiquadFilter(); hp2.type = 'highpass'; hp2.frequency.value = f.graves; hp2.Q.value = 0.7;
    const lp = ctx.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = f.agudos; lp.Q.value = 0.9;
    const lp2 = ctx.createBiquadFilter(); lp2.type = 'lowpass'; lp2.frequency.value = f.agudos; lp2.Q.value = 0.7;
    const mid = ctx.createBiquadFilter(); mid.type = 'peaking'; mid.frequency.value = 1700; mid.Q.value = 1.1; mid.gain.value = f.medios;
    const shaper = ctx.createWaveShaper();
    const curve = new Float32Array(1024);
    for (let i = 0; i < curve.length; i++) { const x = (i / (curve.length - 1)) * 2 - 1; curve[i] = Math.tanh(x * f.saturacion) / Math.tanh(f.saturacion); }
    shaper.curve = curve;
    shaper.oversample = '2x';
    const comp = ctx.createDynamicsCompressor();
    comp.threshold.value = -26; comp.knee.value = 6; comp.ratio.value = Math.max(1, f.compresion); comp.attack.value = 0.003; comp.release.value = 0.12;
    const out = ctx.createGain();
    out.gain.value = f.volumen;
    input.connect(hp).connect(hp2).connect(mid).connect(shaper).connect(lp).connect(lp2).connect(comp).connect(out);
    out.connect(Howler.masterGain ?? ctx.destination); // pasa por el volumen general del juego
    const c = { input, out };
    this.chains.set(kind, c);
    return c;
  }

  private track(src: AudioScheduledSourceNode) {
    this.live.push(src);
    src.onended = () => { this.live = this.live.filter((s) => s !== src); };
  }

  /** Siseo de estática con chasquidos sueltos durante `seconds` (desde `at`, en tiempo del audio). `level` multiplica el volumen del filtro. */
  static(kind: VoiceFilter, seconds: number, level = 1, at?: number) {
    const ctx = this.ctx, c = this.chain(kind);
    if (!ctx || !c) return;
    const t0 = at ?? ctx.currentTime;
    const src = ctx.createBufferSource();
    src.buffer = this.noiseBuffer(ctx);
    src.loop = true;
    const bp = ctx.createBiquadFilter(); bp.type = 'bandpass'; bp.frequency.value = 2600; bp.Q.value = 0.6;
    const g = ctx.createGain();
    const v = RADIO_FILTERS[kind].estatica * level;
    g.gain.setValueAtTime(0, t0);
    g.gain.linearRampToValueAtTime(v, t0 + 0.04);
    // chasquidos: subidas bruscas y breves del siseo
    for (let t = 0.1; t < seconds - 0.1; t += 0.12 + Math.random() * 0.5) {
      const k = 2 + Math.random() * 5;
      g.gain.setValueAtTime(v * k, t0 + t);
      g.gain.setValueAtTime(v * (0.6 + Math.random() * 0.8), t0 + t + 0.015 + Math.random() * 0.03);
    }
    g.gain.setValueAtTime(v, t0 + seconds - 0.06);
    g.gain.linearRampToValueAtTime(0, t0 + seconds);
    src.connect(bp).connect(g).connect(c.out);
    src.start(t0, Math.random());
    src.stop(t0 + seconds + 0.05);
    this.track(src);
  }

  /** «Clic» de la radio: un pitido corto que cae y un golpe de ruido (al empezar) o una cola de ruido (al acabar). */
  click(kind: VoiceFilter, end: boolean, at?: number) {
    const ctx = this.ctx, c = this.chain(kind);
    if (!ctx || !c) return;
    const t0 = at ?? ctx.currentTime;
    const lvl = RADIO_FILTERS[kind].clic;
    if (!end) {
      const o = ctx.createOscillator();
      o.type = 'square';
      o.frequency.setValueAtTime(1500, t0);
      o.frequency.exponentialRampToValueAtTime(950, t0 + 0.05);
      const g = ctx.createGain();
      g.gain.setValueAtTime(0.0001, t0);
      g.gain.exponentialRampToValueAtTime(0.12 * lvl, t0 + 0.005);
      g.gain.exponentialRampToValueAtTime(0.0001, t0 + 0.06);
      o.connect(g).connect(c.input);
      o.start(t0); o.stop(t0 + 0.07);
      this.track(o);
    }
    const n = ctx.createBufferSource();
    n.buffer = this.noiseBuffer(ctx);
    const g = ctx.createGain();
    const len = end ? 0.16 : 0.035;
    g.gain.setValueAtTime(0.0001, t0);
    g.gain.exponentialRampToValueAtTime(0.3 * lvl, t0 + 0.004);
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + len);
    n.connect(g).connect(c.input);
    n.start(t0, Math.random()); n.stop(t0 + len + 0.02);
    this.track(n);
  }

  /**
   * Dice una frase: clic, voz con el filtro (si hay archivo) y estática de fondo, y clic final.
   * Devuelve cuánto dura (la voz real o `fallback` segundos si aún no hay archivo).
   */
  say(id: string | undefined, kind: VoiceFilter, fallback: number): number {
    const ctx = this.ctx, c = this.chain(kind);
    const buf = id ? this.buffers.get(id) : null;
    const dur = buf ? buf.duration : fallback;
    if (!ctx || !c) return dur;
    if (ctx.state !== 'running') void ctx.resume();
    const t0 = ctx.currentTime + 0.02;
    this.click(kind, false, t0);
    if (buf) {
      const src = ctx.createBufferSource();
      src.buffer = buf;
      src.connect(c.input);
      src.start(t0 + 0.06);
      this.track(src);
    }
    this.static(kind, dur + 0.1, buf ? 1 : 0.8, t0 + 0.04);
    this.click(kind, true, t0 + 0.08 + dur);
    return dur;
  }

  /** Vuelve a montar los filtros con los ajustes actuales de RADIO_FILTERS (panel de ajuste del modo de pruebas). */
  retune() {
    for (const c of this.chains.values()) { try { c.out.disconnect(); } catch { /* ya desconectado */ } }
    this.chains.clear();
  }

  /** ¿Están descargadas las voces? (para el panel de ajuste) */
  loaded(id: string) { return !!this.buffers.get(id); }

  /** Corta todo lo que esté sonando (al saltar la cinemática). */
  stopAll() {
    for (const s of this.live) { try { s.stop(); } catch { /* ya parado */ } }
    this.live = [];
  }
}
