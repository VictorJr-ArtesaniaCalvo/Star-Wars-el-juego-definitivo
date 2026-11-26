# NOTAS DEL PROYECTO (para ponerse al día en una conversación nueva)

> Resumen breve del estado y de lo pendiente en **CLAUDE.md**. Aquí, el detalle.

Última actualización: 2026-11-25 (cinemática inicial). Rama de trabajo: `claude/star-wars-3d-pwa-game-vo2yxm` (cada subida a esta rama se publica sola en GitHub Pages).

## 1. Qué es el juego

**«Geonosis: Última Defensa»**: juego personal y experimental de defensa por oleadas en **primera persona**, ambientado en Star Wars (Guerras Clon, Geonosis). Es una **PWA** (aplicación web instalable) pensada sobre todo para **iPhone** (iPhone 13 Pro Max) y también para ordenador (teclado/ratón y mando).

- El jugador es un soldado clon que defiende una zona del cañón, junto a una cañonera de la República (LAAT) estrellada, contra droides separatistas que llegan por los dos extremos del cañón.
- Oleadas: B1 (desde el inicio), B2 (ronda 4), Droidekas (ronda 7). Hay kits médicos, granadas y un bláster que se calienta.
- Es un proyecto personal sin fines comerciales. El dueño, Víctor, **no es programador**: hay que explicarle todo en español sencillo, sin tecnicismos.

## 2. Cómo está organizado el proyecto

```
index.html            Pantallas HTML (menú, HUD, créditos). Muestra la versión al final del menú.
vite.config.ts        Vite + PWA; define __BUILD__ (commit + hora) que sale al final del menú.
src/
  main.ts             Arranque, registro del service worker (busca actualizaciones cada minuto).
  style.css           Estilos del menú, HUD, botones táctiles, viñeta y contraste de pantalla.
  core/Game.ts        Bucle principal, escena, renderer, física, estados (menú/jugando/pausa), funciones debug* para pruebas.
  core/Settings.ts    Ajustes guardados en el dispositivo y tabla QUALITY (baja/media/alta/ultra).
  world/              Todo el escenario (ver abajo).
  enemies/            Droides: Droid.ts (cuerpo, escudo, mancha de contacto), DroidBrain.ts (IA y disparos),
                      B1Rig/B2Rig/DroidekaRig.ts (esqueletos y posturas), droidWear.ts (brillo metálico, desgaste, polvo),
                      EnemyManager.ts, ModelFile.ts (lector de modelos .bin).
  weapons/            Blaster.ts, Grenade.ts, Medkits.ts, Effects.ts (disparos, explosiones, partículas),
                      ViewModel.ts (arma en pantalla) y arms.ts (brazos de armadura clon).
  player/PlayerController.ts   Movimiento y colisión del jugador (Rapier).
  input/              Touch.ts (joystick con doble toque = avanzar solo, botones), KeyboardMouse.ts, Gamepad.ts, InputManager.ts.
  ui/                 Hud.ts, Menu.ts, Compass.ts, GameOver.ts.
  waves/WaveManager.ts   Oleadas y dificultad por ronda (parámetros de cada tipo de droide).
  audio/              AudioEngine.ts (Howler) y Synth.ts (sonidos generados: viento, disparos…).
  cinematic/          Cinemática inicial: script.ts (GUION: tomas, cámaras, tiempos, diálogos; todo ajustable), Cinematic.ts (reproductor),
                      actors.ts (LAAT en vuelo con la puerta abierta, piernas de clones, comando PROVISIONAL, B1 en silueta).
  audio/Voices.ts     Voces con filtro de radio de casco clon (Web Audio). audio/CineSounds.ts: motor, golpe en el casco, fuego.
  sim/, net/          Tipos de estado y reserva de ideas para multijugador (no usado).
src/world/ (lo más importante del escenario)
  terrain.ts          Altura del terreno (cañón, ancho, grietas, paredes), RIM = curvas del ancho del cañón, cráter de la cañonera.
  rocks.ts            Rocas, agujas con anillos (spireGeometry), mesetas, setas, coberturas de roca en capas.
  builder.ts          Junta todas las piezas fijas en una malla y crea sus cuerpos sólidos (Rapier).
  materials.ts        Texturas del suelo y la roca mezcladas por «triplanar» en un sombreador a medida.
  wallBlocks.ts       Bloques de roca apilados en las paredes (instancias, 6 formas generadas por código).
  scatter.ts          Lajas 3D, piedrecitas alrededor del jugador, repisas de roca (con colisión).
  wreckage.ts         Restos de la cañonera, chapas retorcidas, muros de chapa y cajas/barriles de la República (provisionales por código).
  laat.ts, gunship.ts Cañonera LAAT derribada (modelo real; si falla se usa una de formas sencillas).
  wreck.ts            Nave droide estrellada al norte (provisional, anillo + esfera).
  landmarks.ts        Castillo geonosiano (norte) y nave núcleo separatista (sur), solo para mirar.
  crashFx.ts          Humo, columna de humo alta, brasas, chispas y fuego de la cañonera (partículas Kenney).
  scorch.ts           Marcas de quemado en el suelo. contact.ts: sombras de contacto. lightFill.ts: mínimo de luz.
  sunShadow.ts        Sombras de las paredes calculadas al cargar. sky.ts: cielo, sol, luces y niebla.
  atmosphere.ts       Humo lejano, brasas, fuegos. skyLife.ts: batalla de naves en el cielo y geonosianos.
public/               Modelos .bin (b1, b2, droideka, blaster, laat) con sus texturas, texturas del suelo/roca (jpg 1K), partículas, audio.
assets/               Originales descargados (Poly Haven, ambientCG, OpenGameArt, Kenney) con CREDITOS.md. No viaja con el juego.
tools/                Conversores de modelos (.mjs) y generadores de texturas/partículas (.py: build-textures.py, build-particles.py).
.github/workflows/deploy.yml   Publicación automática en GitHub Pages.
README.md, CRÉDITOS.md, NOTAS.md   Documentación (README detallado por funciones; CRÉDITOS = autores y licencias).
```

