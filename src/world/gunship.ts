import * as THREE from 'three';
import { Builder, place } from './builder';
import { CRASH, terrainHeight } from './terrain';

// Cañonera de la República (LAAT) estrellada, hecha con formas sencillas a partir de las imágenes de referencia:
// fuselaje crema con franjas granates, morro con cabina y torreta con cañones, bahía lateral abierta, dos tubos de
// cañones sobre el techo, motores redondos atrás, alas largas hacia atrás con torretas de burbuja y dos esferas de artillero.
// Marco local: +X = morro, +Y = arriba, ±Z = lados (alas). Está hundida en el cráter, ladeada hacia el lado enemigo (-Z).

const HULL = 0xc7c8ba, SHADE = 0xa9ada0, RED = 0x74262e, DARK = 0x2e312f, VENT = 0x1b1d1c;
const GLASS = 0x46696c, TRIM = 0xdcdbcf, METAL = 0x5a5e5c, SCORCH = 0x24201d, ORANGE = 0xc98a2a;

/** Puntos donde arde fuego en la nave (para los destellos). */
export const GUNSHIP_FIRES: Array<{ x: number; y: number; z: number; size: number }> = [];

export function buildGunship(b: Builder) {
  GUNSHIP_FIRES.length = 0;
  const gh = terrainHeight(CRASH.x, CRASH.z);
  // hundida en el cráter, ladeada hacia el enemigo y con el morro algo bajo
  // (a escala 0,8 y alejada del jugador, que empieza a unos 5 m: la nave real es grande, pero aquí debe dejar sitio)
  const root = place(CRASH.x, gh + 0.45, CRASH.z - 1.2, CRASH.yaw, -0.12, -0.05, new THREE.Vector3(0.8, 0.8, 0.8));
  const at = (x: number, y: number, z: number, ry = 0, rx = 0, rz = 0) => root.clone().multiply(place(x, y, z, ry, rx, rz));

  const box = (size: [number, number, number], x: number, y: number, z: number, color: number, o: { solid?: boolean; ry?: number; rx?: number; rz?: number } = {}) =>
    b.addBox(size, at(x, y, z, o.ry, o.rx, o.rz), color, o.solid ?? false);
  const solid = (size: [number, number, number], x: number, y: number, z: number, color: number, o: { ry?: number; rx?: number; rz?: number } = {}) =>
    box(size, x, y, z, color, { ...o, solid: true });
  const cylX = (r: number, len: number, x: number, y: number, z: number, color: number) =>
    b.addDecor(new THREE.CylinderGeometry(r, r, len, 12), at(x, y, z, 0, 0, Math.PI / 2), color);
  const cylZ = (r: number, len: number, x: number, y: number, z: number, color: number) =>
    b.addDecor(new THREE.CylinderGeometry(r, r, len, 12), at(x, y, z, 0, Math.PI / 2, 0), color);
  const ball = (r: number, x: number, y: number, z: number, color: number, sy = 1) =>
    b.addDecor(new THREE.SphereGeometry(r, 12, 9), root.clone().multiply(place(x, y, z, 0, 0, 0, new THREE.Vector3(1, sy, 1))), color);

  // ---------- Fuselaje (lo que da cobertura) ----------
  solid([11.6, 2.2, 3.7], 0, 1.1, 0, HULL); // casco inferior
  solid([2.4, 1.8, 3.0], 6.2, 1.05, 0, HULL); // morro
  solid([1.0, 1.2, 2.4], 7.3, 0.8, 0, SHADE); // «barbilla» bajo el morro
  solid([6.2, 1.5, 3.5], -2.6, 2.95, 0, HULL); // cubierta trasera, más alta
  solid([3.0, 1.1, 3.2], 1.9, 2.75, 0, HULL); // tramo central
  solid([1.6, 2.8, 3.0], -6.5, 1.6, 0, METAL); // cola en cuña
  box([4.4, 0.3, 2.7], 4.9, 2.55, 0, GLASS, { rz: -0.29 }); // cabina inclinada
  box([4.5, 0.12, 0.32], 4.9, 2.72, 1.3, RED, { rz: -0.29 }); // marco granate de la cabina
  box([4.5, 0.12, 0.32], 4.9, 2.72, -1.3, RED, { rz: -0.29 });
  box([0.25, 0.5, 2.8], 3.1, 3.15, 0, RED); // arco de la cabina

  // Franjas granates y detalles de los costados
  for (const s of [-1, 1]) {
    box([11.6, 0.22, 0.06], 0, 0.8, s * 1.87, RED);
    box([6.2, 0.18, 0.06], -2.6, 3.4, s * 1.78, RED);
    box([3.4, 1.7, 0.12], 0.9, 1.45, s * 1.86, DARK); // bahía abierta
    box([3.7, 0.16, 0.22], 0.9, 2.36, s * 1.92, TRIM); // marco de la bahía
    box([0.16, 1.7, 0.22], -0.85, 1.45, s * 1.92, TRIM);
    box([0.16, 1.7, 0.22], 2.65, 1.45, s * 1.92, TRIM);
    box([0.2, 1.3, 0.05], 3.9, 1.45, s * 1.86, SHADE); // paneles
    cylZ(0.42, 0.06, 2.4, 3.0, s * 1.77, METAL); // escudo de la República
  }
  box([6.2, 0.06, 0.9], -2.6, 3.72, 0, RED); // banda del techo
  box([0.12, 1.4, 0.8], -7.36, 1.6, 0.6, VENT); // rejillas del motor trasero
  box([0.12, 1.4, 0.8], -7.36, 1.6, -0.6, VENT);

  // Torreta bajo el morro con cañones largos y finos
  ball(0.62, 6.9, 0.45, 0, SHADE, 0.8);
  box([2.6, 0.08, 0.08], 8.6, 0.55, 0.22, DARK);
  box([2.6, 0.08, 0.08], 8.6, 0.55, -0.22, DARK);

  // ---------- Tubos de cañones del techo (granate y blanco) ----------
  for (const s of [-1, 1]) {
    const broken = s > 0; // el del lado del jugador está roto
    const bands = broken ? 3 : 6;
    let x = -5.1;
    for (let i = 0; i < bands; i++) {
      const len = i % 2 === 0 ? 1.15 : 0.95;
      cylX(0.4, len, x + len / 2, 4.45, s * 1.05, i % 2 === 0 ? TRIM : RED);
      x += len;
    }
    if (!broken) cylX(0.2, 2.0, x + 1.0, 4.45, s * 1.05, DARK); // boca del cañón
    box([1.4, 0.8, 0.5], -1.0, 4.0, s * 1.05, SHADE);
    cylX(0.6, 1.3, -6.0, 4.15, s * 1.55, DARK); // motores redondos
    cylX(0.66, 0.2, -5.4, 4.15, s * 1.55, TRIM);
    cylX(0.44, 0.4, -6.75, 4.15, s * 1.55, VENT);
  }
  // Tubo arrancado, caído al suelo del lado del jugador
  b.addDecor(new THREE.CylinderGeometry(0.4, 0.4, 3.2, 12), at(1.2, 0.3, 6.0, 0.5, 0, Math.PI / 2), TRIM);
  b.addDecor(new THREE.CylinderGeometry(0.4, 0.4, 1.0, 12), at(2.8, 0.3, 6.5, 0.5, 0, Math.PI / 2), RED);

  // ---------- Alas ----------
  const wing = (sign: number, length: number, droop: number, broken: boolean) => {
    const M = at(-3.2, 3.25, sign * 1.75, -0.5 * sign, droop * sign, 0);
    const wmat = (x: number, y: number, z: number) => M.clone().multiply(place(x, y, z));
    b.addBox([3.4, 0.2, length], wmat(-0.9, 0, sign * length / 2), HULL, true);
    b.addBox([1.5, 0.215, Math.min(length, 2.6)], wmat(-0.15, 0, sign * Math.min(length, 2.6) / 2), RED, false);
    if (!broken) {
      b.addBox([3.4, 0.215, 0.8], wmat(-0.9, 0, sign * (length - 0.4)), RED, false); // punta granate
      b.addBox([3.0, 0.1, 0.5], wmat(-1.0, -0.14, sign * (length - 2.4)), VENT, false); // rejillas bajo el ala
      b.addDecor(new THREE.SphereGeometry(0.5, 10, 8), wmat(-0.3, -0.45, sign * (length - 1.2)), SHADE); // torreta de la punta
    } else {
      b.addBox([0.9, 0.2, 0.7], wmat(-2.0, 0.12, sign * (length + 0.25)), SHADE, false); // borde roto
    }
  };
  wing(-1, 7.4, 0.2, false); // ala entera, hacia el enemigo: apoya la punta en el suelo
  wing(1, 1.6, 0.0, true); // muñón del ala rota, hacia el jugador

  // ---------- Esferas de los artilleros ----------
  // Lado enemigo: intacta, colgada de su brazo y hundida en el suelo
  box([0.14, 0.14, 1.4], 3.0, 1.35, -2.45, METAL);
  ball(0.78, 3.0, 1.15, -3.25, GLASS);
  b.addDecor(new THREE.TorusGeometry(0.8, 0.045, 6, 18), at(3.0, 1.15, -3.25, 0, Math.PI / 2, 0), TRIM);
  // Lado del jugador: arrancada, caída en el suelo
  ball(0.78, 4.6, 0.35, 4.2, GLASS, 0.9);
  b.addDecor(new THREE.TorusGeometry(0.8, 0.045, 6, 18), at(4.6, 0.35, 4.2, 0.5, 0.6, 0), TRIM);
  box([0.14, 0.14, 1.2], 3.0, 1.2, 2.45, METAL, { rx: 0.5 }); // brazo doblado

  // ---------- Daños del choque ----------
  box([2.0, 0.05, 1.4], -3.2, 3.73, 0.4, VENT); // agujero en la cubierta
  box([1.6, 0.04, 1.2], -0.9, 3.72, -0.5, SCORCH); // quemaduras
  box([1.2, 0.04, 1.6], 1.4, 3.3, 0.2, SCORCH);
  box([1.4, 0.08, 0.9], -4.3, 3.95, -0.7, TRIM, { rz: 0.4, ry: 0.5 }); // planchas levantadas
  box([0.9, 0.08, 0.7], -2.2, 4.0, 1.2, SHADE, { rz: -0.35, ry: -0.4 });
  box([0.6, 0.06, 1.1], 5.6, 1.75, 0.5, SCORCH); // morro chamuscado

  for (const [x, y, z, size] of [[-6.2, 3.7, -1.2, 5], [-3.2, 3.95, 0.4, 3.5], [-5.9, 3.4, 1.4, 4]] as const) {
    const p = new THREE.Vector3(x, y, z).applyMatrix4(root);
    GUNSHIP_FIRES.push({ x: p.x, y: p.y, z: p.z, size });
  }
  void ORANGE;
}
