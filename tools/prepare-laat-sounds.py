"""
Prepara los sonidos de la cañonera (originales de Víctor en assets/audio/efectos/*.mp3) para el juego:

  laat_paso_rasante.mp3  → public/audio/laat-pasada.mp3   (cinemática de paso a la arena, toma 1)
      · se recorta el principio casi en silencio (2 s) y la cola; mono (el juego lo mueve de lado a lado)
      · volumen −17 LUFS (no hay diálogo en esa toma)
      · el momento más fuerte queda en el segundo PICO (el juego lo hace coincidir con la nave pasando por encima)

  laat_interior_vuelo.mp3 → public/audio/laat-interior.mp3  (cinemática inicial, tomas 2A y 2B, en bucle)
      · bucle sin cortes: el final se funde con el principio (1,5 s)
      · se añaden 0,25 s antes y después con la continuación del propio bucle (así el bucle no tiene cortes aunque
        el reproductor añada un silencio al principio del MP3); el juego repite de BUCLE_INICIO a BUCLE_INICIO + BUCLE_LARGO
      · volumen −26 LUFS: unos 10 dB por debajo de las voces (−16 LUFS), para que los diálogos se entiendan bien

Uso (desde la carpeta del proyecto, con ffmpeg y numpy):  python3 -I tools/prepare-laat-sounds.py
"""
import os, re, subprocess, sys, tempfile, wave

import numpy as np

SR = 48000
ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
IN = os.path.join(ROOT, 'assets', 'audio', 'efectos')
OUT = os.path.join(ROOT, 'public', 'audio')


def load(path, channels):
    tmp = tempfile.mktemp(suffix='.wav')
    subprocess.run(['ffmpeg', '-hide_banner', '-loglevel', 'error', '-y', '-i', path, '-ac', str(channels), '-ar', str(SR), tmp], check=True)
    with wave.open(tmp) as w:
        d = np.frombuffer(w.readframes(w.getnframes()), dtype=np.int16).astype(np.float32) / 32768
    os.remove(tmp)
    return d.reshape(-1, channels)


def loudness(x):
    """Sonoridad integrada (LUFS) medida con ffmpeg."""
    tmp = tempfile.mktemp(suffix='.wav')
    save_wav(tmp, x)
    r = subprocess.run(['ffmpeg', '-hide_banner', '-i', tmp, '-af', 'ebur128', '-f', 'null', '-'], capture_output=True, text=True)
    os.remove(tmp)
    return float(re.findall(r'I:\s+(-?[\d.]+) LUFS', r.stderr)[-1])


def save_wav(path, x):
    with wave.open(path, 'wb') as w:
        w.setnchannels(x.shape[1]); w.setsampwidth(2); w.setframerate(SR)
        w.writeframes((np.clip(x, -1, 1) * 32767).astype(np.int16).tobytes())


def to_mp3(x, path, kbps):
    tmp = tempfile.mktemp(suffix='.wav')
    save_wav(tmp, x)
    subprocess.run(['ffmpeg', '-hide_banner', '-loglevel', 'error', '-y', '-i', tmp, '-ar', '44100', '-b:a', f'{kbps}k', path], check=True)
    os.remove(tmp)


def normalize(x, target):
    g = 10 ** ((target - loudness(x)) / 20)
    x = x * g
    peak = np.abs(x).max()
    return x * (0.95 / peak) if peak > 0.95 else x


# ---------- Pasada rasante ----------
p = load(os.path.join(IN, 'laat_paso_rasante.mp3'), 1)
a, b = int(2.0 * SR), int(9.6 * SR)
p = p[a:b].copy()
fade = int(0.6 * SR)
p[-fade:] *= np.linspace(1, 0, fade)[:, None]
p[:int(0.05 * SR)] *= np.linspace(0, 1, int(0.05 * SR))[:, None]
p = normalize(p, -17)
env = np.sqrt(np.convolve(p[:, 0] ** 2, np.ones(SR // 10) / (SR // 10), 'same'))
print(f'laat-pasada.mp3: {len(p) / SR:.2f} s · PICO en {np.argmax(env) / SR:.2f} s')
to_mp3(p, os.path.join(OUT, 'laat-pasada.mp3'), 96)

# ---------- Interior en vuelo (bucle) ----------
x = load(os.path.join(IN, 'laat_interior_vuelo.mp3'), 2)
L, F = len(x), int(1.5 * SR)
body = x[:L - F].copy()
t = np.linspace(0, 1, F)[:, None]
body[:F] = x[:F] * np.sqrt(t) + x[L - F:] * np.sqrt(1 - t)  # el final del original se funde con el principio
body = normalize(body, -26)
pad = int(0.25 * SR)
out = np.concatenate([body[-pad:], body, body[:pad]])
print(f'laat-interior.mp3: BUCLE_INICIO 0.25 s · BUCLE_LARGO {len(body) / SR:.4f} s')
to_mp3(out, os.path.join(OUT, 'laat-interior.mp3'), 112)
sys.exit(0)
