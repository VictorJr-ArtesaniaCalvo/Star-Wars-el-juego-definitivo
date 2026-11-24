import * as THREE from 'three';
import { makeRng, terrainHeight } from './terrain';

// Ambiente lejano: columnas de humo y enjambres de criaturas voladoras. Todo ligero:
// el humo es un único objeto y los voladores son puntos.

function puffTexture(): THREE.Texture {
  const s = 128;
  const c = document.createElement('canvas');
  c.width = c.height = s;
  const g = c.getContext('2d')!;
  const grad = g.createRadialGradient(s / 2, s / 2, 4, s / 2, s / 2, s / 2);
  grad.addColorStop(0, 'rgba(255,255,255,1)');
  grad.addColorStop(0.55, 'rgba(255,255,255,0.55)');
  grad.addColorStop(1, 'rgba(255,255,255,0)');
  g.fillStyle = grad;
  g.fillRect(0, 0, s, s);
  return new THREE.CanvasTexture(c);
}

export class Atmosphere {
  private flyers: THREE.Points;
  private t = 0;

  constructor(scene: THREE.Scene) {
    const rng = makeRng(777);
    const range = (a: number, b: number) => a + rng() * (b - a);

    // --- Columnas de humo, a lo lejos, detrás de las paredes del cañón ---
    const plumes: Array<[number, number]> = [[-85, -125], [70, -135], [-100, 70], [95, 105], [30, 150], [-30, -170]];
    const pos: number[] = [], col: number[] = [], uv: number[] = [], idx: number[] = [];
    const up = new THREE.Vector3(0, 1, 0);
    const base = new THREE.Color(0x3a2412);
    const top = new THREE.Color(0xc89450);
    const tmp = new THREE.Color();
    let v = 0;
    for (const [px, pz] of plumes) {
      const toC = new THREE.Vector3(-px, 0, -pz).normalize();
      const right = new THREE.Vector3().crossVectors(up, toC).normalize();
      const y0 = terrainHeight(px, pz) + 4;
      const sway = range(-1, 1) * 22;
      const puffs = 18;
      for (let i = 0; i < puffs; i++) {
        const k = i / (puffs - 1);
        const size = 12 + k * 46 + range(-3, 3);
        const cx = px + right.x * sway * k * k + range(-4, 4);
        const cz = pz + right.z * sway * k * k + range(-4, 4);
        const cy = y0 + k * 125;
        tmp.copy(base).lerp(top, Math.pow(k, 0.8));
        const a = (0.62 - 0.42 * k) * (i === 0 ? 0.6 : 1);
        for (const [sx, sy] of [[-1, -1], [1, -1], [1, 1], [-1, 1]]) {
          pos.push(cx + right.x * sx * size, cy + sy * size, cz + right.z * sx * size);
          col.push(tmp.r, tmp.g, tmp.b, a);
          uv.push((sx + 1) / 2, (sy + 1) / 2);
        }
        idx.push(v, v + 1, v + 2, v, v + 2, v + 3);
        v += 4;
      }
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    geo.setAttribute('color', new THREE.Float32BufferAttribute(col, 4));
    geo.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
    geo.setIndex(idx);
    const smoke = new THREE.Mesh(
      geo,
      new THREE.MeshBasicMaterial({ map: puffTexture(), vertexColors: true, transparent: true, depthWrite: false, fog: false }),
    );
    smoke.frustumCulled = false;
    smoke.renderOrder = 1;
    scene.add(smoke);

    // --- Enjambres de criaturas voladoras (puntos oscuros que giran despacio) ---
    const n = 140;
    const p = new Float32Array(n * 3);
    for (let i = 0; i < n; i++) {
      const a = range(0, Math.PI * 2), r = range(70, 210);
      p[i * 3] = Math.cos(a) * r;
      p[i * 3 + 1] = range(45, 130);
      p[i * 3 + 2] = Math.sin(a) * r;
    }
    const fg = new THREE.BufferGeometry();
    fg.setAttribute('position', new THREE.BufferAttribute(p, 3));
    this.flyers = new THREE.Points(fg, new THREE.PointsMaterial({ color: 0x1c120b, size: 2.4, sizeAttenuation: false, fog: false }));
    this.flyers.frustumCulled = false;
    scene.add(this.flyers);
  }

  tick(dt: number) {
    this.t += dt;
    this.flyers.rotation.y += dt * 0.035;
    this.flyers.position.y = Math.sin(this.t * 0.4) * 2;
  }
}
