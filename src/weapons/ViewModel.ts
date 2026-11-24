import * as THREE from 'three';
import { buildArms, type ArmsVariant } from './arms';

// El bláster que se ve en pantalla. Va pegado a la cámara. El modelo 3D (public/models/blaster.bin + blaster-color.jpg) es el «E-5 Blaster Rifle»
// de A308 Digital (CC-BY 4.0, ver CRÉDITOS.md) y se genera con tools/convert-blaster.mjs. Si no se pudiera cargar, se usa uno de cajas.
interface BlasterModel { geo: THREE.BufferGeometry; map: THREE.Texture | null; muzzle: [number, number, number] }
let blasterModel: BlasterModel | null = null;
const BLASTER_BRIGHT = 2.2;
// Posición del arma en pantalla: desde la cadera (abajo a la derecha) y apuntando (centrada, un poco más arriba)
const HIP = { x: 0.23, y: -0.2, z: -0.58, scale: 0.54, adsLift: 0.065 };

/** Descarga el modelo del bláster del jugador. Si falla, el arma se dibuja con cajas (modelo de respaldo). Llamarlo antes de crear el ViewModel. */
export async function loadBlasterModel(url: string): Promise<boolean> {
  try {
    const res = await fetch(url);
    if (!res.ok) throw new Error('HTTP ' + res.status);
    const buf = await res.arrayBuffer();
    const dv = new DataView(buf);
    if (String.fromCharCode(dv.getUint8(0), dv.getUint8(1), dv.getUint8(2), dv.getUint8(3)) !== 'BLS1') throw new Error('formato desconocido');
    const hl = dv.getUint32(4, true);
    const h = JSON.parse(new TextDecoder().decode(new Uint8Array(buf, 8, hl)));
    const base = 8 + hl + ((4 - ((8 + hl) % 4)) % 4);
    const geo = new THREE.BufferGeometry();
    geo.setIndex(new THREE.BufferAttribute(new Uint16Array(buf.slice(base + h.index, base + h.index + h.indices * 2)), 1));
    geo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(buf.slice(base + h.pos, base + h.pos + h.verts * 12)), 3));
    geo.setAttribute('normal', new THREE.BufferAttribute(new Int8Array(buf.slice(base + h.nor, base + h.nor + h.verts * 3)), 3, true));
    geo.setAttribute('uv', new THREE.BufferAttribute(new Float32Array(buf.slice(base + h.uv, base + h.uv + h.verts * 8)), 2));
    geo.computeBoundingSphere();
    let map: THREE.Texture | null = null;
    try {
      map = await new THREE.TextureLoader().loadAsync(url.replace(/[^/]*$/, '') + h.texture);
      map.flipY = false; // coordenadas de textura con el origen arriba a la izquierda (como en glTF)
      map.colorSpace = THREE.SRGBColorSpace;
      map.anisotropy = 4;
    } catch (e) {
      console.warn('No se pudo cargar la textura del bláster; se usa gris liso.', e);
    }
    blasterModel = { geo, map, muzzle: h.muzzle };
    return true;
  } catch (e) {
    console.warn('No se pudo cargar el modelo del bláster; se usa el de respaldo.', e);
    blasterModel = null;
    return false;
  }
}

export class ViewModel {
  readonly group = new THREE.Group();
  readonly muzzle = new THREE.Object3D();
  private body: THREE.MeshLambertMaterial;
  private arms: THREE.Mesh | null = null;
  private kick = 0;
  private flashSprite: THREE.Sprite;
  private grenade = new THREE.Group();
  private bRaise = 1; // 0 = guardada, 1 = en la mano
  private gRaise = 0;
  private throwT = 0;
  private cold = new THREE.Color(0x000000);
  private hot = new THREE.Color(0x9a2408); // con el modelo con textura (más claro) el rojo del calor es más suave

