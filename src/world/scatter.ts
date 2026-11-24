import * as THREE from 'three';
import { CANYON_HALF_L, CANYON_HALF_W, crashField, makeRng, terrainHeight } from './terrain';
import { applyWorldTextures, groundExtraTexture, groundTexture, pitsTexture, rockJointsTexture, rockTexture, slabRockTexture, slabsTexture, strataTexture } from './materials';
import type RAPIER from '@dimforge/rapier3d-compat';
import type { Quality } from '../core/Settings';
import { withLightFloor } from './lightFill';
import { bakeSunShadow, shadeColor, sunShadow } from './sunShadow';

// Decoración del suelo de Geonosis, solo en calidad media y alta (en baja no se dibuja nada de esto):
//  · Lajas de piedra planas e irregulares con la textura de Rock 029, esparcidas por el suelo (más junto a rocas y paredes, menos en los caminos),
//    algunas medio enterradas. Se reúnen por zonas en piezas grandes (muy ligeras para el móvil) y no tienen cuerpo sólido: ni frenan al jugador ni a los droides.
//  · Piedrecitas diminutas solo alrededor del jugador, que se recolocan al moverse.

const SLAB_COLORS = [0xa8603a, 0x93502f, 0xb87040, 0x7d4429, 0x9c5a38].map((c) => new THREE.Color(c));
const PEBBLE_COLORS = [0x8a5a3c, 0x6e4630, 0x9b6a48, 0x5a3d2c, 0xa07650].map((c) => new THREE.Color(c));
const smooth = (a: number, b: number, v: number) => { const t = Math.min(1, Math.max(0, (v - a) / (b - a))); return t * t * (3 - 2 * t); };

/**
 * Piedra plana de contorno irregular (de 7 a 9 lados), con la cara de arriba algo facetada. Mide rx × rz de radio y `thick` de grueso.
 * Sin cara inferior (queda siempre contra el suelo). Devuelve una malla sin índices con normales planas.
 */
export function slabGeometry(rnd: () => number, rx: number, rz: number, thick: number): THREE.BufferGeometry {
  const n = 7 + Math.floor(rnd() * 3);
  const ring: Array<[number, number]> = [];
  const rot = rnd() * Math.PI * 2;
  for (let i = 0; i < n; i++) {
    const a = rot + ((i + (rnd() - 0.5) * 0.5) / n) * Math.PI * 2;
    const k = 0.72 + rnd() * 0.38;
    ring.push([Math.cos(a) * rx * k, Math.sin(a) * rz * k]);
  }
  const top = ring.map(([x, z]) => new THREE.Vector3(x, thick * (0.9 + rnd() * 0.2), z));
  const bot = ring.map(([x, z]) => new THREE.Vector3(x * 0.88, 0, z * 0.88));
  const centre = new THREE.Vector3((rnd() - 0.5) * rx * 0.2, thick * (1.0 + rnd() * 0.25), (rnd() - 0.5) * rz * 0.2);
  const p: number[] = [];
  const tri = (a: THREE.Vector3, b: THREE.Vector3, c: THREE.Vector3) => p.push(a.x, a.y, a.z, b.x, b.y, b.z, c.x, c.y, c.z);
  for (let i = 0; i < n; i++) {
    const j = (i + 1) % n;
    // el contorno recorre el plano XZ en sentido horario visto desde arriba: se ordena para que las caras miren hacia fuera
    tri(centre, top[j], top[i]);
    tri(top[i], top[j], bot[j]);
    tri(top[i], bot[j], bot[i]);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(p, 3));
  g.computeVertexNormals();
  return g;
}

