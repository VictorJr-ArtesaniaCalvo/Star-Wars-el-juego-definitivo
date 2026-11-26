#!/usr/bin/env python3
"""Prepara los sonidos de las naves del cielo (de Víctor, ElevenLabs) para el juego.

  python3 tools/prepare-ship-sounds.py

Lee assets/audio/efectos/<nave>_<sonido>[_N].mp3 (nave: venator o fragata; sonido: motores, turbolaser o disparo, rafaga) y escribe
public/audio/naves/*.mp3 y public/audio/naves/naves.json, la lista que lee el juego (src/audio/ShipSounds.ts). Los que falten no
suenan; al añadirlos basta con pasar otra vez el script.
- motores: fondo en bucle: sin silencio ni fundidos (solo la parte a volumen completo), −30 LUFS. El juego lo repite con fundido cruzado.
- disparos y ráfagas: sin el silencio del principio y del final, −18 LUFS, en mono (suenan desde la nave, en 3D).
"""
import json
import math
import os
import re
import struct
import subprocess

IN = 'assets/audio/efectos'
OUT = 'public/audio/naves'
SR = 8000


def levels(path, win):
    raw = subprocess.run(['ffmpeg', '-v', 'error', '-i', path, '-ac', '1', '-ar', str(SR), '-f', 'f32le', '-'], capture_output=True, check=True).stdout
    a = struct.unpack('<%df' % (len(raw) // 4), raw)
    w = int(win * SR)
    return [10 * math.log10(sum(x * x for x in a[i:i + w]) / w + 1e-12) for i in range(0, len(a) - w + 1, w)]


def encode(src, dst, start, end, lufs, fade_out=0.0):
    af = f'atrim={start:.3f}:{end:.3f},asetpts=PTS-STARTPTS'
    if fade_out:
        af += f',afade=t=out:st={max(0, end - start - fade_out):.3f}:d={fade_out}'
    m = subprocess.run(['ffmpeg', '-hide_banner', '-i', src, '-af', af + f',loudnorm=I={lufs}:TP=-2:LRA=20:print_format=json', '-f', 'null', '-'], capture_output=True, text=True).stderr
    j = json.loads(m[m.rindex('{'):m.rindex('}') + 1])
    ln = (f'loudnorm=I={lufs}:TP=-2:LRA=20:measured_I={j["input_i"]}:measured_TP={j["input_tp"]}:measured_LRA={j["input_lra"]}'
          f':measured_thresh={j["input_thresh"]}:offset={j["target_offset"]}:linear=true')
    subprocess.run(['ffmpeg', '-v', 'error', '-y', '-i', src, '-ac', '1', '-af', af + ',' + ln, '-ar', '44100', '-c:a', 'libmp3lame', '-b:a', '96k', dst], check=True)


os.makedirs(OUT, exist_ok=True)
lista = {}
for f in sorted(os.listdir(IN)):
    m = re.match(r'(venator|fragata)_(motores|turbolaser|disparo|rafaga)(?:_(\d+))?\.mp3$', f)
    if not m:
        continue
    nave, tipo = m.group(1), m.group(2)
    tipo = 'disparo' if tipo == 'turbolaser' else tipo
    name, src = f[:-4], os.path.join(IN, f)
    if tipo == 'motores':
        win = 0.25
        lv = levels(src, win)
        mid = sorted(lv[len(lv) // 5: len(lv) * 4 // 5])
        normal = mid[len(mid) // 2]
        full = [i for i, v in enumerate(lv) if v > normal - 6]
        start, end = (full[0] + 1) * win, full[-1] * win  # una ventana más adentro: nada de fundido ni de silencio
        encode(src, os.path.join(OUT, name + '.mp3'), start, end, -30)
    else:
        win = 0.02
        lv = levels(src, win)
        peak = max(lv)
        on = [i for i, v in enumerate(lv) if v > peak - 50]
        start, end = on[0] * win, (on[-1] + 1) * win
        encode(src, os.path.join(OUT, name + '.mp3'), start, end, -18, fade_out=0.03)
    lista.setdefault(nave, {}).setdefault(tipo, []).append(name)
    print(f'{name:22s} {tipo:8s} {end - start:.2f} s')
with open(os.path.join(OUT, 'naves.json'), 'w') as fh:
    json.dump(lista, fh, indent=1)
print(json.dumps(lista))
