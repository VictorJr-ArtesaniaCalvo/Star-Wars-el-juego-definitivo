import * as THREE from 'three';
import { terrainHeight } from './terrain';

// Sombras de contacto: un oscurecimiento suave donde los objetos tocan el suelo, para que no parezcan flotar. Es independiente de la calidad
// (no usa sombras de sol), así que también funciona en Baja.
//  · Rocas, muros y demás piezas fijas: una pieza grande con una mancha suave bajo cada una (calculada al cargar) y la base de cada pieza algo oscurecida.
//  · Droides: una mancha suave que les sigue los pasos.

let tex: THREE.Texture | null = null;
export function contactTexture(): THREE.Texture {
  if (tex) return tex;
  const s = 64, c = document.createElement('canvas');
  c.width = c.height = s;
  const g = c.getContext('2d')!;
  const gr = g.createRadialGradient(s / 2, s / 2, s * 0.08, s / 2, s / 2, s / 2);
  gr.addColorStop(0, 'rgba(0,0,0,0.62)');
  gr.addColorStop(0.55, 'rgba(0,0,0,0.3)');
  gr.addColorStop(1, 'rgba(0,0,0,0)');
  g.fillStyle = gr; g.fillRect(0, 0, s, s);
  tex = new THREE.CanvasTexture(c);
  return tex;
}

const material = () => new THREE.MeshBasicMaterial({ map: contactTexture(), transparent: true, depthWrite: false, color: 0x2a1208, polygonOffset: true, polygonOffsetFactor: -3, polygonOffsetUnits: -3 });

export interface Foot { x: number; z: number; r: number }

/** Manchas de contacto, siguiendo el relieve, una sola malla para todas. */
export function buildContactDecals(scene: THREE.Scene, feet: Foot[]) {
  const pos: number[] = [], uv: number[] = [], idx: number[] = [];
  let v = 0;
  for (const f of feet) {
    const R = f.r * 1.55 + 0.35, N = f.r > 1.6 ? 3 : 2; // las grandes siguen el relieve (3×3 puntos); las pequeñas son un cuadrado
    for (let j = 0; j < N; j++) for (let i = 0; i < N; i++) {
      const x = f.x + (i / (N - 1) * 2 - 1) * R, z = f.z + (j / (N - 1) * 2 - 1) * R;
      pos.push(x, terrainHeight(x, z) + 0.05, z); uv.push(i / (N - 1), j / (N - 1));
    }
    for (let j = 0; j < N - 1; j++) for (let i = 0; i < N - 1; i++) { const a = v + j * N + i; idx.push(a, a + N, a + 1, a + 1, a + N, a + N + 1); }
    v += N * N;
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  g.setIndex(idx);
  const m = new THREE.Mesh(g, material());
  m.frustumCulled = false; m.renderOrder = 0.6;
  scene.add(m);
}

/** Oscurece la base de las piezas (color por vértice): cuanto más cerca del suelo, más oscuro. */
export function bakeBaseAO(g: THREE.BufferGeometry) {
  const p = g.attributes.position, c = g.attributes.color;
  if (!p || !c) return;
  for (let i = 0; i < p.count; i++) {
    const h = p.getY(i) - terrainHeight(p.getX(i), p.getZ(i));
    if (h > 1.1) continue;
    const t = Math.min(1, Math.max(0, h / 1.1)), k = 0.62 + 0.38 * t * t * (3 - 2 * t);
    c.setXYZ(i, c.getX(i) * k, c.getY(i) * k, c.getZ(i) * k);
  }
  c.needsUpdate = true;
}

/** Mancha que sigue a un droide. */
export function makeBlob(scene: THREE.Scene, size: number): THREE.Mesh {
  const m = new THREE.Mesh(new THREE.PlaneGeometry(1, 1).rotateX(-Math.PI / 2), material());
  m.scale.setScalar(size); m.visible = false; m.renderOrder = 0.6; m.frustumCulled = false;
  scene.add(m);
  return m;
}
