import * as THREE from 'three';
import { DecalGeometry } from 'three/addons/geometries/DecalGeometry.js';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { Builder } from './builder';
import { GUNSHIP_FIRES, GUNSHIP_FX } from './crashFx';
import { CRASH, terrainHeight } from './terrain';

// Cañonera LAAT derribada. El modelo 3D (public/models/laat.bin) se genera con tools/convert-laat.mjs a partir del glTF
// «LAAT - Low Altitude Assault Transport» de Mind Mulch for The Masses (CC-BY 4.0, ver CRÉDITOS.md).
// El modelo NO se edita: se coloca inclinada y hundida en la arena, y los daños (hollín, humo, chispas, fuego) se simulan encima.
// Del casco se ha separado un ala (el converter la corta junto al fuselaje): queda tirada cerca, como cobertura extra.
// Marco del modelo (metros reales): +X = morro, +Y = arriba, ±Z = lados (alas).

interface Part { geo: THREE.BufferGeometry; material: number }
interface LaatData { parts: Record<string, Part>; textures: THREE.Texture[] }
let data: LaatData | null = null;

export const laatReady = () => data !== null;

/** Descarga el modelo y sus texturas. Si falla, el escenario usa la cañonera de formas sencillas. */
export async function loadLaat(url: string): Promise<boolean> {
  try {
    const res = await fetch(url);
    if (!res.ok) throw new Error('HTTP ' + res.status);
    const buf = await res.arrayBuffer();
    const dv = new DataView(buf);
    if (String.fromCharCode(dv.getUint8(0), dv.getUint8(1), dv.getUint8(2), dv.getUint8(3)) !== 'LAT1') throw new Error('archivo de modelo no válido');
    const jsonLen = dv.getUint32(4, true);
    const meta = JSON.parse(new TextDecoder().decode(new Uint8Array(buf, 8, jsonLen)));
    const base = 8 + jsonLen + ((4 - ((8 + jsonLen) % 4)) % 4);
    const parts: Record<string, Part> = {};
    for (const p of meta.parts as Array<{ name: string; material: number; verts: number; indices: number; index: number; pos: number; nor: number; uv: number }>) {
      const g = new THREE.BufferGeometry();
      g.setIndex(new THREE.BufferAttribute(new Uint16Array(buf.slice(base + p.index, base + p.index + p.indices * 2)), 1));
      g.setAttribute('position', new THREE.BufferAttribute(new Float32Array(buf.slice(base + p.pos, base + p.pos + p.verts * 12)), 3));
      g.setAttribute('normal', new THREE.BufferAttribute(new Int8Array(buf.slice(base + p.nor, base + p.nor + p.verts * 3)), 3, true));
      g.setAttribute('uv', new THREE.BufferAttribute(new Float32Array(buf.slice(base + p.uv, base + p.uv + p.verts * 8)), 2));
      g.computeBoundingSphere();
      parts[p.name] = { geo: g, material: p.material };
    }
    const dir = url.replace(/[^/]*$/, '');
    const loader = new THREE.TextureLoader();
    const textures = await Promise.all((meta.textures as string[]).map(async (f) => {
      const t = await loader.loadAsync(dir + f);
      t.flipY = false; // coordenadas con origen arriba a la izquierda (como en glTF)
      t.colorSpace = THREE.SRGBColorSpace;
      t.anisotropy = 4;
      return t;
    }));
    data = { parts, textures };
    return true;
  } catch (e) {
    console.warn('No se pudo cargar la cañonera LAAT; se usa la de formas sencillas.', e);
    data = null;
    return false;
  }
}

// ---------- Colocación ----------
const SCALE = 0.7; // la LAAT real mide 17,4 m de envergadura: aquí debe dejar sitio al jugador
const CUT = 2.15; // el ala se cortó a esta distancia del eje (ver tools/convert-laat.mjs)
const NOSE = new THREE.Vector3(7.92, -2.2, 0.25); // punta del morro (en el modelo)
const WING_TIP = new THREE.Vector3(-1.33, -1.39, -8.7); // punta del ala entera