## 3. Tecnologías y librerías

Three.js 0.187 (gráficos), Rapier 3D (física y colisiones), Yuka (IA de los droides), Howler (audio), nipplejs (joystick táctil), Vite 8 + TypeScript + vite-plugin-pwa (compilación y PWA). Herramientas de conversión: meshoptimizer, jpeg-js (Node); Pillow + NumPy (Python) para texturas.

Materiales: casi todo es `MeshLambertMaterial` modificado con `onBeforeCompile` (texturas triplanares, mínimo de luz, desgaste de droides). Los droides usan `MeshPhongMaterial`. No hay HDRI ni materiales PBR (decisión de rendimiento: se imita con colores de luz).

## 4. Qué está hecho y funcionando

- Juego completo con oleadas, 3 tipos de droide, granadas, kits médicos, brújula, HUD, menú, créditos, game over, ajustes, modo pruebas oculto.
- Controles táctiles (joystick dinámico, doble toque = avanzar solo, botones a ~50 % de opacidad), teclado/ratón y mando.
- Modelos reales: B1, B2, Droideka (con postura de bola y despliegue), bláster E-5 del jugador, cañonera LAAT; todos con respaldo de formas sencillas si el archivo falla.
- Escenario: cañón jugable de 80 × 192 m que se abre por los lados al norte y al sur (curvas `RIM`); paredes con silueta irregular, capas de roca con voladizos y escombros; suelo de arena roja con caminos claros, roca en lajas, lajas 3D y piedrecitas; agujas con anillos; castillo geonosiano y nave núcleo separatista lejanos (esta dispara rayos pequeños).
- Zona del accidente: cráter, surco de arrastre, montón de arena, marcas de quemado, trozos reales de la LAAT quemados, chapas, muros de chapa, cajas y barriles de la República (un tercio en gris y negro), columna de humo alta, brasas y chispas azul/blancas, luces azules.
- Luz y color: sol amarillo pálido a 27°, luz ambiente fría + luz de relleno marrón, sombras de paredes pintadas al cargar, niebla pálida, viñeta y contraste de pantalla, sombras de contacto, desfase de sombras corregido (con sol bajo no se separan de los objetos).
- Droides: brillo metálico sutil (un 20 % reducido; solo Media/Alta), aristas claras, polvo rojizo; B2 gris azulado; droideka con escudo esférico un 25 % más transparente y disparos que salen de sus manos alternando.
- Brazos de armadura clon sujetando el bláster (propuesta A: antebrazos que entran por las esquinas de abajo), sucios con arena roja y quemaduras. Subido en el commit `41e9349`; Víctor aún no ha dado su opinión desde el iPhone.
- Se quitaron: puntos negros del cielo, polvo y ráfagas de arena visibles («niebla de viento»; el sonido del viento sigue).
- **Cañonera estrellada a tamaño real** (`CRASH_POSE`, `crashMatrix` en `terrain.ts`): misma inclinación de siempre (morro abajo 0,2 rad, ladeo 0,05). El cráter crece como la nave a lo largo y la mitad a lo ancho; bajo la nave el suelo sigue la panza (enterrada 0,35 m) y la cola se levanta; el surco baja sin parar desde el pie de la pared oeste hasta la nave (`furrowCut`). Rocas, lajas y restos se reparten con el cráter ANTIGUO (`crashFieldOriginal`) para que no cambien de sitio; solo se apartó la roca del morro (`NOSE_GAP` en `rocks.ts`).
- **Arma del jugador: DC-17m** (`public/models/dc17m.glb`, goreduku CC-BY 4.0, aportado por Víctor; se carga en `loadBlasterModel` de `ViewModel.ts`, medidas en `DC17`; el E-5 queda de respaldo). El arma mide 0,8 × `HIP.scale` (0,54 → ~43 cm); 0,625 = sus 50 cm reales. El panel de ajuste también mueve/escala el arma (`HIP`) y lo incluye en «Copiar valores».
- **Voces reales** (grabadas por Víctor con el iPhone; originales en `assets/audio/voces/*.m4a`, preparadas con `sh tools/prepare-voices.sh` → `public/audio/voces/*.mp3`: sin silencios, −16 LUFS, comandante −1,5 semitonos). Filtro de radio en el juego (`RADIO_FILTERS` en `src/audio/Voices.ts`: `radio` para 2A/2B, `casco` para la toma 5), ajustable de oído en el menú oculto («AJUSTAR FILTRO DE RADIO (VOCES)», `src/ui/VoiceTuner.ts`, con «Copiar valores»). Toma 2 partida en 2A (4 s, desde fuera) y 2B (7 s, desde dentro); toma 5 de 6 s; gestos sincronizados con las frases (`gestos` en `SHIP_TROOPERS`). Soldados de la nave: clon normal (sin arma, señala) y comandante (clon comando con DC-17m), modelo del clon en `public/models/clone/` (.fbx de Admiral Tributon, CC-BY).
- **Clon comando real** (`src/player/commandoModel.ts`, `public/models/commando.glb`, modelo de Abel CC-BY-NC aportado por Víctor): en la cinemática (clase `CommandoModel` de `actors.ts`, posturas por IK con el bláster en las manos) y en primera persona (solo antebrazos y manos, `createFirstPersonArms`): cada mano encajada en un agarre del arma (`FP_HANDS` en `commandoModel.ts`: posición/giro en el sistema del arma, cierre de dedos con parada al tocar el arma, ángulo del antebrazo, antebrazo alargado ×1,6 sin deformar la mano). Brazos y arma se dibujan en su propia capa (`ViewModel.scene`/`cam`), por encima del escenario. Panel de ajuste en el menú oculto («AJUSTAR MANOS EN PRIMERA PERSONA», `src/ui/HandTuner.ts`) con «Copiar valores»: Víctor afinará y pasará los números para dejarlos fijos en `FP_HANDS`. La palma se calcula como el lado contrario a la placa de armadura del dorso del guante (ver `makeHand`). Si no carga, se usan el comando y los brazos provisionales. Jugador a 1,85 m (ojos a 1,70).
- **Cinemática inicial** (~26 s, 6 tomas, ver README «Cinemática inicial»): sale al pulsar JUGAR la primera vez desde que se abre la app; no se repite al reintentar ni al volver a jugar; botón «VER CINEMÁTICA INICIAL» en el menú de inicio; botón OMITIR traslúcido abajo a la derecha (también Esc/Espacio/Intro/mando). Barras negras, fundidos, subtítulos con nombre (SOLDADO, COMANDANTE, TÚ), HUD y controles ocultos, la música empieza con ella y sigue en la partida. Zona de aparición (también al reintentar): borde NORTE del cráter, 1,5 m más allá de su cresta y al este de la punta del ala apoyada (4,0; −14,0), mirando al norte con la nave a la espalda; delante, una caja de la República sólida de cara al norte (`COMANDO` y `COBERTURA` en `src/cinematic/script.ts`; `SPAWN` de `defenseZone.ts` es el mismo punto). La caja queda algo cuesta abajo y cubre poco: Víctor lo da por bueno. La LAAT de la cinemática y la estrellada van a tamaño real (17,69 m de largo; también el ala arrancada; los restos de alrededor siguen a la escala de antes) con la abertura central de la bahía abierta a los dos lados como un rectángulo exacto recortado al dibujar (`APERTURA` en actors.ts; el modelo no se toca) (la que está justo detrás de la torreta de bola y la ventanita en arco, según la foto de Víctor; NO la pieza trasera inclinada con rendijas). Clones 1,83 m, comando 1,85 m. Pendiente: que Víctor la vea en el iPhone y pida ajustes; voces reales; modelo del comando.
- **Naves grandes del cielo** (`src/world/skyLife.ts`, pedidas por Víctor): destructor **Venator** (Digital Sock, CC-BY) al sur, sobre la nave núcleo, y **fragata Munificent** (A308 Digital, CC-BY) al norte, sobre el castillo; sustituyen a las naves sencillas hechas por código (que quedan de respaldo si los archivos fallan). Quietas (antes se mecían), en los mismos sitios de antes y 80 m más altas (265 y 240 m; pedido por Víctor), disparándose (verde la República, rojo los separatistas; los rayos salen y llegan a puntos del casco). Las dos a la misma escala (`SKY_SCALE` 0,19 → Venator 216 m, fragata 157 m: su proporción real). Brillo de motores en `SHIP_INFO`. Materiales pasados a Lambert sin niebla y con algo de luz propia (`prepareShip`) para que desde abajo no se vean negras. Archivos `public/models/venator.glb` y `frigate.glb`, hechos con `node tools/convert-ship.mjs` (sirve para cualquier nave de Sketchfab en GLB: escala a la eslora real, reordena ejes, simplifica y reduce texturas; los comandos usados están al principio del archivo). Formato preferido para los modelos que pase Víctor: **GLB + license.txt**.
- **Altura de los droides** (`src/enemies/sizes.ts`, pedida por Víctor): B1 1,93 m, B2 1,93 m (antes 2,35), droideka 1,83 m desplegado (antes 1,74; en bola 1,24). El modelo se escala y con él el cuerpo sólido, el punto al que se apunta (`KINDS` en `Droid.ts`) y de dónde salen sus disparos (`SIZE_CHANGE` en `WaveManager.ts`); también los B1 de la cinemática.
- **Viento** al 36 % del volumen original (dos veces al 60 %) (`WIND_VOLUME` en `AudioEngine.ts` y el viento de la cinemática en `CineSounds.ts`).
- **Pantalla principal y menús** (`index.html` #menu, `src/ui/Menu.ts`): #menu.main = pantalla principal con `public/menu-fondo.jpg`; #mainPanel (JUGAR, AJUSTES, AGRADECIMIENTOS; ABANDONAR solo en pausa) y #settingsPanel (ajustes y ayuda de controles, «‹ VOLVER»). JUGAR desde la pantalla principal pone siempre la cinemática (`startRun(true)`); reintentar no. Ya no hay botón «VER CINEMÁTICA INICIAL» (las tomas siguen en el modo de pruebas).
- **«TOCA PARA EMPEZAR»** (`#tapStart` en `index.html`, `Game.setupTapStart()`): tapa todo al abrir; con `touchend`/`click`/tecla llama a `audio.unlock()` y `startMenuMusic()`, se funde en 0,7 s (sigue tapando mientras, para que el toque no pulse un botón de debajo) y se borra. Solo sale al abrir la app (o tras recargar para volver al cañón).
- **Cortinilla y música de la pantalla principal**: JUGAR → `Game.playFromMenu()`: `audio.unlock()` en el mismo toque (iOS), `audio.fadeOutMenuMusic(WIPE_TIME)` y `Wipe.run()` (#wipe .bar: degradado con la punta difuminada `--feather` 14vw que cruza de derecha a izquierda en `WIPE_TIME` 1,1 s; en negro se llama a `startRun(true)` y la cortina se quita con un fundido de 0,5 s sobre la cinemática, que ya empieza en negro). Ojo: la clase `.go` ya existe en el CSS (botones del modo de pruebas), por eso la cortinilla usa `.sweep`. Música del menú: `AudioEngine.startMenuMusic()` (primer `touchend`/`pointerup`/`click`/`keydown` con `mode === 'menu'`; con `pointerdown` NO suena en el iPhone, iOS solo deja sonar al levantar el dedo, y en `quitToMenu`, que además para la de la partida con `stopMusic()`); usa el mismo control de volumen de Música. `public/audio/menu.mp3`: sacada del vídeo de Víctor, recortado el silencio final (solo había 1–2 s; la música llega hasta 11:05), igualada a −20 LUFS como `musica.mp3`, MP3 80 kbps (6,6 MB, entra en la copia sin conexión, límite 8 MB por archivo).
- **HUD**: `#roundBox.away` mientras hay aviso (`Hud.showBanner`/`hideBanner`); `#banner` bajo la brújula; brújula 360 px / 52 px; sin `#stance`; `#heat` sin texto.
- Todas las pruebas automáticas pasan (ver §8).

## 4 bis. Arena de Geonosis (fase 2)

- **Flujo**: `WaveManager` llama a `onEnterArena(8)` al acabar la ronda 7 en el cañón → `Game.enterArena`: fundido (`#zoneFade`, 1,6 s), en negro `World.disposeCanyon` (quita del dibujo y de la física todo lo que creó el cañón, salvo cielo y luces; se apuntó al construirlo), `buildArenaWorld` (dibujo + cuerpos sólidos + coberturas), `setZone('arena')`, sol de la arena (`ARENA_SUN`, se cambia `SUN_DIR` en su sitio para que cielo y luces lo sigan), vida 100 y 4 granadas, jugador en `ARENA_ENTRY` (dentro de la puerta sur, a 2,5 m de la boca del túnel, mirando al norte), fundido de vuelta y `waves.start(8)`.
- **Zona** (`src/world/zone.ts`): `groundHeight`, `walkable` (suelo ovalado y túneles), `standable` (sitios para que se pare un droide: solo el óvalo), `clampInside`, `zoneObstacles`. Lo usan jugador, droides (`Droid`, `DroidBrain`, `EnemyManager`) y kits médicos. En el cañón devuelven lo de siempre.
- **Volver al cañón**: no se reconstruye; se recarga la página (`reloadForCanyon`) y la cinemática no se repite (`sessionStorage` `geonosis.cineSeen`). Reintentar en modo de pruebas con ronda ≥ 8 no recarga.
- **Droides en la arena**: `EnemyManager.spawnAtDoor` los hace aparecer dentro del túnel (5–13 m) y salen andando; no aparece en un túnel si estás a menos de 9 m de su boca. `WaveManager.pickDoors`: puertas de la oleada (`ENEMY_DOORS`: norte, este, oeste) y oleadas sorpresa (`SURPRISE_CHANCE` 0,25, nunca seguidas ni en la 8).
- **Forma y aspecto**: ver CLAUDE.md. Todo ajustable en `layout.ts` (medidas, coberturas, surco) y `ARENA_COLORS` (arena.ts). Coberturas: rocas, restos de chapa (planchas dobladas y un tubo) y el montón del surco. Los droides destruidos de decorado se quitaron a petición de Víctor.
- **Rendimiento medido aquí**: ~105.000 triángulos de la arena (cañón en Media ≈ 175.000); montarla tarda ~1–1,4 s en este ordenador (en el iPhone quizá 2–3 s, en negro). Sus sombras van pintadas (no proyecta sombras en tiempo real; los droides sí). No medido en iPhone.
- **Fotos sin el juego**: `npm run dev` y abrir `/tools/arena-preview/index.html?arena` (`?color` = prueba de color antigua, sin nada = maqueta gris); `#vista` elige cámara (inicio, palco, sur, oeste, puerta, restos, surco, pelicula1, pelicula2, general, arriba).

## 4 ter. Animaciones de Mixamo, cueva y cinemática de paso a la arena (2026-11-26)

- **Animaciones** (`src/anim/mixamo.ts`): `retargetMixamo` traduce un .fbx de Mixamo (esqueleto `mixamorig*`, cm, mirando a +Z) al rig del comando (`createTrooperRig`): pone cada hueso del comando apuntando como el de Mixamo en reposo (postura en T) y le aplica el mismo giro «en el mundo» que hace el de Mixamo en cada imagen; la cadera se escala por altura. Se guardan los giros locales imagen a imagen en `public/animations/<nombre>.json` (30 fps; las de reposo, 15). En el juego: `loadClips` al cargar (`ANIM_CLIPS`), `applyClip(rig, clip, t, loop, peso)`. Regenerar: `npm run dev` y `node tools/bake-animations.cjs` (usa `tools/anim-preview/`, que también enseña cada una: `api.show(nombre, t, vista)`, `api.gun()` = el arma con sus puntos de agarre, `?arma=0.5` cambia el largo).
- **Arma en la mano** (`CommandoModel.animate/holdRifle`): el arma va «pegada» a la muñeca derecha con un agarre calculado una vez (`calibrateGrip` con «Crouch_Rapid_Fire» en el segundo 0: arma recta al frente) y el **centro del mango (`DC17_GRIP`) en el centro de la palma** (entre muñeca y nudillo del corazón); la mano izquierda va a la empuñadura delantera con IK. El comandante de la cañonera usa el mismo giro (`gripRotation`). Arma de las cinemáticas a **70 cm** (Víctor).
- **Comandante de la cañonera** (opción B, `ShipTrooper.poseAnimated`): «Rifle_Idle» en bucle + torso y cabeza hacia el cañón + gestos (mirar, asentir) + mano izquierda en el asa. Si las animaciones no cargan, la postura por código de antes.
- **Cueva** (`src/world/cave.ts`, `CUEVA`): sitio C (pared oeste, z −24; el pie de la pared se calcula con el detalle de cada calidad). Portada extruida con contorno irregular y hueco en arco redondo (`punta` 0; 1 = apuntado), marco en tubo abultado, rocas, túnel de 9 m que se oscurece hasta negro. Color `0xc2643c` (algo más claro que la roca roja, pedido por Víctor). Cuerpo sólido: la malla entera (trimesh) + pared invisible a 2,5 m dentro (`pasa`). ~3.500 triángulos. `caveKeepOut(x,z,r,y)`: las piezas del `Builder` (rocas, setas, mesetas, losas), los bloques de pared y las repisas que caerían encima o en el pasillo de delante no se ponen, gastando el mismo azar (el resto del mapa no cambia); sus obstáculos se quitan de `OBSTACLES`. Se borra con el cañón al pasar a la arena. `__game.debugCave(opciones)` pone otra copia para probar variantes (null la quita).
- **Cueva, 2.ª versión**: sale 1,6 m (antes 3,2). La masa extruida queda 0,3 m por detrás y delante va una «piel» de roca (malla de 60 × 46 recortada al contorno y sin el hueco del arco) desplazada con ruido: capas de 1,35 m con repisa, abultamientos grandes, grietas verticales y grano fino (`relief`, escala `CUEVA.relieve`). Junto al arco el relieve se aplana (el marco lo tapa y el arco no cambia) y junto al contorno se mete por detrás de la masa. Material: el mismo de los bloques de pared (`applyWorldTextures`, `rockOnly`, atributos `texAmt`/`texKind`); color `0xd27a4c` por la textura. ~6.500 triángulos.
- **Música de la arena** (`AudioEngine`): tres pistas (`canyonMusic`, `arenaMusic`, `menuMusic`); `music` es la de la partida activa. `fadeOutGameMusic(s)` con el fundido de `enterArena`; en negro, `setGameMusic('arena')` + `startMusic()`. `unlock()` «despierta» las dos pistas de partida en el toque de JUGAR (iOS) para que la de la arena pueda empezar luego sin otro toque; si aun así iOS la bloquea, arranca en el siguiente toque (`onMusicTouch`). Volver al cañón recarga el juego (vuelve la del cañón).
- **Cinemática de paso a la arena** (hecha, primera versión; ver CLAUDE.md para las tomas):
  - Archivos: `src/cinematic/script2.ts` (guion: tomas `TOMAS2`, lugares `COMANDO2`, `DROIDES_CAÑON`, `CARRERA`, `VUELO2`, `ARENA2`) y `src/cinematic/ArenaCinematic.ts` (reproductor). Usa la pantalla `#cine` de la inicial (más `#cineLoc`, el rótulo de la esquina) y la cortinilla `Wipe`.
  - Flujo: al caer el último droide de la ronda 6, `WaveManager` llama en el acto a `onEnterArena(7)` (sin la fase «RONDA SUPERADA»; también `jumpToRound` desde la pausa) → `Game.arenaReached`: si no se ha visto en la sesión (`geonosis.cine2Seen`), hay modelo y animaciones (`ArenaCinematic.ready()`) y se está jugando → `beginArenaCinematic`; si no, `enterArena` (fundido). Mientras se ve el cañón, `ArenaPrep.step(5 ms)` monta la arena a trozos (`buildArenaSteps` es un generador; el cálculo de sombras del sol también va a trozos: `SunBake.fill`). En la toma 6, evento `cortinilla` → `Wipe.run` → en negro `Game.swapToArena` (acaba la arena si faltaba, borra el cañón, cuerpos sólidos con `addArenaPhysics`, zona, sol) y el tiempo salta al principio de la toma del túnel (si la cortinilla tarda, la cinemática espera al final de la toma 6). Al acabar (u omitir): `endArenaCinematic` → jugador donde quedó el comando (≈ 0,3; 40, mirando al norte), vida y granadas, `waves.start(7)`.
  - Medido aquí: arena montada en ~0,85–1 s de trabajo repartido en ~50 imágenes (trozos de 8–35 ms; antes el cálculo de sombras era un solo trozo de 133 ms); el cambio en negro, ~20–50 ms.
  - Comando: `CommandoModel.animateMix` (una animación o dos mezcladas + mano al casco `helmet`, `lookUp`, `lookSide`), `setShade` (silueta en el túnel, materiales propios), `muzzle`. `applyClip(..., moveHips)` para mezclar sin mover la cadera (de «correr y pararse» a «reposo»; `stopShift` = lo que avanza al frenar).
  - Sonidos nuevos: `CineSounds.setEngine` (volumen y tono del motor según la distancia: se acerca y se aleja), `shieldOn`, `echoStep`; `Voices.staticFade` (estática que se limpia) y filtro `piloto` en `RADIO_FILTERS`; `Effects.groundDust`.
  - Carrera: zigzag por la arena libre comprobado en el mapa desde arriba (las rocas del camino: `OBSTACLES` de rocks.ts). Empieza donde haga falta para cruzar la boca de la cueva 0,85 s después de empezar la toma 6.
  - Arreglo de paso: al soltar el ratón al empezar una cinemática en mitad de la partida (ordenador), el juego lo tomaba como pausa y la cinemática se quedaba quieta.
  - Cambios de Víctor (2.ª versión): sin la toma de la carrera (la 5 es ahora «llega a la cueva y entra», 3,8 s, cámara fija junto a la boca que le sigue y se queda en la entrada; cruza la boca en `CARRERA.cruza`); pasada de la cañonera a 27–33 m; vueltas de radio 40 m, a 36 m de altura, 150° en 8 s, alabeo 40°.
  - Vista previa (modo de pruebas): `ArenaCinematic.start(n, { preview: true })` reproduce solo esa toma (`previewEnd`), sin preparar la arena, sin cambiar la música y sin pasar a la arena (la cortinilla de la toma 5 acaba la vista previa); `Game.testArenaCinematic` esconde la partida (`EnemyManager.setShown`) y `endArenaPreview` vuelve al menú o a la pausa. Toma del cañón desde la arena: `sessionStorage` `geonosis.previewShot` + recarga; se pone tras el toque de «TOCA PARA EMPEZAR».
  - Sonidos grabados de la cañonera (`CineSounds`, búferes compartidos cargados con `loadLaatSounds` al arrancar): `startInterior(presencia)` / `setInterior` / `duckInterior` / `stopInterior` (bucle con `loopStart` 0,25 s y `loopEnd` 0,25 + 28,5 s: el archivo lleva 0,25 s de relleno a cada lado con la continuación del bucle, así no hay corte aunque el MP3 traiga silencio al principio); en script.ts, `cabina` 0/1 en 2A/2B y el evento `motor` usa el interior. `startFlyby(offset)` / `steerFlyby(pan, tono)`: la pasada empieza de forma que su pico (2,59 s del archivo) coincida con la nave más cerca de la cámara; se mueve de izquierda a derecha alrededor de ese momento y el tono cambia ±8 % con la velocidad.
  - Pruebas: `__game.testArenaCinematic(n)` (n = toma desde 0; vista previa), `__game.cine2.debug()`, `__game.cine2.hold(true)`, `__game.arenaReached(7)` (como si acabara la ronda 6).

## 5. Problemas pendientes y cosas a medias

- **Cajas y barriles de la República son provisionales** (generados por código). Víctor quiere sustituirlos por sus modelos gratuitos (Sci-Fi Weapon Case Pack, 3 Sci-Fi Barrels, Sci-fi Crate Pack) cuando los suba a `assets/models`. Esa carpeta aún no existe en el repositorio. Hay que conseguir también sus licencias para `CRÉDITOS.md`.
- **Lajas 3D en el suelo**: hechas y subidas, pero Víctor dijo que se veían algo uniformes («terrazo»); se podrían variar.
- **HDRI y materiales completos (normal + rugosidad + metalicidad)**: NO hechos. Era la mejora gráfica 1 y 2 de la lista; solo se hizo el suelo y las sombras. Pendiente decidir si se hace.
- **Brazos**: formas simples, sin animación propia (no se doblan al disparar), la mano izquierda se ve poco al apuntar. Quemaduras poco visibles. Pendiente feedback de Víctor.
- **Droideka**: su color va por vértice (sin textura), menos detalle que B1/B2; los metales se ven beige claro frente a la referencia, casi negros. Sin resolver.
- **Castillo**: desde el punto de aparición apenas se ve (la cañonera y la pared lo tapan). Posible ajuste de posición/oscuridad.
- **Nave droide estrellada (norte)**: modelo provisional (anillo + esfera); se propuso reconstruirla con casco en capas, cráter y surco propios.
- **B1 sin textura en algunos brazos** (arm.L, arm_rotat) y licencia del modelo B1 por confirmar (autor desconocido). Licencia de la música pendiente de revisar si el repositorio es público.
- Rendimiento **no medido en iPhone** por mi parte: Víctor reportó 45–60 FPS en las primeras rondas con Alta; hay que vigilar ronda 15, calor y batería.
- Aviso: cuando la versión de calidad cambia entre **Baja** y las demás, el juego se recarga (la forma de las paredes y su colisión se fijan al cargar).

## 6. Decisiones importantes

**Calidad gráfica (Baja/Media/Alta/Ultra)**
- **Baja** debe quedar lo más parecida posible al juego original: pared recta, sin lajas 3D, sin bloques de pared, sin brillo metálico, sin luces ni disparos de la nave núcleo (las formas sí se dibujan). Pero sí recibe cosas casi gratis (luz de relleno, sombras de contacto, escudo, polvo).
- **Media y Alta** llevan los mismos bloques de pared (la cantidad de Media gustó más). **Alta** añade sombras reales cerca del jugador y más lajas (1.400 frente a 560). **Ultra** añade resplandor (bloom) y resolución máxima.
- Cambiar entre Baja y las demás recarga el juego.
- Viñeta y ajuste de contraste: siempre activos, sin depender de la calidad.

**Rendimiento (iPhone primero)**
- Piezas fijas unidas en pocas mallas; instancias para repeticiones; sombras e iluminación del sol bajo calculadas al cargar (color de vértice); texturas 1K comprimidas en JPG; partículas en reservas fijas.
- Cualquier cosa de fondo lejana son siluetas de pocos polígonos con una niebla propia limitada.
- Antes de añadir peso: medir triángulos y llamadas con las pruebas y avisar si algo pesa; ofrecer alternativa más ligera.
- Presupuesto actual aprox. (mi navegador de pruebas): Baja ≈ 125.000 triángulos, Media ≈ 175.000, Alta ≈ 280.000 por imagen. Descarga total ≈ 19 MB en caché.

**Controles**
- Táctil: joystick dinámico a la izquierda (doble toque = avanzar solo; otro toque lo para), deslizar a la derecha para mirar, botón grande de disparo (3 balas), botón de 1 bala sobre el joystick, mira, salto, agachado, granada, pausa. Opacidad baja (50–55 %).
- El menú no se desplaza a los lados (panel de 580 px).

**Publicación en GitHub Pages**
- `.github/workflows/deploy.yml` compila y publica en cada subida a `main` o a `claude/star-wars-3d-pwa-game-vo2yxm`. No se crean pull requests salvo petición expresa.
- La PWA guarda una copia local; en el iPhone la versión nueva puede tardar en verse: cerrar la app del todo y abrir con conexión. Al final del menú sale `Versión <commit> · <hora UTC>` para comprobar cuál se usa. La app busca actualizaciones al abrirse, cada minuto y al volver a ella, y se recarga sola.
- Los commits terminan con las dos líneas `Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>` y `Claude-Session: https://claude.ai/code/session_01QvXPp9w1MwcYr399v3stsn`.

**Forma de trabajar con Víctor**
- **Ante cualquier duda (qué pieza quitar, dónde poner algo, cómo interpretar una petición), PREGUNTAR ANTES de hacer nada y pasarle fotos (capturas marcadas, por ejemplo en rojo) para que corrija.** Ejemplo: con la puerta de la LAAT se quitó primero la pieza equivocada por no preguntar.
- Hablarle en español sin tecnicismos. Cuando pida «antes de empezar, dime cómo lo plantearías», proponer y **esperar su visto bueno**; avanzar de una en una; decir qué no se pudo probar (iPhone: FPS, calor, batería) y cómo probarlo en el iPhone.
- Si algo baja mucho el rendimiento, avisar y proponer alternativa. Si una descarga falla o pide login, no insistir y avisar.
- Pasarle imágenes de lo hecho (antes y después) y, si lo pide, esperar a su aprobación antes de subir. Subir a la rama publica el juego.
- Para peticiones de pruebas en el entorno de Claude: red limitada; hosts permitidos: api.polyhaven.com, dl.polyhaven.org, opengameart.org, kenney.nl, ambientcg.com, acg-download.struffelproductions.com.

**Estilo visual acordado**: Geonosis con sol amarillo pálido, sombras frías marrón violáceo, niebla pálida, más contraste y variedad (caminos de arena clara, rocas oscuras), luces azules y blancas en restos, fuego amarillo blanquecino. Las agujas llevan anillos redondeados. Cambios sutiles; si gustan, se intensifican.

## 7. Próximos pasos (en este orden, pedidos por Víctor)

1. **Cinemática inicial**: HECHA (primera versión). Esperando que Víctor la revise en el iPhone y pida cambios (se ajusta en `src/cinematic/script.ts`). Luego: voces (archivos en `public/audio/voces/`, ver LEEME.txt) y modelo/texturas del clon comando a partir de sus imágenes (sustituir la clase `Commando` de `actors.ts`, que es provisional).
2. **Arena de Geonosis**: HECHA y en el juego (ver abajo «Arena»). Pendiente que Víctor la pruebe en el iPhone.
3. **Cinemática de transición** entre las zonas (ahora es un fundido a negro provisional) y **nave droide** en el surco de impacto de la arena.

Antes de empezar cada una: proponer el plan sin tecnicismos y esperar el visto bueno.

## 8. Cómo trabajar y probar

- `npm install`, `npm run dev` (desarrollo), `npm run build` (comprueba tipos y compila), `npx vite preview --port 4173` (servidor local para probar lo compilado).
- Modo de pruebas: ajustes `testRound`, `invincible`, `quality` guardados en `localStorage` bajo `geonosis.settings.v1`. Se puede preparar con `page.addInitScript` en Playwright (cambiar de Baja a otra calidad recarga la página).
- El objeto del juego se expone como `window.__game` con funciones de depuración: `debugShot(x,y,z,yaw,pitch)`, `debugHeight`, `debugTopDown`, `debugSpawn(tipo,x,z)`, `debugPlace`, `debugKit`, `debugHurt`. Los droides tienen `poseNow()` y `debugRoll(...)`.
- Cinemática: `__game.startRun(true, n)` la pone desde la toma n (0 = principio); `__game.cine.debug()` da el tiempo y la toma; `__game.cine.hold(true)` la congela para hacer capturas. En el menú oculto hay botones 1–6 para ver una toma.
- Pruebas de regresión usadas (scripts de Playwright, no están en el repositorio): oleadas y rondas, árbol de triángulos y llamadas por calidad, carga sin archivos de modelos/texturas/partículas, FPS aproximado. Hay que volver a crearlas si se necesitan: lo importante es comprobar que no hay errores de consola, que el juego arranca en las tres calidades y también si faltan `laat.bin`, texturas o el atlas de partículas (deben usarse los respaldos).
- Regenerar texturas: `python tools/build-textures.py`, partículas `python tools/build-particles.py`; modelos: `node tools/convert-*.mjs` (necesitan los originales descargados, que no están en el repositorio salvo texturas en `assets/`).
- Documentación detallada de cada función en `README.md`; créditos y licencias en `CRÉDITOS.md` y `assets/CREDITOS.md`.
