import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';

// Brazos del jugador sujetando el bláster (armadura clon: antebrazos blancos con guantes negros). Se dibujan en el sistema del arma:
// +x derecha, +y arriba, −z hacia el cañón. La mano derecha agarra el mango (atrás y abajo) y la izquierda la empuñadura frontal
// (la barra horizontal bajo el cañón). Todo son cajas y cilindros con color por vértice, unidos en una sola malla (una llamada de dibujo).
export type ArmsVariant = 'A' | 'B';

const WHITE = new THREE.Color(0xd2d5d9), GREY = new THREE.Color(0x8c9096), BLACK = new THREE.Color(0x1a1b1e), SUIT = new THREE.Color(0x2c2f34);

function paint(g: THREE.BufferGeometry, c: THREE.Color): THREE.BufferGeometry {
  const n = g.attributes.position.count, col = new Float32Array(n * 3);
  for (let i = 0; i < n; i++) col.set([c.r, c.g, c.b], i * 3);
  g.setAttribute('color', new THREE.BufferAttribute(col, 3));
  g.deleteAttribute('uv');
  return g;
}
const box = (w: number, h: number, d: number, x: number, y: number, z: number, c: THREE.Color, rx = 0, ry = 0, rz = 0) => {
  const g = new THREE.BoxGeometry(w, h, d).toNonIndexed();
  g.applyMatrix4(new THREE.Matrix4().makeRotationFromEuler(new THREE.Euler(rx, ry, rz)));
  g.translate(x, y, z);
  return paint(g, c);
};
/** Tubo entre dos puntos, algo más ancho en el segundo (r0 → r1). */
const limb = (p0: [number, number, number], p1: [number, number, number], r0: number, r1: number, c: THREE.Color, sides = 7) => {
  const a = new THREE.Vector3(...p0), b = new THREE.Vector3(...p1), len = a.distanceTo(b);
  const g = new THREE.CylinderGeometry(r1, r0, len, sides).toNonIndexed();
  const q = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), b.clone().sub(a).normalize());
  g.applyMatrix4(new THREE.Matrix4().compose(a.clone().add(b).multiplyScalar(0.5), q, new THREE.Vector3(1, 1, 1)));
  return paint(g, c);
};
const lerp3 = (a: [number, number, number], b: [number, number, number], t: number): [number, number, number] => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];

/** Antebrazo de armadura: puño negro, peto blanco con una banda gris y manga oscura hasta el borde de la pantalla. */
function forearm(wrist: [number, number, number], elbow: [number, number, number]) {
  const p: THREE.BufferGeometry[] = [];
  const t1 = lerp3(wrist, elbow, 0.16), t2 = lerp3(wrist, elbow, 0.62);
  p.push(limb(wrist, t1, 0.03, 0.034, BLACK)); // puño del guante
  p.push(limb(t1, t2, 0.04, 0.048, WHITE)); // placa del antebrazo
  p.push(limb(lerp3(t1, t2, 0.5), lerp3(t1, t2, 0.62), 0.05, 0.05, GREY)); // banda
  p.push(limb(t2, elbow, 0.046, 0.05, SUIT)); // manga bajo la armadura
  return p;
}

/** Mano derecha sobre el mango y el dedo índice a lo largo del guardamano. */
function rightHand() {
  const p: THREE.BufferGeometry[] = [];
  p.push(box(0.075, 0.11, 0.075, 0.018, -0.18, 0.205, BLACK)); // palma, tapando el mango
  for (let i = 0; i < 3; i++) p.push(box(0.07, 0.024, 0.04, 0.012, -0.16 - i * 0.027, 0.15, BLACK)); // dedos rodeando el frente del mango
  p.push(box(0.022, 0.022, 0.085, 0.04, -0.118, 0.085, BLACK)); // índice sobre el gatillo
  p.push(box(0.025, 0.03, 0.075, -0.034, -0.15, 0.2, BLACK, 0.2, 0, 0)); // pulgar
  return p;
}
/** Mano izquierda abrazando la barra frontal desde abajo: la palma debajo y los dedos subiendo por los lados. */
function leftHand() {
  const p: THREE.BufferGeometry[] = [];
  p.push(box(0.09, 0.034, 0.11, 0.0, -0.19, -0.25, BLACK)); // palma bajo la barra
  for (let i = 0; i < 4; i++) p.push(box(0.028, 0.075, 0.021, 0.062, -0.145, -0.31 + i * 0.026, BLACK)); // dedos a la derecha de la barra
  p.push(box(0.026, 0.07, 0.03, -0.062, -0.145, -0.21, BLACK, 0, 0, 0)); // pulgar por el otro lado
  return p;
}

/** Los dos brazos del arma. `A`: antebrazos que entran desde las esquinas de abajo (como en Battlefront). `B`: más juntos y verticales, el izquierdo por debajo del arma (como en Halo/CoD). */
export function buildArms(variant: ArmsVariant): THREE.Mesh {
  const parts: THREE.BufferGeometry[] = [];
  parts.push(...rightHand(), ...leftHand());
  if (variant === 'A') {
    parts.push(...forearm([0.022, -0.2, 0.265], [0.14, -0.55, 0.66]));
    parts.push(...forearm([0.0, -0.205, -0.19], [-0.24, -0.55, 0.2]));
  } else {
    parts.push(...forearm([0.022, -0.2, 0.265], [0.07, -0.5, 0.56]));
    parts.push(...forearm([0.0, -0.205, -0.19], [-0.07, -0.47, 0.3]));
  }
  const g = mergeGeometries(parts, false)!;
  for (const x of parts) x.dispose();
  g.computeVertexNormals();
  const m = new THREE.Mesh(g, new THREE.MeshLambertMaterial({ vertexColors: true, fog: false }));
  m.frustumCulled = false;
  return m;
}
