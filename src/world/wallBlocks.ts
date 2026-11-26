import * as THREE from 'three';
import { caveKeepOut } from './cave';
import { applyWorldTextures, groundExtraTexture, groundTexture, pitsTexture, rockJointsTexture, rockTexture, slabsTexture, strataTexture } from './materials';
import { CANYON_HALF_L, floorHalfWidth, makeRng, terrainHeight, wallOffset, wallTop } from './terrain';
import type { Quality } from '../core/Settings';

// Bloques de roca apilados contra las paredes del cañón, solo en calidad media y alta (con la pared recta de «baja» no existen).
// Son tortitas irregulares de arenisca: cada capa sobresale o se mete respecto a la anterior y las de arriba suelen vuelar más hacia fuera
// (voladizos), con la parte de abajo oscurecida. Al pie de la pared se amontonan escombros (rocas caídas y lajas).
// Se generan 6 formas por código y se repiten con instancias (giradas y escaladas): una sola figura por forma, muy ligero para el móvil.
// Son solo visuales (sin cuerpo sólido): los salientes están por encima de la cabeza y el suelo jugable termina antes que ellos.

const PALETTE = [0x9a4a2c, 0xb85c36, 0x7e3a22, 0xc0693c, 0xa85a34].map((c) => new THREE.Color(c));

function hash(n: number) { const x = Math.sin(n * 127.1 + 311.7) * 43758.5453; return x - Math.floor(x); }

/** Capa de roca de 1 de radio y 1 de alto (luego se escala): la parte de abajo metida hacia dentro, la panza ancha en medio y la cima redondeada, con bordes erosionados. Más oscura abajo. */
function pancakeGeometry(seed: number): THREE.BufferGeometry {
  const rnd = (() => { let k = seed * 977; return () => hash(k++); })();
  const n = 11 + Math.floor(rnd() * 4);
  const bulge = 0.1 + rnd() * 0.14;
  const ys = [0, 0.28, 0.68, 1];
  const rad = [0.55 + rnd() * 0.08, 1 + bulge, 0.98 + bulge * 0.5, 0.7 + rnd() * 0.1];
  const SH = [0.42, 0.9, 1.05, 1.12]; // más oscuro abajo (oclusión), más claro arriba
  const rings: THREE.Vector3[][] = ys.map(() => []);
  for (let i = 0; i < n; i++) {
    const a = ((i + (rnd() - 0.5) * 0.4) / n) * Math.PI * 2;
    const k = 0.74 + rnd() * 0.42; // contorno irregular
    for (let r = 0; r < ys.length; r++) {
      const kk = k * (1 + (rnd() - 0.5) * 0.24); // erosión: cada anillo se come un poco distinto
      rings[r].push(new THREE.Vector3(Math.cos(a) * rad[r] * kk, ys[r] + (rnd() - 0.5) * 0.05, Math.sin(a) * rad[r] * kk));
    }
  }
  const top = new THREE.Vector3((rnd() - 0.5) * 0.2, 1.05 + rnd() * 0.06, (rnd() - 0.5) * 0.2);
  const bot = new THREE.Vector3(0, -0.02, 0);
  const P: number[] = [], C: number[] = [];
  const tri = (a: THREE.Vector3, b: THREE.Vector3, c: THREE.Vector3, ca: number, cb: number, cc: number) => {
    P.push(a.x, a.y, a.z, b.x, b.y, b.z, c.x, c.y, c.z); C.push(ca, ca, ca, cb, cb, cb, cc, cc, cc);
  };
  const L = ys.length - 1;
  for (let i = 0; i < n; i++) {
    const j = (i + 1) % n;
    tri(top, rings[L][j], rings[L][i], 1.15, SH[L], SH[L]); // cima (hacia arriba)
    for (let r = 0; r < L; r++) {
      const A = rings[r][i], B = rings[r][j], A2 = rings[r + 1][i], B2 = rings[r + 1][j];
      tri(A, B, B2, SH[r], SH[r], SH[r + 1]); tri(A, B2, A2, SH[r], SH[r + 1], SH[r + 1]);
    }
    tri(bot, rings[0][i], rings[0][j], 0.3, SH[0] * 0.8, SH[0] * 0.8); // panza metida (abajo: muy oscura)
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(P, 3));
  g.setAttribute('color', new THREE.Float32BufferAttribute(C, 3));
  g.computeVertexNormals();
  return fixFaces(g);
}

