import * as THREE from 'three';
import { terrainHeight } from './terrain';
import { SUN_DIR } from './sky';

// Sombras del sol sobre el escenario, calculadas UNA vez al cargar y pintadas en el color de cada vértice (no cuestan nada al jugar):
// las paredes del cañón (y el relieve en general) tapan el sol en una parte del suelo y de las rocas, que se ven más oscuras y de un tono
// marrón violáceo, frías, en vez de naranjas. Se mira desde cada punto hacia el sol y se comprueba si el terreno lo tapa.
// Los personajes en movimiento no se ven afectados (en calidad Alta tienen las sombras reales cerca de ti).

const X0 = -84, X1 = 84, Z0 = -150, Z1 = 150, STEP = 2;
const NX = Math.round((X1 - X0) / STEP) + 1, NZ = Math.round((Z1 - Z0) / STEP) + 1;
let grid: Float32Array | null = null;

function ensureGrid() {
  if (grid) return grid;
  grid = new Float32Array(NX * NZ);
  for (let j = 0; j < NZ; j++) for (let i = 0; i < NX; i++) grid[j * NX + i] = terrainHeight(X0 + i * STEP, Z0 + j * STEP);
  return grid;
}
/** Altura del terreno (de la rejilla, con interpolación); null fuera de ella. */
function height(x: number, z: number): number | null {
  if (x < X0 || x > X1 || z < Z0 || z > Z1) return null;
  const g = grid!, fx = (x - X0) / STEP, fz = (z - Z0) / STEP;
  const i = Math.min(NX - 2, Math.floor(fx)), j = Math.min(NZ - 2, Math.floor(fz)), u = fx - i, v = fz - j;
  const a = g[j * NX + i], b = g[j * NX + i + 1], c = g[(j + 1) * NX + i], d = g[(j + 1) * NX + i + 1];
  return a + (b - a) * u + (c - a) * v + (a - b - c + d) * u * v;
}

const HL = Math.hypot(SUN_DIR.x, SUN_DIR.z), HX = SUN_DIR.x / HL, HZ = SUN_DIR.z / HL, TAN = SUN_DIR.y / HL;
const smooth = (a: number, b: number, v: number) => { const t = Math.min(1, Math.max(0, (v - a) / (b - a))); return t * t * (3 - 2 * t); };

/** Cuánta sombra hay en un punto (0 = al sol, 1 = a la sombra). `n`: la cara mira hacia el sol; si no, ya está a oscuras por la luz y no se oscurece dos veces. */
export function sunShadow(x: number, y: number, z: number, nx = 0, ny = 1, nz = 0): number {
  ensureGrid();
  if (nx * SUN_DIR.x + ny * SUN_DIR.y + nz * SUN_DIR.z < 0.08) return 0;
  let worst = -1e9;
  for (let t = 1.5; t < 150; t += 3) {
    const h = height(x + HX * t, z + HZ * t);
    if (h === null) break;
    const e = h - (y + 0.25 + TAN * t);
    if (e > worst) worst = e;
  }
  return smooth(-0.5, 3.5, worst); // el borde de la sombra es suave (unos 4 m)
}

/** Factor de color de una zona a la sombra: oscuro y algo violáceo. */
const SHADE = new THREE.Color(0.46, 0.38, 0.46);
export function shadeColor(s: number, c: THREE.Color) {
  if (s <= 0) return;
  c.r *= 1 + (SHADE.r - 1) * s; c.g *= 1 + (SHADE.g - 1) * s; c.b *= 1 + (SHADE.b - 1) * s;
}

/** Oscurece el color por vértice de una malla estática (en coordenadas del mundo) según la sombra del sol. */
export function bakeSunShadow(g: THREE.BufferGeometry) {
  const p = g.attributes.position, n = g.attributes.normal, c = g.attributes.color;
  if (!p || !c) return;
  const col = new THREE.Color();
  for (let i = 0; i < p.count; i++) {
    const s = sunShadow(p.getX(i), p.getY(i), p.getZ(i), n ? n.getX(i) : 0, n ? n.getY(i) : 1, n ? n.getZ(i) : 0);
    if (s <= 0.001) continue;
    col.setRGB(c.getX(i), c.getY(i), c.getZ(i));
    shadeColor(s, col);
    c.setXYZ(i, col.r, col.g, col.b);
  }
  c.needsUpdate = true;
}
