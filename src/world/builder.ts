import * as THREE from 'three';
import type RAPIER from '@dimforge/rapier3d-compat';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { applyWorldTextures, groundExtraTexture, groundTexture, rockJointsTexture, rockTexture } from './materials';

// Junta muchas piezas en un único objeto dibujable (mucho más ligero para el móvil)
// y crea a la vez su versión "sólida" para la física.
export class Builder {
  private geos: THREE.BufferGeometry[] = [];
  private tmpColor = new THREE.Color();
  private extras: THREE.Object3D[] = [];

  constructor(
    private rapier: typeof RAPIER,
    private physics: RAPIER.World,
  ) {}

  /** Cuánto se aplica la textura de arenisca a una pieza (1 = roca; 0 = metal, cajas, cañonera). */
  private texAmt(geo: THREE.BufferGeometry, amt: number) {
    geo.setAttribute('texAmt', new THREE.BufferAttribute(new Float32Array(geo.attributes.position.count).fill(amt), 1));
  }

  private paint(geo: THREE.BufferGeometry, color: number, shade = 1) {
    const n = geo.attributes.position.count;
    const arr = new Float32Array(n * 3);
    this.tmpColor.set(color).multiplyScalar(shade);
    for (let i = 0; i < n; i++) arr.set([this.tmpColor.r, this.tmpColor.g, this.tmpColor.b], i * 3);
    geo.setAttribute('color', new THREE.BufferAttribute(arr, 3));
  }

  /** Pieza con forma libre (rocas). Su parte sólida es su envolvente. */
  addHull(geo: THREE.BufferGeometry, matrix: THREE.Matrix4, color: number, shade = 1, solid = true) {
    const g = geo.index ? geo.toNonIndexed() : geo;
    g.applyMatrix4(matrix);
    g.computeVertexNormals();
    g.deleteAttribute('uv');
    this.paint(g, color, shade);
    this.texAmt(g, 1);
    this.geos.push(g);
    if (!solid) return; // piezas inalcanzables (el borde del cañón) no necesitan cuerpo sólido
    const desc = this.rapier.ColliderDesc.convexHull(new Float32Array(g.attributes.position.array));
    if (desc) this.physics.createCollider(desc);
  }

  /** Roca en capas: el color cambia por franjas de altura (como los estratos de una pared). */
  addStrataHull(geo: THREE.BufferGeometry, matrix: THREE.Matrix4, palette: number[], bandHeight: number, solid = true) {
    const g = geo.index ? geo.toNonIndexed() : geo.clone();
    g.applyMatrix4(matrix);
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
    if (!solid) return;
    const desc = this.rapier.ColliderDesc.convexHull(new Float32Array(g.attributes.position.array));
    if (desc) this.physics.createCollider(desc);
  }

  /** Decorado pequeño (grava, losas): se ve, pero no tiene cuerpo sólido. */
  addDecor(geo: THREE.BufferGeometry, matrix: THREE.Matrix4, color: number, shade = 1, tex = 0) {
    const g = geo.index ? geo.toNonIndexed() : geo.clone();
    g.applyMatrix4(matrix);
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
    // Las rocas y piezas llevan la arenisca estratificada (en el espacio del mundo); la cañonera y los restos metálicos
    // se verían raros con ella, pero el efecto es suave porque solo modula el color de cada pieza.
    const mesh = new THREE.Mesh(merged, applyWorldTextures(new THREE.MeshLambertMaterial({ vertexColors: true, flatShading: true }), { ground: groundTexture(), groundX: groundExtraTexture(), rock: rockTexture(), rock2: rockJointsTexture(), rockOnly: true, rockScale: 0.3, rock2Scale: 0.07 }));
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
