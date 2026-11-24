import { Builder, place } from './builder';
import { buildGunship } from './gunship';
import { CRASH, crashField, makeRng, terrainHeight } from './terrain';

// Zona a defender: centrada en (0,0). La nave se estrelló en el centro y dejó un cráter.
// Los enemigos llegan desde los dos extremos del cañón (-Z y +Z).
// Todas las coberturas bajas miden ~1,15 m: de pie asomas, agachado quedas cubierto.
export const SPAWN = { x: -2.5, z: 3.2 };
export const COVER_HEIGHT = 1.15;

const WHITE = 0xd9d6cc;
const GREY = 0x6d6b68;
const DARK = 0x2b2b2e;
const CRATE = 0x5d6b5a;
const BARRICADE = 0x8a8f96;

/** Altura del suelo en un punto (el cráter y el relieve hacen que no sea plano). */
const gy = (x: number, z: number) => terrainHeight(x, z);

/** Restos de la nave esparcidos por el cráter y a lo largo del surco que dejó. */
function crashDebris(b: Builder) {
  const rng = makeRng(4242);
  const range = (a: number, c: number) => a + rng() * (c - a);
  const PIECES = [WHITE, WHITE, GREY, DARK, 0x4a4540];
  const cos = Math.cos(CRASH.yaw), sin = Math.sin(CRASH.yaw);
  const ok = (x: number, z: number) => Math.hypot(x - SPAWN.x, z - SPAWN.z) > 2.6;

  // Alrededor de la nave
  for (let n = 0, tries = 0; n < 26 && tries < 200; tries++) {
    const a = range(0, Math.PI * 2), r = range(4.5, 14);
    const x = CRASH.x + Math.cos(a) * r * 1.2, z = CRASH.z + Math.sin(a) * r * 0.8;
    if (!ok(x, z) || crashField(x, z).h < -0.9) continue;
    const kind = rng();
    if (kind < 0.45) {
      // placa de fuselaje, medio enterrada
      const sx = range(0.9, 2.6), sz = range(0.7, 1.7);
      b.addBox([sx, 0.14, sz], place(x, gy(x, z) + range(0.08, 0.35), z, range(0, 3.14), range(-0.35, 0.35), range(-0.35, 0.35)), PIECES[Math.floor(rng() * PIECES.length)], false);
    } else if (kind < 0.75) {
      // pieza maciza (motor, bloque de casco): sirve de cobertura baja
      const s = range(0.6, 1.4), h = range(0.5, 1.1);
      b.addBox([s, h, s * range(0.7, 1.3)], place(x, gy(x, z) + h / 2 - 0.1, z, range(0, 3.14), range(-0.2, 0.2), range(-0.2, 0.2)), PIECES[2 + Math.floor(rng() * 3)]);
    } else {
      // tubo o puntal retorcido
      const l = range(1.8, 3.6);
      b.addBox([0.13, 0.13, l], place(x, gy(x, z) + 0.25, z, range(0, 3.14), range(-0.3, 0.3), 0), DARK, false);
    }
    n++;
  }
  // A lo largo del surco (más escasos conforme se alejan)
  for (let n = 0; n < 12; n++) {
    const back = range(6, 30);
    const lat = range(-3.5, 3.5);
    const x = CRASH.x - back * cos + lat * sin, z = CRASH.z + back * sin + lat * cos;
    if (!ok(x, z)) continue;
    if (rng() < 0.6) {
      b.addBox([range(0.8, 2), 0.14, range(0.6, 1.4)], place(x, gy(x, z) + 0.15, z, range(0, 3.14), range(-0.4, 0.4), range(-0.4, 0.4)), PIECES[Math.floor(rng() * PIECES.length)], false);
    } else {
      const s = range(0.5, 1.0);
      b.addBox([s, s * 0.8, s], place(x, gy(x, z) + s * 0.35, z, range(0, 3.14), range(-0.3, 0.3), 0), GREY);
    }
  }
}

export function buildDefenseZone(b: Builder) {
  buildGunship(b);
  crashDebris(b);
  const H = COVER_HEIGHT;

  // Trozo de ala arrancado, apoyado en el suelo a la derecha
  b.addBox([3.2, 0.25, 1.8], place(10.4, gy(10.4, 1.6) + 0.55, 1.6, 0.5, 0.55, 0), WHITE);

  // Barricadas en los flancos (mirando al enemigo)
  b.addBox([2.6, H, 0.45], place(-8.8, gy(-8.8, -2.9) + H / 2 - 0.1, -2.9, 0.28), BARRICADE);
  b.addBox([2.6, H, 0.45], place(9.8, gy(9.8, -2.2) + H / 2 - 0.1, -2.2, -0.3), BARRICADE);
  b.addBox([2.2, H, 0.45], place(-10.2, gy(-10.2, 0.8) + H / 2 - 0.1, 0.8, 1.15), BARRICADE);

  // Cajas de suministros
  b.addBox([1.1, H, 1.1], place(-4.6, gy(-4.6, 0.7) + H / 2 - 0.1, 0.7, 0.2), CRATE);
  b.addBox([1.6, H, 1.0], place(6.4, gy(6.4, 1.6) + H / 2 - 0.1, 1.6, -0.15), CRATE);
  b.addBox([1.0, 0.8, 1.0], place(6.5, gy(6.5, 2.8) + 0.3, 2.8, 0.4), CRATE);
  b.addBox([1.4, H, 1.0], place(0.8, gy(0.8, 4.6) + H / 2 - 0.1, 4.6, 0.1), CRATE);
  b.addBox([0.9, 0.9, 0.9], place(-0.5, gy(-0.5, 4.9) + 0.35, 4.9, 0.7), CRATE);

}