/** Material de las lajas: la roca de Rock 029 vista desde arriba (brillo y relieve) multiplicada por el color de cada laja. */
function slabMaterial(): THREE.MeshLambertMaterial {
  const mat = new THREE.MeshLambertMaterial({ vertexColors: true });
  const tex = slabRockTexture();
  if (!tex) return mat;
  mat.onBeforeCompile = (shader) => {
    shader.uniforms.slabMap = { value: tex };
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\nvarying vec3 vWPos;')
      .replace('#include <begin_vertex>', '#include <begin_vertex>\nvWPos = (modelMatrix * vec4(position, 1.0)).xyz;');
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', '#include <common>\nvarying vec3 vWPos;\nuniform sampler2D slabMap;')
      .replace('#include <map_fragment>', `
  vec4 sm = texture2D(slabMap, vWPos.xz * 0.8);
  diffuseColor.rgb *= sm.b * 1.35;`)
      .replace('#include <normal_fragment_maps>', `#include <normal_fragment_maps>
  normal = normalize(normal + (viewMatrix * vec4((sm.r * 2.0 - 1.0) * 0.5, 0.0, (sm.g * 2.0 - 1.0) * 0.5, 0.0)).xyz * (1.0 - smoothstep(15.0, 60.0, length(vViewPosition))));`);
  };
  mat.customProgramCacheKey = () => 'slabs1';
  return withLightFloor(mat);
}

interface Chunk {
  mesh: THREE.Mesh;
  /** vértices acumulados tras cada laja (para dibujar solo las primeras según la calidad) */
  offsets: number[];
}

export class Scatter {
  private chunks: Chunk[] = [];
  private pebbles: THREE.InstancedMesh;
  private pebR = 0;
  private pebCenter = new THREE.Vector2(1e9, 1e9);
  private frac = 0;
  private on = false;
  private tmp = new THREE.Object3D();
  private col = new THREE.Color();

  constructor(private scene: THREE.Scene, spots: Array<{ x: number; z: number; r: number }>) {
    this.buildSlabs(spots);
    const pg = new THREE.IcosahedronGeometry(1, 0);
    const pm = new THREE.MeshLambertMaterial({ flatShading: true });
    this.pebbles = new THREE.InstancedMesh(pg, pm, 1400);
    this.pebbles.count = 0;
    this.pebbles.frustumCulled = false;
    this.pebbles.visible = false;
    scene.add(this.pebbles);
  }

