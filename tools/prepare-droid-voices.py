#!/usr/bin/env python3
"""Prepara las voces de los droides (ElevenLabs, de Víctor) para el juego.

  python3 tools/prepare-droid-voices.py

Lee assets/audio/voces/droides/<droide>_<frase>_<n>.mp3 (p. ej. b1_avistado_1, b1_buscando_3, b2_recibido_1, b1_granada_2…) y escribe
public/audio/voces/droides/*.mp3 y public/audio/voces/droides/droides.json, la lista que lee el juego (src/audio/DroidVoices.ts).
Para añadir voces basta con dejar los archivos con ese nombre y volver a pasar este script: el juego las usa sin tocar nada más.
- recorta el silencio del principio y del final (deja 0,03 s),
- iguala el volumen de todas (−16 LUFS, picos a −1,5 dB), en mono.
El filtro robótico NO se aplica aquí: lo pone el juego (ajustable en el panel del modo de pruebas).
"""
import json
import os
import re
import subprocess

IN = 'assets/audio/voces/droides'
OUT = 'public/audio/voces/droides'
TRIM = ('silenceremove=start_periods=1:start_threshold=-45dB:start_silence=0.03,areverse,'
        'silenceremove=start_periods=1:start_threshold=-45dB:start_silence=0.03,areverse')

os.makedirs(OUT, exist_ok=True)
lista = {}
for f in sorted(os.listdir(IN)):
    m = re.match(r'([a-z0-9]+)_([a-z]+)_(\d+)\.(mp3|m4a|wav)$', f)
    if not m:
        continue
    droide, frase = m.group(1), m.group(2)
    name = f'{droide}_{frase}_{m.group(3)}'
    dst = os.path.join(OUT, name + '.mp3')
    subprocess.run(['ffmpeg', '-v', 'error', '-y', '-i', os.path.join(IN, f), '-ac', '1',
                    '-af', TRIM + ',loudnorm=I=-16:TP=-1.5:LRA=11', '-ar', '44100', '-b:a', '64k', dst], check=True)
    dur = float(subprocess.run(['ffprobe', '-v', 'error', '-show_entries', 'format=duration', '-of', 'csv=p=0', dst],
                               capture_output=True, text=True, check=True).stdout)
    lista.setdefault(droide, {}).setdefault(frase, []).append(name)
    print(f'{name:22s} {dur:.2f} s')
with open(os.path.join(OUT, 'droides.json'), 'w') as fh:
    json.dump(lista, fh, indent=1)
print(json.dumps(lista))
