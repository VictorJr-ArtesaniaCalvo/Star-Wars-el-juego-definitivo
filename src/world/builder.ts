import * as THREE from 'three';
import type RAPIER from '@dimforge/rapier3d-compat';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';

// Junta muchas piezas en un único objeto dibujable (mucho más ligero para el móvil)
// y crea a la vez su versión "sólida" para la física.
export class Builder {
  private geos: THREE.BufferGeometry[] = [];
  private tmpColor = new THREE.Color();

  constructor(
    private rapier: typeof RAPIER,
    private physics: RAPIER.World,
  ) {}

  private paint(geo: THREE.BufferGeometry, color: number, shade = 1) {
    const n = geo.attributes.position.count;
    const arr = new Float32Array(n * 3);
    this.tmpColor.set(color).multiplyScalar(shade);
    for (let i = 0; i < n; i++) arr.set([this.tmpColor.r, this.tmpColor.g, this.tmpColor.b], i * 3);
    geo.setAttribute('color', new THREE.BufferAttribute(arr, 3));
  }

  /** Pieza con forma libre (rocas). Su parte sólida es su envolvente. */
  addHull(geo: THREE.BufferGeometry, matrix: THREE.Matrix4, color: number, shade = 1) {
    const g = geo.index ? geo.toNonIndexed() : geo;
    g.applyMatrix4(matrix);
    g.computeVertexNormals();
    g.deleteAttribute('uv');
    this.paint(g, color, shade);
    this.geos.push(g);
    const desc = this.rapier.ColliderDesc.convexHull(new Float32Array(g.attributes.position.array));
    if (desc) this.physics.createCollider(desc);
  }

  /** Caja (muros, cajas, piezas de la cañonera). */
  addBox(size: [number, number, number], matrix: THREE.Matrix4, color: number, solid = true) {
    const g = new THREE.BoxGeometry(size[0], size[1], size[2]).toNonIndexed();
    g.applyMatrix4(matrix);
    g.computeVertexNormals();
    g.deleteAttribute('uv');
    this.paint(g, color);
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

  finish(scene: THREE.Scene): THREE.Mesh {
    const merged = mergeGeometries(this.geos, false)!;
    for (const g of this.geos) g.dispose();
    const mesh = new THREE.Mesh(merged, new THREE.MeshLambertMaterial({ vertexColors: true, flatShading: true }));
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
