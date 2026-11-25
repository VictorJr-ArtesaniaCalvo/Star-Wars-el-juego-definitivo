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

**Clon comando** (`public/models/commando.glb`): este trabajo se basa en
«[Republic Commando](https://sketchfab.com/3d-models/republic-commando-30959b9c2ddb475085eaccdcb00e2dd8)»
de [Abel](https://sketchfab.com/abel76), con licencia
[CC-BY-NC 4.0](http://creativecommons.org/licenses/by-nc/4.0/) (hay que citar al autor; **no se permite el uso comercial**; ver `public/models/LICENCIA-COMANDO.txt`).
Modelo aportado por el autor del proyecto. Cambios hechos para el juego (herramienta `tools/convert-commando.py`): las imágenes pasan de PNG a JPG y se quitan las de
metal/rugosidad/oclusión (de ~9,6 MB a ~3,7 MB); el modelo no se edita. Las posturas (cinemática) y los brazos en primera persona se colocan por código girando sus huesos.

**Droide B2** (`public/models/b2.bin` y `public/models/b2-atlas.jpg`): este trabajo se basa en
«[B2 Super battle droid](https://sketchfab.com/3d-models/b2-super-battle-droid-927b3ec911cc45c3ad15c458b3de4d50)»
de [zakeriiino](https://sketchfab.com/zakeriiino), con licencia
[CC-BY 4.0](http://creativecommons.org/licenses/by/4.0/) (hay que citar al autor; se permite el uso comercial; ver `public/models/LICENCIA-B2.txt`).
Cambios hechos para el juego (herramienta `tools/convert-b2.mjs`): se ha enderezado la postura (el original viene «congelado» en un paso de marcha),
se ha dividido en huesos para animarlo, se ha simplificado de ~49.000 a ~9.000 triángulos (y ~3.400 a distancia) y las texturas del autor se han reunido
en una sola imagen (atlas) de menor tamaño. No se usan los mapas de relieve. El personaje es propiedad de Lucasfilm Ltd. / Disney.

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

## Star Wars
Star Wars, Geonosis y los personajes y vehículos que aparecen son marcas y propiedad de Lucasfilm Ltd. / Disney.
Este juego es un proyecto de aficionado, personal y experimental, sin relación con Lucasfilm ni Disney.