  /** Reparte las lajas por todo el suelo del cañón: más cerca de las coberturas y de las paredes, menos por los caminos. */
  private buildSlabs(spots: Array<{ x: number; z: number; r: number }>) {
    const rng = makeRng(20241);
    const range = (a: number, b: number) => a + rng() * (b - a);
    const CELL = 40, HW = CANYON_HALF_W + 3, HL = CANYON_HALF_L;
    // las coberturas se guardan por celdas para consultar rápido las cercanas
    const grid = new Map<string, Array<{ x: number; z: number; r: number }>>();
    for (const s of spots) { const k = `${Math.floor(s.x / 12)},${Math.floor(s.z / 12)}`; (grid.get(k) ?? grid.set(k, []).get(k)!).push(s); }
    const near = (x: number, z: number) => {
      let m = 0;
      const cx = Math.floor(x / 12), cz = Math.floor(z / 12);
      for (let i = -1; i <= 1; i++) for (let j = -1; j <= 1; j++) for (const s of grid.get(`${cx + i},${cz + j}`) ?? []) {
        m = Math.max(m, 1 - smooth(s.r * 0.6, s.r * 1.7 + 3, Math.hypot(x - s.x, z - s.z)));
      }
      return m;
    };
    const target = 1400;
    const perChunk = new Map<string, THREE.BufferGeometry[]>();
    const pos = new THREE.Vector3(), q = new THREE.Quaternion(), e = new THREE.Euler(), m4 = new THREE.Matrix4(), up = new THREE.Vector3(0, 1, 0), nrm = new THREE.Vector3();
    for (let n = 0, tries = 0; n < target && tries < target * 12; tries++) {
      const x = range(-HW, HW), z = range(-HL, HL);
      if (Math.hypot(x + 2.5, z - 3.2) < 2.5 || crashField(x, z).h < -0.5) continue;
      const wall = smooth(20, 38, Math.abs(x));
      const p = 0.1 + 0.85 * near(x, z) + 0.45 * wall;
      if (rng() > p) continue;
      const big = rng() < 0.12;
      const rx = big ? range(0.9, 1.5) : range(0.3, 0.75), rz = rx * range(0.6, 1);
      const thick = range(0.05, 0.16) * (big ? 1.4 : 1);
      const g = slabGeometry(rng, rx, rz, thick);
      // apoyada en el suelo (siguiendo la pendiente), con un giro al azar; algunas se inclinan más y otras quedan medio enterradas
      const h = terrainHeight(x, z);
      const hx = terrainHeight(x + 0.4, z) - terrainHeight(x - 0.4, z), hz = terrainHeight(x, z + 0.4) - terrainHeight(x, z - 0.4);
      nrm.set(-hx, 0.8, -hz).normalize();
      q.setFromUnitVectors(up, nrm);
      const lean = rng() < 0.25 ? range(0.15, 0.4) : range(0, 0.1);
      e.set((rng() - 0.5) * 2 * lean, range(0, Math.PI * 2), (rng() - 0.5) * 2 * lean, 'YXZ');
      q.multiply(new THREE.Quaternion().setFromEuler(e));
      const sink = rng() < 0.35 ? range(0.3, 0.75) * thick : -0.01;
      pos.set(x, h - sink, z);
      m4.compose(pos, q, new THREE.Vector3(1, 1, 1));
      g.applyMatrix4(m4);
      const c = this.col.copy(SLAB_COLORS[Math.floor(rng() * SLAB_COLORS.length)]).multiplyScalar(range(0.8, 1.15));
      const cols = new Float32Array(g.attributes.position.count * 3);
      for (let i = 0; i < cols.length; i += 3) { cols[i] = c.r; cols[i + 1] = c.g; cols[i + 2] = c.b; }
      g.setAttribute('color', new THREE.BufferAttribute(cols, 3));
      const key = `${Math.floor(x / CELL)},${Math.floor(z / CELL)}`;
      (perChunk.get(key) ?? perChunk.set(key, []).get(key)!).push(g);
      n++;
    }
    const mat = slabMaterial();
    for (const geos of perChunk.values()) {
      let total = 0;
      for (const g of geos) total += g.attributes.position.count;
      const P = new Float32Array(total * 3), N = new Float32Array(total * 3), C = new Float32Array(total * 3);
      const offsets: number[] = [0];
      let o = 0;
      for (const g of geos) {
        P.set(g.attributes.position.array as Float32Array, o * 3); N.set(g.attributes.normal.array as Float32Array, o * 3); C.set(g.attributes.color.array as Float32Array, o * 3);
        o += g.attributes.position.count; offsets.push(o);
        g.dispose();
      }
      const geo = new THREE.BufferGeometry();
      geo.setAttribute('position', new THREE.BufferAttribute(P, 3));
      geo.setAttribute('normal', new THREE.BufferAttribute(N, 3));
      geo.setAttribute('color', new THREE.BufferAttribute(C, 3));
      geo.computeBoundingSphere();
      bakeSunShadow(geo);
      const mesh = new THREE.Mesh(geo, mat);
      mesh.receiveShadow = true;
      mesh.visible = false;
      this.scene.add(mesh);
      this.chunks.push({ mesh, offsets });
    }
  }

