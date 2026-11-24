import * as THREE from 'three';

// Lectura de los archivos de modelo de los droides (b1.bin / b2.bin), generados con tools/convert-b1.mjs y tools/convert-b2.mjs.
// Formato: 4 letras («B1M1» / «B2M1»), tamaño de la cabecera, cabecera JSON (huesos y niveles de detalle) y los datos (índices, posiciones,
// normales, colores, hueso y coordenadas de textura de cada vértice). Cada vértice pertenece a un solo hueso.

export interface ModelBone { name: string; parent: number; pivot: [number, number, number] }
export interface ModelFile { bones: ModelBone[]; lods: THREE.BufferGeometry[]; /** Nombre del archivo de textura (atlas), si el modelo lo lleva. */ atlas?: string }

export function parseModelFile(buf: ArrayBuffer, magic: string): ModelFile {
  const dv = new DataView(buf);
  const got = String.fromCharCode(dv.getUint8(0), dv.getUint8(1), dv.getUint8(2), dv.getUint8(3));
  if (got !== magic) throw new Error('archivo de modelo no válido');
  const jsonLen = dv.getUint32(4, true);
  const meta = JSON.parse(new TextDecoder().decode(new Uint8Array(buf, 8, jsonLen)));
  const base = 8 + jsonLen + ((4 - ((8 + jsonLen) % 4)) % 4);
  const lods = meta.lods.map((l: { verts: number; indices: number; index: number; pos: number; nor: number; col: number; bone: number; uv?: number; colTex?: number }) => {
    const g = new THREE.BufferGeometry();
    g.setIndex(new THREE.BufferAttribute(new Uint16Array(buf.slice(base + l.index, base + l.index + l.indices * 2)), 1));
    g.setAttribute('position', new THREE.BufferAttribute(new Float32Array(buf.slice(base + l.pos, base + l.pos + l.verts * 12)), 3));
    g.setAttribute('normal', new THREE.BufferAttribute(new Int8Array(buf.slice(base + l.nor, base + l.nor + l.verts * 3)), 3, true));
    g.setAttribute('color', new THREE.BufferAttribute(new Uint8Array(buf.slice(base + l.col, base + l.col + l.verts * 3)), 3, true));
    if (l.uv !== undefined) g.setAttribute('uv', new THREE.BufferAttribute(new Uint16Array(buf.slice(base + l.uv, base + l.uv + l.verts * 4)), 2, true));
    // color para cuando hay textura (solo sombreado en las piezas con imagen); se usa si el atlas se carga
    if (l.colTex !== undefined) g.userData.colTex = new Uint8Array(buf.slice(base + l.colTex, base + l.colTex + l.verts * 3));
    const bones = new Uint8Array(buf.slice(base + l.bone, base + l.bone + l.verts));
    const si = new Uint16Array(l.verts * 4), sw = new Float32Array(l.verts * 4);
    for (let i = 0; i < l.verts; i++) { si[i * 4] = bones[i]; sw[i * 4] = 1; }
    g.setAttribute('skinIndex', new THREE.BufferAttribute(si, 4));
    g.setAttribute('skinWeight', new THREE.BufferAttribute(sw, 4));
    g.computeBoundingSphere();
    return g;
  });
  return { bones: meta.bones, lods, atlas: meta.atlas };
}
