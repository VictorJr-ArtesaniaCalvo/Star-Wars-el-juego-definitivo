import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';

// Brazos del jugador sujetando el bláster (armadura clon: antebrazos blancos con guantes negros). Se dibujan en el sistema del arma:
// +x derecha, +y arriba, −z hacia el cañón. La mano derecha agarra el mango (atrás y abajo) y la izquierda la empuñadura frontal
// (la barra horizontal bajo el cañón). Todo son cajas y cilindros con color por vértice, unidos en una sola malla (una llamada de dibujo).
export type ArmsVariant = 'A' | 'B';

const WHITE = new THREE.Color(0x9ea3aa), GREY = new THREE.Color(0x5e6269), BLACK = new THREE.Color(0x15161a), SUIT = new THREE.Color(0x24272c); // tonos medios: la luz cálida los aclara

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

/** Matriz que lleva un bloque desde el origen a la línea p0→p1 (el eje largo del bloque, y, se alinea con la línea). */
function along(p0: [number, number, number], p1: [number, number, number], t: number, roll = 0) {
  const a = new THREE.Vector3(...p0), b = new THREE.Vector3(...p1), d = b.clone().sub(a);
  const q = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), d.clone().normalize());
  q.multiply(new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), roll));
  return { pos: a.clone().addScaledVector(d, t), q, len: d.length() };
}
/** Bloque (placa, pieza) colocado sobre una línea: sx × sy × sz en sus ejes (sy a lo largo del brazo), a la fracción t y con un desplazamiento lateral. */
function plate(p0: [number, number, number], p1: [number, number, number], t: number, sx: number, sy: number, sz: number, off: [number, number, number], c: THREE.Color, roll = 0, bevel = 0) {
  const { pos, q } = along(p0, p1, t, roll);
  // placa de 8 caras (cilindro achatado) si hay bisel, caja si no
  const g = (bevel ? new THREE.CylinderGeometry(0.5, 0.5, 1, 6).toNonIndexed() : new THREE.BoxGeometry(1, 1, 1).toNonIndexed());
  g.scale(sx, sy, sz);
  g.translate(off[0], off[1], off[2]);
  g.applyMatrix4(new THREE.Matrix4().compose(pos, q, new THREE.Vector3(1, 1, 1)));
  return paint(g, c);
}

/** Brazo de armadura clon visto desde dentro: manga negra gruesa, vambrazo blanco con placas y una banda, codera con relieve, muñeca y guante. */
function forearm(wrist: [number, number, number], elbow: [number, number, number], _side: 1 | -1) {
  const p: THREE.BufferGeometry[] = [];
  const R = 0.082; // radio del antebrazo (en medidas del arma): ancho como el de un brazo real visto a 40 cm
  p.push(limb(wrist, lerp3(wrist, elbow, 0.2), R * 0.62, R * 0.8, BLACK, 8)); // muñeca y guante largo
  p.push(limb(lerp3(wrist, elbow, 0.14), elbow, R * 0.86, R * 1.02, SUIT, 8)); // manga del traje, gruesa (se asoma bajo las placas)
  // vambrazo: la placa blanca cubre casi todo el antebrazo (de arriba y de los lados), con una banda gris en el medio y reborde junto a la muñeca
  const body = limb(lerp3(wrist, elbow, 0.2), lerp3(wrist, elbow, 0.9), R * 1.12, R * 1.3, WHITE, 8);
  p.push(body);
  p.push(limb(lerp3(wrist, elbow, 0.2), lerp3(wrist, elbow, 0.27), R * 1.18, R * 1.18, GREY, 8)); // reborde junto a la muñeca
  p.push(limb(lerp3(wrist, elbow, 0.5), lerp3(wrist, elbow, 0.58), R * 1.22, R * 1.24, GREY, 8)); // banda
  p.push(plate(wrist, elbow, 0.55, R * 0.7, 0.45, R * 0.35, [0, 0, R * 1.2], BLACK)); // línea negra de la placa (detalle)
  // codera: casquete redondeado blanco con borde oscuro
  p.push(limb(lerp3(wrist, elbow, 0.9), lerp3(wrist, elbow, 1.02), R * 1.4, R * 1.5, WHITE, 8));
  p.push(limb(lerp3(wrist, elbow, 1.02), lerp3(wrist, elbow, 1.08), R * 1.45, R * 0.9, GREY, 8));
  return p;
}