/** Cantos rodados y escombros: icosaedro deformado, más oscuro por debajo. */
function rubbleGeometry(seed: number): THREE.BufferGeometry {
  const g = new THREE.IcosahedronGeometry(1, 1);
  const p = g.attributes.position as THREE.BufferAttribute;
  const col = new Float32Array(p.count * 3);
  for (let i = 0; i < p.count; i++) {
    const x = p.getX(i), y = p.getY(i), z = p.getZ(i);
    const k = 0.72 + hash(Math.round(x * 100) + Math.round(y * 100) * 7 + Math.round(z * 100) * 13 + seed) * 0.5;
    p.setXYZ(i, x * k, Math.max(y * k, -0.3) * 0.8, z * k);
    const sh = y < -0.1 ? 0.55 : 0.9 + 0.2 * y;
    col.set([sh, sh, sh], i * 3);
  }
  g.setAttribute('color', new THREE.BufferAttribute(col, 3));
  g.computeVertexNormals();
  return g;
}

/** Comprueba que las normales apuntan hacia fuera (si no, se invierte el orden de los triángulos). */
function fixFaces(g: THREE.BufferGeometry) {
  g.computeBoundingBox();
  const c = g.boundingBox!.getCenter(new THREE.Vector3());
  const p = g.attributes.position, n = g.attributes.normal;
  let dot = 0;
  for (let i = 0; i < p.count; i++) dot += (p.getX(i) - c.x) * n.getX(i) + (p.getY(i) - c.y) * n.getY(i) + (p.getZ(i) - c.z) * n.getZ(i);
  if (dot < 0) {
    for (let i = 0; i < p.count; i += 3) for (const a of [p, g.attributes.color]) {
      const x = [a.getX(i + 1), a.getY(i + 1), a.getZ(i + 1)];
      a.setXYZ(i + 1, a.getX(i + 2), a.getY(i + 2), a.getZ(i + 2)); a.setXYZ(i + 2, x[0], x[1], x[2]);
    }
    g.computeVertexNormals();
  }
  return g;
}

interface Variant { mesh: THREE.InstancedMesh; n: number }

export class WallBlocks {
  private variants: Variant[] = [];

