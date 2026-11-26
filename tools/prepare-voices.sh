#!/bin/sh
# Prepara las voces de la cinemática a partir de las grabaciones originales (assets/audio/voces/*.m4a, hechas con el iPhone).
#  - recorta los silencios del principio y del final (deja 0,05 s),
#  - iguala el volumen de las tres (−16 LUFS, picos a −1,5 dB),
#  - baja un poco el tono del comandante (≈ −1,5 semitonos, misma duración) para que no se parezca tanto al comando,
#  - las guarda en MP3 mono en public/audio/voces/ con los nombres que usa el guion (src/cinematic/script.ts).
# El filtro de radio NO se aplica aquí: lo pone el juego al reproducirlas (src/audio/Voices.ts).
set -e
IN=assets/audio/voces
OUT=public/audio/voces
TRIM="silenceremove=start_periods=1:start_threshold=-45dB:start_silence=0.05,areverse,silenceremove=start_periods=1:start_threshold=-45dB:start_silence=0.05,areverse"
NORM="loudnorm=I=-16:TP=-1.5:LRA=11"
ffmpeg -hide_banner -loglevel error -y -i $IN/t2a_soldado.m4a -ac 1 -af "$TRIM,$NORM" -ar 44100 -b:a 64k $OUT/soldado-1.mp3
ffmpeg -hide_banner -loglevel error -y -i $IN/t2b_comandante.m4a -ac 1 -af "$TRIM,asetrate=48000*0.917,aresample=48000,atempo=1/0.917,$NORM" -ar 44100 -b:a 64k $OUT/comandante-1.mp3
ffmpeg -hide_banner -loglevel error -y -i $IN/t5_comando.m4a -ac 1 -af "$TRIM,$NORM" -ar 44100 -b:a 64k $OUT/comando-1.mp3
# Cinemática de paso a la arena (se preparan solo si ya están grabadas): assets/audio/voces/c2_*.m4a → public/audio/voces/c2_*.mp3
for v in c2_piloto_1 c2_piloto_2 c2_comando; do
  if [ -f $IN/$v.m4a ]; then ffmpeg -hide_banner -loglevel error -y -i $IN/$v.m4a -ac 1 -af "$TRIM,$NORM" -ar 44100 -b:a 64k $OUT/$v.mp3; fi
done
