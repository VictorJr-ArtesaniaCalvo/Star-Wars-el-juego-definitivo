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
| Táctil | Joystick | Deslizar (también con el dedo sobre el botón grande de disparo) | Botón grande de 3 balas (abajo a la derecha) | Botón de 1 bala (izquierda, sobre el joystick) | Botón de mira (alterna) | Botón de flechas hacia arriba | Botón de figura agachada | Botón de dos barras (arriba a la derecha) |
| Mando | Stick izquierdo | Stick derecho | RT / R2 | RB / R1 | LT / L2 (mantener) | A / Cruz | B / Círculo | Options / Menu |
| Teclado | WASD | Ratón o flechas | F | Clic izquierdo | Clic derecho (mantener) o Q (alterna) | Espacio | C | P |

**Granada:** pulsa el botón de la granada (táctil, arriba a la derecha; el número es lo que te queda), LB / L1 (mando) o G (teclado) para sacarla; se coge en la mano y los botones de disparo cambian su icono por el de lanzar. Al disparar se lanza hacia donde miras (mira más arriba para llegar más lejos) y vuelve el bláster; pulsar el botón de la granada otra vez la guarda sin lanzarla. Rebota y explota a los 2,4 s. Radio de 7 m: destruye a un B1 a menos de unos 3,5 m y lo daña hasta los 7 m; las rocas y muros por medio reducen el daño. Si estás cerca, también te hiere.

**Apuntar:** acerca la vista, afina la puntería y baja la velocidad. El disparo principal apunta mientras se mantiene pulsado;
el de cadera dispara sin acercar la vista (con el disparo más abierto), salvo que ya estés apuntando.

## Enemigos

| | Vida | Particularidad | Aparece |
|---|---|---|---|
| B1 | 60 | Débil y lento. Disparos de poco daño. | Desde la ronda 1 |
| B2 (modelo 3D de zakeriiino, CC-BY 4.0) | 180 | Lento y resistente (8 disparos de bláster). Disparos más fuertes. | Desde la ronda 4 |
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

## Música y volumen

La música de fondo (`public/audio/musica.mp3`) suena en bucle desde que se toca JUGAR o se mueve el control de Música. En el menú hay tres controles: **Volumen general**, **Música** y **Efectos**. Al soltar el control de Efectos suena un disparo de muestra. En pausa la música baja un poco y los efectos callan; al salir de la app se detiene.

## Efectos

Destello azul en la boca del bláster y naranja en la de los droides, auras de color en los rayos, impactos (chispas y polvo en el suelo, destello azul en los escudos, chispas y humo en los droides), explosión de granada en capas (llamas, onda de polvo, columna de humo, marca quemada y fogonazo en pantalla si estalla cerca) y ráfagas periódicas de viento y arena. Todo con reservas fijas de partículas, ligeras para el móvil (`src/weapons/Effects.ts`, `src/world/crashFx.ts`).

## Pendiente (acordado)

- **Células de vida:** algunos droides las soltarán al morir para recogerlas. Cuando se hagan, se quita la curación de +10 de vida cada 3 bajas.
- Ideas propuestas, aún sin decidir: editor de controles (arrastrar, tamaño, opacidad), apuntar con el giroscopio del iPhone, agacharse manteniendo pulsado.

## Modelo del B1

El B1 usa un modelo 3D real (`public/models/b1.bin` + `b1-atlas.jpg`) con dos niveles de detalle (5.000 y 1.700 triángulos) y un esqueleto de 17 huesos.
Se genera desde el OBJ original con `node tools/convert-b1.mjs <B1DROID.obj> public/models/b1.bin <carpeta-de-texturas-jpg>` (necesita `npm install`; el OBJ original no está en el repositorio).
Se tienen 31 de las ~40 texturas pintadas, reunidas en un atlas de 2048×2048 que solo se usa en el nivel de detalle cercano (de lejos, color arena por vértice). Faltan las del brazo superior (`B1 arm.L`) y los tubos del hombro (`arm_rotat.L/R`), que van en color arena, y el rifle va en gris metálico por vértice. Cada textura se asigna por *material* del modelo en la tabla `TEXTURED` de `tools/convert-b1.mjs` (las dudosas están marcadas con `?`).

## Modelos del B2, del droideka, de la cañonera y del bláster

- **B2** (`public/models/b2.bin` + `b2-atlas.jpg`): modelo de zakeriiino (CC-BY 4.0) con esqueleto de 14 huesos y dos niveles de detalle. Se genera con `node tools/convert-b2.mjs <scene.gltf> <carpeta-de-texturas>`.
- **Droideka** (`public/models/droideka.bin`): modelo de PokCat (CC-BY 4.0), simplificado a ~8.000 triángulos (~2.500 de lejos) con los 12 huesos del droideka de siempre (rueda, cuenco, capucha, columna, brazos y 3 patas con cadera y rodilla). Viene desplegado; la postura de bola rodando se calcula al cargar (`src/enemies/DroidekaRig.ts`). Se genera con `node tools/convert-droideka.mjs <scene.gltf> <carpeta-texturas-jpg>`. Si el archivo falta, el juego usa el droideka de formas sencillas.
- **Bláster del jugador** (`public/models/blaster.bin` + `blaster-color.jpg`): «E-5 Blaster Rifle» de A308 Digital (CC-BY 4.0), ~4.900 triángulos, con textura (`src/weapons/ViewModel.ts`). Se genera con `node tools/convert-blaster.mjs <scene.gltf> <textura-horneada.jpg>` (la cabecera de la herramienta explica cómo se hornea la textura). Si el archivo falta, el juego usa un arma de cajas.
- **Cañonera LAAT derribada** (`public/models/laat.bin` + `laat-*.jpg`): modelo de Mind Mulch for The Masses (CC-BY 4.0), inclinada y hundida en la arena, con un ala arrancada tirada a la derecha como cobertura, hollín, humo continuo de los motores, chispas y pequeños fuegos (`src/world/laat.ts`, `src/world/crashFx.ts`). Se genera con `node tools/convert-laat.mjs <scene.gltf> <carpeta-de-texturas>`. Si el archivo falta, el juego usa la cañonera de formas sencillas.
- Los autores están citados en la **pantalla de créditos** del juego (menú → «Créditos y agradecimientos») y en `CRÉDITOS.md`.
