import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { buildArms, type ArmsVariant } from './arms';
import { commandoModelReady, createFirstPersonArms, FP_GRENADE, FP_STATE, grenadeOffset, type FirstPersonArms, type FreePose, type LeftFree } from '../player/commandoModel';
import { EYE_STAND } from '../player/PlayerController';

// El bláster que se ve en pantalla. Va pegado a la cámara. El modelo 3D (public/models/blaster.bin + blaster-color.jpg) es el «E-5 Blaster Rifle»
// de A308 Digital (CC-BY 4.0, ver CRÉDITOS.md) y se genera con tools/convert-blaster.mjs. Si no se pudiera cargar, se usa uno de cajas.
interface BlasterModel { geo: THREE.BufferGeometry; map: THREE.Texture | null; muzzle: [number, number, number]; /** cuánto se aclara su textura */ bright: number }
let blasterModel: BlasterModel | null = null;
/** El modelo del bláster (para ponérselo en las manos al comando de la cinemática), o null si no cargó. */
export const blasterModelData = () => blasterModel;
/** El E-5 de antes (lo lleva el clon normal de la cinemática), o null si no cargó. */
let e5Model: BlasterModel | null = null;
export const e5ModelData = () => e5Model;
const BLASTER_BRIGHT = 2.2 * 0.9; // el negro del arma un 10 % más oscuro
// Posición del arma en pantalla: desde la cadera (abajo a la derecha) y apuntando (centrada, un poco más arriba)
/** Posición del arma en pantalla (respecto a los ojos, en m: x derecha, y arriba, z hacia atrás), tamaño y cuánto sube al apuntar.
 *  Se puede cambiar en directo con el panel de ajuste del modo de pruebas. */
export const HIP = { x: 0.26, y: -0.184, z: -0.624, scale: 0.905, adsLift: 0.102 }; // valores de Víctor (panel de ajuste)

/**
 * Descarga el modelo del arma del jugador. Primero el DC-17m (public/models/dc17m.glb, «DC-17m» de goreduku, CC-BY 4.0, ver CRÉDITOS.md):
 * sus ~250 piezas se juntan en una sola malla, se gira para que el cañón mire hacia delante (−Z) y se escala al largo del arma de siempre.
 * Si falla, se usa el E-5 de antes (blaster.bin) y, si tampoco, uno de cajas.
 */
export async function loadBlasterModel(url: string): Promise<boolean> {
  const old = loadOldBlaster(url); // el E-5 se carga siempre (respaldo del jugador y arma del clon normal de la cinemática)
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
    await old;
    return true;
  } catch (e) {
    console.warn('No se pudo cargar el DC-17m; se usa el bláster de antes.', e);
  }
  blasterModel = await old;
  return blasterModel !== null;
}

/** Medidas del DC-17m en el sistema del arma (las mismas unidades que el arma de antes): largo total, dónde está la boca (z) y a qué altura va el cañón. */
/** Granada en la mano: detonador térmico (public/models/detonator.glb, «Star Wars Genesis - Thermal_detonator_low» de Léonard Doye /
 *  Leoskateman, CC-BY 4.0, ver CRÉDITOS.md; hecho con tools/convert-ship.mjs, 10 cm). Si no carga, la esfera de antes. */
let detonatorModel: THREE.Object3D | null = null;
export async function loadDetonatorModel(url: string) {
  try { detonatorModel = (await new GLTFLoader().loadAsync(url)).scene; } catch (e) { console.warn('no se pudo cargar el detonador térmico', e); }
}
/** Solo si faltan los brazos del comando (la granada flota en pantalla): giro (rad) para que el panel de luces mire a la cámara. */
export const DETONATOR_HOLD = { yaw: -Math.PI / 2 + 0.05, pitch: 0.2, roll: 0 };