  setQuality(q: Quality) {
    // baja: nada · media: unas 4 de cada 10 lajas y piedrecitas cerca · alta: todas, con más piedrecitas
    this.on = q !== 'low';
    this.frac = q === 'low' ? 0 : q === 'medium' ? 0.4 : 1;
    this.pebR = q === 'low' ? 0 : q === 'medium' ? 11 : 17;
    for (const c of this.chunks) {
      const n = c.offsets.length - 1, k = Math.floor(n * this.frac);
      c.mesh.visible = this.on && k > 0;
      c.mesh.geometry.setDrawRange(0, c.offsets[k]);
    }
    this.pebbles.visible = this.on;
    this.pebCenter.set(1e9, 1e9); // recolocar en el siguiente movimiento
  }

  /** Posición del jugador: las piedrecitas se recolocan a su alrededor cuando se ha movido unos metros. */
  follow(p: THREE.Vector3) {
    if (!this.on || this.pebR === 0) return;
    if (Math.hypot(p.x - this.pebCenter.x, p.z - this.pebCenter.y) < 2.5) return;
    this.pebCenter.set(p.x, p.z);
    const R = this.pebR, CELL = 1.25;
    let n = 0;
    const max = this.pebbles.instanceMatrix.count;
    const cx0 = Math.floor((p.x - R) / CELL), cx1 = Math.floor((p.x + R) / CELL), cz0 = Math.floor((p.z - R) / CELL), cz1 = Math.floor((p.z + R) / CELL);
    for (let cx = cx0; cx <= cx1 && n < max; cx++) {
      for (let cz = cz0; cz <= cz1 && n < max; cz++) {
        // cada celda tiene siempre las mismas piedrecitas (se calculan a partir de su posición)
        const rnd = makeRng((cx * 73856093) ^ (cz * 19349663));
        if (rnd() > 0.7) continue;
        const x = (cx + rnd()) * CELL, z = (cz + rnd()) * CELL;
        const d = Math.hypot(x - p.x, z - p.z);
        if (d > R || Math.abs(x) > CANYON_HALF_W + 3 || Math.abs(z) > CANYON_HALF_L) continue;
        if (crashField(x, z).h < -0.5) continue;
        const s = (0.04 + rnd() * rnd() * 0.12) * smooth(R, R * 0.7, d); // las del borde del círculo se encogen
        if (s < 0.02) continue;
        this.tmp.position.set(x, terrainHeight(x, z) + s * 0.25, z);
        this.tmp.rotation.set(rnd() * 3, rnd() * 6.28, rnd() * 3);
        this.tmp.scale.set(s * (0.8 + rnd() * 0.6), s * (0.45 + rnd() * 0.3), s * (0.8 + rnd() * 0.6));
        this.tmp.updateMatrix();
        this.pebbles.setMatrixAt(n, this.tmp.matrix);
        this.col.copy(PEBBLE_COLORS[Math.floor(rnd() * PEBBLE_COLORS.length)]).multiplyScalar(0.8 + rnd() * 0.4);
        shadeColor(sunShadow(x, this.tmp.position.y, z), this.col);
        this.pebbles.setColorAt(n, this.col);
        n++;
      }
    }
    this.pebbles.count = n;
    this.pebbles.instanceMatrix.needsUpdate = true;
    if (this.pebbles.instanceColor) this.pebbles.instanceColor.needsUpdate = true;
  }
}


const LEDGE_COLORS = [0xa84a2a, 0xc2693c, 0x8a3a22, 0xb85a32, 0x74301c].map((c) => new THREE.Color(c));

/**
 * Repisas de roca: pilas de 2 a 4 capas planas e irregulares, cada una más pequeña que la de abajo, como los escalones de las paredes del cañón.
 * Sirven de cobertura baja o media. Solo existen en calidad media y alta (en baja se quitan con su colisión, y el mapa queda como estaba).
 */
export class Ledges {
  private mesh: THREE.Mesh;
  private colliders: RAPIER.Collider[] = [];

