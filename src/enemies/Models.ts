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

/** Droide B2: más alto y corpulento que el B1, con coraza y un cañón en la muñeca. */
export function b2Geometry() {
  if (b2) return b2;
  const BODY = 0x6e6b5f, DARK = 0x45443f, PLATE = 0x8a8678;
  b2 = assemble([
    box(0.15, 0.95, 0.16, -0.18, 0.47, 0, DARK), // piernas
    box(0.15, 0.95, 0.16, 0.18, 0.47, 0, DARK),
    box(0.5, 0.2, 0.3, 0, 1.0, 0, BODY), // cadera
    box(0.56, 0.75, 0.34, 0, 1.5, 0, BODY), // torso
    box(0.42, 0.34, 0.08, 0, 1.55, -0.2, PLATE), // placa del pecho
    box(0.24, 0.22, 0.3, -0.4, 1.82, 0, PLATE), // hombreras
    box(0.24, 0.22, 0.3, 0.4, 1.82, 0, PLATE),
    box(0.13, 0.62, 0.13, -0.4, 1.4, -0.12, DARK, [0.5, 0, 0]), // brazos
    box(0.13, 0.62, 0.13, 0.4, 1.4, -0.12, DARK, [0.5, 0, 0]),
    box(0.16, 0.16, 0.5, 0.4, 1.22, -0.5, 0x2b2b2e), // cañón de la muñeca
    box(0.3, 0.42, 0.14, 0, 1.55, 0.26, DARK), // mochila
    box(0.2, 0.2, 0.26, 0, 2.05, -0.02, DARK), // cabeza
    box(0.1, 0.06, 0.06, 0, 2.06, -0.17, 0xb03a1e), // visor
  ]);
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
