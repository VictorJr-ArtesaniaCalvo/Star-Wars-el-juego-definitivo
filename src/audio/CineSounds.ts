import { Howler } from 'howler';

// Sonidos propios de la cinemática, generados en el momento con Web Audio (sin archivos):
// motor de la cañonera en vuelo (con volumen y tono para las pasadas), golpe con los nudillos en el casco, crepitar del fuego,
// escudo de droideka encendiéndose y pasos con eco en el túnel.
// Todos pasan por el volumen general del juego.

export class CineSounds {
  private noise: AudioBuffer | null = null;
  private engine: { stop: (fade: number) => void; set: (level: number, pitch: number) => void } | null = null;
  private live: AudioScheduledSourceNode[] = [];

  private get ctx(): AudioContext | null { return Howler.ctx ?? null; }
  private get out(): AudioNode | null { const c = this.ctx; return c ? (Howler.masterGain ?? c.destination) : null; }

  private noiseBuffer(ctx: AudioContext) {
    if (this.noise) return this.noise;
    const n = ctx.sampleRate * 3;
    const b = ctx.createBuffer(1, n, ctx.sampleRate);
    const d = b.getChannelData(0);
    // ruido «marrón» (más grave que el blanco): mejor para motores y viento
    let last = 0;
    for (let i = 0; i < n; i++) { last = (last + 0.02 * (Math.random() * 2 - 1)) / 1.02; d[i] = last * 3.5; }
    this.noise = b;
    return b;
  }

  private track<T extends AudioScheduledSourceNode>(s: T): T {
    this.live.push(s);
    s.onended = () => { this.live = this.live.filter((x) => x !== s); };
    return s;
  }

  /** Motor de la cañonera: retumbo grave con un silbido de turbina por encima. `level` 0..1. */
  startEngine(level = 1, fadeIn = 0.8) {
    const ctx = this.ctx, out = this.out;
    if (!ctx || !out || this.engine) return;
    const t0 = ctx.currentTime;
    const master = ctx.createGain();
    master.gain.setValueAtTime(0.0001, t0);
    master.gain.exponentialRampToValueAtTime(0.55 * level, t0 + fadeIn);
    master.connect(out);
    // retumbo
    const rumble = this.track(ctx.createBufferSource());
    rumble.buffer = this.noiseBuffer(ctx); rumble.loop = true;
    const lp = ctx.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = 220;
    const rg = ctx.createGain(); rg.gain.value = 1.4;
    rumble.connect(lp).connect(rg).connect(master);
    // zumbido de los motores (dos tonos un poco desafinados: «late»)
    const oscs = [62, 63.4].map((f) => { const o = this.track(ctx.createOscillator()); o.type = 'sawtooth'; o.frequency.value = f; return o; });
    const olp = ctx.createBiquadFilter(); olp.type = 'lowpass'; olp.frequency.value = 300;
    const og = ctx.createGain(); og.gain.value = 0.12;
    for (const o of oscs) o.connect(olp);
    olp.connect(og).connect(master);
    // silbido de turbina
    const whine = this.track(ctx.createBufferSource());
    whine.buffer = this.noiseBuffer(ctx); whine.loop = true;
    const bp = ctx.createBiquadFilter(); bp.type = 'bandpass'; bp.frequency.value = 1150; bp.Q.value = 7;
    const wg = ctx.createGain(); wg.gain.value = 0.55;
    whine.connect(bp).connect(wg).connect(master);
    // viento que entra por la puerta abierta
    const wind = this.track(ctx.createBufferSource());
    wind.buffer = this.noiseBuffer(ctx); wind.loop = true; wind.playbackRate.value = 2.2;
    const whp = ctx.createBiquadFilter(); whp.type = 'bandpass'; whp.frequency.value = 600; whp.Q.value = 0.5;
    const wng = ctx.createGain(); wng.gain.value = 0.18; // bajado dos veces al 60 % (0,5 → 0,3 → 0,18), como el viento de la partida
    const lfo = this.track(ctx.createOscillator()); lfo.frequency.value = 0.35;
    const lfoG = ctx.createGain(); lfoG.gain.value = 0.09; // las ráfagas, igual
    lfo.connect(lfoG).connect(wng.gain);
    wind.connect(whp).connect(wng).connect(master);
    for (const s of [rumble, whine, wind]) s.start(t0, Math.random() * 2);
    for (const s of [lfo, ...oscs]) s.start(t0);
    const baseF = [62, 63.4];
    this.engine = {
      // volumen (0..1) y tono (1 = normal; más alto al acercarse, más bajo al alejarse) para la pasada rasante
      set: (lv: number, pitch: number) => {
        const t = ctx.currentTime;
        master.gain.setTargetAtTime(Math.max(0.0001, 0.55 * lv), t, 0.05);
        oscs.forEach((o, i) => o.frequency.setTargetAtTime(baseF[i] * pitch, t, 0.05));
        bp.frequency.setTargetAtTime(1150 * pitch, t, 0.05);
        rumble.playbackRate.setTargetAtTime(pitch, t, 0.05);
      },
      stop: (fade: number) => {
        const t = ctx.currentTime;
        master.gain.cancelScheduledValues(t);
        master.gain.setValueAtTime(Math.max(0.0001, master.gain.value), t);
        master.gain.exponentialRampToValueAtTime(0.0001, t + fade);
        for (const s of [rumble, whine, wind, lfo, ...oscs]) s.stop(t + fade + 0.05);
      },
    };
  }