const mat4 = (fn: (m: THREE.Matrix4) => void) => { const m = new THREE.Matrix4(); fn(m); return m; };
/** Posición + giros (Y: dirección, X: alabeo sobre el eje del morro, Z: cabeceo) + escala, con el mismo orden que `place`. */
function placeM(x: number, y: number, z: number, ry: number, rx: number, rz: number, s: number) {
  return new THREE.Matrix4().compose(new THREE.Vector3(x, y, z), new THREE.Quaternion().setFromEuler(new THREE.Euler(rx, ry, rz, 'YXZ')), new THREE.Vector3(s, s, s));
}

function worldPoints(geo: THREE.BufferGeometry, m: THREE.Matrix4, keep: (x: number, y: number, z: number) => boolean) {
  const p = geo.attributes.position as THREE.BufferAttribute;
  const v = new THREE.Vector3();
  const out: number[] = [];
  for (let i = 0; i < p.count; i++) {
    if (!keep(p.getX(i), p.getY(i), p.getZ(i))) continue;
    v.fromBufferAttribute(p, i).applyMatrix4(m);
    out.push(v.x, v.y, v.z);
  }
  return out;
}

/** Hollín: mancha irregular oscura con vetas hacia arriba (la calcomanía se proyecta sobre el casco). */
function sootTexture(): THREE.Texture {
  const s = 256;
  const c = document.createElement('canvas');
  c.width = c.height = s;
  const g = c.getContext('2d')!;
  let seed = 31;
  const r = () => { seed = (seed * 16807) % 2147483647; return seed / 2147483647; };
  for (let i = 0; i < 26; i++) {
    const x = s / 2 + (r() - 0.5) * s * 0.55, y = s / 2 + (r() - 0.5) * s * 0.55, rad = s * (0.1 + r() * 0.22);
    const grad = g.createRadialGradient(x, y, 0, x, y, rad);
    grad.addColorStop(0, `rgba(12,9,7,${0.35 + r() * 0.3})`);
    grad.addColorStop(1, 'rgba(12,9,7,0)');
    g.fillStyle = grad;
    g.fillRect(0, 0, s, s);
  }
  for (let i = 0; i < 14; i++) { // vetas
    const x = s * (0.25 + r() * 0.5), w = 4 + r() * 10, y0 = s * (0.15 + r() * 0.3), y1 = y0 + s * (0.25 + r() * 0.4);
    const grad = g.createLinearGradient(0, y0, 0, y1);
    grad.addColorStop(0, `rgba(10,8,6,${0.3 + r() * 0.2})`);
    grad.addColorStop(1, 'rgba(10,8,6,0)');
    g.fillStyle = grad;
    g.fillRect(x, y0, w, y1 - y0);
  }
  // borde suave: se apaga hacia las esquinas
  g.globalCompositeOperation = 'destination-in';
  const fade = g.createRadialGradient(s / 2, s / 2, s * 0.18, s / 2, s / 2, s / 2);
  fade.addColorStop(0, 'rgba(0,0,0,1)');
  fade.addColorStop(1, 'rgba(0,0,0,0)');
  g.fillStyle = fade;
  g.fillRect(0, 0, s, s);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

export function buildLaatWreck(b: Builder) {
  const d = data!;
  GUNSHIP_FIRES.length = 0;
  GUNSHIP_FX.smoke.length = 0; GUNSHIP_FX.sparks.length = 0; GUNSHIP_FX.flames.length = 0;

  // --- Colocación del casco: ladeada hacia el enemigo (-Z), con el morro hundido en la arena y el ala entera apoyando la punta ---
  const px = CRASH.x, pz = CRASH.z - 1.2;
  const yaw = CRASH.yaw, pitch = -0.2;
  // El morro queda hundido 0,85 m; el alabeo se ajusta al relieve para que la punta del ala entera se entierre unos 0,45 m
  const fit = (roll: number) => {
    let m = placeM(px, 0, pz, yaw, roll, pitch, SCALE);
    const n = NOSE.clone().applyMatrix4(m);
    m = placeM(px, terrainHeight(n.x, n.z) - 0.85 - n.y, pz, yaw, roll, pitch, SCALE);
    const t = WING_TIP.clone().applyMatrix4(m);
    return { m, sink: terrainHeight(t.x, t.z) - t.y };
  };
  let best = fit(-0.05);
  for (let roll = -0.05; roll >= -0.3; roll -= 0.01) {
    const f = fit(roll);
    best = f;
    if (f.sink >= 0.45) break;
  }
  const M = best.m;
  const toWorld = (x: number, y: number, z: number) => new THREE.Vector3(x, y, z).applyMatrix4(M);

  // --- Materiales (textura del autor) y mallas ---
  const mats = d.textures.map((t) => new THREE.MeshLambertMaterial({ map: t, side: THREE.DoubleSide, color: 0xd6d0c8 }));
  const hullMesh = new THREE.Mesh(d.parts.casco.geo, mats[d.parts.casco.material]);
  const add = (part: Part, m: THREE.Matrix4, shadow = true) => {
    const mesh = part === d.parts.casco ? hullMesh : new THREE.Mesh(part.geo, mats[part.material]);
    mesh.matrixAutoUpdate = false;
    mesh.matrix.copy(m);
    mesh.matrixWorldNeedsUpdate = true;
    mesh.castShadow = shadow; mesh.receiveShadow = true;
    mesh.updateMatrixWorld(true);
    b.addObject(mesh);
    return mesh;
  };
  add(d.parts.casco, M);
  for (const n of ['cabina', 'bahia', 'marco']) add(d.parts[n], M, false);

  // --- Cuerpos sólidos (cobertura): fuselaje hasta el suelo, ala entera y muñón ---
  const gy = (x: number, z: number) => terrainHeight(x, z);
  const fus = worldPoints(d.parts.casco.geo, M, (_x, _y, z) => Math.abs(z) <= CUT + 0.05);
  const skirt: number[] = []; // se prolonga hasta el suelo: no se puede pasar por debajo de la panza
  for (let i = 0; i < fus.length; i += 3) if (fus[i + 1] < gy(fus[i], fus[i + 2]) + 2.6) skirt.push(fus[i], gy(fus[i], fus[i + 2]) - 0.5, fus[i + 2]);
  b.addConvex(new Float32Array([...fus, ...skirt]));
  b.addConvex(new Float32Array(worldPoints(d.parts.casco.geo, M, (_x, _y, z) => z < -CUT)));

  // --- Ala arrancada, tirada a la derecha del jugador, ladeada para que un borde asome como cobertura ---
  {
    const c = new THREE.Vector3(-2.75, 0.3, 5.4); // centro del ala en el modelo
    const wx = 10.6, wz = 1.2, tilt = 0.6;
    const ground = gy(wx, wz);
    const flat = mat4((m) => m.makeRotationX(-0.5)); // la deja plana (en el modelo cae unos 29° hacia la punta)
    const lean = mat4((m) => m.makeRotationZ(tilt)); // un borde sube
    const turn = mat4((m) => m.makeRotationY(Math.PI / 2 - 0.3)); // el largo del ala sigue el eje X del mundo
    const W = new THREE.Matrix4()
      .makeTranslation(wx, ground + 0.15, wz)
      .multiply(turn).multiply(lean).multiply(flat)
      .multiply(new THREE.Matrix4().makeScale(SCALE, SCALE, SCALE))
      .multiply(new THREE.Matrix4().makeTranslation(-c.x, -c.y, -c.z));
    add(d.parts.ala, W);
    b.addConvex(new Float32Array(worldPoints(d.parts.ala.geo, W, () => true)));
  }

  // --- Hollín: calcomanías proyectadas sobre el casco (sin modificar el modelo) ---
  {
    const rc = new THREE.Raycaster();
    const geos: THREE.BufferGeometry[] = [];
    const soot = (from: [number, number, number], to: [number, number, number], size: number, depth = 1.4) => {
      const o = toWorld(...from), t = toWorld(...to);
      rc.set(o, t.clone().sub(o).normalize());
      const hit = rc.intersectObject(hullMesh)[0];
      if (!hit || !hit.face) return;
      const n = hit.face.normal.clone().transformDirection(hullMesh.matrixWorld);
      const look = new THREE.Object3D();
      look.position.copy(hit.point);
      look.lookAt(hit.point.clone().add(n));
      look.rotateZ(Math.random() * Math.PI * 2);
      geos.push(new DecalGeometry(hullMesh, hit.point, look.rotation, new THREE.Vector3(size * SCALE, size * SCALE, depth * SCALE)));
    };
    // alrededor de los motores (atrás y arriba), el muñón del ala, el costado, el morro y la panza
    soot([-11, 2.5, 1.4], [-6.5, 2.5, 1.4], 4.2);
    soot([-11, 2.5, -1.4], [-6.5, 2.5, -1.4], 3.2);
    soot([-6, 8, 1.4], [-6, 3, 1.4], 4.4);
    soot([-6, 8, -1.2], [-6, 3, -1.2], 3);
    soot([-3, 1.2, 6], [-3, 1.2, 1.5], 5.2);
    soot([-3, 3, 5], [-3, 1.5, 2.1], 3.6);
    soot([0, -0.5, 6], [0, -0.5, 1], 3.4);
    soot([-4.5, 0, -6], [-4.5, 0, -1], 3.6);
    soot([6.5, 3, 0], [6.5, -1, 0], 3.8);
    soot([2.5, 3, 4], [2.5, 1, 1.2], 3.2);
    soot([-1, 6, -0.3], [-1, 2, -0.3], 3.6);
    if (geos.length) {
      const merged = mergeGeometries(geos, false)!;
      for (const g of geos) g.dispose();
      const m = new THREE.Mesh(merged, new THREE.MeshLambertMaterial({
        map: sootTexture(), transparent: true, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -4, polygonOffsetUnits: -4, color: 0x2a221c,
      }));
      m.renderOrder = 1;
      b.addObject(m);
    }
  }

  // --- Humo, chispas y fuego (los dibuja CrashFx; los destellos, Atmosphere) ---
  const P = (x: number, y: number, z: number) => toWorld(x, y, z);
  const e1 = P(-7.5, 2.6, 1.4), e2 = P(-7.5, 2.6, -1.4); // salida de los dos motores
  GUNSHIP_FX.smoke.push({ x: e1.x, y: e1.y, z: e1.z, rate: 5.5, size: 1.7 }, { x: e2.x, y: e2.y, z: e2.z, rate: 2.2, size: 1.3 });
  const stub = P(-2.6, 1.0, 2.2), deck = P(-3.4, 3.1, 0.2), nosePt = P(4.6, -0.2, 0.9);
  GUNSHIP_FX.sparks.push(
    { x: stub.x, y: stub.y, z: stub.z, every: [1.6, 4.5], count: 11 },
    { x: e1.x, y: e1.y - 0.2, z: e1.z, every: [2.5, 6], count: 8 },
    { x: nosePt.x, y: nosePt.y, z: nosePt.z, every: [4, 9], count: 7 },
  );
  for (const [pt, size] of [[stub, 0.7], [e1, 0.6], [deck, 0.5]] as const) {
    GUNSHIP_FX.flames.push({ x: pt.x, y: pt.y, z: pt.z, size });
    GUNSHIP_FIRES.push({ x: pt.x, y: pt.y + 0.3, z: pt.z, size: size * 2.6 });
  }
}
