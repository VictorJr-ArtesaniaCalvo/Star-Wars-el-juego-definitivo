# Geonosis: Última Defensa

Juego 3D de defensa por oleadas en primera persona para el navegador, instalable en el iPhone como app (PWA).
Proyecto personal y experimental.

## Estado

- **Fase 1 (hecha):** moverse en primera persona, agacharse, escenario y zona de defensa con coberturas.
- **Fase 2 (hecha):** bláster con sobrecalentamiento, droide B1 de prueba y ayuda al apuntar.
- **Fase 3 (hecha):** oleadas de droides B1 que avanzan usando las rocas como cobertura y disparan; vida, ronda, fin de partida y menú oculto de pruebas.
- Escenario: cañón de 80 m de ancho con paredes en terrazas, nave estrellada en un cráter y droides que llegan por los dos extremos.
- Ambiente: neblina ámbar pálida y apagada que se espesa con la distancia (lo cercano queda más intenso y oscuro; se cierra algo más en las ráfagas de arena), sol amarillo pálido e intenso a unos 27° y girado hacia el eje del cañón, y luz ambiente fría marrón violácea (el color de las sombras), con polvo flotando, brasas (se han quitado el polvo bajo y las ráfagas de arena visibles; el sonido del viento sigue). Las paredes proyectan sombra sobre una parte del suelo y de las rocas: se calcula una vez al cargar (`src/world/sunShadow.ts`) y se pinta en el color de cada vértice, en todas las calidades y sin coste al jugar (los personajes en movimiento no se oscurecen; con calidad Alta o Ultra hay además sombras reales cerca de ti). Viñeta suave y un ligero ajuste de contraste y saturación sobre la imagen (`src/style.css`), siempre activos.
- Suelo de Geonosis (calidad Media y Alta; en Baja se queda el de siempre): arena roja de base (con caminos limpios) que pasa a roca en lajas cerca de las paredes, en pendientes y alrededor de las coberturas; las imágenes se mezclan sin que se note la repetición. Encima, lajas de piedra planas en 3D (`src/world/scatter.ts`; unas 560 en Media y 1.400 en Alta, algunas medio enterradas, solo decoración sin colisión), piedrecitas diminutas solo alrededor del jugador y 10 repisas de roca en capas que sirven de cobertura.
- Paredes del cañón (`src/world/terrain.ts`, `wallBlocks.ts`; calidad Media y Alta, con la pared recta de siempre en Baja): el pie de la pared serpentea con bahías y contrafuertes, cada escalón tiene su altura y la cima es irregular con torres; los entrantes y las esquinas se oscurecen (calculado una vez al cargar); la roca usa Rock 029 y, en algunas zonas, la roca con agujeros. Encima, bloques (la misma cantidad en Media y en Alta) de roca apilados en capas horizontales con voladizos y escombros al pie, hechos con 6 formas generadas por código y repetidas con instancias (solo visuales). La colisión es la de la propia forma del terreno, así que sigue bloqueando igual. Cambiar entre Baja y las demás calidades recarga el juego (con aviso si hay partida en curso).
- Restos y cajas (`src/world/wreckage.ts`, sin cajas planas de color; igual en todas las calidades): trozos del propio casco de la LAAT cortados del modelo con su misma textura (ennegrecidos y con quemaduras, medio enterrados alrededor de la nave y a lo largo del surco), chapas de metal dobladas hechas por código con trozos de la textura de la LAAT, muros de chapa con puntales como cobertura, y pocas cajas y barriles de la República cerca del impacto (blanco y gris con franja roja, y un tercio en gris y negro; con polvo y manchas negras). Las cajas y barriles son provisionales, generados por código hasta tener los modelos. Los muros en ruinas con agujeros pasan a ser coberturas de roca en capas. Todo el conjunto son solo dos mallas (dos llamadas de dibujo); las piezas pequeñas son decoración y las cajas grandes, muros y rocas bloquean.
- Variedad de color: caminos sinuosos de arena más clara a lo largo del cañón, zonas de roca más oscura (junto a las paredes y en manchas) y rocas sueltas oscuras tipo basalto o claras de arenisca según la zona (todo por color de vértice, sin coste al jugar). La nave droide del fondo es de metal gris y blanco. Luces azules y blancas que parpadean (pilotos y pantallas) en la cañonera y en la nave droide, chispas eléctricas azul y blanco, y fuego, brasas y destellos de tono amarillo blanquecino que acaba en naranja.
- Forma del cañón: la zona jugable mide 80 m de ancho hasta z = ±96; más allá de las grietas el cañón se abre por los lados hacia el norte y el sur (curvas en `RIM`, `src/world/terrain.ts`: borde de arriba de la pared hasta unos ±130–160 m; el pie queda 16 m más adentro). La nave separatista estrellada está en x ≈ 40, z ≈ −168. En la zona nueva hay las mismas rocas y mesetas repartidas por una superficie mayor (queda poco poblada), cuatro de cada dieciocho grupos de agujas menos, y bloques de pared más espaciados. Las naves de la batalla del cielo vuelan 75 m más altas. La zona jugable y su colisión no cambian.
- Referencias lejanas (`src/world/landmarks.ts`, solo para mirar, sin colisión): al norte (x ≈ −35, z ≈ −265) un castillo geonosiano de montículos en terrazas con ventanas en arco y torres con anillos (la central de unos 110 m); al sur (x ≈ −45, z ≈ +235) una nave núcleo separatista en buen estado, una esfera de paneles de unos 38 m sobre seis patas con una torre pequeña y antenas arriba, que dispara rayos pequeños hacia los lados y hacia el suelo. Llevan una niebla propia limitada (se ven como siluetas pálidas en la bruma aunque estén más lejos que la niebla normal). En calidad Baja se dibujan las formas, sin luces ni disparos.
- Zona del accidente (`src/world/terrain.ts`, `scorch.ts`, `crashFx.ts`, `defenseZone.ts`): cráter con borde levantado, surco de arrastre con tierra removida a los lados, montón de arena empujado contra el morro, marcas de quemado nítidas en el suelo y hollín sobre el casco, restos metálicos a lo largo del surco, y una columna de humo alta (~70 m) visible desde todo el cañón, con brasas y chispas ocasionales. Con calidad Baja/Media salen menos partículas (45 % / 75 %).
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

