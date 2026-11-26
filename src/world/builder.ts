import * as THREE from 'three';
import type RAPIER from '@dimforge/rapier3d-compat';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { cruiserKeepOut, terrainHeight } from './terrain';
import { caveKeepOut } from './cave';
import { bakeSunShadow } from './sunShadow';
import { bakeBaseAO, type Foot } from './contact';
import { applyWorldTextures, groundExtraTexture, groundTexture, pitsTexture, rockJointsTexture, rockTexture, slabsTexture, strataTexture } from './materials';

// Junta muchas piezas en un único objeto dibujable (mucho más ligero para el móvil)
// y crea a la vez su versión "sólida" para la física.
export class Builder {
  private geos: THREE.BufferGeometry[] = [];
  private tmpColor = new THREE.Color();
  private extras: THREE.Object3D[] = [];
  /** Dónde hay coberturas (x, z, radio): el suelo se vuelve rocoso a su alrededor. */
  readonly spots: Array<{ x: number; z: number; r: number }> = [];
  /** Huella de cada pieza sólida en el suelo (para su mancha de contacto). */
  readonly feet: Foot[] = [];

  constructor(
    private rapier: typeof RAPIER,
    private physics: RAPIER.World,
  ) {}

  /** Cuánto se aplica la textura de arenisca a una pieza (1 = roca; 0 = metal, cajas, cañonera) y de qué tipo es (1 = aguja/torre, que lleva otras texturas). */
  private texAmt(geo: THREE.BufferGeometry, amt: number, kind = 0) {
    const n = geo.attributes.position.count;
    geo.setAttribute('texAmt', new THREE.BufferAttribute(new Float32Array(n).fill(amt), 1));
    geo.setAttribute('texKind', new THREE.BufferAttribute(new Float32Array(n).fill(kind), 1));
  }

  private spot(g: THREE.BufferGeometry) {
    g.computeBoundingSphere();
    const bs = g.boundingSphere!;
    this.spots.push({ x: bs.center.x, z: bs.center.z, r: Math.min(bs.radius, 14) });
    // huella: los vértices que están a menos de 0,7 m del suelo
    const p = g.attributes.position;
    let x0 = 1e9, x1 = -1e9, z0 = 1e9, z1 = -1e9, n = 0;
    for (let i = 0; i < p.count; i++) {
      const x = p.getX(i), z = p.getZ(i);
      if (p.getY(i) - terrainHeight(x, z) > 0.7) continue;
      x0 = Math.min(x0, x); x1 = Math.max(x1, x); z0 = Math.min(z0, z); z1 = Math.max(z1, z); n++;
    }
    if (n >= 3 && Math.abs(bs.center.x) < 60 && Math.abs(bs.center.z) < 125) this.feet.push({ x: (x0 + x1) / 2, z: (z0 + z1) / 2, r: Math.min(8, Math.max(x1 - x0, z1 - z0) / 2) });
  }

  private paint(geo: THREE.BufferGeometry, color: number, shade = 1) {
    const n = geo.attributes.position.count;
    const arr = new Float32Array(n * 3);
    this.tmpColor.set(color).multiplyScalar(shade);
    for (let i = 0; i < n; i++) arr.set([this.tmpColor.r, this.tmpColor.g, this.tmpColor.b], i * 3);
    geo.setAttribute('color', new THREE.BufferAttribute(arr, 3));
  }

  /** Mientras está a true se ponen los restos y rocas del crucero (que sí van en su zona). */
  cruiserPieces = false;

  /** ¿Taparía esta pieza (ya colocada) la entrada de la cueva, o caería encima del crucero estrellado? Entonces no se pone (el resto del mapa no cambia). */
  private overCave(g: THREE.BufferGeometry) {
    g.computeBoundingBox();
    const b = g.boundingBox!;
    const r = Math.max(b.max.x - b.min.x, b.max.z - b.min.z) * 0.4;
    const cx = (b.min.x + b.max.x) / 2, cz = (b.min.z + b.max.z) / 2;
    // tampoco encima del crucero estrellado ni de su surco (salvo sus propios restos y rocas)
    return caveKeepOut(cx, cz, r, b.min.y) || (!this.cruiserPieces && cruiserKeepOut(cx, cz, r));
  }

  /** Pieza con forma libre (rocas). Su parte sólida es su envolvente. */
  addHull(geo: THREE.BufferGeometry, matrix: THREE.Matrix4, color: number, shade = 1, solid = true, spire = false) {
    const g = geo.index ? geo.toNonIndexed() : geo;
    g.userData = geo.userData;
    g.applyMatrix4(matrix);
    if (this.overCave(g)) return;
    if (!g.userData.keepNormals) g.computeVertexNormals(); // las rocas traen su sombreado suave ya calculado
    g.deleteAttribute('uv');
    this.paint(g, color, shade);
    this.texAmt(g, 1, spire ? 1 : 0);
    this.geos.push(g);
    this.spot(g);
    if (!solid) return; // piezas inalcanzables (el borde del cañón) no necesitan cuerpo sólido
    const pos = g.attributes.position.array as Float32Array;
    const cuts = g.userData.cuts as number[] | undefined;
    if (cuts) {
      // aguja con anillos: un cuerpo sólido por cada anillo (en vez de uno solo que las envolvería en un cono ancho), así se puede rodear entre los cuellos
      const y0 = new THREE.Vector3().setFromMatrixPosition(matrix).y;
      for (let c = 0; c + 1 < cuts.length; c++) {
        const sel: number[] = [];
        for (let i = 0; i < pos.length; i += 3) if (pos[i + 1] >= y0 + cuts[c] - 1e-4 && pos[i + 1] <= y0 + cuts[c + 1] + 1e-4) sel.push(pos[i], pos[i + 1], pos[i + 2]);
        const d = sel.length >= 12 ? this.rapier.ColliderDesc.convexHull(new Float32Array(sel)) : null;
        if (d) this.physics.createCollider(d);
      }
      return;
    }
    const desc = this.rapier.ColliderDesc.convexHull(new Float32Array(pos));
    if (desc) this.physics.createCollider(desc);
  }

