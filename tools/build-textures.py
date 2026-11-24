#!/usr/bin/env python3
"""Prepara las texturas reales del juego a partir de assets/ (necesita Python con Pillow y NumPy).

    python tools/build-textures.py

Cada textura del juego es UNA imagen JPG de 1024x1024 que lleva dentro varias cosas (para que el móvil lea una sola imagen por capa):
  - rock-wall.jpg, rock-cracks.jpg, ground-red.jpg:  R,G = relieve (normal map, componentes x e y)   B = detalle de brillo
  - ground-extra.jpg:                                  R = detalle del barro agrietado             G = detalle de la arena
  - (tercera tanda) ground-sand.jpg, ground-rocky.jpg, rock-pitted.jpg, rock-slab.jpg:  R,G = relieve   B = detalle de brillo

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


def detail(path, keep_large=0.2, contrast=1.15, blur=90, weights=(0.2126, 0.7152, 0.0722)):
    rgb = load(path)
    lum = rgb @ np.array(weights, dtype=np.float32)
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


# ---------------------------------------------------------------------------------------------------------------------------------
# Segunda tanda: roca estratificada (foto) y dos texturas hechas por código (lajas de arenisca para el suelo y huecos de erosión para las rocas)
# ---------------------------------------------------------------------------------------------------------------------------------
rng = np.random.default_rng(1138)


def periodic_noise(sigma, seed):
    """Ruido suave que se repite sin costuras, con valores entre 0 y 1."""
    r = np.random.default_rng(seed).standard_normal((SIZE, SIZE))
    n = periodic_blur(r, sigma)
    return (n - n.min()) / (n.max() - n.min())


def worley(cells, seed, warp=0.0, warp_sigma=40, jitter=(0.15, 0.85)):
    """Celdas de Voronoi que se repiten sin costuras. Devuelve (distancia al punto más cercano, al borde de su celda, número de celda, vector al centro), en píxeles."""
    r = np.random.default_rng(seed)
    pts = (np.stack(np.meshgrid(np.arange(cells), np.arange(cells), indexing='ij'), -1) + r.uniform(jitter[0], jitter[1], (cells, cells, 2))) * (SIZE / cells)
    yy, xx = np.mgrid[0:SIZE, 0:SIZE].astype(np.float32)
    if warp:  # deforma un poco las celdas para que no parezcan una cuadrícula
        xx = xx + (periodic_noise(warp_sigma, seed + 1) - 0.5) * warp
        yy = yy + (periodic_noise(warp_sigma, seed + 2) - 0.5) * warp
    ci = np.floor(xx / (SIZE / cells)).astype(int)  # sin «% cells»: así la deformación no rompe la repetición en los bordes
    cj = np.floor(yy / (SIZE / cells)).astype(int)
    best = np.full(xx.shape, 1e9, np.float32); second = np.full(xx.shape, 1e9, np.float32)
    best_id = np.zeros(xx.shape, np.int32); bvx = np.zeros(xx.shape, np.float32); bvy = np.zeros(xx.shape, np.float32)
    for di in (-1, 0, 1):
        for dj in (-1, 0, 1):
            gi, gj = ci + di, cj + dj
            px = pts[gi % cells, gj % cells, 0] + (gi // cells) * SIZE
            py = pts[gi % cells, gj % cells, 1] + (gj // cells) * SIZE
            dx, dy = xx - px, yy - py  # (el eje 0 de pts es x)
            d = np.sqrt(dx * dx + dy * dy)
            better = d < best
            second = np.where(better, best, np.minimum(second, d))
            best_id = np.where(better, (gi % cells) * cells + (gj % cells), best_id)
            bvx = np.where(better, dx, bvx); bvy = np.where(better, dy, bvy)
            best = np.where(better, d, best)
    return best, second - best, best_id, bvx, bvy


def smooth(a, b, v):
    t = np.clip((v - a) / (b - a), 0, 1)
    return t * t * (3 - 2 * t)


def normal_from_height(h, strength):
    gx = (np.roll(h, -1, 1) - np.roll(h, 1, 1)) * 0.5
    gy = (np.roll(h, -1, 0) - np.roll(h, 1, 0)) * 0.5
    nx, ny, nz = -gx * strength, gy * strength, np.ones_like(h)  # +y hacia arriba de la imagen, como los mapas OpenGL
    l = np.sqrt(nx * nx + ny * ny + nz * nz)
    return nx / l * 0.5 + 0.5, ny / l * 0.5 + 0.5


def finish(nxn, nyn, luma):
    luma = np.clip(luma / luma.mean() * MEAN, 0, 1)
    return nxn, nyn, luma


# Roca estratificada (Poly Haven, Cliff Side): capas horizontales de arenisca roja. Para las rocas y las paredes (no para las agujas).
nx, ny = normal_xy(ph('cliff_side', 'nor_gl'))
save('rock-strata.jpg', nx, ny, detail(ph('cliff_side', 'diff'), keep_large=0.3, contrast=0.95, blur=150))

# Lajas de arenisca sueltas sobre arena (suelo): placas irregulares e inclinadas al azar, esparcidas entre arena clara y polvo.
def plates(cells, seed, present, margin, warp):
    d, edge, cid, vx, vy = worley(cells, seed, warp=warp, warp_sigma=50)
    r = np.random.default_rng(seed + 100)
    n = cells * cells
    pres = (r.uniform(0, 1, n) < present)[cid]
    m = r.uniform(*margin, n)[cid]
    body = smooth(m, m + 7.0, edge) * pres                 # la laja es más pequeña que su celda: queda arena alrededor
    return body, edge - m, cid, vx, vy, r.uniform(0.0, 1.0, n)[cid], r.uniform(-1, 1, (n, 2))[cid], r.uniform(0.42, 1.0, n)[cid]


bigA, edgeA, cidA, vxA, vyA, liftA, tiltA, toneA = plates(11, 7, 0.7, (5, 26), 90)
bigB, edgeB, cidB, vxB, vyB, liftB, tiltB, toneB = plates(40, 9, 0.2, (2, 5), 20)
grainS = periodic_noise(2.5, 21) * 0.6 + periodic_noise(8, 22) * 0.4
planeA = (tiltA[..., 0] * vxA + tiltA[..., 1] * vyA) * 0.0045
planeB = (tiltB[..., 0] * vxB + tiltB[..., 1] * vyB) * 0.012
hA = bigA * (0.5 + 0.5 * liftA + planeA)
hB = bigB * (0.35 + 0.35 * liftB + planeB)
h = np.maximum(hA, hB * 0.9) + (grainS - 0.5) * 0.05
nxn, nyn = normal_from_height(h, 13.0)
body = np.maximum(bigA, bigB * 0.9)
tone = np.where(bigA >= bigB * 0.9, toneA, toneB) * (0.84 + 0.3 * grainS)
sand = 1.18 * (0.88 + 0.24 * grainS)
shadow = 1.0 - 0.45 * smooth(2.0, 9.0, edgeA) * (1 - smooth(9.0, 16.0, edgeA)) * (bigA > 0.05)  # sombra fina al pie de cada laja
luma = (sand * (1 - body) + tone * body) * np.where(body > 0.05, 1.0, shadow) * (0.82 + 0.26 * periodic_noise(60, 23))
save('ground-slabs.jpg', *finish(nxn, nyn, luma))

# Huecos de erosión (alvéolos) en la roca: cuencos irregulares con borde claro (nunca más anchos que su celda, para que no se corten).
d, edge, cid, vx, vy = worley(11, 31, warp=40, warp_sigma=50, jitter=(0.32, 0.68))
radius = np.random.default_rng(32).uniform(17, 29, 11 * 11)[cid]
depth = smooth(radius, radius * 0.3, d)
present = np.random.default_rng(33).uniform(0, 1, 11 * 11)[cid] > 0.25  # no todas las celdas tienen hueco
depth = depth * present
rim = smooth(radius * 1.3, radius, d) * smooth(radius * 0.75, radius, d) * present
bump = periodic_noise(4, 34)
h = -depth + 0.2 * rim + (bump - 0.5) * 0.08
nxn, nyn = normal_from_height(h, 5.5)
luma = (0.9 + 0.2 * bump) * (1 - 0.62 * depth * (0.5 + 0.5 * smooth(radius, 0, d))) + 0.18 * rim
luma = luma * (0.85 + 0.22 * periodic_noise(70, 35))
save('rock-pits.jpg', *finish(nxn, nyn, luma))


# ---------------------------------------------------------------------------------------------------------------------------------
# Tercera tanda (suelo de Geonosis): arena roja, roca plana en lajas, roca con agujeros y la roca de las lajas en 3D
# ---------------------------------------------------------------------------------------------------------------------------------
ag = lambda n, kind: os.path.join(A, 'ambientcg', n, '1k', f'{n}_1K-JPG_{kind}.jpg')

# Arena roja, base del suelo y de los caminos (Poly Haven, Red Sand): casi lisa, con rizos finos de viento
nx, ny = normal_xy(ph('red_sand', 'nor_gl'))
save('ground-sand.jpg', nx, ny, detail(ph('red_sand', 'diff'), keep_large=0.1, contrast=2.2, blur=60))
# Zonas rocosas (ambientCG, Rocks 011): lajas planas de piedra apiladas. El tono gris lo sustituye el rojo del juego
nx, ny = normal_xy(ag('Rocks011', 'NormalGL'))
save('ground-rocky.jpg', nx, ny, detail(ag('Rocks011', 'Color'), keep_large=0.2, contrast=1.5, blur=100))
# Roca con agujeros (Poly Haven, Rock Pitted Mossy): el verde del musgo se quita dejando solo el canal rojo, que apenas lo recoge
nx, ny = normal_xy(ph('rock_pitted_mossy', 'nor_gl'))
save('rock-pitted.jpg', nx, ny, detail(ph('rock_pitted_mossy', 'diff'), keep_large=0.2, contrast=1.1, blur=110, weights=(0.85, 0.15, 0.0)))
# Lajas y rocas sueltas (ambientCG, Rock 029): se usa en las piedras planas en 3D
nx, ny = normal_xy(ag('Rock029', 'NormalGL'))
save('rock-slab.jpg', nx, ny, detail(ag('Rock029', 'Color'), keep_large=0.25, contrast=1.3, blur=100))
