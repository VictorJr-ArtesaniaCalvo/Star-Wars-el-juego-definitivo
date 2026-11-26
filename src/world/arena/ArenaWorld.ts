import * as THREE from 'three';
import type RAPIER from '@dimforge/rapier3d-compat';
import type { Obstacle } from '../rocks';
import { TUNNEL_DEPTH } from '../zone';
import { buildArena, buildArenaSteps, type ArenaBuild } from './arena';
import { ARENA_A, ARENA_B, COVERS, DOOR, DOORS, PILLAR, PILLARS, floorHeight, ovalPoint } from './layout';

// LA ARENA EN EL JUEGO: la monta (dibujo), le pone cuerpos sólidos (suelo, muro, túneles de las puertas, pilares y coberturas)
// y prepara la lista de coberturas que usan los droides. El cañón ya se ha borrado antes de llamar aquí.

export interface ArenaWorld { group: THREE.Group; obstacles: Obstacle[]; triangles: number; buildMs: number }

const yawQuat = (yaw: number) => ({ x: 0, y: Math.sin(yaw / 2), z: 0, w: Math.cos(yaw / 2) });

export function buildArenaWorld(scene: THREE.Scene, rapier: typeof RAPIER, physics: RAPIER.World): ArenaWorld {
  const t0 = performance.now();
  const built = buildArena();
  scene.add(built.group);
  const obstacles = addArenaPhysics(built.group, rapier, physics);
  return { group: built.group, obstacles, triangles: built.triangles, buildMs: performance.now() - t0 };
}

/**
 * Prepara la arena (solo el dibujo) poco a poco, imagen a imagen, sin pasarse de `budgetMs` milisegundos cada vez.
 * La usa la cinemática de paso: mientras se ve el cañón, la arena se va montando escondida.
 */
export class ArenaPrep {
  private it = buildArenaSteps();
  private built: ArenaBuild | null = null;
  /** Tiempo de trabajo de verdad (ms) y número de imágenes que ha usado. */
  workMs = 0;
  frames = 0;

  get done() { return !!this.built; }
  get result() { return this.built; }

  /** Avanza hasta gastar `budgetMs` (o acabar). */
  step(budgetMs: number) {
    if (this.built) return true;
    const t0 = performance.now();
    this.frames++;
    while (performance.now() - t0 < budgetMs) {
      const r = this.it.next();
      if (r.done) { this.built = r.value; for (const o of this.built.group.children) o.castShadow = false; break; }
    }
    this.workMs += performance.now() - t0;
    return !!this.built;
  }

  /** Acaba de golpe lo que falte (si la cinemática llega a la cortinilla antes de tiempo, en un móvil lento). */
  finishNow() {
    while (!this.step(1e9)) { /* nada */ }
    return this.built!;
  }
}