  /** Cambia el volumen y el tono del motor que ya suena (la cañonera se acerca y se aleja). */
  setEngine(level: number, pitch = 1) { this.engine?.set(level, pitch); }

  /**
   * Escudo de droideka encendiéndose: un zumbido eléctrico que sube de tono y se queda vibrando, con chisporroteo al principio.
   * `level` 0..1 (dos droidekas a la vez: algo más fuerte).
   */
  shieldOn(level = 1) {
    const ctx = this.ctx, out = this.out;
    if (!ctx || !out) return;
    const t0 = ctx.currentTime + 0.01, dur = 1.6;
    const master = ctx.createGain();
    master.gain.setValueAtTime(0.0001, t0);
    master.gain.exponentialRampToValueAtTime(0.5 * level, t0 + 0.08);
    master.gain.setValueAtTime(0.5 * level, t0 + 0.7);
    master.gain.exponentialRampToValueAtTime(0.16 * level, t0 + 1.1);
    master.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
    master.connect(out);
    // barrido que sube (dos tonos algo desafinados, como un generador que arranca)
    for (const [a, b, type, g0] of [[90, 420, 'sawtooth', 0.12], [92, 426, 'square', 0.05]] as const) {
      const o = this.track(ctx.createOscillator());
      o.type = type;
      o.frequency.setValueAtTime(a, t0);
      o.frequency.exponentialRampToValueAtTime(b, t0 + 0.55);
      const lp = ctx.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.setValueAtTime(400, t0); lp.frequency.exponentialRampToValueAtTime(2600, t0 + 0.5);
      const g = ctx.createGain(); g.gain.value = g0;
      // vibración del campo de energía
      const lfo = this.track(ctx.createOscillator()); lfo.frequency.value = 23;
      const lg = ctx.createGain(); lg.gain.value = g0 * 0.6;
      lfo.connect(lg).connect(g.gain);
      o.connect(lp).connect(g).connect(master);
      o.start(t0); o.stop(t0 + dur + 0.05); lfo.start(t0); lfo.stop(t0 + dur + 0.05);
    }
    // chisporroteo eléctrico al encenderse
    const n = this.track(ctx.createBufferSource());
    n.buffer = this.noiseBuffer(ctx); n.loop = true; n.playbackRate.value = 4;
    const hp = ctx.createBiquadFilter(); hp.type = 'highpass'; hp.frequency.value = 2200;
    const ng = ctx.createGain();
    ng.gain.setValueAtTime(0, t0);
    for (let t = 0; t < 0.6; t += 0.02 + Math.random() * 0.05) { ng.gain.setValueAtTime((0.5 + Math.random()) * (1 - t / 0.6), t0 + t); ng.gain.setValueAtTime(0, t0 + t + 0.008 + Math.random() * 0.01); }
    n.connect(hp).connect(ng).connect(master);
    n.start(t0, Math.random()); n.stop(t0 + 0.7);
  }

