#!/usr/bin/env python3
"""Prepara las partículas del juego a partir de assets/particles/kenney (necesita Python con Pillow y NumPy).

    python tools/build-particles.py

Reúne 16 imágenes de Kenney (CC0) en UNA sola imagen de 1024x1024 (4x4 casillas de 256 px): public/particles/atlas.png.
Cada casilla guarda en el canal alfa la forma de la partícula y en el color su relieve de luz y sombra (en grises);
el juego la tiñe con el color que toque (humo gris, llamas naranjas...). Orden de las casillas:
   0-4  humo (nubes oscuras y densas)      5-7  polvo       8-11  fuego (2 estallidos y 2 lenguas)
  12-14 chispas (destellos)                 15   rayo
"""
import os
import numpy as np
from PIL import Image, ImageFile

ImageFile.MAXBLOCK = 1 << 27
ROOT = os.path.join(os.path.dirname(__file__), '..')
K = os.path.join(ROOT, 'assets', 'particles', 'kenney')
OUT = os.path.join(ROOT, 'public', 'particles')
CELL = 256

# (archivo, modo): «tinte» normaliza el brillo para que el color lo ponga el juego; «luz» conserva el brillo original (fuego y chispas)
SPRITES = [
    ('smoke-particles/black-smoke/blackSmoke00.png', 'tinte'), ('smoke-particles/black-smoke/blackSmoke08.png', 'tinte'),
    ('smoke-particles/black-smoke/blackSmoke16.png', 'tinte'), ('smoke-particles/white-puff/whitePuff04.png', 'tinte'),
    ('smoke-particles/white-puff/whitePuff16.png', 'tinte'),
    ('particle-pack/smoke_04.png', 'tinte'), ('particle-pack/smoke_07.png', 'tinte'), ('particle-pack/smoke_08.png', 'tinte'),
    ('particle-pack/fire_01.png', 'luz'), ('particle-pack/fire_02.png', 'luz'), ('particle-pack/flame_05.png', 'luz'), ('particle-pack/flame_06.png', 'luz'),
    ('particle-pack/star_01.png', 'luz'), ('particle-pack/star_04.png', 'luz'), ('particle-pack/flare_01.png', 'luz'),
    ('particle-pack/spark_01.png', 'luz'),
]

atlas = np.zeros((CELL * 4, CELL * 4, 4), dtype=np.uint8)
for i, (f, mode) in enumerate(SPRITES):
    im = Image.open(os.path.join(K, f)).convert('RGBA')
    # se recorta a un cuadrado centrado (con el contenido) y se escala a la casilla, dejando un margen
    a = np.asarray(im, dtype=np.float32) / 255.0
    ys, xs = np.where(a[..., 3] > 0.02)
    cx, cy = (xs.min() + xs.max()) / 2, (ys.min() + ys.max()) / 2
    half = max(xs.max() - xs.min(), ys.max() - ys.min()) / 2 * 1.08 + 2
    box = (int(cx - half), int(cy - half), int(cx + half), int(cy + half))
    im = im.crop(box).resize((CELL, CELL), Image.LANCZOS)
    a = np.asarray(im, dtype=np.float32) / 255.0
    alpha = a[..., 3]
    lum = a[..., :3] @ np.array([0.2126, 0.7152, 0.0722], dtype=np.float32)
    core = alpha > 0.3
    if mode == 'tinte':
        det = lum / max(lum[core].mean(), 1e-3)
        det = np.clip(det * 0.62, 0, 1)
    else:
        det = np.clip(lum * 1.15, 0, 1)
    w = np.clip(alpha * 4, 0, 1)
    det = det * w + det[core].mean() * (1 - w)  # fuera de la forma, el color sigue al del interior (sin bordes oscuros al suavizar)
    r, c = divmod(i, 4)
    atlas[r * CELL:(r + 1) * CELL, c * CELL:(c + 1) * CELL, :3] = (det[..., None] * 255 + 0.5).astype(np.uint8)
    atlas[r * CELL:(r + 1) * CELL, c * CELL:(c + 1) * CELL, 3] = (alpha * 255 + 0.5).astype(np.uint8)

os.makedirs(OUT, exist_ok=True)
out = os.path.join(OUT, 'atlas.png')
Image.fromarray(atlas, 'RGBA').save(out, optimize=True)
print(f'atlas.png: {os.path.getsize(out) / 1024:.0f} KB')
