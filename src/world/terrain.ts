import * as THREE from 'three';
import type RAPIER from '@dimforge/rapier3d-compat';

export const WORLD_SEED = 1138;
export const MAP_SIZE = 270; // metros de lado
export const PLAY_RADIUS = 104; // hasta dónde se puede caminar desde el centro
const SEGMENTS = 108;

export const smoothstep = (a: number, b: number, v: number) => {
  const t = Math.min(1, Math.max(0, (v - a) / (b - a)));
  return t * t * (3 - 2 * t);
};

// Generador de números "aleatorios" repetibles: misma semilla → mismo escenario siempre.
export function makeRng(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// Altura del suelo en cualquier punto. Dunas suaves, llano en la zona de defensa
// y una cresta alta en el borde que cierra el mapa.
export function terrainHeight(x: number, z: number): number {
  let h =
    2.6 * Math.sin(x * 0.031 + 1.3) * Math.cos(z * 0.027 - 0.4) +
    1.3 * Math.sin(x * 0.071 + z * 0.053 + 2.1) +
    0.55 * Math.sin(x * 0.16 - z * 0.19 + 0.7) +
    0.25 * Math.sin(x * 0.37 + 1.1) * Math.sin(z * 0.41);
  const d = Math.hypot(x, z);
  h *= smoothstep(10, 30, d);
  h += smoothstep(100, 130, d) * 14;
  return h;
}

// Textura de arena hecha por código (grano fino). Provisional hasta la Fase 6.
function sandTexture(): THREE.Texture {
  const s = 256;
  const c = document.createElement('canvas');
  c.width = c.height = s;
  const g = c.getContext('2d')!;
  const img = g.createImageData(s, s);
  const rng = makeRng(7);
  for (let i = 0; i < s * s; i++) {
    const v = 205 + rng() * 50 - (rng() < 0.04 ? 45 : 0);
    img.data[i * 4] = v;
    img.data[i * 4 + 1] = v;
    img.data[i * 4 + 2] = v;
    img.data[i * 4 + 3] = 255;
  }
  g.putImageData(img, 0, 0);
  const t = new THREE.CanvasTexture(c);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.repeat.set(70, 70);
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 4;
  return t;
}

export function buildTerrain(scene: THREE.Scene, rapier: typeof RAPIER, physics: RAPIER.World) {
  const geo = new THREE.PlaneGeometry(MAP_SIZE, MAP_SIZE, SEGMENTS, SEGMENTS);
  geo.rotateX(-Math.PI / 2);
  const pos = geo.attributes.position as THREE.BufferAttribute;
  const colors = new Float32Array(pos.count * 3);
  const light = new THREE.Color(0xc9683f);
  const dark = new THREE.Color(0x9a4326);
  const tmp = new THREE.Color();
  for (let i = 0; i < pos.count; i++) {
    const x = pos.getX(i);
    const z = pos.getZ(i);
    const h = terrainHeight(x, z);
    pos.setY(i, h);
    const k = 0.5 + 0.5 * Math.sin(x * 0.05 + Math.sin(z * 0.08) * 2) * Math.cos(z * 0.043 + 1);
    tmp.copy(dark).lerp(light, Math.min(1, Math.max(0, k * 0.7 + h * 0.06 + 0.2)));
    colors.set([tmp.r, tmp.g, tmp.b], i * 3);
  }
  geo.setAttribute('color', new THREE.BufferAttribute(colors, 3));
  geo.computeVertexNormals();

  const mesh = new THREE.Mesh(geo, new THREE.MeshLambertMaterial({ vertexColors: true, map: sandTexture() }));
  mesh.receiveShadow = true;
  scene.add(mesh);

  // Suelo "sólido" para la física.
  const verts = new Float32Array(pos.array);
  const idx = new Uint32Array(geo.index!.array);
  physics.createCollider(rapier.ColliderDesc.trimesh(verts, idx));
  return mesh;
}
