import { Howler } from 'howler';

// Sonido de las naves grandes del cielo (de Víctor, ElevenLabs; preparados con tools/prepare-ship-sounds.py → public/audio/naves/).
// Solo motores y disparos:
//  · Motores de la Venator: vibración grave y continua que sale de la nave (3D), muy de fondo (por debajo del viento y de la música).
//    Bucle con fundido cruzado de igual potencia (como los ambientes): nunca se nota el corte ni hay bajones.
//  · Disparos: cada rayo que sale suena en ese momento desde la nave que dispara (verdes = Venator, rojos = fragata). Variantes
//    alternas sin repetir seguidas y con algo de tono; ráfaga (si hay archivo) cuando la nave dispara varios muy seguidos.
//    Más bajos que todo lo demás, apagados (sin agudos) y con eco por la distancia.
//  · En la arena las naves no se ven: sus disparos suenan de vez en cuando, más bajos y más apagados (batalla lejana); sin motores.
// Todo pasa por el volumen general del juego (se calla en pausa y respeta el volumen de efectos).

/** Valores ajustables (panel del modo de pruebas: «AJUSTAR SONIDO DE LAS NAVES», con «Copiar valores»). */
export const SHIP_SOUND = {
  /** Volumen de los motores de la Venator. */
  motores: 0.5,
  /** Volumen de los disparos de las naves. */
  disparos: 0.35,
  /** En la arena (sin naves a la vista): cuánto bajan los disparos (1 = igual que en el cañón). */
  arena: 0.4,
};
export type ShipSoundKey = keyof typeof SHIP_SOUND;
export type ShipName = 'venator' | 'fragata';

const CROSS = 2.5; // fundido cruzado del bucle de los motores (s)
const BURST_GAP = 0.3; // disparos de la misma nave a menos de esto cuentan como ráfaga (s)
const rnd = (a: number, b: number) => a + Math.random() * (b - a);
const N = 64;
const UP = new Float32Array(N), DOWN = new Float32Array(N);
for (let i = 0; i < N; i++) { const a = (i / (N - 1)) * Math.PI / 2; UP[i] = Math.sin(a); DOWN[i] = Math.cos(a); }

export class ShipSounds {
  private ctx: AudioContext | null = null;
  private clips = new Map<string, AudioBuffer>();
  private lines: Record<string, Record<string, string[]>> = {};
  private last = new Map<string, string>();
  private engine: { input: BiquadFilterNode; gain: GainNode; panner: PannerNode; cur: { src: AudioBufferSourceNode; g: GainNode } | null; next: number } | null = null;
  private shotBus: GainNode | null = null;
  private lastShot = new Map<ShipName, { t: number; n: number; burstUntil: number }>();
  private arena = false;
  private nextArenaShot = 0;
  ready = false;
  played: Record<string, number> = {};

  async load(base: string) {
    const ctx = Howler.ctx as AudioContext | undefined;
    if (!ctx || !Howler.masterGain) return;
    this.ctx = ctx;
    try {
      this.lines = (await (await fetch(`${base}audio/naves/naves.json`)).json()) as Record<string, Record<string, string[]>>;
      const names = Object.values(this.lines).flatMap((t) => Object.values(t).flat());
      await Promise.all(names.map(async (n) => {
        this.clips.set(n, await ctx.decodeAudioData(await (await fetch(`${base}audio/naves/${n}.mp3`)).arrayBuffer()));
      }));
      this.shotBus = ctx.createGain();
      this.shotBus.connect(Howler.masterGain);
      this.ready = true;
    } catch (e) {
      console.warn('No se pudieron cargar los sonidos de las naves; quedan los cañonazos de antes.', e);
    }
    window.setInterval(() => this.pump(), 250);
  }

  /** ¿Hay disparos grabados? (si no, suena el cañonazo generado de antes) */
  get hasShots() { return this.ready && Object.values(this.lines).some((t) => t.disparo?.length); }

