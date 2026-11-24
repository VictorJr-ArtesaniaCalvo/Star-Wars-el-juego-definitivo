import * as THREE from 'three';
import { Builder, place } from './builder';
import { makeRng, terrainHeight, WRECK } from './terrain';

const HULL = 0xb9aa8c; // casco crema
const CORE = 0x7c766e;
const DARK = 0x3d3834;
const SCORCH = 0x2a221d;

/** Puntos donde arde fuego en los restos (para los destellos y el humo). */
export const WRECK_FIRES: Array<{ x: number; y: number; z: number; size: number }> = [];

/**
 * Nave droide estrellada (modelo provisional): un gran anillo medio enterrado, como una puerta rota,
 * con la esfera central caída dentro y restos alrededor. Está al fondo del cañón, tras la grieta:
 * se ve desde tu posición pero no se puede llegar.
 */
export function buildDroidWreck(b: Builder) {
  WRECK_FIRES.length = 0;
  const gh = terrainHeight(WRECK.x, WRECK.z);
  const root = (x: number, y: number, z: number, ry = 0, rx = 0, rz = 0, sc = new THREE.Vector3(1, 1, 1)) =>
    new THREE.Matrix4()
      .makeRotationY(WRECK.yaw)
      .setPosition(WRECK.x, gh, WRECK.z)
      .multiply(place(x, y, z, ry, rx, rz, sc));

  // Anillo (arco abierto por abajo, hincado en el suelo)
  b.addDecor(new THREE.TorusGeometry(30, 4.6, 8, 36, Math.PI * 1.35), root(0, 13, 0, 0, 0, -0.55), HULL, 1);
  // Nervios del anillo
  b.addDecor(new THREE.TorusGeometry(30, 5.1, 4, 36, Math.PI * 1.35), root(0, 13, 0.2, 0, 0, -0.55, new THREE.Vector3(1, 1, 0.28)), DARK, 1);
  // Esfera central, caída y medio enterrada
  b.addDecor(new THREE.SphereGeometry(10, 10, 8), root(5, 6, 4, 0.5, 0.2, 0.15, new THREE.Vector3(1, 0.88, 1)), CORE, 1);
  b.addDecor(new THREE.CylinderGeometry(2.2, 2.2, 22, 7), root(-6, 9, -4, 0, 0.1, 1.2), DARK, 1); // varilla de antena rota
  // Radios que unían la esfera con el anillo, rotos y tirados
  for (const [x, y, z, ry, rz, len] of [[-14, 3, 2, 0.2, 0.25, 18], [14, 5, -8, 2.5, -0.35, 16], [-4, 2, 14, 1.4, 0.15, 14]] as const) {
    b.addDecor(new THREE.BoxGeometry(len, 2.4, 2.6), root(x, y, z, ry, 0, rz), CORE, 0.9);
  }

  // Restos esparcidos: placas, bloques y tubos quemados
  const rng = makeRng(909);
  const range = (a: number, c: number) => a + rng() * (c - a);
  for (let i = 0; i < 40; i++) {
    const a = range(0, Math.PI * 2), r = range(12, 46);
    const x = WRECK.x + Math.cos(a) * r, z = WRECK.z + Math.sin(a) * r * 0.8;
    const y = terrainHeight(x, z);
    const k = rng();
    if (k < 0.5) {
      b.addDecor(new THREE.BoxGeometry(range(2, 6), range(0.3, 0.6), range(1.6, 4)), place(x, y + 0.3, z, range(0, 3), range(-0.3, 0.3), range(-0.3, 0.3)), k < 0.25 ? HULL : SCORCH, range(0.7, 1));
    } else if (k < 0.8) {
      const s = range(1.5, 4);
      b.addDecor(new THREE.BoxGeometry(s, s * range(0.5, 1), s * range(0.7, 1.3)), place(x, y + s * 0.3, z, range(0, 3), range(-0.3, 0.3), 0), CORE, range(0.6, 1));
    } else {
      b.addDecor(new THREE.CylinderGeometry(0.4, 0.4, range(5, 12), 5), place(x, y + 0.6, z, range(0, 3), 0, Math.PI / 2 + range(-0.3, 0.3)), DARK, 1);
    }
  }

  // Dónde hay fuego
  const toWorld = (x: number, y: number, z: number) => {
    const v = new THREE.Vector3(x, y, z).applyMatrix4(new THREE.Matrix4().makeRotationY(WRECK.yaw));
    return { x: WRECK.x + v.x, y: gh + v.y, z: WRECK.z + v.z, size: 0 };
  };
  for (const [x, y, z, size] of [[5, 8, 4, 9], [-27, 6, 0, 6], [24, 8, 2, 7], [-12, 2, 10, 5]] as const) {
    const w = toWorld(x, y, z);
    w.size = size;
    WRECK_FIRES.push(w);
  }
}