  constructor(scene: THREE.Scene, rapier: typeof RAPIER, physics: RAPIER.World, count = 10) {
    const rng = makeRng(777001);
    const range = (a: number, b: number) => a + rng() * (b - a);
    const P: number[] = [], N: number[] = [], C: number[] = [];
    const placed: Array<[number, number]> = [];
    const q = new THREE.Quaternion(), e = new THREE.Euler(), m4 = new THREE.Matrix4(), one = new THREE.Vector3(1, 1, 1), col = new THREE.Color();
    for (let n = 0, tries = 0; n < count && tries < 400; tries++) {
      const nearWall = rng() < 0.6;
      const x = nearWall ? (rng() < 0.5 ? -1 : 1) * range(22, CANYON_HALF_W - 3) : range(-CANYON_HALF_W + 6, CANYON_HALF_W - 6);
      const z = range(-CANYON_HALF_L + 8, CANYON_HALF_L - 8);
      if (Math.hypot(x + 2.5, z - 3.2) < 20 || crashField(x, z).h < -0.25) continue;
      if (placed.some(([px, pz]) => Math.hypot(px - x, pz - z) < 14)) continue;
      placed.push([x, z]);
      const yaw = range(0, Math.PI * 2);
      const layers = 2 + Math.floor(rng() * 3);
      let rx = range(2.4, 4.2), y = terrainHeight(x, z) - 0.3, ox = 0, oz = 0;
      for (let k = 0; k < layers; k++) {
        const thick = range(0.38, 0.65);
        const g = slabGeometry(rng, rx, rx * range(0.6, 0.9), thick);
        e.set((rng() - 0.5) * 0.06, yaw + (rng() - 0.5) * 0.5, (rng() - 0.5) * 0.06, 'YXZ');
        q.setFromEuler(e);
        m4.compose(new THREE.Vector3(x + ox, y, z + oz), q, one);
        g.applyMatrix4(m4);
        const gp = g.attributes.position.array as Float32Array;
        const desc = rapier.ColliderDesc.convexHull(new Float32Array(gp));
        if (desc) this.colliders.push(physics.createCollider(desc));
        col.copy(LEDGE_COLORS[Math.floor(rng() * LEDGE_COLORS.length)]).multiplyScalar(range(0.85, 1.1));
        for (let i = 0; i < gp.length; i += 3) C.push(col.r, col.g, col.b);
        for (const v of gp) P.push(v);
        for (const v of g.attributes.normal.array as Float32Array) N.push(v);
        g.dispose();
        y += thick * 0.8; rx *= range(0.62, 0.85); ox += range(-0.5, 0.5); oz += range(-0.5, 0.5);
      }
      n++;
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.Float32BufferAttribute(P, 3));
    geo.setAttribute('normal', new THREE.Float32BufferAttribute(N, 3));
    geo.setAttribute('color', new THREE.Float32BufferAttribute(C, 3));
    const cnt = P.length / 3;
    geo.setAttribute('texAmt', new THREE.BufferAttribute(new Float32Array(cnt).fill(1), 1));
    geo.setAttribute('texKind', new THREE.BufferAttribute(new Float32Array(cnt), 1));
    geo.computeBoundingSphere();
    bakeSunShadow(geo);
    // mismo material que las rocas del cañón (arenisca en capas)
    const mat = applyWorldTextures(new THREE.MeshLambertMaterial({ vertexColors: true, flatShading: true }), { ground: groundTexture(), groundX: groundExtraTexture(), slabs: slabsTexture(), strata: strataTexture(), pits: pitsTexture(), spire: { rock: rockTexture(), joints: rockJointsTexture() }, rockOnly: true, strataScale: 0.2 });
    this.mesh = new THREE.Mesh(geo, mat);
    this.mesh.castShadow = true;
    this.mesh.receiveShadow = true;
    this.mesh.visible = false;
    scene.add(this.mesh);
    for (const c of this.colliders) c.setEnabled(false);
  }

  setQuality(q: Quality) {
    const on = q !== 'low';
    this.mesh.visible = on;
    for (const c of this.colliders) c.setEnabled(on);
  }
}
