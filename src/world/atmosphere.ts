import * as THREE from 'three';
import { makeRng, terrainHeight, WRECK } from './terrain';

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

export function glowTexture(): THREE.Texture {
  const s = 64;
  const c = document.createElement('canvas');
  c.width = c.height = s;
  const g = c.getContext('2d')!;
  const grad = g.createRadialGradient(s / 2, s / 2, 0, s / 2, s / 2, s / 2);
  grad.addColorStop(0, 'rgba(255,240,200,1)');
  grad.addColorStop(0.3, 'rgba(255,150,50,0.8)');
  grad.addColorStop(1, 'rgba(255,80,0,0)');
  g.fillStyle = grad;
  g.fillRect(0, 0, s, s);
  return new THREE.CanvasTexture(c);
}

export class Atmosphere {
  private flyers: THREE.Points;
  private embers: THREE.Points;
  private emberVel: Float32Array;
  private dust: Array<{ sprite: THREE.Sprite; vx: number; vz: number }> = [];
  private focus = new THREE.Vector3();
  private fires: Array<{ sprite: THREE.Sprite; size: number; phase: number }> = [];
  private t = 0;

  constructor(scene: THREE.Scene, fires: Array<{ x: number; y: number; z: number; size: number }> = []) {
    const rng = makeRng(777);
    const range = (a: number, b: number) => a + rng() * (b - a);

    // --- Columnas de humo, a lo lejos, detrás de las paredes del cañón ---
    const plumes: Array<[number, number]> = [[-85, -125], [70, -135], [-100, 70], [95, 105], [30, 150], [-30, -190], [WRECK.x + 4, WRECK.z - 6]];
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

    // --- Fuego en los restos de la nave droide (destellos que parpadean) ---
    const glow = glowTexture();
    for (const f of fires) {
      const sprite = new THREE.Sprite(new THREE.SpriteMaterial({ map: glow, blending: THREE.AdditiveBlending, depthWrite: false, fog: false, transparent: true }));
      sprite.position.set(f.x, f.y, f.z);
      sprite.scale.setScalar(f.size);
      scene.add(sprite);
      this.fires.push({ sprite, size: f.size, phase: range(0, 6.28) });
    }

    // --- Brasas que flotan en el aire alrededor del jugador (como en las referencias) ---
    const ne = 150;
    const ep = new Float32Array(ne * 3);
    this.emberVel = new Float32Array(ne * 3);
    for (let i = 0; i < ne; i++) {
      ep[i * 3] = range(-34, 34); ep[i * 3 + 1] = range(0.3, 14); ep[i * 3 + 2] = range(-34, 34);
      this.emberVel[i * 3] = range(0.8, 2.2); this.emberVel[i * 3 + 1] = range(0.2, 1.1); this.emberVel[i * 3 + 2] = range(-0.6, 0.6);
    }
    const eg = new THREE.BufferGeometry();
    eg.setAttribute('position', new THREE.BufferAttribute(ep, 3));
    this.embers = new THREE.Points(eg, new THREE.PointsMaterial({ map: glowTexture(), color: 0xff9a40, size: 0.5, transparent: true, opacity: 0.95, blending: THREE.AdditiveBlending, depthWrite: false, fog: false }));
    this.embers.frustumCulled = false;
    scene.add(this.embers);

    // --- Polvo bajo: nubes grandes y suaves que se desplazan con el viento ---
    const puff = puffTexture();
    for (let i = 0; i < 14; i++) {
      const sprite = new THREE.Sprite(new THREE.SpriteMaterial({ map: puff, color: 0xc9966a, transparent: true, opacity: range(0.07, 0.13), depthWrite: false, fog: false }));
      sprite.scale.setScalar(range(14, 26));
      sprite.position.set(range(-60, 60), range(1.5, 6), range(-60, 60));
      sprite.renderOrder = 1;
      scene.add(sprite);
      this.dust.push({ sprite, vx: range(1.0, 2.4), vz: range(-0.5, 0.5) });
    }

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

  /** Posición del jugador: las brasas y el polvo se mueven con él. */
  follow(p: THREE.Vector3) {
    this.focus.copy(p);
  }

  tick(dt: number) {
    this.t += dt;
    // Brasas: suben y derivan con el viento; las que se alejan reaparecen al otro lado
    const pos = this.embers.geometry.attributes.position as THREE.BufferAttribute;
    const a = pos.array as Float32Array;
    const f = this.focus;
    for (let i = 0; i < a.length / 3; i++) {
      const k = i * 3;
      a[k] += this.emberVel[k] * dt + Math.sin(this.t * 1.3 + i) * 0.4 * dt;
      a[k + 1] += this.emberVel[k + 1] * dt;
      a[k + 2] += this.emberVel[k + 2] * dt + Math.cos(this.t * 1.1 + i * 2) * 0.4 * dt;
      if (a[k] - f.x > 34) a[k] -= 68; else if (a[k] - f.x < -34) a[k] += 68;
      if (a[k + 2] - f.z > 34) a[k + 2] -= 68; else if (a[k + 2] - f.z < -34) a[k + 2] += 68;
      if (a[k + 1] - f.y > 15) a[k + 1] -= 14.5; else if (a[k + 1] - f.y < -2) a[k + 1] += 14.5;
    }
    pos.needsUpdate = true;
    // Polvo: avanza con el viento y se recoloca alrededor del jugador
    for (const d of this.dust) {
      const p = d.sprite.position;
      p.x += d.vx * dt; p.z += d.vz * dt;
      if (p.x - f.x > 62) p.x -= 124; else if (p.x - f.x < -62) p.x += 124;
      if (p.z - f.z > 62) p.z -= 124; else if (p.z - f.z < -62) p.z += 124;
    }
    this.flyers.rotation.y += dt * 0.035;
    this.flyers.position.y = Math.sin(this.t * 0.4) * 2;
    for (const f of this.fires) {
      const k = 0.85 + 0.15 * Math.sin(this.t * 7 + f.phase) + 0.08 * Math.sin(this.t * 13.3 + f.phase * 2);
      f.sprite.scale.setScalar(f.size * k);
    }
  }
}