  private pick(ship: string, type: string): AudioBuffer | null {
    const list = this.lines[ship]?.[type];
    if (!list?.length) return null;
    const key = `${ship}_${type}`;
    const choices = list.length > 1 ? list.filter((n) => n !== this.last.get(key)) : list;
    const name = choices[Math.floor(Math.random() * choices.length)];
    this.last.set(key, name);
    this.played[name] = (this.played[name] ?? 0) + 1;
    return this.clips.get(name) ?? null;
  }

  private panner(x: number, y: number, z: number) {
    const p = this.ctx!.createPanner();
    p.panningModel = 'equalpower';
    p.distanceModel = 'inverse';
    p.refDistance = 1000; // muy lejos: la distancia no cambia el volumen (lo pone SHIP_SOUND); solo da la dirección
    p.rolloffFactor = 0;
    p.positionX.value = x; p.positionY.value = y; p.positionZ.value = z;
    return p;
  }

  // ---------- Motores de la Venator ----------

  /** Arranca (o mueve) el zumbido de los motores en la posición de la nave. Con `null`, se apaga con un fundido (en la arena). */
  setEngine(pos: { x: number; y: number; z: number } | null) {
    const ctx = this.ctx;
    if (!ctx || !this.ready || !this.lines.venator?.motores?.length || !Howler.masterGain) return;
    const t = ctx.currentTime;
    if (!pos) {
      if (this.engine) { const e = this.engine; e.gain.gain.setTargetAtTime(0, t, 0.8); e.next = Infinity; setTimeout(() => { try { e.cur?.src.stop(); } catch { /* nada */ } }, 5000); this.engine = null; }
      return;
    }
    if (this.engine) { const p = this.engine.panner; p.positionX.value = pos.x; p.positionY.value = pos.y; p.positionZ.value = pos.z; return; }
    const gain = ctx.createGain();
    gain.gain.setValueAtTime(0, t);
    gain.gain.setTargetAtTime(SHIP_SOUND.motores, t, 1.2); // entra suave
    const lp = ctx.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = 260; lp.Q.value = 0.5; // solo lo grave
    const panner = this.panner(pos.x, pos.y, pos.z);
    lp.connect(gain).connect(panner).connect(Howler.masterGain);
    this.engine = { input: lp, gain, panner, cur: null, next: t };
    this.enginePass(t, false);
  }

  private enginePass(at: number, cross: boolean) {
    const e = this.engine, ctx = this.ctx;
    if (!e || !ctx) return;
    const buf = this.pick('venator', 'motores');
    if (!buf) return;
    const src = ctx.createBufferSource();
    src.buffer = buf;
    const g = ctx.createGain();
    src.connect(g).connect(e.input);
    if (cross) {
      g.gain.setValueCurveAtTime(UP, at, CROSS);
      const prev = e.cur;
      if (prev) { prev.g.gain.cancelScheduledValues(at); prev.g.gain.setValueCurveAtTime(DOWN, at, CROSS); try { prev.src.stop(at + CROSS + 0.05); } catch { /* nada */ } }
    } else g.gain.setValueAtTime(1, at);
    src.start(at);
    e.cur = { src, g };
    e.next = at + buf.duration - CROSS - 0.1;
  }

  private pump() {
    const ctx = this.ctx, e = this.engine;
    if (!ctx || !e) return;
    if (e.next < ctx.currentTime + 1.5) this.enginePass(Math.max(e.next, ctx.currentTime + 0.05), true);
    e.gain.gain.setTargetAtTime(SHIP_SOUND.motores, ctx.currentTime, 0.3); // sigue al panel de pruebas
  }

  // ---------- Disparos ----------