/** Cuerpos sólidos de la arena (suelo, muro, túneles, pilares y coberturas) y su lista de coberturas para los droides. */
export function addArenaPhysics(group: THREE.Group, rapier: typeof RAPIER, physics: RAPIER.World): Obstacle[] {
  for (const o of group.children) o.castShadow = false; // sus sombras ya van pintadas (las de los droides sí se ven encima)

  const fixed = (desc: RAPIER.ColliderDesc) => physics.createCollider(desc);
  // suelo (con el surco de impacto): la misma forma que se dibuja
  const floor = group.getObjectByName('floor') as THREE.Mesh;
  const fg = floor.geometry;
  fixed(rapier.ColliderDesc.trimesh(new Float32Array(fg.attributes.position.array), new Uint32Array(fg.index!.array)));
  // suelo plano más allá (bajo el muro y en los túneles)
  fixed(rapier.ColliderDesc.cuboid(ARENA_A + 30, 0.5, ARENA_B + 30).setTranslation(0, -0.5, 0));

  // muro alrededor del suelo: tramos rectos altos (no se puede saltar), con los huecos de las puertas
  const N = 120;
  for (let i = 0; i < N; i++) {
    const t0a = (i / N) * Math.PI * 2, t1a = ((i + 1) / N) * Math.PI * 2;
    const [x0, z0] = ovalPoint(t0a, 0.5), [x1, z1] = ovalPoint(t1a, 0.5);
    const cx = (x0 + x1) / 2, cz = (z0 + z1) / 2, len = Math.hypot(x1 - x0, z1 - z0);
    const inDoor = DOORS.some((d) => {
      const s = (cx - d.x) * d.out[0] + (cz - d.z) * d.out[1];
      const lat = Math.abs(-(cx - d.x) * d.out[1] + (cz - d.z) * d.out[0]);
      return Math.abs(s) < 3 && lat < DOOR.width / 2 - 0.1;
    });
    if (inDoor) continue;
    const yaw = Math.atan2(-(z1 - z0), x1 - x0); // el lado largo del bloque, a lo largo del borde
    fixed(rapier.ColliderDesc.cuboid(len / 2 + 0.25, 4, 0.6).setTranslation(cx, 4, cz).setRotation(yawQuat(yaw)));
  }

  // túneles de las puertas: paredes a los lados y al fondo
  for (const d of DOORS) {
    const yaw = Math.atan2(d.out[0], d.out[1]);
    const at = (s: number, lat: number) => [d.x + d.out[0] * s - d.out[1] * lat, d.z + d.out[1] * s + d.out[0] * lat] as const;
    for (const side of [-1, 1]) {
      const [x, z] = at(TUNNEL_DEPTH / 2, side * (DOOR.width / 2 + 0.5));
      fixed(rapier.ColliderDesc.cuboid(0.5, 4.5, TUNNEL_DEPTH / 2 + 1).setTranslation(x, 4.5, z).setRotation(yawQuat(yaw)));
      // jambas del marco
      const [jx, jz] = at(-0.4, side * (DOOR.width / 2 + 0.9));
      fixed(rapier.ColliderDesc.cuboid(0.9, 4.5, 0.8).setTranslation(jx, 4.5, jz).setRotation(yawQuat(yaw)));
    }
    const [ex, ez] = at(TUNNEL_DEPTH + 0.5, 0);
    fixed(rapier.ColliderDesc.cuboid(DOOR.width / 2 + 1, 4.5, 0.5).setTranslation(ex, 4.5, ez).setRotation(yawQuat(yaw)));
  }

  // pilares
  for (const p of PILLARS) fixed(rapier.ColliderDesc.cylinder(PILLAR.height / 2 + 0.3, PILLAR.radius * 1.1).setTranslation(p.x, PILLAR.height / 2, p.z));

  // coberturas (con la forma aproximada de lo que se dibuja) y su lista para los droides
  const obstacles: Obstacle[] = [];
  const local = (c: { x: number; z: number; rot: number }, lx: number, lz: number) => {
    const co = Math.cos(c.rot), si = Math.sin(c.rot);
    return [c.x + lx * co + lz * si, c.z - lx * si + lz * co] as const;
  };
  for (const c of COVERS) {
    const y0 = floorHeight(c.x, c.z);
    if (c.kind === 'roca') {
      fixed(rapier.ColliderDesc.cuboid(2.0, 1.1, 1.5).setTranslation(c.x, y0 + 0.9, c.z).setRotation(yawQuat(c.rot)));
      const [bx, bz] = local(c, 1.9, 1.1);
      fixed(rapier.ColliderDesc.cuboid(1.0, 0.65, 0.9).setTranslation(bx, y0 + 0.55, bz).setRotation(yawQuat(c.rot)));
      obstacles.push({ x: c.x, z: c.z, radius: 2.2, height: 1.9 }, { x: bx, z: bz, radius: 1.1, height: 1.2 });
    } else if (c.kind === 'chapa') {
      fixed(rapier.ColliderDesc.cuboid(1.5, 0.7, 1.0).setTranslation(c.x, y0 + 0.65, c.z).setRotation(yawQuat(c.rot)));
      obstacles.push({ x: c.x, z: c.z, radius: 1.6, height: 1.4 });
    } else if (c.kind === 'monticulo') {
      obstacles.push({ x: c.x, z: c.z, radius: 2.4, height: 1.1 }); // el montón de arena ya es parte del suelo
    }
  }
  for (const p of PILLARS) obstacles.push({ x: p.x, z: p.z, radius: 0.75, height: PILLAR.height });
  return obstacles;
}