  constructor(scene: THREE.Scene) {
    const geos = [pancakeGeometry(1), pancakeGeometry(2), pancakeGeometry(3), pancakeGeometry(4), rubbleGeometry(5), rubbleGeometry(6)];
    for (const g of geos) {
      const cnt = g.attributes.position.count;
      g.setAttribute('texAmt', new THREE.BufferAttribute(new Float32Array(cnt).fill(1), 1));
      g.setAttribute('texKind', new THREE.BufferAttribute(new Float32Array(cnt), 1));
    }
    const mat = applyWorldTextures(new THREE.MeshLambertMaterial({ vertexColors: true, flatShading: true }), { ground: groundTexture(), groundX: groundExtraTexture(), slabs: slabsTexture(), strata: strataTexture(), pits: pitsTexture(), spire: { rock: rockTexture(), joints: rockJointsTexture() }, rockOnly: true, strataScale: 0.2 });
    const lists: THREE.Matrix4[][] = geos.map(() => []);
    const colors: THREE.Color[][] = geos.map(() => []);
    const rng = makeRng(555123);
    const range = (a: number, b: number) => a + rng() * (b - a);
    const q = new THREE.Quaternion(), e = new THREE.Euler(), pos = new THREE.Vector3(), sc = new THREE.Vector3();
    const put = (v: number, x: number, y: number, z: number, sx: number, sy: number, sz: number, yaw: number, tilt = 0) => {
      e.set((rng() - 0.5) * tilt, yaw, (rng() - 0.5) * tilt, 'YXZ');
      q.setFromEuler(e);
      const color = new THREE.Color().copy(PALETTE[Math.floor(rng() * PALETTE.length)]).multiplyScalar(range(0.85, 1.15));
      if (caveKeepOut(x, z, Math.max(sx, sz) * 0.8, y - sy)) return; // no tapa la cueva (el azar se gasta igual: el resto no cambia)
      lists[v].push(new THREE.Matrix4().compose(pos.set(x, y, z), q, sc.set(sx, sy, sz)));
      colors[v].push(color);
    };
    /** Distancia al eje del cañón a la que la pared alcanza la altura y (la altura solo sube hacia fuera: se busca por bisección). */
    const surface = (side: number, z: number, y: number) => {
      let lo = floorHalfWidth(side, z), hi = lo + 8 + 44;
      for (let i = 0; i < 14; i++) { const mid = (lo + hi) / 2; if (terrainHeight(side * mid, z) < y) lo = mid; else hi = mid; }
      return (lo + hi) / 2;
    };
    const Z = 200; // a lo largo del tramo jugable y de la zona que se abre; lo lejano lleva menos bloques (cada 16 m en vez de cada 8)
    for (const side of [-1, 1]) {
      for (let z = -Z; z <= Z; z += Math.abs(z) > CANYON_HALF_L + 14 ? 16 : 8) {
        const zz = z + range(-2.5, 2.5);
        const T = wallTop(side, zz);
        // las capas van a las mismas alturas relativas en columnas vecinas: así se juntan en bandas horizontales a lo largo de la pared
        const FR = [0.2, 0.4, 0.6, 0.8];
        for (let k = 0; k < FR.length; k++) {
          if (rng() < 0.15) continue;
          const y = T * (FR[k] + range(-0.03, 0.03)) + 2;
          // las capas altas sobresalen más (voladizo); las bajas quedan casi a ras o metidas en la pared
          const protrude = -0.6 + k * 0.9 + range(-0.5, 1.4);
          const w = range(11, 16), d = range(8, 12), t = range(3.8, 5.8); // capas gruesas, no tablas
          const sx = surface(side, zz, y);
          const outer = sx - protrude;
          const v = Math.floor(rng() * 4);
          put(v, side * (outer + d * 0.5), y, zz, w * 0.5, t, d * 0.5, (side > 0 ? 0 : Math.PI) + range(-0.1, 0.1) + (rng() < 0.5 ? Math.PI : 0), 0.03);
        }
        // escombros al pie: rocas caídas y lajas amontonadas
        const foot = floorHalfWidth(side, zz) + wallOffset(side, zz);
        const nr = 3 + Math.floor(rng() * 4);
        for (let r = 0; r < nr; r++) {
          const x = foot + range(-2.5, 5), z2 = zz + range(-3.5, 3.5);
          const s = range(0.8, 3.2);
          put(4 + (rng() < 0.5 ? 1 : 0), side * x, terrainHeight(side * x, z2) + s * 0.15, z2, s * range(0.8, 1.3), s * range(0.6, 1), s * range(0.8, 1.3), range(0, 6.28), 0.8);
        }
        if (rng() < 0.7) {
          // un montón de lajas apoyadas unas en otras
          const x = foot + range(-1.5, 4), z2 = zz + range(-3, 3);
          for (let r = 0; r < 3; r++) put(Math.floor(rng() * 4), side * (x + range(-1, 1)), terrainHeight(side * x, z2) + 0.25 + r * 0.35, z2 + range(-1, 1), range(0.9, 1.6), range(0.18, 0.3), range(0.8, 1.4), range(0, 6.28), 0.5);
        }
      }
    }
    // al azar el orden de cada lista: así las primeras (media calidad) quedan repartidas por toda la pared
    geos.forEach((g, i) => {
      const idx = lists[i].map((_, k) => k).sort(() => rng() - 0.5);
      const mesh = new THREE.InstancedMesh(g, mat, Math.max(1, idx.length));
      idx.forEach((src, k) => { mesh.setMatrixAt(k, lists[i][src]); mesh.setColorAt(k, colors[i][src]); });
      mesh.instanceMatrix.needsUpdate = true;
      if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
      mesh.castShadow = true;
      mesh.receiveShadow = true;
      mesh.visible = false;
      mesh.frustumCulled = false;
      scene.add(mesh);
      this.variants.push({ mesh, n: idx.length });
    });
  }

  setQuality(q: Quality) {
    // Media y Alta llevan la misma cantidad de bloques (la de Media gustó más); Alta se distingue en sombras, lajas y piedrecitas
    const frac = q === 'low' ? 0 : 0.45;
    for (const v of this.variants) { v.mesh.count = Math.floor(v.n * frac); v.mesh.visible = v.mesh.count > 0; }
  }
}
