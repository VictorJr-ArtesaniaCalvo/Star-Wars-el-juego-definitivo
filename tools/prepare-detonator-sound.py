"""
Prepara el sonido del detonador térmico (original de Víctor: assets/audio/efectos/thermal_detonator.mp4) para el juego.
El audio trae el pitido de la granada armada y, a los 2,735 s, la explosión. Se parte en dos para que la explosión suene
siempre en el instante exacto en que la granada estalla (aunque el juego vaya a tirones o se pause):

  public/audio/detonador-armado.mp3     del primer sonido (0,05 s) hasta justo antes de la explosión: suena al lanzar,
                                         desde la granada. Su duración es la MECHA de la granada (GRENADE.fuse en Grenade.ts).
  public/audio/detonador-explosion.mp3  la explosión hasta el final: suena al estallar, desde donde estalla.

Mono (el juego los coloca en el espacio). Las dos partes llevan la misma ganancia, así guardan el volumen relativo del
original; el pico de la explosión queda a −1 dB.

Uso (desde la carpeta del proyecto, con ffmpeg y numpy):  python3 -I tools/prepare-detonator-sound.py
"""
import os, subprocess, tempfile, wave

import numpy as np

SR = 48000
ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
SRC = os.path.join(ROOT, 'assets', 'audio', 'efectos', 'thermal_detonator.mp4')
OUT = os.path.join(ROOT, 'public', 'audio')

START = 0.05   # s: justo antes del primer sonido (0,058 s)
BOOM = 2.733   # s: empieza la explosión (el volumen salta de −37 a −16 dB entre 2,734 y 2,739 s)


def load(path):
    tmp = tempfile.mktemp(suffix='.wav')
    subprocess.run(['ffmpeg', '-hide_banner', '-loglevel', 'error', '-y', '-i', path, '-ac', '1', '-ar', str(SR), tmp], check=True)
    with wave.open(tmp) as w:
        d = np.frombuffer(w.readframes(w.getnframes()), dtype=np.int16).astype(np.float32) / 32768
    os.remove(tmp)
    return d


def to_mp3(x, path, kbps):
    tmp = tempfile.mktemp(suffix='.wav')
    with wave.open(tmp, 'wb') as w:
        w.setnchannels(1); w.setsampwidth(2); w.setframerate(SR)
        w.writeframes((np.clip(x, -1, 1) * 32767).astype(np.int16).tobytes())
    subprocess.run(['ffmpeg', '-hide_banner', '-loglevel', 'error', '-y', '-i', tmp, '-ar', '44100', '-b:a', f'{kbps}k', path], check=True)
    os.remove(tmp)


x = load(SRC)
a, b = int(START * SR), int(BOOM * SR)
armed, boom = x[a:b].copy(), x[b:].copy()
g = 10 ** (-1 / 20) / np.abs(boom).max()  # pico de la explosión a −1 dB; la misma ganancia para el pitido
armed *= g; boom *= g
f = int(0.003 * SR)  # fundidos de 3 ms en los cortes (sin chasquidos)
armed[:f] *= np.linspace(0, 1, f); armed[-f:] *= np.linspace(1, 0, f)
boom[:f] *= np.linspace(0, 1, f)
t = int(0.05 * SR); boom[-t:] *= np.linspace(1, 0, t)
to_mp3(armed, os.path.join(OUT, 'detonador-armado.mp3'), 96)
to_mp3(boom, os.path.join(OUT, 'detonador-explosion.mp3'), 128)
print(f'detonador-armado.mp3: {len(armed) / SR:.3f} s  (= mecha de la granada)')
print(f'detonador-explosion.mp3: {len(boom) / SR:.3f} s')
