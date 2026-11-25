import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { buildArms, type ArmsVariant } from './arms';
import { commandoModelReady, createFirstPersonArms, FP_STATE, type FirstPersonArms } from '../player/commandoModel';
import { EYE_STAND } from '../player/PlayerController';

// El bláster que se ve en pantalla. Va pegado a la cámara. El modelo 3D (public/models/blaster.bin + blaster-color.jpg) es el «E-5 Blaster Rifle»
// de A308 Digital (CC-BY 4.0, ver CRÉDITOS.md) y se genera con tools/convert-blaster.mjs. Si no se pudiera cargar, se usa uno de cajas.
interface BlasterModel { geo: THREE.BufferGeometry; map: THREE.Texture | null; muzzle: [number, number, number]; /** cuánto se aclara su textura */ bright: number }
let blasterModel: BlasterModel | null = null;
/** El modelo del bláster (para ponérselo en las manos al comando de la cinemática), o null si no cargó. */
export const blasterModelData = () => blasterModel;
const BLASTER_BRIGHT = 2.2 * 0.9; // el negro del arma un 10 % más oscuro
// Posición del arma en pantalla: desde la cadera (abajo a la derecha) y apuntando (centrada, un poco más arriba)
/** Posición del arma en pantalla (respecto a los ojos, en m: x derecha, y arriba, z hacia atrás), tamaño y cuánto sube al apuntar.
 *  Se puede cambiar en directo con el panel de ajuste del modo de pruebas. */
export const HIP = { x: 0.23, y: -0.2, z: -0.58, scale: 0.54, adsLift: 0.065 };

/**
 * Descarga el modelo del arma del jugador. Primero el DC-17m (public/models/dc17m.glb, «DC-17m» de goreduku, CC-BY 4.0, ver CRÉDITOS.md):
 * sus ~250 piezas se juntan en una sola malla, se gira para que el cañón mire hacia delante (−Z) y se escala al largo del arma de siempre.
 * Si falla, se usa el E-5 de antes (blaster.bin) y, si tampoco, uno de cajas.
 */
export async function loadBlasterModel(url: string): Promise<boolean> {
  try {
    const gltf = await new GLTFLoader().loadAsync(url.replace(/[^/]*$/, '') + 'dc17m.glb');
    gltf.scene.updateMatrixWorld(true);
    const geos: THREE.BufferGeometry[] = [];
    let map: THREE.Texture | null = null;
    gltf.scene.traverse((o) => {
      const m = o as THREE.Mesh;
      if (!m.isMesh) return;
      const g = m.geometry.clone();
      for (const k of Object.keys(g.attributes)) if (k !== 'position' && k !== 'normal' && k !== 'uv') g.deleteAttribute(k);
      g.applyMatrix4(m.matrixWorld);
      geos.push(g.index ? g : g.setIndex([...Array(g.attributes.position.count).keys()]));
      map ??= (m.material as THREE.MeshStandardMaterial).map ?? null;
    });
    const geo = mergeGeometries(geos, false)!;
    for (const g of geos) g.dispose();
    // el modelo trae el cañón hacia +X: se gira para que mire a −Z (y la carga lateral queda a la izquierda, como en el arma real)
    geo.rotateY(Math.PI / 2);
    geo.computeBoundingBox();
    const bb = geo.boundingBox!;
    const s = DC17.largo / (bb.max.z - bb.min.z);
    geo.translate(-(bb.min.x + bb.max.x) / 2, 0, -bb.min.z);
    geo.scale(s, s, s);
    geo.translate(0, 0, DC17.boca);
    geo.computeBoundingBox();
    // altura del cañón: el centro de lo que hay en la punta
    const p = geo.attributes.position as THREE.BufferAttribute;
    let x0 = 0, y0 = 0, n = 0;
    for (let i = 0; i < p.count; i++) if (p.getZ(i) < DC17.boca + 0.02) { x0 += p.getX(i); y0 += p.getY(i); n++; }
    // el cañón en el centro y a la misma altura que el arma de antes (la carga lateral no cuenta para centrarla)
    geo.translate(n ? -x0 / n : 0, DC17.alturaCanon - (n ? y0 / n : 0), 0);
    geo.computeBoundingSphere();
    geo.computeBoundingBox();
    if (map) { (map as THREE.Texture).colorSpace = THREE.SRGBColorSpace; (map as THREE.Texture).anisotropy = 4; }
    blasterModel = { geo, map, muzzle: [0, DC17.alturaCanon, DC17.boca], bright: DC17.brillo };
    return true;
  } catch (e) {
    console.warn('No se pudo cargar el DC-17m; se prueba con el bláster de antes.', e);
  }
  return loadOldBlaster(url);
}

/** Medidas del DC-17m en el sistema del arma (las mismas unidades que el arma de antes): largo total, dónde está la boca (z) y a qué altura va el cañón. */
export const DC17 = { largo: 0.8, boca: -0.45, alturaCanon: 0, /** cuánto se aclara la textura (1 = tal cual) */ brillo: 1.05 };

/** El bláster E-5 de antes (respaldo). */
async function loadOldBlaster(url: string): Promise<boolean> {
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
      map.flipY = false;
      map.colorSpace = THREE.SRGBColorSpace;
      map.anisotropy = 4;
    } catch (e) {
      console.warn('No se pudo cargar la textura del bláster; se usa gris liso.', e);
    }
    blasterModel = { geo, map, muzzle: h.muzzle, bright: BLASTER_BRIGHT };
    return true;
  } catch (e) {
    console.warn('No se pudo cargar el modelo del bláster; se usa el de respaldo.', e);
    blasterModel = null;
    return false;
  }
}

