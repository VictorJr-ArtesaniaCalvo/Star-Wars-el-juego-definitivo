# CLAUDE.md — Geonosis: Última Defensa

Juego personal en 3D (PWA para iPhone y ordenador): un clon comando defiende un cañón de Geonosis junto a una cañonera LAAT estrellada, por oleadas de droides.
Detalle técnico completo en **NOTAS.md** (estructura, decisiones, cómo probar) y **README.md** (funciones). Créditos y licencias en **CRÉDITOS.md**.

## Cómo trabajar con Víctor
- Víctor **no es programador**: explicar en español sencillo, sin tecnicismos.
- **Ante cualquier duda, preguntar antes de tocar nada** y enseñar fotos (capturas marcadas) para que corrija. Proponer el plan y esperar su visto bueno.
- **Pasar fotos antes de subir**; subir (commit + push) solo cuando lo pida. Cada subida a la rama `claude/star-wars-3d-pwa-game-vo2yxm` se publica sola en GitHub Pages: https://victorjr-artesaniacalvo.github.io/Star-Wars-el-juego-definitivo/ (comprobar que la publicación termina bien; a veces GitHub Pages falla y hay que relanzarla).
- Avisar de lo que no se puede probar aquí (FPS, calor y batería del iPhone; cómo suena el audio).

## Hecho y funcionando
- Juego completo: oleadas (B1, B2, droideka), bláster con calor, granadas, kits médicos, HUD, brújula, menú, ajustes, créditos, controles táctiles/teclado/mando, 4 calidades gráficas.
- Escenario: cañón con paredes en capas, rocas, agujas, castillo y nave núcleo lejanos, cañonera LAAT estrellada **a tamaño real** (17,69 m) enterrada en un cráter agrandado con surco de arrastre.
- Jugador: clon comando de 1,85 m. Aparece en el borde norte del cráter, mirando al norte, con una caja de cobertura delante.
- Modelos reales: B1, B2, droideka, LAAT, clon comando (Abel, CC-BY-NC), clon de fase I (Admiral Tributon), arma DC-17m (goreduku) y E-5 de respaldo.
- Altura de los droides (pedida por Víctor, de los pies a lo alto de la cabeza): B1 1,93 m, B2 1,93 m, droideka 1,83 m desplegado (en bola, en proporción). Un solo sitio: `src/enemies/sizes.ts`.
- Viento de fondo bajado dos veces al 60 % (36 % del original; partida y cinemática): `WIND_VOLUME` en `src/audio/AudioEngine.ts`.
- **Pantalla principal** (sale siempre al abrir): fondo del planeta Geonosis (`public/menu-fondo.jpg`, imagen de Víctor) y botones JUGAR (empieza siempre con la cinemática, que se puede omitir), AJUSTES (pantalla propia, en dos columnas) y AGRADECIMIENTOS. En pausa: CONTINUAR, AJUSTES y ABANDONAR PARTIDA.
- **HUD**: el indicador de ronda y droides se aparta mientras sale un aviso de ronda (que sale justo bajo la brújula); brújula un 10 % más pequeña; sin indicador «DE PIE/AGACHADO»; barra del bláster sin texto, más fina y más abajo.
- Menú oculto de pruebas (5 toques en el título): ronda, invencible, FPS, ver cada toma de la cinemática, **panel de manos/arma** y **panel del filtro de radio**, ambos con «Copiar valores».

## Cinemática inicial (unos 31 s, funcionando pero provisional)
Guion en `src/cinematic/script.ts` (todo ajustable). Tomas: 1 GEONOSIS · 2A nave desde fuera · 2B desde dentro · 3 cañonera estrellada · 4 droides en la neblina · 5 el comando tras la caja · 6 paso a primera persona.
- ✅ Toma 2 dividida en 2A (4 s) y 2B (7 s), con vuelo recto a lo largo del cañón.
- ✅ Soldados de la nave: clon normal (sin arma, señala) y comandante (clon comando con DC-17m), agarrados a las asas, con gestos sincronizados con sus frases.
- ✅ Voces reales de Víctor (preparadas con `tools/prepare-voices.sh`) con filtro de radio en el juego («radio» para 2A/2B, «casco» para la toma 5) y valores ya ajustados por Víctor.
- ⏳ **Pendiente de rematar**: posturas de los clones (más naturales; los dedos cierran en puño de forma aproximada), en 2A los soldados se ven pequeños, posturas del comando en las tomas 5 y 6, y revisión de Víctor en el iPhone (incluidos los FPS).

## Pendiente
- **Brazos y manos en primera persona**: montados (dos agarres en el arma, dedos que se cierran hasta tocarla, capa propia que no atraviesa paredes) y con los valores de Víctor. ⏳ Falta que se vean naturales al disparar, apuntar y mirar arriba/abajo (la mano izquierda se ve poco).
- **Pulido visual**:
  - ✅ Hecho: luz de relleno contra los contraluces, sombras de las paredes calculadas al cargar, rocas y agujas con más forma, paredes con bloques en capas, niebla pálida.
  - ⏳ No hecho: texturas del droideka (va con color por vértice), brazos del B1 sin textura, materiales completos (relieve, rugosidad, metal) y cielo HDRI, y revisar sombras y contraluces junto a la cañonera nueva.
- Cajas y barriles de la República provisionales (generados por código), a la espera de los modelos de Víctor.

## Fase 2: la arena de Geonosis (en el juego, en pruebas)
- **Cómo se llega**: al completar la **ronda 7** (cañón), fundido a negro suave con «ARENA DE GEONOSIS», el cañón se borra entero y se monta la arena; apareces **en la puerta sur** (a la entrada del túnel, mirando a la arena) con vida llena y 4 granadas; sigue la **ronda 8**. Sin cinemática de transición todavía. Número en `ARENA_ROUND` (`src/world/arena/layout.ts`).
- **Droides**: entran por las puertas **norte, este y oeste** (por la sur, la tuya, nunca); 1 de cada 4 oleadas aprox. es «sorpresa» (solo 1 o 2 puertas, con aviso). Usan las coberturas de la arena.
- **Arena**: suelo ovalado de 64 × 83 m, muro bajo, gradas ocres de roca modelada con escaleras, columnas orgánicas que nacen de las gradas, palco de bulbos sobre la puerta este, puertas en arco con túnel, reja y polvo; 3 pilares en el centro, 11 rocas, 6 restos de chapa y un surco de impacto al norte (para la futura nave droide). **Sin droides destruidos** (Víctor los quitó). Sombras y oscurecidos pintados al cargar. ~105.000 triángulos.
- **Modo de pruebas**: botón «EMPEZAR EN LA ARENA» y ronda rápida «8 · Arena».
- **Volver al cañón** (reintentar una partida normal o ir a una ronda < 8 desde la arena): el juego se recarga y sale el menú (la cinemática no se repite).
- Archivos: `src/world/arena/` (layout = medidas, arena.ts = formas y luz, look.ts = materiales, ArenaWorld.ts = cuerpos sólidos y coberturas), `src/world/zone.ts` (suelo, límites y coberturas de la zona actual). Página de fotos sin el juego: `tools/arena-preview/index.html?arena` (con `npm run dev`).
- ⏳ Pendiente: que Víctor la pruebe en el iPhone (FPS, tamaño, diversión), cinemática de transición, nave droide en el surco, fase de detalles y fase de vida (geonosianos volando, polvo).