  /** Un paso en el túnel: golpe sordo de la bota y su eco contra la roca (tres rebotes que se apagan). `level` 0..1. */
  echoStep(level = 1) {
    const ctx = this.ctx, out = this.out;
    if (!ctx || !out) return;
    const t0 = ctx.currentTime + 0.005;
    for (const [dt, k, f] of [[0, 1, 520], [0.13, 0.42, 420], [0.27, 0.22, 360], [0.42, 0.11, 300]] as const) {
      const src = this.track(ctx.createBufferSource());
      src.buffer = this.noiseBuffer(ctx);
      const lp = ctx.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = f;
      const g = ctx.createGain();
      const t = t0 + dt;
      g.gain.setValueAtTime(0.0001, t);
      g.gain.exponentialRampToValueAtTime(1.3 * k * level, t + 0.006);
      g.gain.exponentialRampToValueAtTime(0.0001, t + 0.09 + dt * 0.25);
      src.connect(lp).connect(g).connect(out);
      src.start(t, Math.random() * 2); src.stop(t + 0.2 + dt * 0.3);
      // el crujido de la grava bajo la bota (solo el golpe, no el eco)
      if (dt === 0) {
        const c = this.track(ctx.createBufferSource());
        c.buffer = this.noiseBuffer(ctx); c.playbackRate.value = 3;
        const bp = ctx.createBiquadFilter(); bp.type = 'bandpass'; bp.frequency.value = 1700; bp.Q.value = 0.8;
        const cg = ctx.createGain();
        cg.gain.setValueAtTime(0.0001, t); cg.gain.exponentialRampToValueAtTime(0.5 * level, t + 0.004); cg.gain.exponentialRampToValueAtTime(0.0001, t + 0.05);
        c.connect(bp).connect(cg).connect(out);
        c.start(t, Math.random() * 2); c.stop(t + 0.07);
      }
    }
  }

  stopEngine(fade = 0.6) {
    this.engine?.stop(fade);
    this.engine = null;
  }

  /** Golpes con los nudillos en el lateral del casco (`n` golpes seguidos). */
  knock(n = 2) {
    const ctx = this.ctx, out = this.out;
    if (!ctx || !out) return;
    for (let i = 0; i < n; i++) {
      const t0 = ctx.currentTime + 0.01 + i * 0.17;
      // golpe hueco: un tono grave que cae muy rápido…
      const o = this.track(ctx.createOscillator());
      o.type = 'sine';
      o.frequency.setValueAtTime(420, t0);
      o.frequency.exponentialRampToValueAtTime(140, t0 + 0.06);
      const g = ctx.createGain();
      g.gain.setValueAtTime(0.0001, t0);
      g.gain.exponentialRampToValueAtTime(0.7, t0 + 0.003);
      g.gain.exponentialRampToValueAtTime(0.0001, t0 + 0.12);
      o.connect(g).connect(out);
      o.start(t0); o.stop(t0 + 0.14);
      // …y el «clac» del plástico duro
      const c = this.track(ctx.createBufferSource());
      c.buffer = this.noiseBuffer(ctx);
      const bp = ctx.createBiquadFilter(); bp.type = 'bandpass'; bp.frequency.value = 2400; bp.Q.value = 1.5;
      const cg = ctx.createGain();
      cg.gain.setValueAtTime(0.0001, t0);
      cg.gain.exponentialRampToValueAtTime(1.6, t0 + 0.002);
      cg.gain.exponentialRampToValueAtTime(0.0001, t0 + 0.035);
      c.connect(bp).connect(cg).connect(out);
      c.start(t0, Math.random()); c.stop(t0 + 0.05);
    }
  }

  /** Crepitar del fuego durante `seconds` (chasquidos sueltos sobre un rumor suave). */
  crackle(seconds: number, level = 1) {
    const ctx = this.ctx, out = this.out;
    if (!ctx || !out) return;
    const t0 = ctx.currentTime;
    const src = this.track(ctx.createBufferSource());
    src.buffer = this.noiseBuffer(ctx); src.loop = true;
    const lp = ctx.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = 500;
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t0);
    g.gain.exponentialRampToValueAtTime(0.35 * level, t0 + 0.5);
    g.gain.setValueAtTime(0.35 * level, t0 + seconds - 0.5);
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + seconds);
    src.connect(lp).connect(g).connect(out);
    src.start(t0); src.stop(t0 + seconds + 0.05);
    const pops = ctx.createBufferSource();
    this.track(pops);
    pops.buffer = this.noiseBuffer(ctx); pops.loop = true; pops.playbackRate.value = 3;
    const hp = ctx.createBiquadFilter(); hp.type = 'highpass'; hp.frequency.value = 1800;
    const pg = ctx.createGain();
    pg.gain.setValueAtTime(0, t0);
    for (let t = 0.2; t < seconds - 0.2; t += 0.03 + Math.random() * 0.22) {
      pg.gain.setValueAtTime(0.4 + Math.random() * 1.6 * level, t0 + t);
      pg.gain.setValueAtTime(0, t0 + t + 0.006 + Math.random() * 0.012);
    }
    pops.connect(hp).connect(pg).connect(out);
    pops.start(t0); pops.stop(t0 + seconds);
  }

  /** Corta todo (al saltar la cinemática). */
  stopAll() {
    this.stopEngine(0.25);
    for (const s of this.live) { try { s.stop(); } catch { /* ya parado */ } }
    this.live = [];
  }
}
