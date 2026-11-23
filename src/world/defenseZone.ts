import * as THREE from 'three';
import { Builder, place } from './builder';

// Zona a defender: centrada en (0,0), suelo llano. Los enemigos llegarán desde -Z.
// Todas las coberturas bajas miden ~1,15 m: de pie asomas, agachado quedas cubierto.
export const SPAWN = { x: -2.5, z: 3.2 };
export const COVER_HEIGHT = 1.15;

const WHITE = 0xd9d6cc;
const RED = 0xa32b20;
const GREY = 0x6d6b68;
const DARK = 0x2b2b2e;
const GLASS = 0x2f5548;
const CRATE = 0x5d6b5a;
const BARRICADE = 0x8a8f96;

/** Cañonera de la República derribada (modelo provisional hecho con cajas). */
function gunship(b: Builder) {
  // Colocación general: de costado frente al enemigo, algo hundida y ladeada.
  const root = place(0.3, -0.35, -1.9, 0.16, -0.17, 0.03, new THREE.Vector3(1.15, 1.15, 1.15));
  const part = (size: [number, number, number], x: number, y: number, z: number, color: number, rz = 0, ry = 0, solid = true) =>
    b.addBox(size, root.clone().multiply(place(x, y, z, ry, 0, rz)), color, solid);

  part([7.4, 2.3, 2.6], 0, 1.25, 0, WHITE); // cuerpo
  part([3.2, 0.5, 2.68], 1.2, 2.05, 0, RED, 0, 0, false); // franja roja
  part([3.4, 1.5, 2.66], -0.3, 1.1, 0, DARK, 0, 0, false); // hueco de la bodega
  part([2.2, 1.5, 1.7], 4.7, 1.2, 0, WHITE); // morro
  part([1.0, 0.5, 1.72], 5.0, 0.7, 0, RED, 0, 0, false);
  part([1.3, 0.8, 1.1], 4.5, 2.25, 0, GLASS); // cabina
  part([1.0, 0.7, 0.9], 3.2, 2.75, 0, GLASS); // cabina trasera
  part([4.6, 0.8, 1.5], -1.3, 2.75, 0, GREY); // motores superiores
  part([3.8, 0.7, 0.8], -5.4, 2.15, 0, WHITE, -0.14); // cola
  part([1.3, 1.7, 0.2], -7.0, 3.0, 0, RED, -0.3); // deriva
  part([2.3, 0.25, 5.4], -0.4, 2.55, -4.0, WHITE); // ala entera (lado enemigo, cae hasta el suelo)
  part([2.3, 0.25, 1.3], -0.4, 2.55, 1.95, WHITE); // ala rota (muñón)
  part([0.9, 0.9, 0.9], -0.4, 2.2, -6.2, GREY); // torreta del ala
}

export function buildDefenseZone(b: Builder) {
  gunship(b);
  const H = COVER_HEIGHT;

  // Trozo de ala arrancado, apoyado en el suelo a la derecha
  b.addBox([3.2, 0.25, 1.8], place(10.4, 0.55, 1.6, 0.5, 0.55, 0), WHITE);

  // Barricadas en los flancos (mirando al enemigo)
  b.addBox([2.6, H, 0.45], place(-7.4, H / 2, -2.4, 0.28), BARRICADE);
  b.addBox([2.6, H, 0.45], place(8.9, H / 2, -1.9, -0.3), BARRICADE);
  b.addBox([2.2, H, 0.45], place(-9.4, H / 2, 0.6, 1.15), BARRICADE);

  // Cajas de suministros
  b.addBox([1.1, H, 1.1], place(-4.6, H / 2, 0.7, 0.2), CRATE);
  b.addBox([1.6, H, 1.0], place(6.4, H / 2, 1.6, -0.15), CRATE);
  b.addBox([1.0, 0.8, 1.0], place(6.5, 0.4, 2.8, 0.4), CRATE);
  b.addBox([1.4, H, 1.0], place(0.8, H / 2, 4.6, 0.1), CRATE);
  b.addBox([0.9, 0.9, 0.9], place(-0.5, 0.45, 4.9, 0.7), CRATE);

}
