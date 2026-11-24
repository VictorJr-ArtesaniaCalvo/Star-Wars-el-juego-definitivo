# Geonosis: Última Defensa

Juego 3D de defensa por oleadas en primera persona para el navegador, instalable en el iPhone como app (PWA).
Proyecto personal y experimental.

## Estado

- **Fase 1 (hecha):** moverse en primera persona, agacharse, escenario y zona de defensa con coberturas.
- **Fase 2 (hecha):** bláster con sobrecalentamiento, droide B1 de prueba y ayuda al apuntar.
- **Fase 3 (hecha):** oleadas de droides B1 que avanzan usando las rocas como cobertura y disparan; vida, ronda, fin de partida y menú oculto de pruebas.
- Escenario: cañón de 80 m de ancho con paredes en terrazas, nave estrellada en un cráter y droides que llegan por los dos extremos.
- Extras: salto, brújula azul, indicador de daño direccional, chispas y humo al destruir droides, y curación (kits médicos que sueltan los droides, +30 al superar una ronda).
- **Fase 4 (hecha):** 4 granadas por partida, con explosión de área. · Fase 5: más enemigos. · Fase 6: mejoras visuales y sonido.

## Controles

| | Moverse | Mirar | Disparar apuntando | Disparar desde la cadera | Apuntar | Saltar | Agacharse | Pausa |
|---|---|---|---|---|---|---|---|---|
| Táctil | Joystick | Deslizar (también con el dedo sobre DISPARAR) | Botón DISPARAR (derecha) | Botón CADERA (izquierda, sobre el joystick) | Botón APUNTAR (alterna) | Botón | Botón | Botón II |
| Mando | Stick izquierdo | Stick derecho | RT / R2 | RB / R1 | LT / L2 (mantener) | A / Cruz | B / Círculo | Options / Menu |
| Teclado | WASD | Ratón o flechas | F | Clic izquierdo | Clic derecho (mantener) o Q (alterna) | Espacio | C | P |

**Granada:** pulsa GRANADA (táctil, arriba a la derecha), LB / L1 (mando) o G (teclado) para sacarla; se coge en la mano y los botones de disparo pasan a decir LANZAR. Al disparar se lanza hacia donde miras (mira más arriba para llegar más lejos) y vuelve el bláster; pulsar GRANADA otra vez la guarda sin lanzarla. Rebota y explota a los 2,4 s. Radio de 7 m: destruye a un B1 a menos de unos 3,5 m y lo daña hasta los 7 m; las rocas y muros por medio reducen el daño. Si estás cerca, también te hiere.

**Apuntar:** acerca la vista, afina la puntería y baja la velocidad. El disparo principal apunta mientras se mantiene pulsado;
el de cadera dispara sin acercar la vista (con el disparo más abierto), salvo que ya estés apuntando.

## Enemigos

| | Vida | Particularidad | Aparece |
|---|---|---|---|
| B1 | 60 | Débil y lento. Disparos de poco daño. | Desde la ronda 1 |
| B2 | 180 | Lento y resistente (8 disparos de bláster). Disparos más fuertes. | Desde la ronda 4 |
| Droideka | 100 + escudo 150 | Rueda muy rápido, se despliega y dispara ráfagas largas bajo un escudo azul que absorbe los disparos de bláster (se regenera si lo dejas en paz 4 s). Las granadas atraviesan el escudo. Rodando recibe la mitad de daño. | Desde la ronda 7 |

En la brújula, los B2 se marcan con un triángulo rojo más grande y los droidekas con uno azul.

## Kits médicos

Los droides pueden soltar un kit médico al morir (B1 10 %, B2 35 %, droideka 75 %). Se recoge pasando por encima: B1 +15 de vida, B2 +18, droideka +28.
Tiene una luz verde y una marca verde en la brújula; dura 20 s en el suelo (parpadea los últimos 5) y no puede haber más de 4 a la vez. Ya no hay curación por bajas.

## Menú oculto de pruebas

En el menú de inicio, toca 5 veces seguidas el título «GEONOSIS». Permite elegir la ronda (con botones rápidos: 1, 4 · B2, 7 · Deka, 10, 15, 20), ser invencible y ver los FPS.
En plena partida, en la pausa, el botón «IR A LA RONDA N AHORA» salta a esa ronda sin reiniciar (vida y granadas al máximo).
Las partidas con estas opciones no cuentan para el récord.

## Sonido y calidad gráfica

- **Sonido:** viento del desierto, cañonazos lejanos de las naves, disparos del bláster, disparos de los droides (con dirección: si te disparan por la espalda, suena por detrás), aviso de sobrecalentamiento y granadas. Todo se genera por código (originales, sin derechos de autor). Volumen ajustable en el menú. La música no está incluida.
  En iPhone el sonido empieza al pulsar JUGAR, y **el interruptor lateral de silencio lo apaga** (desactívalo).
- **Calidad gráfica:** Baja, Media, Alta y **Ultra** (sombras más nítidas, resplandor en las luces fuertes y resolución máxima; la que más calienta el móvil).

## Instalar en el iPhone

Abrir el enlace del juego en Safari → Compartir → «Añadir a pantalla de inicio». Así se ve a pantalla completa.

## Organización

- `src/core` arranque, bucle del juego, ajustes · `src/world` escenario · `src/player` jugador
- `src/input` controles · `src/ui` menús e indicadores · `src/sim` reglas del juego
- `src/weapons` bláster y efectos · `src/enemies` droides y su cerebro (Yuka) · `src/waves` rondas
- `src/net`, `src/audio`: reservados para fases posteriores

## Para desarrollo

`npm install` · `npm run dev` (probar en local) · `npm run build` (generar la versión publicable).
Cada subida a GitHub publica el juego automáticamente en GitHub Pages.

## Pendiente (acordado)

- **Células de vida:** algunos droides las soltarán al morir para recogerlas. Cuando se hagan, se quita la curación de +10 de vida cada 3 bajas.
- Ideas propuestas, aún sin decidir: editor de controles (arrastrar, tamaño, opacidad), apuntar con el giroscopio del iPhone, agacharse manteniendo pulsado.

## Modelo del B1

El B1 usa un modelo 3D real (`public/models/b1.bin`, 240 KB) con dos niveles de detalle (5.000 y 1.500 triángulos) y un esqueleto de 17 huesos.
Se genera desde el OBJ original con `node tools/convert-b1.mjs <B1DROID.obj>` (necesita `npm install`; el OBJ original no está en el repositorio).
