import { Howler } from 'howler';
import type RAPIER from '@dimforge/rapier3d-compat';
import type { BrainContext } from '../enemies/DroidBrain';
import type { Droid } from '../enemies/Droid';

// Voces de los droides (de Víctor, hechas con ElevenLabs; preparadas con tools/prepare-droid-voices.py → public/audio/voces/droides/).
// Los archivos se llaman <droide>_<frase>_<n> (b1_avistado_1, b1_buscando_3, b2_recibido_1…) y el juego usa todos los que haya en
// droides.json: para añadir variantes, frases nuevas (granada, baja, avance) o las del B2 basta con el archivo y el script.
//
// CUÁNDO HABLAN (solo en partida, nunca en las cinemáticas):
//  · avistado: un droide ve al jugador por primera vez, o lo vuelve a ver tras perderlo un rato.
//  · buscando: lleva unos segundos sin verlo (p. ej., el jugador está a cubierto). Una vez por cada vez que lo pierde.
//  · recibido (o avance, si hay archivos): un droide empieza a moverse a otra posición (al empezar la ronda o al cambiar de cobertura).
//  · granada: tiene una granada cerca · baja: acaba de caer un compañero a su lado (cuando haya archivos de esas frases).
// QUE NO SE REPITAN: solo habla uno a la vez; entre frase y frase (de cualquiera) pasan `espera` s; cada frase tiene su propia espera;
// cada situación solo da frase con cierta probabilidad; las variantes se van rotando (nunca la misma dos veces seguidas) y cada vez
// suena con un tono algo distinto.
// LA VOZ SALE DEL DROIDE: suena desde su cabeza y le sigue (izquierda/derecha, más baja cuanto más lejos); solo habla uno que esté a
// menos de `distancia` m. Si muere hablando, la frase se corta con un fundido muy corto.
// FILTRO ROBÓTICO (todo en el juego, ajustable): más agudo, realce metálico, modulación en anillo (voz «de máquina») y un eco muy corto
// que suena a lata; `filtro` = intensidad de todo ello (0 = voz limpia, 1 = muy robótica).

/** Valores ajustables (panel del modo de pruebas: «AJUSTAR VOCES DE LOS DROIDES», con «Copiar valores»). */
export const DROID_VOICE = {
  /** Distancia máxima (m) a la que un droide puede hablar. */
  distancia: 15,
  /** Espera entre una frase y la siguiente, de cualquier droide (s, al azar entre los dos). */
  esperaMin: 6,
  esperaMax: 10,
  /** Espera de cada frase antes de poder repetirse (s). */
  esperaAvistado: 12,
  esperaBuscando: 20,
  esperaRecibido: 15,
  esperaOtras: 12,
  /** Probabilidad de que una situación dé frase (0 a 1). */
  probabilidad: 0.4,
  /** Intensidad del filtro robótico (0 a 1). */
  filtro: 0.6,
  /** Tono (1 = el de la grabación; más = más agudo). Cada frase varía además ±3 % al azar. */
  tono: 1.06,
  /** Volumen de la voz (a 3 m del droide; más lejos baja). */
  volumen: 1.5,
  /** Segundos sin ver al jugador para decir «buscando», y para que volver a verlo cuente como «avistado». */
  perdido: 5,
};
export type DroidVoiceKey = keyof typeof DROID_VOICE;

const HEAD = 1.75; // altura de la cabeza de un B1/B2 (m)
const REF = 3; // a esta distancia suena a su volumen; más lejos baja (a 15 m, 1/5: unos −14 dB)
const SEE_EVERY = 0.3; // cada cuánto se comprueba si un droide cercano ve al jugador (s)
const CUT_FADE = 0.06; // fundido al cortar la frase cuando muere el droide (s)
const PENDING = 3; // lo que aguarda su turno una situación que llegó mientras otro hablaba (s)
const rnd = (a: number, b: number) => a + Math.random() * (b - a);

interface Watch { active: boolean; moving: boolean; sees: boolean; everSeen: boolean; lostAt: number; searched: boolean; nextSee: number }
interface Speaking { droid: Droid | null; src: AudioBufferSourceNode; osc: OscillatorNode; panner: PannerNode; fade: GainNode; end: number; x: number; y: number; z: number }

