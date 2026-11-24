# Créditos y origen de los recursos

## Código y librerías
Three.js, Rapier, Yuka, Howler.js, nipplejs, Vite (todas con licencias libres).

## Gráficos
Texturas, terreno, rocas, cañonera, droideka y efectos: generados por código en este proyecto (originales).

**Droide B1** (`public/models/b1.bin`): modelo 3D aportado por el autor del proyecto (archivo `B1 DROID.blend/.obj`; las rutas internas
de sus texturas mencionan «Blue Evolution Studio»). Se ha convertido y simplificado con `tools/convert-b1.mjs` (de 45.000 a ~5.000 triángulos),
y se ha coloreado con el tono arena de las texturas originales; las texturas pintadas no se usan (solo llegaron 5 de ~35).
**Autoría y licencia del modelo por confirmar.** El personaje es propiedad de Lucasfilm Ltd. / Disney. Si el proyecto se difunde,
conviene confirmar los derechos del modelo o sustituirlo (el juego trae un B1 de cajas de respaldo que se usa si el archivo falta).

**Droide B2** (`public/models/b2.bin` y `public/models/b2-atlas.jpg`): este trabajo se basa en
«[B2 Super battle droid](https://sketchfab.com/3d-models/b2-super-battle-droid-927b3ec911cc45c3ad15c458b3de4d50)»
de [zakeriiino](https://sketchfab.com/zakeriiino), con licencia
[CC-BY 4.0](http://creativecommons.org/licenses/by/4.0/) (hay que citar al autor; se permite el uso comercial; ver `public/models/LICENCIA-B2.txt`).
Cambios hechos para el juego (herramienta `tools/convert-b2.mjs`): se ha enderezado la postura (el original viene «congelado» en un paso de marcha),
se ha dividido en huesos para animarlo, se ha simplificado de ~49.000 a ~9.000 triángulos (y ~3.400 a distancia) y las texturas del autor se han reunido
en una sola imagen (atlas) de menor tamaño. No se usan los mapas de relieve. El personaje es propiedad de Lucasfilm Ltd. / Disney.

## Sonido
- **Ambiente y granadas:** sintetizados por código (originales).
- **Disparos de los droides B1 y B2** (`public/audio/b1-1.mp3` a `b1-4.mp3`, y `b1-load.mp3` para el «cargar el arma» cuando aparecen) y
  **bláster del jugador** (`public/audio/clon-1.mp3` a `clon-6.mp3`) y **droidekas** (`public/audio/deka-1.mp3` y `deka-2.mp3`): recortes de un audio aportado por el autor del proyecto
  con sonidos de bláster de Star Wars. Los efectos de sonido de Star Wars son propiedad de Lucasfilm Ltd. / Disney.
  Se usan aquí en un proyecto personal y sin ánimo de lucro. **Si el proyecto se hiciera público de forma más amplia o comercial,
  hay que sustituirlos** por sonidos con licencia libre (por ejemplo, los sintetizados que ya trae el juego como respaldo).

## Star Wars
Star Wars, Geonosis y los personajes y vehículos que aparecen son marcas y propiedad de Lucasfilm Ltd. / Disney.
Este juego es un proyecto de aficionado, personal y experimental, sin relación con Lucasfilm ni Disney.
