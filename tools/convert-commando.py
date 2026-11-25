"""Prepara el modelo del clon comando para el juego.

Uso:  python tools/convert-commando.py <republic_commando.glb original> public/models/commando.glb

Modelo: «Republic Commando» de Abel (https://sketchfab.com/abel76), licencia CC-BY-NC 4.0 (ver CRÉDITOS.md).
El modelo NO se edita: solo se cambian sus imágenes para que pese menos en el móvil.
 - Las texturas de color, relieve (normal) y brillo propio (visor, emblema) pasan de PNG a JPG.
 - Se quitan las de metal/rugosidad/oclusión: el juego usa un material más ligero que no las necesita.
El original no está en el repositorio (pesa ~10 MB).
"""
import io
import json
import struct
import sys

from PIL import Image

src, dst = sys.argv[1], sys.argv[2]
data = open(src, 'rb').read()
magic, version, _ = struct.unpack('<III', data[:12])
assert magic == 0x46546C67, 'no es un GLB'
jlen, _ = struct.unpack('<II', data[12:20])
gltf = json.loads(data[20:20 + jlen])
blen, _ = struct.unpack('<II', data[20 + jlen:28 + jlen])
binary = data[28 + jlen:28 + jlen + blen]

# --- qué imágenes se usan (color, relieve y brillo propio) ---
keep_images = set()
for m in gltf['materials']:
    pbr = m.get('pbrMetallicRoughness', {})
    pbr.pop('metallicRoughnessTexture', None)
    m.pop('occlusionTexture', None)
    for key in ('baseColorTexture',):
        if key in pbr: keep_images.add(gltf['textures'][pbr[key]['index']]['source'])
    for key in ('normalTexture', 'emissiveTexture'):
        if key in m: keep_images.add(gltf['textures'][m[key]['index']]['source'])

# --- se reconstruye el bloque binario: primero lo que no son imágenes, luego las imágenes en JPG ---
image_views = {img['bufferView'] for img in gltf['images']}
out = bytearray()
new_views = []
remap = {}
for i, bv in enumerate(gltf['bufferViews']):
    if i in image_views:
        continue
    chunk = binary[bv.get('byteOffset', 0):bv.get('byteOffset', 0) + bv['byteLength']]
    while len(out) % 4: out.append(0)
    nb = dict(bv); nb['byteOffset'] = len(out)
    out += chunk
    remap[i] = len(new_views); new_views.append(nb)

new_images, image_remap = [], {}
for i, img in enumerate(gltf['images']):
    if i not in keep_images:
        continue
    bv = gltf['bufferViews'][img['bufferView']]
    raw = binary[bv.get('byteOffset', 0):bv.get('byteOffset', 0) + bv['byteLength']]
    im = Image.open(io.BytesIO(raw)).convert('RGB')
    buf = io.BytesIO(); im.save(buf, 'JPEG', quality=86, optimize=True)
    jpg = buf.getvalue()
    while len(out) % 4: out.append(0)
    new_views.append({'buffer': 0, 'byteOffset': len(out), 'byteLength': len(jpg)})
    out += jpg
    image_remap[i] = len(new_images)
    new_images.append({'bufferView': len(new_views) - 1, 'mimeType': 'image/jpeg'})
    print(f'imagen {i}: {len(raw) // 1024} KB PNG -> {len(jpg) // 1024} KB JPG')
while len(out) % 4: out.append(0)

# texturas: solo las de imágenes que quedan
new_textures, tex_remap = [], {}
for i, t in enumerate(gltf['textures']):
    if t['source'] in image_remap:
        tex_remap[i] = len(new_textures)
        new_textures.append({**t, 'source': image_remap[t['source']]})
for m in gltf['materials']:
    pbr = m.get('pbrMetallicRoughness', {})
    if 'baseColorTexture' in pbr: pbr['baseColorTexture']['index'] = tex_remap[pbr['baseColorTexture']['index']]
    for key in ('normalTexture', 'emissiveTexture'):
        if key in m: m[key]['index'] = tex_remap[m[key]['index']]

for acc in gltf['accessors']:
    if 'bufferView' in acc: acc['bufferView'] = remap[acc['bufferView']]
gltf['bufferViews'] = new_views
gltf['images'] = new_images
gltf['textures'] = new_textures
gltf['buffers'] = [{'byteLength': len(out)}]

js = json.dumps(gltf, separators=(',', ':')).encode()
while len(js) % 4: js += b' '
glb = struct.pack('<III', 0x46546C67, 2, 12 + 8 + len(js) + 8 + len(out))
glb += struct.pack('<II', len(js), 0x4E4F534A) + js
glb += struct.pack('<II', len(out), 0x004E4942) + bytes(out)
open(dst, 'wb').write(glb)
print(f'{dst}: {len(glb) // 1024} KB (antes {len(data) // 1024} KB)')