/** Mano derecha: puño cerrado sobre el mango, con dedos separados, nudillos reforzados y el índice estirado sobre el gatillo. */
function rightHand() {
  const p: THREE.BufferGeometry[] = [];
  p.push(box(0.095, 0.13, 0.11, 0.018, -0.18, 0.215, BLACK)); // palma y dorso
  p.push(box(0.09, 0.035, 0.1, 0.018, -0.115, 0.218, GREY)); // refuerzo de los nudillos
  for (let i = 0; i < 3; i++) {
    p.push(box(0.085, 0.032, 0.05, 0.016, -0.155 - i * 0.04, 0.148, BLACK)); // dedos rodeando el frente del mango
    p.push(box(0.085, 0.012, 0.012, 0.016, -0.155 - i * 0.04, 0.123, GREY)); // nudillo de cada dedo
  }
  p.push(box(0.03, 0.03, 0.12, 0.05, -0.112, 0.085, BLACK)); // índice sobre el gatillo
  p.push(box(0.03, 0.034, 0.1, -0.05, -0.15, 0.195, BLACK, 0.3, 0, 0.2)); // pulgar
  return p;
}
/** Mano izquierda: palma debajo de la barra frontal, cuatro dedos que la rodean por un lado y el pulgar por el otro. */
function leftHand() {
  const p: THREE.BufferGeometry[] = [];
  p.push(box(0.12, 0.055, 0.13, 0.0, -0.195, -0.25, BLACK)); // palma
  p.push(box(0.105, 0.03, 0.045, 0.0, -0.165, -0.19, GREY)); // refuerzo del dorso
  for (let i = 0; i < 4; i++) {
    p.push(box(0.034, 0.1, 0.026, 0.07, -0.15, -0.325 + i * 0.034, BLACK)); // dedos que suben por el lado derecho de la barra
    p.push(box(0.04, 0.02, 0.028, 0.07, -0.098, -0.325 + i * 0.034, BLACK)); // punta de cada dedo sobre la barra
  }
  p.push(box(0.03, 0.09, 0.04, -0.07, -0.15, -0.215, BLACK)); // pulgar por el otro lado
  return p;
}

const hash = (x: number, y: number, z: number) => { const v = Math.sin(x * 127.1 + y * 311.7 + z * 74.7) * 43758.5453; return v - Math.floor(v); };
const noise = (x: number, y: number, z: number, f: number) => {
  const X = x * f, Y = y * f, Z = z * f, ix = Math.floor(X), iy = Math.floor(Y), iz = Math.floor(Z);
  const fx = X - ix, fy = Y - iy, fz = Z - iz, u = fx * fx * (3 - 2 * fx), v = fy * fy * (3 - 2 * fy), w = fz * fz * (3 - 2 * fz);
  const l = (a: number, b: number, t: number) => a + (b - a) * t;
  return l(l(l(hash(ix, iy, iz), hash(ix + 1, iy, iz), u), l(hash(ix, iy + 1, iz), hash(ix + 1, iy + 1, iz), u), v), l(l(hash(ix, iy, iz + 1), hash(ix + 1, iy, iz + 1), u), l(hash(ix, iy + 1, iz + 1), hash(ix + 1, iy + 1, iz + 1), u), v), w);
};

/** Suciedad de combate en el color de cada vértice: arena roja de Geonosis (más hacia abajo y en las zonas bajas del brazo), manchas de quemadura negras
 *  y un desgaste suave general. Así las piezas blancas dejan de verse limpias. */
function weather(g: THREE.BufferGeometry) {
  const p = g.attributes.position, c = g.attributes.color;
  const sand = new THREE.Color(0x9a5636), soot = new THREE.Color(0x0e0c0b), col = new THREE.Color();
  for (let i = 0; i < p.count; i++) {
    const x = p.getX(i), y = p.getY(i), z = p.getZ(i);
    col.setRGB(c.getX(i), c.getY(i), c.getZ(i));
    const grain = noise(x, y, z, 22);
    const patch = noise(x + 3.1, y, z - 1.7, 6);
    // arena roja: acumulada hacia abajo y hacia delante (donde se hace más contacto), en manchas y con grano fino
    const low = THREE.MathUtils.smoothstep(-y, 0.18, 0.55);
    const dust = Math.min(0.78, THREE.MathUtils.smoothstep(patch * 0.65 + low * 0.6 + grain * 0.25, 0.42, 0.95) * 0.85);
    col.lerp(sand, dust);
    // quemaduras negras: manchas irregulares sueltas
    const burn = THREE.MathUtils.smoothstep(noise(x - 2.3, y + 1.1, z + 4.2, 8) * 0.7 + noise(x, y, z, 30) * 0.3, 0.6, 0.78) * 0.85;
    col.lerp(soot, burn);
    col.multiplyScalar(0.82 + 0.3 * grain); // desgaste fino
    c.setXYZ(i, col.r, col.g, col.b);
  }
}

/** Los dos brazos del arma. `A`: antebrazos que entran desde las esquinas de abajo (como en Battlefront). `B`: más juntos y verticales, el izquierdo por debajo del arma (como en Halo/CoD). */
export function buildArms(variant: ArmsVariant): THREE.Mesh {
  const parts: THREE.BufferGeometry[] = [];
  parts.push(...rightHand(), ...leftHand());
  if (variant === 'A') {
    parts.push(...forearm([0.03, -0.215, 0.27], [0.2, -0.56, 0.7], 1));
    parts.push(...forearm([0.0, -0.225, -0.2], [-0.3, -0.58, 0.28], -1));
  } else {
    parts.push(...forearm([0.03, -0.215, 0.27], [0.09, -0.52, 0.6], 1));
    parts.push(...forearm([0.0, -0.225, -0.2], [-0.08, -0.5, 0.34], -1));
  }
  const g = mergeGeometries(parts, false)!;
  for (const x of parts) x.dispose();
  g.computeVertexNormals();
  weather(g);
  const m = new THREE.Mesh(g, new THREE.MeshLambertMaterial({ vertexColors: true, fog: false }));
  m.frustumCulled = false;
  return m;
}
