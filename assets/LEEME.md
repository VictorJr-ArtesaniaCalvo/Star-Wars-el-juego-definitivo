# Carpeta `assets`: materiales para usar más adelante en el juego

Esta carpeta está **fuera** de `public/`, así que **no viaja con el juego** (no pesa al instalarlo en el móvil). Cuando se usa un recurso,
se prepara y se copia a `public/` (ya reducido y listo para el móvil) con `tools/build-textures.py` y `tools/build-particles.py`.

```
assets/
├── CREDITOS.md              ← autores, webs y licencias
├── textures/                ← texturas (imágenes que se repiten, para suelo y rocas)
│   ├── polyhaven/           ← de Poly Haven: red_sandstone_wall, sandstone_cracks, mud_cracked_dry_03, sand_03
│   │   └── <nombre>/2k  y  <nombre>/1k   ← cada una en 2048 px y en 1024 px: _diff (color), _nor_gl (relieve), _rough (rugosidad)
│   └── opengameart/
│       └── arid_ground/     ← tierra roja y arena de pansapiens (2k y 1k): _diff (color) y _nor (relieve)
└── particles/               ← partículas (humo, fuego, chispas, polvo)
    └── kenney/
        ├── smoke-particles/ ← humo negro/blanco, explosiones, destellos
        └── particle-pack/   ← fuego, chispas, destellos de disparo, quemaduras, polvo…
```

**Qué tamaño usar en el iPhone:** las de 1k (1024 px) pesan cuatro veces menos en memoria y se ven bien en una pantalla de móvil;
las de 2k (2048 px) solo si hace falta más detalle. Conviene no usar muchas a la vez.