export class DroidVoices {
  private ctx: AudioContext | null = null;
  private clips = new Map<string, AudioBuffer>();
  private lines: Record<string, Record<string, string[]>> = {};
  private bags = new Map<string, string[]>();
  private lastOf = new Map<string, string>();
  private watch = new Map<number, Watch>();
  private now = 0;
  private nextAny = 1; // al empezar, un segundo de calma
  /** Situaciones que llegaron mientras otro hablaba o durante la espera: aguardan su turno unos segundos (luego se olvidan). */
  private pending = new Map<number, { d: Droid; types: string[]; until: number }>();
  private nextType = new Map<string, number>();
  private speaking: Speaking | null = null;
  private dir = { x: 0, y: 0, z: 0 };
  ready = false;
  /** Solo para pruebas: qué ha sonado. */
  played: Record<string, number> = {};

  async load(base: string) {
    const ctx = Howler.ctx as AudioContext | undefined;
    if (!ctx || !Howler.masterGain) return;
    this.ctx = ctx;
    try {
      this.lines = (await (await fetch(`${base}audio/voces/droides/droides.json`)).json()) as Record<string, Record<string, string[]>>;
      const names = Object.values(this.lines).flatMap((byType) => Object.values(byType).flat());
      await Promise.all(names.map(async (n) => {
        const data = await (await fetch(`${base}audio/voces/droides/${n}.mp3`)).arrayBuffer();
        this.clips.set(n, await ctx.decodeAudioData(data));
      }));
      this.ready = true;
    } catch (e) {
      console.warn('No se pudieron cargar las voces de los droides.', e);
    }
  }

  /** ¿Tiene este droide alguna frase de este tipo? */
  private has(kind: string, type: string) { return !!this.lines[kind]?.[type]?.length; }

  /** Siguiente variante: se rotan todas antes de repetir y nunca la misma dos veces seguidas. */
  private pick(kind: string, type: string): string | null {
    const key = `${kind}_${type}`, all = this.lines[kind]?.[type];
    if (!all?.length) return null;
    let bag = this.bags.get(key);
    if (!bag?.length) {
      bag = [...all].sort(() => Math.random() - 0.5);
      if (bag.length > 1 && bag[bag.length - 1] === this.lastOf.get(key)) bag.unshift(bag.pop()!); // la última que sonó no repite
      this.bags.set(key, bag);
    }
    const name = bag.pop()!;
    this.lastOf.set(key, name);
    return name;
  }

  private typeWait(type: string) {
    const V = DROID_VOICE;
    return type === 'avistado' ? V.esperaAvistado : type === 'buscando' ? V.esperaBuscando : type === 'recibido' || type === 'avance' ? V.esperaRecibido : V.esperaOtras;
  }

  /** Una situación que podría dar frase: se dice solo si se cumplen todas las reglas (distancia, esperas, probabilidad…). */
  private offer(d: Droid, types: string[], dist: number) {
    if (dist > DROID_VOICE.distancia) return;
    if (this.speaking || this.now < this.nextAny) { this.pending.set(d.state.id, { d, types, until: this.now + PENDING }); return; }
    this.pending.delete(d.state.id);
    const kind = d.kind, options = types.filter((t) => this.has(kind, t) && this.now >= (this.nextType.get(`${kind}_${t}`) ?? 0));
    if (!options.length) return;
    if (Math.random() > DROID_VOICE.probabilidad) return;
    const type = options[Math.floor(Math.random() * options.length)];
    const name = this.pick(kind, type);
    if (!name) return;
    this.say(name, d, d.state.x, d.state.y + HEAD, d.state.z);
    this.nextType.set(`${kind}_${type}`, this.now + this.typeWait(type));
  }