export { FP_STATE };

export class ViewModel {
  readonly group = new THREE.Group();
  readonly muzzle = new THREE.Object3D();
  private body: THREE.MeshLambertMaterial;
  private arms: THREE.Mesh | null = null;
  private modelArms: FirstPersonArms | null = null;
  /** Capa propia: brazos y arma se dibujan en su propia escena, después del escenario y siempre por encima (no atraviesan paredes ni rocas). */
  readonly scene = new THREE.Scene();
  /** Cámara de esa capa: sigue a la del juego, con el plano cercano muy pegado (los antebrazos van muy cerca de los ojos). */
  readonly cam = new THREE.PerspectiveCamera(72, 1, 0.01, 10);
  private sunLight = new THREE.DirectionalLight(0xffe9b0, 3.9);
  private fillLight = new THREE.DirectionalLight(0x9a6038, 0.9);
  private gun: THREE.Mesh | null = null;
  private rc = new THREE.Raycaster();
  private kick = 0;
  private flashSprite: THREE.Sprite;
  private grenade = new THREE.Group();
  private bRaise = 1; // 0 = guardada, 1 = en la mano
  private gRaise = 0;
  private throwT = 0;
  private cold = new THREE.Color(0x000000);
  private hot = new THREE.Color(0x9a2408); // con el modelo con textura (más claro) el rojo del calor es más suave

  constructor(_camera: THREE.Camera, sunDir: THREE.Vector3 = new THREE.Vector3(0.5, 0.45, 0.7)) {
    const camera = this.cam;
    // Luz de la capa: la misma que el escenario (cielo, rebote del suelo, sol y relleno)
    this.scene.add(new THREE.HemisphereLight(0xa99bbb, 0xa65e38, 1.5), this.cam, this.sunLight, this.sunLight.target, this.fillLight, this.fillLight.target);
    this.sunLight.position.copy(sunDir).normalize();
    this.fillLight.position.set(-sunDir.x, 0.25, -sunDir.z).normalize();
    if (blasterModel) {
      // El gris oscuro de la textura se aclara un poco para que no se pierda con la luz cálida de Geonosis.
      this.body = new THREE.MeshLambertMaterial({ map: blasterModel.map, color: blasterModel.map ? 0xffffff : 0x3b3f45, fog: false });
      if (blasterModel.map) this.body.color.setScalar(blasterModel.bright);
      this.hot.set(0x5a1503);
      this.gun = new THREE.Mesh(blasterModel.geo, this.body);
      this.group.add(this.gun);
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
    // Brazos: los del modelo del clon comando (si cargó); si no, los de formas sencillas (propuesta A)
    if (commandoModelReady()) {
      this.modelArms = createFirstPersonArms(1.85, EYE_STAND);
      camera.add(this.modelArms.root); // los agarres de cada mano están en FP_HANDS (sistema del arma)
    } else this.setArms('A');
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

  /** Pone las manos en sus agarres (también lo usa el panel de ajuste). */
  solveHands() {
    if (!this.modelArms) return;
    this.cam.updateMatrixWorld(true);
    const gun = this.gun ?? this.group;
    const dir = new THREE.Vector3();
    const hits = (a: THREE.Vector3, b: THREE.Vector3) => {
      if (!this.gun) return false;
      const len = dir.subVectors(b, a).length();
      if (len < 1e-5) return false;
      this.rc.set(a, dir.divideScalar(len));
      this.rc.far = len;
      return this.rc.intersectObject(this.gun, false).length > 0;
    };
    this.modelArms.solve(gun, this.cam, hits);
  }

  /** La capa del arma sigue a la cámara del juego (posición, giro, campo de visión y proporción). */
  syncCamera(camera: THREE.PerspectiveCamera) {
    camera.updateMatrixWorld();
    camera.matrixWorld.decompose(this.cam.position, this.cam.quaternion, this.cam.scale);
    if (this.cam.fov !== camera.fov || this.cam.aspect !== camera.aspect) { this.cam.fov = camera.fov; this.cam.aspect = camera.aspect; this.cam.updateProjectionMatrix(); }
    this.cam.updateMatrixWorld(true);
    // las luces direccionales se colocan junto a la cámara (solo importa su dirección)
    for (const l of [this.sunLight, this.fillLight]) {
      const d = l.position.clone().sub(l.target.position).normalize();
      l.target.position.copy(this.cam.position);
      l.position.copy(this.cam.position).add(d);
      l.target.updateMatrixWorld();
    }
  }

  /** Esconde el arma por debajo de la imagen: en cuanto se actualice, sube a su sitio (al empezar tras la cinemática). */
  lowerNow() {
    this.bRaise = 0;
    this.group.visible = false;
  }

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
    if (this.group.scale.x !== HIP.scale) this.group.scale.setScalar(HIP.scale);
    this.group.rotation.x = this.kick * 0.07;
    if (this.modelArms) {
      // las manos siguen al arma (al apuntar, al disparar, al cambiar de arma)
      this.modelArms.root.visible = this.group.visible;
      if (this.group.visible) this.solveHands();
    }
    // El arma se pone al rojo con el calor.
    this.body.emissive.copy(this.cold).lerp(this.hot, Math.max(0, heat - 0.35) / 0.65);
  }
}
