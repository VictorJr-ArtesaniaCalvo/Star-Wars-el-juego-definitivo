#!/bin/sh
# Prepara las voces de las cinemáticas a partir de las grabaciones originales de Víctor (assets/audio/voces/, en .mp3 o .m4a; si hay
# las dos, manda el .mp3, que es la grabación más reciente):
#  - recorta los silencios del principio y del final (deja 0,05 s),
#  - iguala el volumen de todas (−16 LUFS, picos a −1,5 dB),
#  - baja un poco el tono del comandante (≈ −1,5 semitonos, misma duración) para que no se parezca tanto al comando,
#  - las guarda en MP3 mono en public/audio/voces/ con los nombres que usan los guiones (src/cinematic/script.ts y script2.ts),
#  - y escribe cuánto dura cada una ya recortada (public/audio/voces/duraciones.txt): las tomas se alargan para que quepa entera.
# El filtro de radio NO se aplica aquí: lo pone el juego al reproducirlas (src/audio/Voices.ts).
set -e
IN=assets/audio/voces
OUT=public/audio/voces
TRIM="silenceremove=start_periods=1:start_threshold=-45dB:start_silence=0.05,areverse,silenceremove=start_periods=1:start_threshold=-45dB:start_silence=0.05,areverse"
NORM="loudnorm=I=-16:TP=-1.5:LRA=11"
src() { if [ -f $IN/$1.mp3 ]; then echo $IN/$1.mp3; elif [ -f $IN/$1.m4a ]; then echo $IN/$1.m4a; fi; }
prep() { # $1 = grabación, $2 = nombre de salida, $3 = filtro extra
  f=$(src $1); [ -n "$f" ] || return 0
  ffmpeg -hide_banner -loglevel error -y -i "$f" -ac 1 -af "$TRIM$3,$NORM" -ar 44100 -b:a 64k $OUT/$2.mp3
  printf '%s\t%s\n' "$2" "$(ffprobe -v error -show_entries format=duration -of csv=p=0 $OUT/$2.mp3)" >> $OUT/duraciones.txt
}
: > $OUT/duraciones.txt
prep t2a_soldado soldado-1 ""
prep t2b_comandante comandante-1 ",asetrate=48000*0.917,aresample=48000,atempo=1/0.917"
prep t5_comando comando-1 ""
# Cinemática de paso a la arena
prep c2_piloto_1 c2_piloto_1 ""
prep c2_piloto_2 c2_piloto_2 ""
prep c2_comando c2_comando ""
cat $OUT/duraciones.txt