  /** Una nave dispara un rayo desde (x, y, z). */
  shot(ship: ShipName, x: number, y: number, z: number) {
    const ctx = this.ctx;
    if (!ctx || !this.shotBus || !this.hasShots) return;
    const now = ctx.currentTime;
    const st = this.lastShot.get(ship) ?? { t: -9, n: 0, burstUntil: 0 };
    st.n = now - st.t < BURST_GAP ? st.n + 1 : 1;
    st.t = now;
    this.lastShot.set(ship, st);
    if (now < st.burstUntil) return; // ya suena la ráfaga que cubre estos disparos
    // tercer disparo muy seguido y hay archivo de ráfaga: suena la ráfaga en vez de los sueltos
    if (st.n >= 3 && this.lines[ship]?.rafaga?.length) {
      const buf = this.pick(ship, 'rafaga');
      if (buf) { st.burstUntil = now + buf.duration * 0.8; this.play(buf, x, y, z, this.arena); return; }
    }
    const buf = this.pick(ship, 'disparo');
    if (buf) this.play(buf, x, y, z, this.arena);
  }

  /** Suena un disparo lejano: apagado, con eco por la distancia y desde su dirección. */
  private play(buf: AudioBuffer, x: number, y: number, z: number, arena: boolean) {
    const ctx = this.ctx!;
    const t = ctx.currentTime + 0.01;
    const src = ctx.createBufferSource();
    src.buffer = buf;
    src.playbackRate.value = rnd(0.94, 1.06);
    const lp = ctx.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = arena ? 700 : 2200; lp.Q.value = 0.6; // apagado
    const vol = ctx.createGain(); vol.gain.value = SHIP_SOUND.disparos * (arena ? SHIP_SOUND.arena : 1);
    // eco por la distancia: dos repeticiones suaves y cada vez más apagadas
    const delay = ctx.createDelay(1); delay.delayTime.value = rnd(0.28, 0.4);
    const fb = ctx.createGain(); fb.gain.value = 0.32;
    const dlp = ctx.createBiquadFilter(); dlp.type = 'lowpass'; dlp.frequency.value = 1200;
    const wet = ctx.createGain(); wet.gain.value = 0.45;
    const pan = this.panner(x, y, z);
    src.connect(lp).connect(vol);
    vol.connect(pan);
    vol.connect(delay); delay.connect(dlp).connect(fb).connect(delay); dlp.connect(wet).connect(pan);
    pan.connect(this.shotBus!);
    src.start(t);
    // al acabar (con su eco) se suelta todo
    setTimeout(() => { try { pan.disconnect(); } catch { /* nada */ } }, (buf.duration + 2.5) * 1000);
  }

  // ---------- Arena: batalla lejana que no se ve ----------

  /** En la arena no hay naves: de vez en cuando suena algún disparo lejano, más bajo y apagado, desde lo alto. */
  setArena(on: boolean) {
    if (on === this.arena) return;
    this.arena = on;
    if (on) { this.setEngine(null); this.nextArenaShot = (this.ctx?.currentTime ?? 0) + rnd(4, 9); }
  }

  /** Cada fotograma en la arena (dispara de vez en cuando, desde el sur o el norte, muy alto). */
  tickArena(listener: { x: number; y: number; z: number }) {
    const ctx = this.ctx;
    if (!this.arena || !ctx || ctx.currentTime < this.nextArenaShot) return;
    this.nextArenaShot = ctx.currentTime + rnd(5, 14);
    const ship: ShipName = Math.random() < 0.5 ? 'venator' : 'fragata';
    const n = 1 + Math.floor(Math.random() * 3);
    const zDir = ship === 'venator' ? 1 : -1;
    for (let i = 0; i < n; i++) {
      setTimeout(() => this.shot(ship, listener.x + rnd(-80, 80), listener.y + 250, listener.z + zDir * 300), i * 140);
    }
  }

  /** Panel de pruebas: un disparo de cada nave desde donde está. */
  test(ship: ShipName, pos: { x: number; y: number; z: number }) { this.shot(ship, pos.x, pos.y, pos.z); }
}
