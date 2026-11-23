import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';

export const DROID_HEIGHT = 1.9;

let cached: THREE.BufferGeometry | null = null;

/** Droide de combate B1 (modelo provisional hecho con cajas), fundido en una sola pieza. */
export function b1Geometry(): THREE.BufferGeometry {
  if (cached) return cached;
  const parts: THREE.BufferGeometry[] = [];
  const box = (w: number, h: number, d: number, x: number, y: number, z: number, color: number, rx = 0) => {
    const g = new THREE.BoxGeometry(w, h, d).toNonIndexed();
    g.deleteAttribute('uv');
    g.rotateX(rx);
    g.translate(x, y, z);
    const c = new THREE.Color(color);
    const arr = new Float32Array(g.attributes.position.count * 3);
    for (let i = 0; i < arr.length; i += 3) { arr[i] = c.r; arr[i + 1] = c.g; arr[i + 2] = c.b; }
    g.setAttribute('color', new THREE.BufferAttribute(arr, 3));
    parts.push(g);
  };
  const TAN = 0xc9b48c, DARK = 0x4a4540, GUN = 0x2d2d30;
  box(0.09, 0.85, 0.09, -0.13, 0.43, 0, TAN); // piernas
  box(0.09, 0.85, 0.09, 0.13, 0.43, 0, TAN);
  box(0.34, 0.14, 0.16, 0, 0.9, 0, DARK); // cadera
  box(0.3, 0.5, 0.18, 0, 1.2, 0, TAN); // torso
  box(0.26, 0.4, 0.12, 0, 1.25, 0.14, DARK); // mochila
  box(0.07, 0.6, 0.07, -0.23, 1.15, -0.08, TAN, 0.5); // brazos
  box(0.07, 0.6, 0.07, 0.23, 1.15, -0.08, TAN, 0.5);
  box(0.06, 0.06, 0.5, 0.12, 1.0, -0.42, GUN); // bláster
  box(0.06, 0.22, 0.06, 0, 1.55, 0, TAN); // cuello
  box(0.13, 0.13, 0.42, 0, 1.72, -0.1, TAN, 0.35); // cabeza alargada
  cached = mergeGeometries(parts, false)!;
  for (const p of parts) p.dispose();
  return cached;
}
