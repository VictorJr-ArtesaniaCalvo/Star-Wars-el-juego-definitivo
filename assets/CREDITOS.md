# Créditos de los recursos descargados (carpeta `assets`)

Todos los recursos de esta carpeta son de **licencia CC0 1.0** (dominio público): se pueden usar en proyectos personales y comerciales, sin permiso
y sin obligación de citar al autor (aun así se citan aquí por cortesía). Licencia: https://creativecommons.org/publicdomain/zero/1.0/

**Ya se usan en el juego** (versiones preparadas en `public/textures/` y `public/particles/`, ver abajo); el resto están guardados para más adelante.

---

## Texturas de Poly Haven — `textures/polyhaven/`
Web: https://polyhaven.com · Licencia: CC0 1.0 (https://polyhaven.com/license)
Cada textura trae tres mapas en JPG, en 2k (2048 px) y en 1k (1024 px): color (`_diff`), relieve (`_nor_gl`, formato OpenGL, el que usa Three.js) y rugosidad (`_rough`).

| Recurso | Para qué | Autor | Página |
|---|---|---|---|
| `red_sandstone_wall` — Red Sandstone Wall | roca de las agujas (juntas de bloques) — **en uso** | Amal Kumar | https://polyhaven.com/a/red_sandstone_wall |
| `sandstone_cracks` — Sandstone Cracks | roca de las agujas y paredes del cañón — **en uso** | Rob Tuytel | https://polyhaven.com/a/sandstone_cracks |
| `mud_cracked_dry_03` — Mud Cracked Dry 03 | suelo agrietado (para teñir de rojo) — **en uso** | Dario Barresi (procesado) y Dimitrios Savva (fotografía) | https://polyhaven.com/a/mud_cracked_dry_03 |
| `sand_03` — Sand 03 | arena — **en uso** | Charlotte Baglioni | https://polyhaven.com/a/sand_03 |
| `cliff_side` — Cliff Side | capas de roca erosionada de rocas y paredes del cañón (no de las agujas) — **en uso** | James Ray Cock y Dario Barresi (fotografía), Jenelle van Heerden (procesado) | https://polyhaven.com/a/cliff_side |
| `red_sand` — Red Sand | arena roja, base del suelo y de los caminos — **en uso** | Rohit Seervi | https://polyhaven.com/a/red_sand |
| `rock_pitted_mossy` — Rock Pitted Mossy | roca con agujeros de las rocas (el verde del musgo se quita) — **en uso** | Dimitrios Savva (fotografía), Rico Cilliers (procesado) | https://polyhaven.com/a/rock_pitted_mossy |

En cada carpeta hay también `informacion_polyhaven.json`, los datos oficiales de la textura (autores, etiquetas, tamaño real que cubre…).

## Texturas de OpenGameArt — `textures/opengameart/arid_ground/`
**Arid ground textures** — autor: **pansapiens** (https://opengameart.org/users/pansapiens)
Web: https://opengameart.org/content/arid-ground-textures · Licencia: CC0 1.0
Fotos de tierra roja, grava y arena (cerca del Museo Nacional de Australia, Canberra), hechas repetibles sin costuras; los mapas de relieve son sintéticos.
Se guardan solo `red_earth_01` a `07` y `sand_01` a `04` (color `_diff` y relieve `_nor`), en 2k y 1k. Detalles y cambios en `LICENCIA.txt` de esa carpeta.

## Partículas de Kenney — `particles/kenney/`
Autor: **Kenney Vleugels** (https://kenney.nl) · Licencia: CC0 1.0 · «Crédito a Kenney o a www.kenney.nl sería bonito, pero no es obligatorio.»

- **Smoke Particles** (2014) — https://kenney.nl/assets/smoke-particles → `particles/kenney/smoke-particles/`
  Humo negro (`black-smoke`), humo blanco (`white-puff`), explosiones (`explosion`), destellos (`flash`) y otra serie de bocanadas (`fart`).
- **Particle Pack 1.1** (2018) — https://kenney.nl/assets/particle-pack → `particles/kenney/particle-pack/`
  Fuego, llamas, chispas, humo, destellos de disparo, quemaduras, polvo, estrellas… Solo se guardan las versiones con fondo transparente.
  Créditos adicionales del propio pack por las plantillas de filtros: Indigo Ray, Craig Nisbet, Zoltan Erdokovy, Heliagon, ThreeDee, Killst4r y Tim2501.
  Más packs gratuitos de Kenney: https://kenney.nl/assets (si te gustan, él acepta donaciones voluntarias en https://kenney.nl/donate).

---

## Qué se usa en el juego y cómo
- **Suelo y rocas:** `public/textures/ground-red.jpg` (de `red_earth_03` de pansapiens), `ground-extra.jpg` (barro agrietado y arena de Poly Haven), `rock-cracks.jpg` y `rock-wall.jpg` (de `sandstone_cracks` y `red_sandstone_wall`), `rock-strata.jpg` (de `cliff_side`). `ground-slabs.jpg` (lajas del suelo) y `rock-pits.jpg` (picaduras tipo panal) **no son fotos**: las dibuja el propio script, así que no llevan autor externo. Cada una es una imagen de 1024 px con el relieve y el brillo en blanco y negro (el color rojo lo pone el juego). Se generan con `python tools/build-textures.py`.
- **Partículas:** `public/particles/atlas.png`: 16 imágenes de Kenney (humo, polvo, fuego, chispas, rayo) en una sola; se usan en la cañonera derribada y en las explosiones, impactos y fogonazos. Se genera con `python tools/build-particles.py`.
- Siguen sin usarse: `sand_01` a `04` y el resto de `red_earth` de pansapiens, y la mayoría de las partículas de Kenney.


## Texturas de ambientCG — `textures/ambientcg/` (licencia CC0)
Autor: ambientCG (https://ambientcg.com). Cada carpeta lleva `2k/` y `1k/` con color (`_Color`), relieve (`_NormalGL`, formato OpenGL) y rugosidad (`_Roughness`).

| Recurso | Para qué | Página |
|---|---|---|
| `Rocks011` — Rocks 011 | zonas rocosas del suelo (lajas de piedra planas apiladas; el gris se tiñe de rojo) — **en uso** | https://ambientcg.com/view?id=Rocks011 |
| `Rock029` — Rock 029 | lajas y piedras planas en 3D esparcidas por el suelo — **en uso** | https://ambientcg.com/view?id=Rock029 |

**Cómo se usan las nuevas del suelo** (`tools/build-textures.py`, en 1K): `ground-sand.jpg` (Red Sand), `ground-rocky.jpg` (Rocks 011), `rock-pitted.jpg` (Rock Pitted Mossy) y `rock-slab.jpg` (Rock 029), cada una con el relieve en rojo y verde y el detalle de brillo en azul. Solo se usan en calidad media y alta; en baja se queda el suelo de antes.