// ---------- Gesto de la granada (mano izquierda) ----------
type NadePhase = 'none' | 'reach' | 'hold' | 'throw' | 'back';
/** Tiempos del gesto (s). Coger: suelta el rifle y llega al cinturón (`cinturon`) y sube con la granada (`coger`).
 *  Lanzar: impulso atrás (`impulso`), brazo adelante (`lanzar`; la granada sale en `suelta`) y vuelta al rifle (`vuelve`). */
export const NADE_T = { cinturon: 0.2, coger: 0.5, impulso: 0.13, suelta: 0.21, lanzar: 0.26, baja: 0.4, vuelve: 0.66 };
/** Posturas del gesto, como desplazamiento sobre la de sujetar (FP_GRENADE.mano): pos (m, sistema de la cámara), rot (grados), lado/abajo (grados). */
export const NADE_POSES: Record<'cinturon' | 'impulso' | 'lanzar', FreePose> = {
  cinturon: { pos: [-0.05, -0.42, 0.25], rot: [0, 0, 0], lado: 15, abajo: 20 }, // la mano baja al cinturón (fuera de la imagen)
  impulso: { pos: [0.01, 0.05, 0.1], rot: [-30, 0, 0], lado: 0, abajo: 0 }, // coge impulso hacia atrás
  lanzar: { pos: [0.08, 0.08, -0.16], rot: [35, 0, 0], lado: 10, abajo: -10 }, // el brazo se estira hacia delante y arriba
};
const offsetPose = (p: FreePose, d: FreePose): FreePose => ({
  pos: [p.pos[0] + d.pos[0], p.pos[1] + d.pos[1], p.pos[2] + d.pos[2]],
  rot: [p.rot[0] + d.rot[0], p.rot[1] + d.rot[1], p.rot[2] + d.rot[2]],
  lado: p.lado + d.lado, abajo: Math.min(89, p.abajo + d.abajo),
});
const lerpPose = (a: FreePose, b: FreePose, k: number): FreePose => ({
  pos: [0, 1, 2].map((i) => a.pos[i] + (b.pos[i] - a.pos[i]) * k) as [number, number, number],
  rot: [0, 1, 2].map((i) => a.rot[i] + (b.rot[i] - a.rot[i]) * k) as [number, number, number],
  lado: a.lado + (b.lado - a.lado) * k, abajo: a.abajo + (b.abajo - a.abajo) * k,
});

export const DC17 = { largo: 0.8, boca: -0.45, alturaCanon: 0, /** cuánto se aclara la textura (1 = tal cual) */ brillo: 1.05 };

