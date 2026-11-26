# Créditos y origen de los recursos

## Código y librerías
Three.js, Rapier, Yuka, Howler.js, nipplejs, Vite (todas con licencias libres).

## Gráficos
Texturas del terreno, rocas, droideka y efectos: generados por código en este proyecto (originales).

**Droide B1** (`public/models/b1.bin` y `b1-atlas.jpg`): modelo 3D aportado por el autor del proyecto (archivo `B1 DROID.blend/.obj`; las rutas internas
de sus texturas mencionan «Blue Evolution Studio»). Se ha convertido y simplificado con `tools/convert-b1.mjs` (de 45.000 a ~5.000 triángulos).
De las ~40 texturas pintadas del modelo se aplican 31 (cuerpo, cabeza, cuello, piernas, pies, antebrazos, manos, dedos, radio, articulaciones…): se reúnen en un atlas y
se aplican con las coordenadas del autor. Las piezas cuya textura aún falta (brazo superior y tubos del hombro) llevan el color arena de esas texturas, y el rifle, gris metálico.
**Autoría y licencia del modelo por confirmar.** El personaje es propiedad de Lucasfilm Ltd. / Disney. Si el proyecto se difunde,
conviene confirmar los derechos del modelo o sustituirlo (el juego trae un B1 de cajas de respaldo que se usa si el archivo falta).

