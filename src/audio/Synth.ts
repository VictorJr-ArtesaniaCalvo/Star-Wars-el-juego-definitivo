// Sintetizador de efectos de sonido: genera los sonidos por código (originales, sin descargas ni derechos de autor)
// y los convierte en archivos WAV en memoria que Howler reproduce como cualquier otro sonido.

const SR = 44100;
const TAU = Math.PI * 2;

function rngFrom(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const exp = Math.exp;
const buf = (seconds: number) => new Float32Array(Math.floor(SR * seconds));
const attack = (t: number, a: number) => Math.min(1, t / a);

/** Limita los picos con una curva suave (evita chasquidos al sumar capas). */
function finish(b: Float32Array, gain: number, fadeOut = 0.01): Float32Array {
  const n = Math.floor(SR * fadeOut);
  for (let i = 0; i < b.length; i++) {
    let v = Math.tanh(b[i] * gain);
    if (i > b.length - n) v *= (b.length - i) / n;
    b[i] = v;
  }
  return b;
}

/** Disparo de bláster del jugador: «piu» grave-agudo con golpe de energía. */
function playerBlaster(variant: number): Float32Array {
  const r = rngFrom(100 + variant), b = buf(0.34);
  let p = 0, nz = 0;
  const f0 = 2100 + variant * 120;
  for (let i = 0; i < b.length; i++) {
    const t = i / SR;
    const f = 230 + (f0 - 230) * exp(-t * 15);
    p += (TAU * f) / SR;
    const tone = Math.sin(p) + 0.45 * Math.sin(2 * p) + 0.22 * Math.sin(3 * p + 0.4);
    nz = nz * 0.4 + (r() * 2 - 1) * 0.6;
    const env = attack(t, 0.002) * exp(-t * 9);
    b[i] = tone * env * 0.5 + nz * exp(-t * 55) * 0.5 + Math.sin(TAU * 85 * t) * exp(-t * 26) * 0.45;
  }
  return finish(b, 1.15);
}

/** Disparo del B1: más agudo, fino y corto. */
function b1Blaster(variant: number): Float32Array {
  const r = rngFrom(200 + variant), b = buf(0.24);
  let p = 0;
  for (let i = 0; i < b.length; i++) {
    const t = i / SR;
    const f = 520 + (2500 + variant * 150) * exp(-t * 11) + Math.sin(t * 280) * 25;
    p += (TAU * f) / SR;
    const env = attack(t, 0.0015) * exp(-t * 14);
    b[i] = (Math.sin(p) + 0.3 * Math.sin(2 * p)) * env * 0.7 + (r() * 2 - 1) * exp(-t * 90) * 0.25;
  }
  return finish(b, 1.0);
}

/** Disparo del B2: grave, pesado, con golpe seco. */
function b2Blaster(variant: number): Float32Array {
  const r = rngFrom(300 + variant), b = buf(0.46);
  let p = 0, nz = 0;
  for (let i = 0; i < b.length; i++) {
    const t = i / SR;
    const f = 105 + (820 + variant * 60) * exp(-t * 7);
    p += (TAU * f) / SR;
    const sq = Math.sign(Math.sin(p)) * 0.5 + Math.sin(p) * 0.6; // onda casi cuadrada: más «áspera»
    nz = nz * 0.75 + (r() * 2 - 1) * 0.25;
    const env = attack(t, 0.003) * exp(-t * 6.5);
    b[i] = sq * env * 0.55 + nz * exp(-t * 28) * 0.55 + Math.sin(TAU * 58 * t) * exp(-t * 14) * 0.7;
  }
  return finish(b, 1.25);
}

/** Disparo del droideka: zumbido rápido y vibrante. */
function dekaBlaster(variant: number): Float32Array {
  const r = rngFrom(400 + variant), b = buf(0.13);
  let p = 0;
  for (let i = 0; i < b.length; i++) {
    const t = i / SR;
    const f = 900 + (1500 + variant * 100) * exp(-t * 22);
    p += (TAU * f) / SR;
    const ring = 1 + 0.55 * Math.sin(TAU * 190 * t);
    const env = attack(t, 0.001) * exp(-t * 24);
    b[i] = Math.sin(p) * ring * env * 0.7 + (r() * 2 - 1) * exp(-t * 110) * 0.2;
  }
  return finish(b, 1.0);
}

/** Bláster sobrecalentado: siseo con un quejido descendente. */
function overheat(): Float32Array {
  const r = rngFrom(500), b = buf(0.7);
  let prev = 0, p = 0;
  for (let i = 0; i < b.length; i++) {
    const t = i / SR;
    const w = r() * 2 - 1;
    const hiss = (w - prev) * 0.5; // filtro que deja pasar los agudos
    prev = w;
    const pulse = 0.55 + 0.45 * Math.sin(TAU * 22 * t);
    const env = attack(t, 0.01) * exp(-t * 4.2);
    p += (TAU * (880 * exp(-t * 2.4) + 240)) / SR;
    b[i] = hiss * pulse * env * 0.8 + Math.sin(p) * exp(-t * 3) * 0.22 * attack(t, 0.02);
  }
  return finish(b, 1.0, 0.06);
}

/** Bláster listo otra vez: dos pitidos suaves. */
function ready(): Float32Array {
  const b = buf(0.22);
  for (let i = 0; i < b.length; i++) {
    const t = i / SR;
    const tt = t < 0.09 ? t : t - 0.09;
    const f = t < 0.09 ? 880 : 1320;
    const env = attack(tt, 0.004) * exp(-tt * 38);
    b[i] = Math.sin(TAU * f * t) * env * 0.5;
  }
  return finish(b, 1.0);
}

/** Granada lanzada: soplido de aire. */
function whoosh(): Float32Array {
  const r = rngFrom(600), b = buf(0.34);
  let lp = 0;
  for (let i = 0; i < b.length; i++) {
    const t = i / SR;
    const k = 0.06 + 0.5 * Math.sin((Math.PI * t) / 0.34); // el filtro se abre y se cierra
    lp += k * ((r() * 2 - 1) - lp);
    const env = Math.sin((Math.PI * t) / 0.34) ** 1.5;
    b[i] = lp * env * 1.8;
  }
  return finish(b, 1.0, 0.03);
}

/** Rebote metálico. */
function tink(): Float32Array {
  const r = rngFrom(700), b = buf(0.12);
  for (let i = 0; i < b.length; i++) {
    const t = i / SR;
    const env = attack(t, 0.0008) * exp(-t * 38);
    b[i] = (Math.sin(TAU * 1650 * t) * 0.5 + Math.sin(TAU * 2610 * t) * 0.3) * env + (r() * 2 - 1) * exp(-t * 300) * 0.4;
  }
  return finish(b, 1.0);
}

/** Explosión de granada: golpe grave, estruendo y crepitar. */
function explosion(): Float32Array {
  const r = rngFrom(800), b = buf(2.4);
  let lp = 0, lp2 = 0;
  for (let i = 0; i < b.length; i++) {
    const t = i / SR;
    const w = r() * 2 - 1;
    const cutoff = 0.5 * exp(-t * 2.2) + 0.012; // el estruendo se va volviendo grave
    lp += cutoff * (w - lp);
    lp2 += 0.04 * (lp - lp2);
    const boom = Math.sin(TAU * (28 + 60 * exp(-t * 6)) * t) * exp(-t * 2.6);
    const crackle = r() < 0.004 * exp(-t * 1.4) ? (r() * 2 - 1) * 1.4 : 0;
    b[i] = attack(t, 0.003) * (lp * 1.6 * exp(-t * 2) + lp2 * 1.2 * exp(-t * 1.1) + boom * 1.1) + crackle;
  }
  return finish(b, 1.4, 0.2);
}

/** Cañonazo lejano de las naves del cielo: grave y amortiguado, con eco. */
function distantBoom(): Float32Array {
  const r = rngFrom(900), b = buf(3.6);
  const raw = new Float32Array(b.length);
  let lp = 0, lp2 = 0;
  for (let i = 0; i < raw.length; i++) {
    const t = i / SR;
    lp += 0.03 * ((r() * 2 - 1) - lp);
    lp2 += 0.1 * (lp - lp2);
    raw[i] = attack(t, 0.04) * (lp2 * 5 * exp(-t * 1.5) + Math.sin(TAU * (44 + 20 * exp(-t * 3)) * t) * exp(-t * 1.7) * 0.9);
  }
  for (let i = 0; i < b.length; i++) {
    const d1 = i - Math.floor(SR * 0.21), d2 = i - Math.floor(SR * 0.47);
    b[i] = raw[i] + (d1 > 0 ? raw[d1] * 0.45 : 0) + (d2 > 0 ? raw[d2] * 0.25 : 0);
  }
  return finish(b, 1.1, 0.4);
}

/** Viento del desierto: ruido filtrado con ráfagas lentas; da la vuelta sin cortes (periodo de 12 s). */
function wind(): Float32Array {
  const N = Math.floor(SR * 12), F = Math.floor(SR * 0.6), r = rngFrom(1000);
  const body = new Float32Array(N + F);
  let lp = 0, lp2 = 0, bp1 = 0, bp2 = 0;
  for (let i = 0; i < body.length; i++) {
    const t = i / SR;
    const gust = 0.5 + 0.28 * Math.sin(TAU * t / 12 * 2) + 0.17 * Math.sin(TAU * t / 12 * 5 + 1.3) + 0.12 * Math.sin(TAU * t / 12 * 9 + 0.4);
    const w = r() * 2 - 1;
    const k = 0.012 + 0.03 * gust;
    lp += k * (w - lp);
    lp2 += 0.2 * (lp - lp2);
    // silbido débil: filtro resonante que sube y baja con las ráfagas
    const fc = 520 + 340 * Math.sin(TAU * t / 12 * 3) + 220 * gust;
    const q = TAU * fc / SR;
    bp1 += q * bp2;
    bp2 += q * (w * 0.25 - bp1 - bp2 * 0.045);
    const drone = Math.sin(TAU * 48 * t) * 0.05 + Math.sin(TAU * 72 * t + 1) * 0.03; // zumbido grave constante
    body[i] = lp2 * 7.5 * (0.35 + gust) + bp1 * 0.05 * gust + drone;
  }
  const out = new Float32Array(N);
  for (let i = 0; i < N; i++) {
    const m = i < F ? i / F : 1;
    out[i] = body[i] * m + (i < F ? body[N + i] * (1 - m) : 0);
  }
  for (let i = 0; i < N; i++) out[i] = Math.tanh(out[i] * 0.9);
  return out;
}

/** Convierte las muestras en un archivo WAV (16 bits, mono) y devuelve su dirección en memoria. */
function toWavUrl(samples: Float32Array): string {
  const n = samples.length;
  const bytes = new ArrayBuffer(44 + n * 2);
  const v = new DataView(bytes);
  const str = (o: number, s: string) => { for (let i = 0; i < s.length; i++) v.setUint8(o + i, s.charCodeAt(i)); };
  str(0, 'RIFF'); v.setUint32(4, 36 + n * 2, true); str(8, 'WAVE'); str(12, 'fmt ');
  v.setUint32(16, 16, true); v.setUint16(20, 1, true); v.setUint16(22, 1, true);
  v.setUint32(24, SR, true); v.setUint32(28, SR * 2, true); v.setUint16(32, 2, true); v.setUint16(34, 16, true);
  str(36, 'data'); v.setUint32(40, n * 2, true);
  for (let i = 0; i < n; i++) v.setInt16(44 + i * 2, Math.max(-1, Math.min(1, samples[i])) * 32767, true);
  return URL.createObjectURL(new Blob([bytes], { type: 'audio/wav' }));
}

export type SoundId =
  | 'blaster' | 'b1' | 'b2' | 'deka' | 'overheat' | 'ready' | 'whoosh' | 'tink' | 'explosion' | 'boom' | 'wind';

export interface SynthSet {
  /** Variantes de cada sonido (así los disparos seguidos no suenan idénticos). */
  urls: Record<SoundId, string[]>;
  /** Estadísticas para pruebas: duración (s) y pico de cada variante. */
  stats: Record<string, { seconds: number; peak: number; rms: number }>;
}

export function synthesizeAll(): SynthSet {
  const urls = {} as Record<SoundId, string[]>;
  const stats: SynthSet['stats'] = {};
  const add = (id: SoundId, ...list: Float32Array[]) => {
    urls[id] = list.map((s, i) => {
      let peak = 0, sum = 0;
      for (let k = 0; k < s.length; k++) { const a = Math.abs(s[k]); if (a > peak) peak = a; sum += s[k] * s[k]; }
      stats[`${id}${i}`] = { seconds: +(s.length / SR).toFixed(2), peak: +peak.toFixed(2), rms: +Math.sqrt(sum / s.length).toFixed(3) };
      return toWavUrl(s);
    });
  };
  add('blaster', playerBlaster(0), playerBlaster(1), playerBlaster(2));
  add('b1', b1Blaster(0), b1Blaster(1), b1Blaster(2));
  add('b2', b2Blaster(0), b2Blaster(1));
  add('deka', dekaBlaster(0), dekaBlaster(1), dekaBlaster(2));
  add('overheat', overheat());
  add('ready', ready());
  add('whoosh', whoosh());
  add('tink', tink());
  add('explosion', explosion());
  add('boom', distantBoom());
  add('wind', wind());
  return { urls, stats };
}