/** El bláster E-5 de antes (respaldo). */
async function loadOldBlaster(url: string): Promise<BlasterModel | null> {
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
    e5Model = { geo, map, muzzle: h.muzzle, bright: BLASTER_BRIGHT };
    return e5Model;
  } catch (e) {
    console.warn('No se pudo cargar el bláster E-5.', e);
    e5Model = null;
    return null;
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
  /** Granada con la mano izquierda: fase (coger del cinturón, sujetar, lanzar, devolverla) y tiempo dentro de ella. */
  private nade = { phase: 'none' as NadePhase, t: 0, release: false, frozen: false, preview: false, thrown: false };
  /** Cuánto ha bajado el rifle por la granada (0..1). */
  private rifleDown = 0;
  /** Se llama en el instante en que la granada sale de la mano: dónde está (en el mundo; null = desde los ojos) y si es solo una prueba del panel. */
  onGrenadeRelease: ((at: THREE.Vector3 | null, preview: boolean) => void) | null = null;
  private cold = new THREE.Color(0x000000);
  private hot = new THREE.Color(0x9a2408); // con el modelo con textura (más claro) el rojo del calor es más suave

  /** Cambia de dónde viene el sol (al pasar a la arena). */
  setSun(sunDir: THREE.Vector3) {
    this.sunLight.position.copy(sunDir).normalize();
    this.fillLight.position.set(-sunDir.x, 0.25, -sunDir.z).normalize();
  }

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

    // Granada en la mano: el detonador térmico (si cargó) o la esfera verde con la anilla de antes
    if (detonatorModel) {
      const det = detonatorModel;
      det.traverse((o) => {
        const m = o as THREE.Mesh;
        if (!m.isMesh) return;
        const src = m.material as THREE.MeshStandardMaterial;
        m.material = new THREE.MeshLambertMaterial({
          map: src.map, normalMap: src.normalMap, emissiveMap: src.emissiveMap, emissive: src.emissive, emissiveIntensity: Math.min(src.emissiveIntensity, 3), fog: false,
        });
      });
      // con los brazos del comando la granada va en la mano izquierda (se coloca cada fotograma en la palma); si no, flota como antes
      if (!this.modelArms) det.rotation.set(DETONATOR_HOLD.pitch, DETONATOR_HOLD.yaw, DETONATOR_HOLD.roll, 'YXZ');
      this.grenade.add(det); // ya mide 10 cm
    } else {
      const gm = new THREE.MeshLambertMaterial({ color: 0x4d5a3c, fog: false });
      const gs = new THREE.Mesh(new THREE.SphereGeometry(0.075, 10, 8), gm);
      const cap = new THREE.Mesh(new THREE.CylinderGeometry(0.03, 0.03, 0.05, 8), new THREE.MeshLambertMaterial({ color: 0x2b2f26, fog: false }));
      cap.position.y = 0.085;
      const ring = new THREE.Mesh(new THREE.TorusGeometry(0.03, 0.006, 6, 12), new THREE.MeshLambertMaterial({ color: 0xb9b9b0, fog: false }));
      ring.position.set(0.04, 0.1, 0);
      this.grenade.add(gs, cap, ring);
      this.grenade.scale.setScalar(0.7);
    }
    this.grenade.visible = false;
    if (this.modelArms) this.scene.add(this.grenade); // en la mano (posición en el mundo de esta capa)
    else camera.add(this.grenade);
  }

  /** ¿Está la mano izquierda ocupada con la granada? (mientras, no se dispara ni se apunta) */
  get grenadeBusy() { return this.nade.phase !== 'none'; }

  /** Botón de granada pulsado: la mano izquierda suelta el rifle y coge la granada del cinturón. `preview` = prueba del panel (no lanza de verdad). */
  grenadeStart(preview = false) {
    if (this.nade.phase !== 'none') return false;
    Object.assign(this.nade, { phase: 'reach', t: 0, release: false, preview, thrown: false });
    return true;
  }

  /** ¿Tiene (o está cogiendo) la granada en la mano, sin haberla lanzado aún? */
  get grenadeHolding() { return this.nade.phase === 'reach' || this.nade.phase === 'hold'; }

  /** Disparo con la granada en la mano: la lanza (en cuanto la tenga en la mano). */
  grenadeRelease() {
    if (this.grenadeHolding) this.nade.release = true;
  }

  /** Botón de granada otra vez: la guarda en el cinturón sin lanzarla y la mano vuelve al rifle. */
  grenadePutAway() {
    if (this.grenadeHolding) Object.assign(this.nade, { phase: 'back', t: 0, release: false, frozen: false });
  }

  /** Panel de ajuste: deja la postura de sujetar la granada quieta en pantalla (o la quita y la mano vuelve al rifle sin lanzar). */
  grenadeFreeze(on: boolean) {
    this.nade.frozen = on;
    if (on) { if (this.nade.phase === 'none') this.grenadeStart(true); this.nade.release = false; }
    else this.grenadePutAway();
  }
  get grenadeFrozen() { return this.nade.frozen; }

  /** Panel de ajuste: el gesto completo (coger, sujetar un momento y lanzar), sin lanzar una granada de verdad. */
  grenadePreview() {
    this.nade.frozen = false;
    if (this.nade.phase === 'none') this.grenadeStart(true);
    this.nade.preview = true;
    this.nade.release = true;
  }

  /** Quita la granada de la mano al instante (al empezar o acabar una partida, en las cinemáticas…). */
  grenadeReset() {
    Object.assign(this.nade, { phase: 'none', t: 0, release: false, frozen: false, preview: false, thrown: false });
    this.rifleDown = 0;
    this.grenade.visible = false;
  }

  /** Avanza el gesto de la granada y devuelve cómo está la mano izquierda (o null si está en el rifle). */
  private stepGrenade(dt: number): LeftFree | null {
    const n = this.nade, T = NADE_T;
    if (n.phase === 'none') { this.rifleDown = 0; return null; }
    n.t += dt;
    const sm = (x: number) => { const c = Math.min(1, Math.max(0, x)); return c * c * (3 - 2 * c); };
    const hold = FP_GRENADE.mano;
    const belt = offsetPose(hold, NADE_POSES.cinturon);
    let out: LeftFree = { w: 1, pose: hold, open: 1, grip: 1 };
    let ball = true;
    if (n.phase === 'reach') {
      // suelta el rifle y baja al cinturón (fuera de la imagen); vuelve con la granada a la postura de sujetarla
      const a = n.t / T.cinturon;
      if (a < 1) { out = { w: sm(a), pose: belt, open: sm(a), grip: 0 }; ball = false; }
      else out = { w: 1, pose: lerpPose(belt, hold, sm((n.t - T.cinturon) / (T.coger - T.cinturon))), open: 1, grip: sm((n.t - T.cinturon) / 0.12) };
      this.rifleDown = sm(n.t / 0.25);
      if (n.t >= T.coger) { n.phase = 'hold'; n.t = 0; }
    } else if (n.phase === 'hold') {
      this.rifleDown = 1;
      if (n.release && !n.frozen) { n.phase = 'throw'; n.t = 0; n.thrown = false; }
    } else if (n.phase === 'throw') {
      // coge impulso hacia atrás, lanza hacia delante (la granada sale a mitad del gesto) y la mano vuelve al rifle
      const wind = offsetPose(hold, NADE_POSES.impulso), fwd = offsetPose(hold, NADE_POSES.lanzar);
      const t = n.t;
      if (t < T.impulso) out = { w: 1, pose: lerpPose(hold, wind, sm(t / T.impulso)), open: 1, grip: 1 };
      else if (t < T.lanzar) out = { w: 1, pose: lerpPose(wind, fwd, sm((t - T.impulso) / (T.lanzar - T.impulso))), open: 1, grip: 1 - sm((t - T.suelta) / 0.06) };
      // tras soltarla, la mano baja fuera de la imagen (así no se ve el brazo estirado) y sube desde abajo al guardamanos
      else if (t < T.baja) out = { w: 1, pose: lerpPose(fwd, belt, sm((t - T.lanzar) / (T.baja - T.lanzar))), open: 1, grip: 0 };
      else out = { w: 1 - sm((t - T.baja) / (T.vuelve - T.baja)), pose: belt, open: 1 - sm((t - T.baja) / (T.vuelve - T.baja)), grip: 0 };
      ball = t < T.suelta;
      if (t >= T.suelta && !n.thrown) {
        n.thrown = true;
        const at = this.modelArms ? this.grenade.getWorldPosition(new THREE.Vector3()) : null;
        this.onGrenadeRelease?.(at, n.preview);
      }
      this.rifleDown = 1 - sm((t - T.baja) / (T.vuelve - T.baja));
      if (t >= T.vuelve) { this.grenadeReset(); return null; }
    } else if (n.phase === 'back') {
      // sin lanzar: la granada vuelve al cinturón y la mano al rifle
      const t = n.t, half = T.cinturon * 1.2;
      if (t < half) out = { w: 1, pose: lerpPose(hold, belt, sm(t / half)), open: 1, grip: 1 };
      else { out = { w: 1 - sm((t - half) / half), pose: belt, open: 1 - sm((t - half) / half), grip: 0 }; ball = false; }
      this.rifleDown = 1 - sm(t / (half * 2));
      if (t >= half * 2) { this.grenadeReset(); return null; }
    }
    this.grenade.visible = ball;
    return out;
  }

  /** Brazos de armadura clon sujetando el arma (dos propuestas: A y B). */
  setArms(v: ArmsVariant | null) {
    if (this.arms) { this.group.remove(this.arms); this.arms.geometry.dispose(); this.arms = null; }
    if (v) { this.arms = buildArms(v); this.group.add(this.arms); }
  }

  shot() { this.kick = 1; }

  /** Pone las manos en sus agarres (también lo usa el panel de ajuste). */
  solveHands(left?: LeftFree) {
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
    this.modelArms.solve(gun, this.cam, hits, left);
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
  update(dt: number, heat: number, zoom = 0) {
    this.kick = Math.max(0, this.kick - dt * 9);
    (this.flashSprite.material as THREE.SpriteMaterial).opacity = Math.max(0, (this.kick - 0.45) / 0.55);
    this.flashSprite.scale.setScalar(0.28 + 0.2 * this.kick);
    // El arma sube a su sitio (si se había escondido, al empezar tras la cinemática)
    const k = Math.min(1, dt * 11);
    this.bRaise += (1 - this.bRaise) * k;
    // Granada: gesto de la mano izquierda (coger, sujetar, lanzar)
    const left = this.stepGrenade(dt);
    if (!this.modelArms) {
      // sin los brazos del comando: la granada flota abajo a la derecha como antes
      const busy = this.nade.phase === 'reach' || this.nade.phase === 'hold';
      this.gRaise += ((busy ? 1 : 0) - this.gRaise) * k;
      if (this.nade.phase === 'throw' && this.nade.t <= dt) this.throwT = 1;
      this.throwT = Math.max(0, this.throwT - dt * 5);
      this.grenade.visible = this.gRaise > 0.04 || this.throwT > 0;
      this.grenade.position.set(0.15, -0.17 - (1 - this.gRaise) * 0.3 + this.throwT * 0.05, -0.36 - this.throwT * 0.5);
      this.grenade.rotation.x = this.throwT * 1.2;
    }
    this.group.visible = this.bRaise > 0.04;
    zoom = zoom * this.bRaise;
    // mientras la mano izquierda está con la granada, el rifle baja un poco, se aparta y se inclina (lo sujeta solo la derecha)
    const R = FP_GRENADE.rifle, d = this.rifleDown;
    this.group.position.x = HIP.x * (1 - zoom * 0.9) + R.aparta * d;
    this.group.position.y = HIP.y + zoom * HIP.adsLift - (1 - this.bRaise) * 0.3 - R.baja * d;
    this.group.position.z = HIP.z + this.kick * 0.05 * (1 - zoom * 0.5);
    if (this.group.scale.x !== HIP.scale) this.group.scale.setScalar(HIP.scale);
    this.group.rotation.x = this.kick * 0.07;
    this.group.rotation.z = -THREE.MathUtils.degToRad(R.gira) * d;
    if (this.modelArms) {
      // las manos siguen al arma (al apuntar, al disparar, al cambiar de arma); la izquierda, a la granada si la lleva
      this.modelArms.root.visible = this.group.visible;
      if (this.group.visible) this.solveHands(left ?? undefined);
      if (left && this.grenade.visible) {
        // la granada, apoyada en la palma de la mano izquierda
        const palm = this.modelArms.leftPalm;
        this.grenade.position.copy(palm.pos).add(grenadeOffset(FP_GRENADE.granada.pos, palm.q));
        const r = FP_GRENADE.granada.rot.map((v) => THREE.MathUtils.degToRad(v)) as [number, number, number];
        this.grenade.quaternion.copy(palm.q).multiply(new THREE.Quaternion().setFromEuler(new THREE.Euler(...r, 'XYZ')));
      }
    }
    // El arma se pone al rojo con el calor.
    this.body.emissive.copy(this.cold).lerp(this.hot, Math.max(0, heat - 0.35) / 0.65);
  }
}
