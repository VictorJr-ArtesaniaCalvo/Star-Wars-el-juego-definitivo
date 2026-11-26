#!/usr/bin/env python3
"""Prepara los sonidos de ambiente de Víctor (ElevenLabs) para el juego.

  python3 tools/prepare-ambience.py

Lee assets/audio/efectos/amb_*.mp3 y escribe public/audio/ambiente/*.mp3 y public/audio/ambiente/ambiente.json.

- Fondos (amb_*_viento_N, amb_polvo_arrastre_N, amb_batalla_lejana_N, amb_tunel_N): se quita el silencio y TAMBIÉN el fundido de
  entrada y de salida: solo se queda la parte a volumen completo (desde el primer momento en que el nivel llega a 6 dB de su nivel
  normal hasta el último). En el juego se repiten con un fundido cruzado de igual potencia (src/audio/Ambience.ts): nunca se oye un
  bajón.
- Ráfagas (amb_*_rafaga_N): solo se quita el silencio del principio y del final (lo que queda 35 dB por debajo de su golpe más
  fuerte); conservan su subida y su bajada. Se apunta en qué segundo está su golpe más fuerte, para que coincida con la ráfaga de
  polvo que se ve.
- Todos se igualan de volumen (fondos −30 LUFS, ráfagas −24 LUFS); el juego los deja por debajo de voces, disparos y música.
"""
import json
import math
import os
import re
import struct
import subprocess
import sys
import tempfile

IN = 'assets/audio/efectos'
OUT = 'public/audio/ambiente'
WIN = 0.25  # s por ventana al medir el nivel
SR = 8000


def levels(path):
    raw = subprocess.run(['ffmpeg', '-v', 'error', '-i', path, '-ac', '1', '-ar', str(SR), '-f', 'f32le', '-'], capture_output=True, check=True).stdout
    n = len(raw) // 4
    a = struct.unpack('<%df' % n, raw)
    w = int(WIN * SR)
    out = []
    for i in range(0, n - w + 1, w):
        s = sum(x * x for x in a[i:i + w]) / w
        out.append(10 * math.log10(s + 1e-12))
    return out


def duration(path):
    return float(subprocess.run(['ffprobe', '-v', 'error', '-show_entries', 'format=duration', '-of', 'csv=p=0', path], capture_output=True, text=True, check=True).stdout)


def encode(src, dst, start, end, lufs, fade=0.0):
    af = f'atrim={start:.3f}:{end:.3f},asetpts=PTS-STARTPTS'
    if fade:
        af += f',afade=t=in:d={fade},afade=t=out:st={end - start - fade:.3f}:d={fade}'
    # dos pasadas de loudnorm para que el volumen quede exacto sin «bombear»
    m = subprocess.run(['ffmpeg', '-hide_banner', '-i', src, '-af', af + f',loudnorm=I={lufs}:TP=-2:LRA=20:print_format=json', '-f', 'null', '-'], capture_output=True, text=True).stderr
    j = json.loads(m[m.rindex('{'):m.rindex('}') + 1])
    ln = (f'loudnorm=I={lufs}:TP=-2:LRA=20:measured_I={j["input_i"]}:measured_TP={j["input_tp"]}:measured_LRA={j["input_lra"]}'
          f':measured_thresh={j["input_thresh"]}:offset={j["target_offset"]}:linear=true')
    subprocess.run(['ffmpeg', '-v', 'error', '-y', '-i', src, '-af', af + ',' + ln, '-ar', '44100', '-c:a', 'libmp3lame', '-b:a', '128k', dst], check=True)


def main():
    os.makedirs(OUT, exist_ok=True)
    info = {}
    for f in sorted(os.listdir(IN)):
        m = re.match(r'(amb_[a-z_]+?)(?:_(\d+))?\.mp3$', f)  # amb_tunel.mp3 o amb_canon_viento_2.mp3
        if not m:
            continue
        name, src, dst = f[:-4], os.path.join(IN, f), os.path.join(OUT, f)
        lv = levels(src)
        if '_rafaga' in name:
            peak = max(lv)
            on = [i for i, v in enumerate(lv) if v > peak - 35]
            start, end = on[0] * WIN, (on[-1] + 1) * WIN
            encode(src, dst, start, end, -24, fade=0.02)
            pk = max(range(len(lv)), key=lambda i: lv[i]) * WIN + WIN / 2 - start
            info[name] = {'tipo': 'rafaga', 'grupo': m.group(1), 'dura': round(end - start, 3), 'golpe': round(pk, 3)}
        else:
            mid = sorted(lv[len(lv) // 5: len(lv) * 4 // 5])
            normal = mid[len(mid) // 2]
            full = [i for i, v in enumerate(lv) if v > normal - 6]
            start, end = (full[0] + 1) * WIN, full[-1] * WIN  # una ventana más adentro: nada del fundido
            encode(src, dst, start, end, -30)
            info[name] = {'tipo': 'fondo', 'grupo': m.group(1), 'dura': round(duration(dst), 3), 'recorte': [round(start, 2), round(duration(src) - end, 2)]}
        print(f'{name:24s} {info[name]}')
    with open(os.path.join(OUT, 'ambiente.json'), 'w') as fh:
        json.dump(info, fh, indent=1, ensure_ascii=False)


if __name__ == '__main__':
    sys.exit(main())
