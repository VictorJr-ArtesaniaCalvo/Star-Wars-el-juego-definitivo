#!/usr/bin/env python3
"""Prepara las texturas reales del juego a partir de assets/ (necesita Python con Pillow y NumPy).

    python tools/build-textures.py

Cada textura del juego es UNA imagen JPG de 1024x1024 que lleva dentro varias cosas (para que el móvil lea una sola imagen por capa):
  - rock-wall.jpg, rock-cracks.jpg, ground-red.jpg:  R,G = relieve (normal map, componentes x e y)   B = detalle de brillo
  - ground-extra.jpg:                                  R = detalle del barro agrietado             G = detalle de la arena

El «detalle de brillo» es la foto en blanco y negro sin las manchas grandes de luz (así no se nota que se repite) y con el brillo medio
ajustado: el juego lo multiplica por el color de cada trozo de roca o de suelo, que es el que le da el tono rojo de Geonosis.
"""
import os
import numpy as np
from PIL import Image, ImageFile

ImageFile.MAXBLOCK = 1 << 27  # sin esto, el guardado optimizado de JPG puede fallar con imágenes con mucho ruido

ROOT = os.path.join(os.path.dirname(__file__), '..')
A = os.path.join(ROOT, 'assets', 'textures')
OUT = os.path.join(ROOT, 'public', 'textures')
SIZE = 1024
MEAN = 0.78  # brillo medio del detalle (el juego lo multiplica por 1,12)


def load(path):
    return np.asarray(Image.open(path).convert('RGB').resize((SIZE, SIZE), Image.LANCZOS), dtype=np.float32) / 255.0


def periodic_blur(a, sigma):
    """Desenfoque gaussiano que se repite sin costuras (se hace en frecuencias)."""
    f = np.fft.fftfreq(a.shape[0])[:, None] ** 2 + np.fft.fftfreq(a.shape[1])[None, :] ** 2
    g = np.exp(-2 * (np.pi ** 2) * (sigma ** 2) * f)
    return np.real(np.fft.ifft2(np.fft.fft2(a) * g))


def detail(path, keep_large=0.2, contrast=1.15, blur=90):
    rgb = load(path)
    lum = rgb @ np.array([0.2126, 0.7152, 0.0722], dtype=np.float32)
    low = np.maximum(periodic_blur(lum, blur), 0.02)
    rel = np.clip(lum / low, 0.2, 3.0) ** contrast
    out = rel * (low / low.mean()) ** keep_large
    out = out / out.mean() * MEAN
    return np.clip(out, 0.0, 1.0)


def normal_xy(path):
    n = load(path)
    return n[..., 0], n[..., 1]


def save(name, r, g, b):
    img = np.stack([r, g, b], -1)
    os.makedirs(OUT, exist_ok=True)
    out = os.path.join(OUT, name)
    Image.fromarray((np.clip(img, 0, 1) * 255 + 0.5).astype(np.uint8)).save(out, 'JPEG', quality=86, subsampling=0, optimize=True)
    print(f'{name}: {os.path.getsize(out) / 1024:.0f} KB')


ph = lambda n, kind: os.path.join(A, 'polyhaven', n, '1k', f'{n}_{kind}_1k.jpg')
oga = lambda n, kind: os.path.join(A, 'opengameart', 'arid_ground', '1k', f'{n}_{kind}_1k.jpg')

# Paredes del cañón: red_sandstone_wall (Poly Haven)
nx, ny = normal_xy(ph('red_sandstone_wall', 'nor_gl'))
save('rock-wall.jpg', nx, ny, detail(ph('red_sandstone_wall', 'diff'), keep_large=0.25, contrast=1.2))
# Agujas y rocas: sandstone_cracks (Poly Haven)
nx, ny = normal_xy(ph('sandstone_cracks', 'nor_gl'))
save('rock-cracks.jpg', nx, ny, detail(ph('sandstone_cracks', 'diff'), keep_large=0.2, contrast=1.2))
# Suelo: tierra roja con grava (OpenGameArt, pansapiens)
nx, ny = normal_xy(oga('red_earth_03', 'nor'))
save('ground-red.jpg', nx, ny, detail(oga('red_earth_03', 'diff'), keep_large=0.1, contrast=1.3, blur=60))
# Suelo: barro agrietado (R) y arena (G) (Poly Haven)
mud = detail(ph('mud_cracked_dry_03', 'diff'), keep_large=0.15, contrast=1.25)
sand = detail(ph('sand_03', 'diff'), keep_large=0.1, contrast=1.3, blur=60)
save('ground-extra.jpg', mud, sand, np.full_like(mud, 0.5))
