import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';

// Modelos provisionales (hechos con formas sencillas) de los droides B2 y droideka.

type Part = { geo: THREE.BufferGeometry; color: number; at?: [number, number, number]; rot?: [number, number, number] };

function assemble(parts: Part[]): THREE.BufferGeometry {
  const geos: THREE.BufferGeometry[] = [];
  for (const p of parts) {
    const g = p.geo.index ? p.geo.toNonIndexed() : p.geo.clone();
    if (p.rot) g.applyMatrix4(new THREE.Matrix4().makeRotationFromEuler(new THREE.Euler(p.rot[0], p.rot[1], p.rot[2])));
    if (p.at) g.translate(p.at[0], p.at[1], p.at[2]);
    g.deleteAttribute('uv');
    g.computeVertexNormals();
    const c = new THREE.Color(p.color);
    const arr = new Float32Array(g.attributes.position.count * 3);
    for (let i = 0; i < arr.length; i += 3) { arr[i] = c.r; arr[i + 1] = c.g; arr[i + 2] = c.b; }
    g.setAttribute('color', new THREE.BufferAttribute(arr, 3));
    geos.push(g);
  }
  const merged = mergeGeometries(geos, false)!;
  for (const g of geos) g.dispose();
  return merged;
}

const box = (w: number, h: number, d: number, x: number, y: number, z: number, color: number, rot?: [number, number, number]): Part => ({
  geo: new THREE.BoxGeometry(w, h, d), color, at: [x, y, z], rot,
});

let b2: THREE.BufferGeometry | null = null;
let ball: THREE.BufferGeometry | null = null;
let deployed: THREE.BufferGeometry | null = null;

/**
 * Droide B2 (super droide de batalla): hombros muy anchos con coraza, cintura estrecha con el «corsé» de láminas,
 * caderas con cilindros horizontales, piernas largas y finas con discos en las rodillas, brazos largos que cuelgan
 * hasta el muslo (el derecho lleva el cañón) y sin cabeza propia: una cúpula pequeña con el ojo rojo. Mira hacia -Z.
 */
export function b2Geometry() {
  if (b2) return b2;
  const GUN = 0x6c737a, PLATE = 0xa2a9ae, DARK = 0x363a3f, EYE = 0xd8281a, CANNON = 0x1f2124;
  const cyl = (r: number, len: number, x: number, y: number, z: number, color: number, axis: 'x' | 'y' | 'z' = 'x', seg = 10): Part => ({
    geo: new THREE.CylinderGeometry(r, r, len, seg), color, at: [x, y, z],
    rot: axis === 'x' ? [0, 0, Math.PI / 2] : axis === 'z' ? [Math.PI / 2, 0, 0] : undefined,
  });
  const parts: Part[] = [];
  for (const sd of [-1, 1]) {
    parts.push(box(0.2, 0.09, 0.34, 0.2 * sd, 0.045, -0.05, DARK)); // pies
    parts.push(box(0.12, 0.62, 0.15, 0.2 * sd, 0.4, 0.0, GUN)); // piernas (espinillas)
    parts.push(cyl(0.11, 0.05, 0.28 * sd, 0.72, 0, PLATE)); // discos de las rodillas
    parts.push(box(0.14, 0.58, 0.17, 0.2 * sd, 1.02, 0.0, GUN)); // muslos
    parts.push(box(0.26, 0.3, 0.34, 0.52 * sd, 2.0, 0.0, PLATE)); // hombros blindados
    parts.push(box(0.15, 0.5, 0.17, 0.56 * sd, 1.66, 0.0, GUN)); // brazos
    parts.push(cyl(0.1, 0.07, 0.62 * sd, 1.38, 0, DARK)); // codos
  }
  parts.push(cyl(0.11, 0.74, 0, 1.3, 0, DARK)); // eje de la cadera (cilindro horizontal)
  parts.push(box(0.3, 0.2, 0.2, 0, 1.27, 0.02, GUN)); // cadera
  parts.push({ geo: new THREE.CylinderGeometry(0.3, 0.16, 0.38, 10), color: DARK, at: [0, 1.52, 0], rot: undefined }); // cintura con láminas
  parts.push(box(0.8, 0.5, 0.44, 0, 1.9, 0, GUN)); // pecho ancho
  parts.push(box(0.5, 0.32, 0.07, 0, 1.9, -0.24, PLATE)); // placa en V
  parts.push(box(0.3, 0.12, 0.08, 0, 1.74, -0.25, PLATE));
  parts.push({ geo: new THREE.SphereGeometry(0.17, 10, 8), color: GUN, at: [0, 2.2, -0.04] }); // cúpula (la «cabeza»)
  parts.push(box(0.06, 0.06, 0.05, 0.1, 2.2, -0.2, EYE)); // ojo rojo
  parts.push(box(0.36, 0.3, 0.14, 0, 1.95, 0.27, DARK)); // espalda
  // Antebrazo izquierdo colgando y mano
  parts.push(box(0.13, 0.5, 0.15, -0.62, 1.08, 0.0, GUN));
  parts.push(box(0.14, 0.14, 0.12, -0.62, 0.78, 0.0, DARK));
  // Brazo derecho: el antebrazo apunta hacia delante con el cañón
  parts.push(box(0.13, 0.13, 0.5, 0.62, 1.34, -0.3, GUN));
  parts.push(box(0.18, 0.18, 0.34, 0.62, 1.34, -0.7, CANNON));
  parts.push(box(0.05, 0.05, 0.22, 0.62, 1.34, -0.95, CANNON));
  b2 = assemble(parts);
  return b2;
}

/** Droideka rodando: una bola blindada. */
export function droidekaBallGeometry() {
  if (ball) return ball;
  ball = assemble([
    // Centrada en el origen: el modelo gira sobre el centro de la bola (se coloca a 0,5 m del suelo).
    { geo: new THREE.SphereGeometry(0.5, 12, 9), color: 0x7a6a50 },
    { geo: new THREE.TorusGeometry(0.5, 0.06, 6, 16), color: 0x3a3228 },
    { geo: new THREE.TorusGeometry(0.5, 0.06, 6, 16), color: 0x3a3228, rot: [Math.PI / 2, 0, 0] },
    { geo: new THREE.TorusGeometry(0.5, 0.06, 6, 16), color: 0x3a3228, rot: [0, Math.PI / 2, 0] },
  ]);
  return ball;
}

/** Droideka desplegado: tres patas y dos cañones, listo para disparar bajo su escudo. */
export function droidekaDeployedGeometry() {
  if (deployed) return deployed;
  const BODY = 0x7a6a50, DARK = 0x3a3228, GUN = 0x2b2b2e;
  deployed = assemble([
    box(0.5, 0.45, 0.5, 0, 0.78, 0, BODY), // cuerpo
    box(0.24, 0.16, 0.24, 0, 1.12, -0.04, DARK), // sensor
    box(0.12, 0.8, 0.12, 0, 0.4, 0.42, DARK, [0.55, 0, 0]), // pata trasera
    box(0.12, 0.8, 0.12, -0.36, 0.4, -0.18, DARK, [-0.25, 0, 0.5]), // patas delanteras
    box(0.12, 0.8, 0.12, 0.36, 0.4, -0.18, DARK, [-0.25, 0, -0.5]),
    box(0.14, 0.14, 0.8, -0.3, 0.86, -0.5, GUN), // cañones
    box(0.14, 0.14, 0.8, 0.3, 0.86, -0.5, GUN),
  ]);
  return deployed;
}