  /** Dice una frase desde un punto (que sigue al droide si lo hay). */
  say(name: string, droid: Droid | null, x: number, y: number, z: number) {
    const ctx = this.ctx, buf = this.clips.get(name);
    if (!ctx || !buf || !Howler.masterGain) return;
    if (ctx.state !== 'running') void ctx.resume();
    this.stop(true);
    const V = DROID_VOICE, I = Math.max(0, Math.min(1, V.filtro)), t = ctx.currentTime + 0.02;
    const src = ctx.createBufferSource();
    src.buffer = buf;
    src.playbackRate.value = V.tono * rnd(0.97, 1.03);
    // filtro robótico
    const hp = ctx.createBiquadFilter(); hp.type = 'highpass'; hp.frequency.value = 180 + 260 * I;
    const metal = ctx.createBiquadFilter(); metal.type = 'peaking'; metal.frequency.value = 2300; metal.Q.value = 1.6; metal.gain.value = 10 * I;
    const ring = ctx.createGain(); ring.gain.value = 1 - 0.4 * I; // modulación en anillo: la voz «vibra» como un altavoz de máquina
    const osc = ctx.createOscillator(); osc.frequency.value = 62; const oscAmt = ctx.createGain(); oscAmt.gain.value = 0.4 * I;
    osc.connect(oscAmt).connect(ring.gain);
    const comb = ctx.createDelay(0.05); comb.delayTime.value = 0.0045; // eco muy corto: suena a lata
    const fb = ctx.createGain(); fb.gain.value = 0.42 * I;
    const wet = ctx.createGain(); wet.gain.value = 0.55 * I;
    const mix = ctx.createGain();
    const lp = ctx.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = 7000;
    const vol = ctx.createGain(); vol.gain.value = V.volumen;
    src.connect(hp).connect(metal).connect(ring);
    ring.connect(mix);
    ring.connect(comb); comb.connect(fb).connect(comb); comb.connect(wet).connect(mix);
    mix.connect(lp).connect(vol);
    // sale del droide: con dirección y más baja cuanto más lejos
    const panner = ctx.createPanner();
    panner.panningModel = 'HRTF';
    panner.distanceModel = 'inverse';
    panner.refDistance = REF;
    panner.rolloffFactor = 1;
    panner.maxDistance = 60;
    panner.positionX.value = x; panner.positionY.value = y; panner.positionZ.value = z;
    const fade = ctx.createGain();
    vol.connect(panner).connect(fade).connect(Howler.masterGain);
    src.start(t);
    osc.start(t);
    const len = buf.duration / src.playbackRate.value;
    osc.stop(t + len + 0.2);
    this.speaking = { droid, src, osc, panner, fade, end: this.now + len + 0.1, x, y, z };
    src.onended = () => { if (this.speaking?.src === src) this.finish(); };
    this.played[name] = (this.played[name] ?? 0) + 1;
  }

  /** Acaba la frase: empieza a contar la espera hasta la siguiente. */
  private finish() {
    this.speaking = null;
    this.nextAny = this.now + rnd(DROID_VOICE.esperaMin, DROID_VOICE.esperaMax);
  }

  /** Corta la frase que suene (con un fundido muy corto). */
  stop(quiet = false) {
    const s = this.speaking, ctx = this.ctx;
    if (!s || !ctx) return;
    const t = ctx.currentTime;
    s.fade.gain.cancelScheduledValues(t);
    s.fade.gain.setValueAtTime(s.fade.gain.value, t);
    s.fade.gain.linearRampToValueAtTime(0, t + CUT_FADE);
    try { s.src.stop(t + CUT_FADE + 0.01); s.osc.stop(t + CUT_FADE + 0.01); } catch { /* ya parado */ }
    if (quiet) this.speaking = null; else this.finish();
  }

  /** Ha caído un droide: si hablaba, se corta; si tenía un compañero cerca, este puede decir «baja». */
  died(x: number, z: number, droids: Droid[], player: { x: number; z: number }) {
    for (const d of droids) {
      if (!d.state.alive || Math.hypot(d.state.x - x, d.state.z - z) > 12) continue;
      this.offer(d, ['baja'], Math.hypot(d.state.x - player.x, d.state.z - player.z));
      break;
    }
  }