  constructor(camera: THREE.Camera) {
    if (blasterModel) {
      // El gris oscuro de la textura se aclara un poco para que no se pierda con la luz cálida de Geonosis.
      this.body = new THREE.MeshLambertMaterial({ map: blasterModel.map, color: blasterModel.map ? 0xffffff : 0x3b3f45, fog: false });
      if (blasterModel.map) this.body.color.setScalar(BLASTER_BRIGHT);
      this.hot.set(0x5a1503);
      this.group.add(new THREE.Mesh(blasterModel.geo, this.body));
      this.muzzle.position.set(...blasterModel.muzzle);
    } else {
      this.body = new THREE.MeshLambertMaterial({ color: 0x3b3f45, fog: false });
      const dark = new THREE.MeshLambertMaterial({ color: 0x1d1f22, fog: false });
      const box = (w: number, h: number, d: number, x: number, y: number, z: number, m: THREE.Material) => {
        const mesh = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), m);
        mesh.position.set(x, y, z);
        this.group.add(mesh);
      };
      box(0.06, 0.08, 0.34, 0, 0, 0, this.body); // cuerpo
      box(0.035, 0.035, 0.22, 0, 0.012, -0.27, dark); // cañón
      box(0.045, 0.11, 0.06, 0, -0.085, 0.09, dark); // empuñadura
      box(0.03, 0.03, 0.12, 0, 0.055, -0.02, dark); // mira
      this.muzzle.position.set(0, 0.012, -0.4);
    }
    this.group.add(this.muzzle);
    this.setArms('A'); // propuesta A elegida (se revisa antes de subir)
    // Destello azul al disparar (dura una fracción de segundo)
    const fc = document.createElement('canvas'); fc.width = fc.height = 64;
    const fg = fc.getContext('2d')!;
    const fgrad = fg.createRadialGradient(32, 32, 0, 32, 32, 32);
    fgrad.addColorStop(0, 'rgba(255,255,255,1)'); fgrad.addColorStop(0.35, 'rgba(150,215,255,0.85)'); fgrad.addColorStop(1, 'rgba(60,140,255,0)');
    fg.fillStyle = fgrad; fg.fillRect(0, 0, 64, 64);
    this.flashSprite = new THREE.Sprite(new THREE.SpriteMaterial({ map: new THREE.CanvasTexture(fc), blending: THREE.AdditiveBlending, depthWrite: false, transparent: true, fog: false, opacity: 0 }));
    this.flashSprite.scale.setScalar(0.34);
    this.muzzle.add(this.flashSprite);
    this.group.position.set(HIP.x, HIP.y, HIP.z);
    this.group.scale.setScalar(HIP.scale);
    camera.add(this.group);

    // Granada en la mano: esfera verde con la anilla
    const gm = new THREE.MeshLambertMaterial({ color: 0x4d5a3c, fog: false });
    const gs = new THREE.Mesh(new THREE.SphereGeometry(0.075, 10, 8), gm);
    const cap = new THREE.Mesh(new THREE.CylinderGeometry(0.03, 0.03, 0.05, 8), new THREE.MeshLambertMaterial({ color: 0x2b2f26, fog: false }));
    cap.position.y = 0.085;
    const ring = new THREE.Mesh(new THREE.TorusGeometry(0.03, 0.006, 6, 12), new THREE.MeshLambertMaterial({ color: 0xb9b9b0, fog: false }));
    ring.position.set(0.04, 0.1, 0);
    this.grenade.add(gs, cap, ring);
    this.grenade.visible = false;
    this.grenade.scale.setScalar(0.7);
    camera.add(this.grenade);
  }

  /** Brazos de armadura clon sujetando el arma (dos propuestas: A y B). */
  setArms(v: ArmsVariant | null) {
    if (this.arms) { this.group.remove(this.arms); this.arms.geometry.dispose(); this.arms = null; }
    if (v) { this.arms = buildArms(v); this.group.add(this.arms); }
  }

  /** Animación de lanzamiento: la granada sale disparada hacia delante. */
  throwAnim() { this.throwT = 1; }

  shot() { this.kick = 1; }

  /** `zoom` va de 0 (desde la cadera) a 1 (apuntando): el arma se centra y baja un poco. */
  update(dt: number, heat: number, zoom = 0, weapon: 'blaster' | 'grenade' = 'blaster') {
    this.kick = Math.max(0, this.kick - dt * 9);
    (this.flashSprite.material as THREE.SpriteMaterial).opacity = Math.max(0, (this.kick - 0.45) / 0.55);
    this.flashSprite.scale.setScalar(0.28 + 0.2 * this.kick);
    // Se guarda un arma bajándola y se saca la otra subiéndola
    const k = Math.min(1, dt * 11);
    this.bRaise += ((weapon === 'blaster' ? 1 : 0) - this.bRaise) * k;
    this.gRaise += ((weapon === 'grenade' ? 1 : 0) - this.gRaise) * k;
    this.throwT = Math.max(0, this.throwT - dt * 5);
    this.group.visible = this.bRaise > 0.04;
    this.grenade.visible = this.gRaise > 0.04 || this.throwT > 0;
    this.grenade.position.set(0.15, -0.17 - (1 - this.gRaise) * 0.3 + this.throwT * 0.05, -0.36 - this.throwT * 0.5);
    this.grenade.rotation.x = this.throwT * 1.2;
    zoom = zoom * this.bRaise;
    this.group.position.x = HIP.x * (1 - zoom * 0.9);
    this.group.position.y = HIP.y + zoom * HIP.adsLift - (1 - this.bRaise) * 0.3;
    this.group.position.z = HIP.z + this.kick * 0.05 * (1 - zoom * 0.5);
    this.group.rotation.x = this.kick * 0.07;
    // El arma se pone al rojo con el calor.
    this.body.emissive.copy(this.cold).lerp(this.hot, Math.max(0, heat - 0.35) / 0.65);
  }
}