  /** Roca en capas: el color cambia por franjas de altura (como los estratos de una pared). */
  addStrataHull(geo: THREE.BufferGeometry, matrix: THREE.Matrix4, palette: number[], bandHeight: number, solid = true) {
    const g = geo.index ? geo.toNonIndexed() : geo.clone();
    g.applyMatrix4(matrix);
    if (this.overCave(g)) return;
    g.computeVertexNormals();
    g.deleteAttribute('uv');
    const p = g.attributes.position;
    const nrm = g.attributes.normal;
    const arr = new Float32Array(p.count * 3);
    const cols = palette.map((c) => new THREE.Color(c));
    for (let i = 0; i < p.count; i++) {
      const band = Math.floor(p.getY(i) / bandHeight);
      const c = this.tmpColor.copy(cols[((band % cols.length) + cols.length) % cols.length]);
      c.multiplyScalar(0.7 + 0.3 * nrm.getY(i) + 0.1);
      arr.set([c.r, c.g, c.b], i * 3);
    }
    g.setAttribute('color', new THREE.BufferAttribute(arr, 3));
    this.texAmt(g, 1);
    this.geos.push(g);
    this.spot(g);
    if (!solid) return;
    const pos = g.attributes.position.array as Float32Array;
    const parts = g.userData.parts as number[] | undefined;
    if (parts) {
      // pila de capas: un cuerpo sólido por capa (el hueco bajo cada saliente queda libre en lugar de rellenarse)
      let o = 0;
      for (const n of parts) {
        const d = this.rapier.ColliderDesc.convexHull(new Float32Array(pos.subarray(o * 3, (o + n) * 3)));
        if (d) this.physics.createCollider(d);
        o += n;
      }
      return;
    }
    const desc = this.rapier.ColliderDesc.convexHull(new Float32Array(pos));
    if (desc) this.physics.createCollider(desc);
  }

  /** Decorado pequeño (grava, losas): se ve, pero no tiene cuerpo sólido. */
  addDecor(geo: THREE.BufferGeometry, matrix: THREE.Matrix4, color: number, shade = 1, tex = 0) {
    const g = geo.index ? geo.toNonIndexed() : geo.clone();
    g.applyMatrix4(matrix);
    if (this.overCave(g)) return;
    g.computeVertexNormals();
    g.deleteAttribute('uv');
    this.paint(g, color, shade);
    this.texAmt(g, tex);
    this.geos.push(g);
  }

  /** Caja (muros, cajas, piezas de la cañonera). */
  addBox(size: [number, number, number], matrix: THREE.Matrix4, color: number, solid = true, tex = 0) {
    const g = new THREE.BoxGeometry(size[0], size[1], size[2]).toNonIndexed();
    g.applyMatrix4(matrix);
    g.computeVertexNormals();
    g.deleteAttribute('uv');
    this.paint(g, color);
    this.texAmt(g, tex);
    this.geos.push(g);
    if (solid) this.spot(g);
    if (!solid) return;
    const p = new THREE.Vector3();
    const q = new THREE.Quaternion();
    const s = new THREE.Vector3();
    matrix.decompose(p, q, s);
    this.physics.createCollider(
      this.rapier.ColliderDesc.cuboid((size[0] * s.x) / 2, (size[1] * s.y) / 2, (size[2] * s.z) / 2)
        .setTranslation(p.x, p.y, p.z)
        .setRotation(q),
    );
  }

  /** Cuerpo sólido con la forma convexa que envuelve esos puntos (x,y,z seguidos). */
  addConvex(points: Float32Array) {
    const desc = this.rapier.ColliderDesc.convexHull(points);
    if (desc) this.physics.createCollider(desc);
  }

  /** Objeto ya hecho (modelo 3D, calcomanías…) que se añade a la escena junto con el resto. */
  addObject(o: THREE.Object3D) {
    this.extras.push(o);
  }

  finish(scene: THREE.Scene): THREE.Mesh {
    for (const o of this.extras) scene.add(o);
    const merged = mergeGeometries(this.geos, false)!;
    for (const g of this.geos) g.dispose();
    bakeSunShadow(merged); // sombra de las paredes pintada al cargar
    bakeBaseAO(merged); // la base de cada pieza algo más oscura (contacto con el suelo)
    // Las rocas y piezas llevan la arenisca estratificada (en el espacio del mundo); la cañonera y los restos metálicos
    // se verían raros con ella, pero el efecto es suave porque solo modula el color de cada pieza.
    const mesh = new THREE.Mesh(merged, applyWorldTextures(new THREE.MeshLambertMaterial({ vertexColors: true }), { ground: groundTexture(), groundX: groundExtraTexture(), slabs: slabsTexture(), strata: strataTexture(), pits: pitsTexture(), spire: { rock: rockTexture(), joints: rockJointsTexture() }, rockOnly: true, strataScale: 0.2 }));
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    scene.add(mesh);
    return mesh;
  }
}

/** Atajo para colocar una pieza: posición + giros (en radianes). */
export function place(x: number, y: number, z: number, rotY = 0, rotX = 0, rotZ = 0, scale?: THREE.Vector3) {
  return new THREE.Matrix4().compose(
    new THREE.Vector3(x, y, z),
    new THREE.Quaternion().setFromEuler(new THREE.Euler(rotX, rotY, rotZ, 'YXZ')),
    scale ?? new THREE.Vector3(1, 1, 1),
  );
}