  /** Cada fotograma de partida: sigue a quien habla y busca situaciones para hablar. */
  update(dt: number, droids: Droid[], ctx: BrainContext, grenades: Array<{ x: number; y: number; z: number }>) {
    this.now += dt;
    if (!this.ready) return;
    const s = this.speaking;
    if (s) {
      if (s.droid && !s.droid.state.alive) this.stop(); // murió hablando
      else if (s.droid) {
        const p = s.droid.state;
        s.panner.positionX.value = p.x; s.panner.positionY.value = p.y + HEAD; s.panner.positionZ.value = p.z;
      }
      if (this.speaking && this.now > this.speaking.end + 1) this.finish(); // por si no llegó el aviso de que acabó
    }
    const P = ctx.player();
    const range = DROID_VOICE.distancia;
    // las situaciones que esperaban turno (si el droide sigue vivo y cerca)
    if (!this.speaking && this.now >= this.nextAny) {
      for (const [id, q] of this.pending) {
        if (this.now > q.until || !q.d.state.alive) { this.pending.delete(id); continue; }
        this.pending.delete(id);
        this.offer(q.d, q.types, Math.hypot(q.d.state.x - P.x, q.d.state.z - P.z));
        if (this.speaking) break;
      }
    }
    for (const d of droids) {
      const st = d.state;
      let w = this.watch.get(st.id);
      if (!w) { w = { active: false, moving: false, sees: false, everSeen: false, lostAt: 0, searched: false, nextSee: 0 }; this.watch.set(st.id, w); }
      if (!st.active || !st.alive) { w.active = false; continue; }
      const dist = Math.hypot(st.x - P.x, st.z - P.z);
      const fresh = !w.active;
      if (fresh) { w.active = true; w.moving = false; w.sees = false; w.everSeen = false; w.searched = false; w.nextSee = this.now + Math.random() * SEE_EVERY; }
      // se pone en marcha hacia otra posición (al aparecer o al cambiar de cobertura)
      const moving = d.brain.moving;
      if (moving && !w.moving) this.offer(d, ['recibido', 'avance'], dist);
      w.moving = moving;
      if (dist > range + 3) continue; // lejos: no hace falta saber si ve al jugador (no podría hablar)
      // ¿ve al jugador?
      if (this.now >= w.nextSee) {
        w.nextSee = this.now + SEE_EVERY;
        const sees = this.sees(st.x, st.y + HEAD, st.z, P, ctx);
        if (sees && !w.sees) {
          if (!w.everSeen || this.now - w.lostAt > DROID_VOICE.perdido * 0.8) this.offer(d, ['avistado'], dist);
          w.everSeen = true; w.searched = false;
        } else if (!sees && w.sees) w.lostAt = this.now;
        w.sees = sees;
      }
      if (w.everSeen && !w.sees && !w.searched && this.now - w.lostAt > DROID_VOICE.perdido) {
        w.searched = true; // una vez por cada vez que lo pierde
        this.offer(d, ['buscando'], dist);
      }
      // granada cerca
      for (const g of grenades) if (Math.hypot(g.x - st.x, g.z - st.z) < 6) { this.offer(d, ['granada'], dist); break; }
    }
  }

  private sees(x: number, y: number, z: number, P: { x: number; y: number; z: number; crouching: boolean }, ctx: BrainContext) {
    const R = ctx.rapier as typeof RAPIER;
    const ty = P.y + (P.crouching ? 0.9 : 1.5);
    this.dir.x = P.x - x; this.dir.y = ty - y; this.dir.z = P.z - z;
    const len = Math.hypot(this.dir.x, this.dir.y, this.dir.z) || 1;
    this.dir.x /= len; this.dir.y /= len; this.dir.z /= len;
    const h = ctx.physics.castRay(new R.Ray({ x, y, z }, this.dir), len + 1, true, undefined, undefined, undefined, undefined, (c) => !ctx.isDroid(c.handle));
    return !!h && h.collider.handle === ctx.playerCollider();
  }

  /** Al empezar/acabar una partida o en las cinemáticas: calla y lo olvida todo. */
  reset() {
    this.stop(true);
    this.watch.clear();
    this.pending.clear();
    this.nextAny = this.now + 1;
    this.nextType.clear();
  }

  /** Panel de pruebas: dice una frase al azar desde un punto a `dist` m a la izquierda del oyente. */
  test(dist: number, listener: { x: number; y: number; z: number; yaw: number }) {
    const kinds = Object.keys(this.lines);
    if (!kinds.length) return;
    const kind = kinds[0], types = Object.keys(this.lines[kind]);
    const type = types[Math.floor(Math.random() * types.length)];
    const name = this.pick(kind, type);
    if (!name) return;
    // a la izquierda del oyente (yaw: 0 = mirando a −z)
    const lx = -Math.cos(listener.yaw), lz = Math.sin(listener.yaw);
    this.say(name, null, listener.x + lx * dist, listener.y, listener.z + lz * dist);
  }
}