**Cañonera LAAT derribada** (`public/models/laat.bin` y `public/models/laat-*.jpg`): este trabajo se basa en
«[LAAT - Low Altitude Assault Transport](https://sketchfab.com/3d-models/laat-low-altitude-assault-transport-cf7f6043210a418abdd818d5e8dd0fd8)»
de [Mind Mulch for The Masses](https://sketchfab.com/mindmulchforthemasses), con licencia
[CC-BY 4.0](http://creativecommons.org/licenses/by/4.0/) (hay que citar al autor; se permite el uso comercial; ver `public/models/LICENCIA-LAAT.txt`).
Cambios hechos para el juego (herramienta `tools/convert-laat.mjs`): el modelo se coloca inclinado y hundido en la arena, el casco se corta junto al fuselaje
para separar un ala (que queda tirada como cobertura), se simplifica (de ~19.000 a ~11.000 triángulos) y se reducen las texturas a la mitad.
Los daños (hollín, humo, chispas y fuego) se simulan encima, sin modificar el modelo. Hay una versión de formas sencillas de respaldo si el archivo falta.
Se muestra también en la pantalla de créditos del juego (menú → «Créditos y agradecimientos»).

**Bláster DC-17m del jugador** (`public/models/dc17m.glb`): este trabajo se basa en
«[DC-17m](https://sketchfab.com/3d-models/dc-17m-6845ac2657814aa4a870e8d75f05b42f)» de [goreduku](https://sketchfab.com/goreduku), con licencia
[CC-BY 4.0](http://creativecommons.org/licenses/by/4.0/) (hay que citar al autor; se permite el uso comercial; ver `public/models/LICENCIA-DC17M.txt`).
Modelo aportado por el autor del proyecto. Cambios: sus piezas se juntan en una sola malla, se gira y se escala al tamaño del arma en pantalla (en el juego).
Sustituye al E-5, que queda solo como respaldo si el archivo falla.

**Clon de fase I** (`public/models/clone/`): este trabajo se basa en
«[Clone Trooper Phase1 (Shiny) [Updated]](https://sketchfab.com/3d-models/clone-trooper-phase1-shiny-updated-aae018747b054186bd48e460b0ad1192)»
de [Admiral Tributon](https://sketchfab.com/doctor10), con licencia [CC-BY 4.0](http://creativecommons.org/licenses/by/4.0/) (hay que citar al autor; se permite el uso
comercial; ver `public/models/LICENCIA-CLON.txt`). Modelo aportado por el autor del proyecto. Se usa su versión .fbx con sus texturas de color, relieve y brillo
(del .usdz) reducidas a JPG de 1024 px; sin las de metal/rugosidad. Sale en la cinemática (soldado de la puerta de la cañonera en vuelo); las posturas se hacen por código.

**Clon comando** (`public/models/commando.glb`): este trabajo se basa en
«[Republic Commando](https://sketchfab.com/3d-models/republic-commando-30959b9c2ddb475085eaccdcb00e2dd8)»
de [Abel](https://sketchfab.com/abel76), con licencia
[CC-BY-NC 4.0](http://creativecommons.org/licenses/by-nc/4.0/) (hay que citar al autor; **no se permite el uso comercial**; ver `public/models/LICENCIA-COMANDO.txt`).
Modelo aportado por el autor del proyecto. Cambios hechos para el juego (herramienta `tools/convert-commando.py`): las imágenes pasan de PNG a JPG y se quitan las de
metal/rugosidad/oclusión (de ~9,6 MB a ~3,7 MB); el modelo no se edita. Las posturas (cinemática) y los brazos en primera persona se colocan por código girando sus huesos.

**Animaciones del clon comando** (`public/animations/*.json`; originales en `assets/animaciones/mixamo/*.fbx`): de [Mixamo](https://www.mixamo.com) (Adobe),
descargadas por el autor del proyecto (solo movimiento, sin personaje, 30 fps): Rifle Run, Rifle Run To Stop, Crouch Rapid Fire, Rifle Kneel To Stand,
Rifle Idle y Rifle Aiming Idle. Las animaciones de Mixamo se pueden usar gratis en proyectos personales y comerciales (no se pueden redistribuir sueltas).
Cambios: se traducen del esqueleto de Mixamo al del clon comando (`src/anim/mixamo.ts`, `tools/bake-animations.cjs`) y se guardan como giros de huesos.

**Droide B2** (`public/models/b2.bin` y `public/models/b2-atlas.jpg`): este trabajo se basa en
«[B2 Super battle droid](https://sketchfab.com/3d-models/b2-super-battle-droid-927b3ec911cc45c3ad15c458b3de4d50)»
de [zakeriiino](https://sketchfab.com/zakeriiino), con licencia
[CC-BY 4.0](http://creativecommons.org/licenses/by/4.0/) (hay que citar al autor; se permite el uso comercial; ver `public/models/LICENCIA-B2.txt`).
Cambios hechos para el juego (herramienta `tools/convert-b2.mjs`): se ha enderezado la postura (el original viene «congelado» en un paso de marcha),
se ha dividido en huesos para animarlo, se ha simplificado de ~49.000 a ~9.000 triángulos (y ~3.400 a distancia) y las texturas del autor se han reunido
en una sola imagen (atlas) de menor tamaño. No se usan los mapas de relieve. El personaje es propiedad de Lucasfilm Ltd. / Disney.

**Detonador térmico** (granada en la mano, `public/models/detonator.glb`): este trabajo se basa en
«[Star Wars Genesis - Thermal_detonator_low](https://sketchfab.com/3d-models/star-wars-genesis-thermal-detonator-low-f5de6a0d138b4f1aab3596d1ffc03650)»
de [Léonard Doye / Leoskateman](https://sketchfab.com/leoskateman), con licencia
[CC-BY 4.0](http://creativecommons.org/licenses/by/4.0/) (hay que citar al autor; se permite el uso comercial; ver `public/models/LICENCIA-DETONADOR.txt`).
Modelo aportado por el autor del proyecto. Cambios (herramienta `tools/convert-ship.mjs`): escalado a 10 cm, texturas de color y relieve a 512 px y de brillo a 256 px,
sin la de metal/rugosidad. La granada que vuela al lanzarla es una bola gris sencilla con una bombilla roja, hecha por código.

**Destructor de la República, clase Venator** (`public/models/venator.glb`): este trabajo se basa en
«[Venator Class Star Destroyer](https://sketchfab.com/3d-models/venator-class-star-destroyer-af3648043a5b4fd394adfc32baee369e)»
de [Digital Sock](https://sketchfab.com/DigitalSock), con licencia
[CC-BY 4.0](http://creativecommons.org/licenses/by/4.0/) (hay que citar al autor; se permite el uso comercial; ver `public/models/LICENCIA-VENATOR.txt`).
Modelo aportado por el autor del proyecto. Cambios (herramienta `tools/convert-ship.mjs`): simplificado de ~39.000 a ~16.000 triángulos (sin desviarse más de 2 m
a escala real) y, en el juego, reducido de tamaño (×0,19) para verse lejos en el cielo de la primera fase. Viene sin texturas (colores lisos del autor).

**Fragata separatista, clase Munificent** (`public/models/frigate.glb`): este trabajo se basa en
«[Munificent-Class Star Frigate](https://sketchfab.com/3d-models/munificent-class-star-frigate-44d5db77bb1342e5a6e58c24a0dcb256)»
de [A308 Digital](https://sketchfab.com/A308), con licencia
[CC-BY 4.0](http://creativecommons.org/licenses/by/4.0/) (hay que citar al autor; se permite el uso comercial; ver `public/models/LICENCIA-FRAGATA.txt`).
Modelo aportado por el autor del proyecto. Cambios (herramienta `tools/convert-ship.mjs`): simplificado de ~78.500 a ~12.300 triángulos, texturas de color reducidas
a 512 px (las de brillo a 256 px), sin las de relieve ni metal/rugosidad, y en el juego reducida de tamaño (×0,19) para verse lejos en el cielo de la primera fase.

**Droideka** (`public/models/droideka.bin`): este trabajo se basa en
«[Droideka](https://sketchfab.com/3d-models/droideka-42b2a42130f94d73a29eda6ecfdce98f)»
de [PokCat](https://sketchfab.com/PokCat), con licencia
[CC-BY 4.0](http://creativecommons.org/licenses/by/4.0/) (hay que citar al autor; se permite el uso comercial; ver `public/models/LICENCIA-DROIDEKA.txt`).
Cambios hechos para el juego (herramienta `tools/convert-droideka.mjs`): el modelo original (257.000 triángulos, 7 esqueletos) se ha repartido en 12 huesos propios,
muy simplificado (~8.000 triángulos de cerca y ~2.500 de lejos), el color de sus texturas se ha pasado a los vértices, y la postura de bola rodando
(patas plegadas en aro) se calcula en el juego, no viene del modelo. No se usan los mapas de relieve (vienen planos) ni sus animaciones. El personaje es propiedad de Lucasfilm Ltd. / Disney.

**Bláster del jugador** (`public/models/blaster.bin` y `public/models/blaster-color.jpg`): este trabajo se basa en
«[E-5 Blaster Rifle](https://sketchfab.com/3d-models/e-5-blaster-rifle-8fc1a356986140b38f4df49a2e21d079)»
de [A308 Digital](https://sketchfab.com/A308), con licencia
[CC-BY 4.0](http://creativecommons.org/licenses/by/4.0/) (hay que citar al autor; se permite el uso comercial; ver `public/models/LICENCIA-BLASTER.txt`).
Cambios hechos para el juego (herramienta `tools/convert-blaster.mjs`): se ha girado y escalado para verlo en primera persona (~4.900 triángulos, sin simplificar) y la
textura de color del autor se ha combinado con su mapa de oclusión en una sola imagen de 1024×1024. No se usa el mapa de relieve (viene plano). El arma es propiedad de Lucasfilm Ltd. / Disney.

## Texturas y partículas (CC0)
Todas de dominio público (CC0 1.0); se citan por cortesía. Detalles completos en `assets/CREDITOS.md`.
- **Poly Haven** (https://polyhaven.com): *Red Sandstone Wall* (Amal Kumar), *Sandstone Cracks* (Rob Tuytel), *Mud Cracked Dry 03* (Dario Barresi y Dimitrios Savva), *Sand 03* (Charlotte Baglioni) y *Cliff Side* (James Ray Cock y Dario Barresi, fotografía; Jenelle van Heerden, procesado), *Red Sand* (Rohit Seervi) y *Rock Pitted Mossy* (Dimitrios Savva, fotografía; Rico Cilliers, procesado). **ambientCG** (https://ambientcg.com, CC0): *Rocks 011* y *Rock 029*. Usadas, ya preparadas en blanco y negro con relieve, para las rocas, las paredes y el suelo.
- **OpenGameArt** — *Arid ground textures* de **pansapiens** (https://opengameart.org/content/arid-ground-textures): tierra roja con grava (suelo).
- **Kenney** (https://kenney.nl) — *Smoke Particles* y *Particle Pack* de Kenney Vleugels: humo, fuego, chispas y polvo de la cañonera derribada, las explosiones, los impactos y los fogonazos.

## Sonido
- **Ambiente y granadas:** sintetizados por código (originales).
- **Disparos de los droides B1 y B2** (`public/audio/b1-1.mp3` a `b1-4.mp3`, y `b1-load.mp3` para el «cargar el arma» cuando aparecen) y
  **bláster del jugador** (`public/audio/clon-1.mp3` a `clon-6.mp3`) y **droidekas** (`public/audio/deka-1.mp3` y `deka-2.mp3`): recortes de un audio aportado por el autor del proyecto
  con sonidos de bláster de Star Wars. Los efectos de sonido de Star Wars son propiedad de Lucasfilm Ltd. / Disney.
  Se usan aquí en un proyecto personal y sin ánimo de lucro. **Si el proyecto se hiciera público de forma más amplia o comercial,
  hay que sustituirlos** por sonidos con licencia libre (por ejemplo, los sintetizados que ya trae el juego como respaldo).

- **Música** (`public/audio/musica.mp3`): «Separatist March», aportada por el autor del proyecto (el archivo original era el audio de un vídeo, `Separatist_March.mp4`;
  se ha igualado de volumen y recortado a MP3 de 96 kbps). **Autoría y derechos por confirmar.** Si el proyecto se hiciera público de forma más amplia o comercial,
  conviene confirmar que se puede usar o sustituirla. En el juego se puede bajar o quitar desde el menú (Música).
- **Música de la pantalla principal** (`public/audio/menu.mp3`): aportada por el autor del proyecto (audio de un vídeo, `videoplayback.mp4`);
  igualada de volumen, recortado el final y pasada a MP3 de 80 kbps. **Autoría y derechos por confirmar** (mismas condiciones que la anterior).
- **Sonido del detonador térmico** (`public/audio/detonador-armado.mp3` y `detonador-explosion.mp3`): aportado por el autor del proyecto (original en
  `assets/audio/efectos/thermal_detonator.mp4`; autoría y derechos por confirmar). Preparado con `tools/prepare-detonator-sound.py`: partido en el pitido de
  armado y la explosión, en mono y con la explosión a −1 dB.
- **Sonidos de la cañonera** (`public/audio/laat-pasada.mp3` y `laat-interior.mp3`): aportados por el autor del proyecto (originales en
  `assets/audio/efectos/laat_paso_rasante.mp3` y `laat_interior_vuelo.mp3`). Preparados con `tools/prepare-laat-sounds.py`: recortados, igualados de
  volumen (la pasada a −17 LUFS; el interior a −26 LUFS, por debajo de las voces) y el interior convertido en bucle sin cortes. **Origen y licencia por confirmar.**
- **Música de la arena** (`public/audio/arena.mp3`): «Jango's Escape» (banda sonora de *Star Wars: Episodio II*, de John Williams; © Lucasfilm Ltd.),
  aportada por el autor del proyecto (audio de un vídeo; original en `assets/audio/musica/Jango_s_Escape_THEME.mp4`). Recortado el silencio final
  (3:44), igualada al volumen de las otras (−20 LUFS) y pasada a MP3 de 96 kbps. Suena en bucle en la arena. **Obra con derechos de autor:**
  vale para un juego personal; si el proyecto se difunde, habría que sustituirla.

## Star Wars
Star Wars, Geonosis y los personajes y vehículos que aparecen son marcas y propiedad de Lucasfilm Ltd. / Disney.
Este juego es un proyecto de aficionado, personal y experimental, sin relación con Lucasfilm ni Disney.