## Texturas del escenario y partículas (fotos reales, CC0)
- **Suelo y rocas** (`public/textures/*.jpg`): fotos de Poly Haven (red_sandstone_wall, sandstone_cracks, mud_cracked_dry_03, sand_03, cliff_side) y de OpenGameArt (pansapiens, «Arid ground textures»). Cada imagen de 1024 px lleva el relieve y el detalle de brillo; el juego las proyecta por los tres ejes (`src/world/materials.ts`) y las multiplica por el color de cada trozo, que es el que da el tono rojo de Geonosis. Suelo: tierra con grava, parches de barro agrietado y de arena. Además hay zonas de lajas de arenisca que se descascarillan, al estilo de las referencias de Battlefront II (`ground-slabs.jpg`, dibujadas por código en `tools/build-textures.py`, no son fotos). Paredes y rocas: capas de roca erosionada (`rock-strata.jpg`, de la foto *cliff_side*) con parches de picaduras tipo panal (`rock-pits.jpg`, también dibujadas por código). Agujas: arenisca con grietas más juntas de bloques (no cambian). En calidad «baja» se apaga el relieve para ahorrar batería.
- **Humo, fuego, chispas y polvo** (`public/particles/atlas.png`): 16 partículas de Kenney (CC0) reunidas en una sola imagen. Se usan en la cañonera derribada (`src/world/crashFx.ts`) y en las explosiones de granada, la muerte de los droides, los impactos y los fogonazos de las armas (`src/weapons/Effects.ts`).
- Se preparan desde `assets/` con `python tools/build-textures.py` y `python tools/build-particles.py` (necesitan Python con Pillow y NumPy; los resultados ya están en `public/`). Si algún archivo no cargara, el juego usa las texturas y manchas generadas por código.

## Modelos del B2, del droideka, de la cañonera y del bláster

- **B2** (`public/models/b2.bin` + `b2-atlas.jpg`): modelo de zakeriiino (CC-BY 4.0) con esqueleto de 14 huesos y dos niveles de detalle. Se genera con `node tools/convert-b2.mjs <scene.gltf> <carpeta-de-texturas>`.
- **Droideka** (`public/models/droideka.bin`): modelo de PokCat (CC-BY 4.0), simplificado a ~8.000 triángulos (~2.500 de lejos) con los 12 huesos del droideka de siempre (rueda, cuenco, capucha, columna, brazos y 3 patas con cadera y rodilla). Viene desplegado; la postura de bola rodando se calcula al cargar (`src/enemies/DroidekaRig.ts`, medidas en `ROLL`) a partir de las fotos de referencia de la figura de Hot Toys: la capucha forma el borde de la rueda por detrás y por arriba, las patas se curvan por delante y por detrás, la bola de abajo queda en el fondo y la columna y los brazos se encogen dentro. También se calcula cuánto subirlo al plegar y desplegar para que ninguna pata se hunda en el suelo. Se genera con `node tools/convert-droideka.mjs <scene.gltf> <carpeta-texturas-jpg>`. Si el archivo falta, el juego usa el droideka de formas sencillas.
- **Bláster del jugador** (`public/models/blaster.bin` + `blaster-color.jpg`): «E-5 Blaster Rifle» de A308 Digital (CC-BY 4.0), ~4.900 triángulos, con textura (`src/weapons/ViewModel.ts`). Se genera con `node tools/convert-blaster.mjs <scene.gltf> <textura-horneada.jpg>` (la cabecera de la herramienta explica cómo se hornea la textura). Si el archivo falta, el juego usa un arma de cajas.
- **Cañonera LAAT derribada** (`public/models/laat.bin` + `laat-*.jpg`): modelo de Mind Mulch for The Masses (CC-BY 4.0), inclinada y hundida en la arena, con un ala arrancada tirada a la derecha como cobertura, hollín, humo continuo de los motores, chispas y pequeños fuegos (`src/world/laat.ts`, `src/world/crashFx.ts`). Se genera con `node tools/convert-laat.mjs <scene.gltf> <carpeta-de-texturas>`. Si el archivo falta, el juego usa la cañonera de formas sencillas.
- Los autores están citados en la **pantalla de créditos** del juego (menú → «Créditos y agradecimientos») y en `CRÉDITOS.md`.

Las agujas de roca de todo el mapa llevan ahora anillos redondeados (cuentas que se estrechan hasta la punta), la misma forma que las torres del castillo (`spireGeometry` en `src/world/rocks.ts`).
