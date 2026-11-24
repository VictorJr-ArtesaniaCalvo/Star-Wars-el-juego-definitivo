import * as THREE from 'three';
import { parseModelFile, type ModelBone } from './ModelFile';

// Droide B2 (superdroide de combate) con esqueleto. El modelo 3D (public/models/b2.bin) se genera con tools/convert-b2.mjs a partir del
// glTF original de zakeriiino (CC-BY 4.0, ver CRÉDITOS.md): una sola pieza dibujable por droide con 14 huesos (cadera, torso, brazo,
// antebrazo y mano de cada lado, y muslo, pierna y pie de cada lado) y dos niveles de detalle que comparten el esqueleto.
// Si el archivo no se pudiera cargar, se usa un modelo de cajas con el mismo esqueleto.

export interface B2Bones {
  root: THREE.Bone; spine: THREE.Bone;
  armL: THREE.Bone; forearmL: THREE.Bone; handL: THREE.Bone;
  armR: THREE.Bone; forearmR: THREE.Bone; handR: THREE.Bone;
  thighL: THREE.Bone; shinL: THREE.Bone; footL: THREE.Bone;
  thighR: THREE.Bone; shinR: THREE.Bone; footR: THREE.Bone;
  hipY: number;
  /** Geometrías de cada nivel de detalle (0 = cerca, 1 = lejos). */
  lods: THREE.BufferGeometry[];
}

type BoneName = keyof Omit<B2Bones, 'hipY' | 'lods'>;
interface BoneDef extends ModelBone { name: BoneName }
interface Model { bones: BoneDef[]; lods: THREE.BufferGeometry[]; source: 'archivo' | 'respaldo'; map?: THREE.Texture }

let model: Model | null = null;

/** Descarga y prepara el modelo. Si falla, se usa el de respaldo (cajas). Hay que llamarlo antes de crear droides. */
export async function loadB2Model(url: string): Promise<'archivo' | 'respaldo'> {
  try {
    const res = await fetch(url);
    if (!res.ok) throw new Error('HTTP ' + res.status);
    const m = parseModelFile(await res.arrayBuffer(), 'B2M1');
    model = { bones: m.bones as BoneDef[], lods: m.lods, source: 'archivo' };
    if (m.atlas) {
      // Textura del autor (atlas). Si no se pudiera cargar, se queda el color por vértice que trae el modelo.
      try {
        const tex = await new THREE.TextureLoader().loadAsync(url.replace(/[^/]*$/, '') + m.atlas);
        tex.flipY = false; // las coordenadas del modelo tienen el origen arriba a la izquierda (como en glTF)
        tex.colorSpace = THREE.SRGBColorSpace;
        tex.anisotropy = 4;
        model.map = tex;
        for (const g of m.lods) g.setAttribute('color', new THREE.BufferAttribute(new Uint8Array(g.attributes.position.count * 3).fill(255), 3, true));
      } catch (e) {
        console.warn('No se pudo cargar la textura del B2; se usa el color por vértice.', e);
      }
    }
  } catch (e) {
    console.warn('No se pudo cargar el modelo del B2; se usa el de respaldo.', e);
    model = fallback();
  }
  return model.source;
}

// ---------- Modelo de respaldo: cajas por hueso (mismas articulaciones que el modelo real) ----------
const FALLBACK_BONES: BoneDef[] = [
  { name: 'root', parent: -1, pivot: [0, 1.1844, 0] }, { name: 'spine', parent: 0, pivot: [0, 1.375, 0] },
  { name: 'armL', parent: 1, pivot: [-0.4682, 2.0092, 0] }, { name: 'forearmL', parent: 2, pivot: [-0.4682, 1.3913, 0] }, { name: 'handL', parent: 3, pivot: [-0.4682, 0.9213, 0] },
  { name: 'armR', parent: 1, pivot: [0.4694, 2.0091, 0] }, { name: 'forearmR', parent: 5, pivot: [0.4694, 1.3913, 0] }, { name: 'handR', parent: 6, pivot: [0.4694, 0.9212, 0] },
  { name: 'thighL', parent: 0, pivot: [-0.1932, 1.2211, 0] }, { name: 'shinL', parent: 8, pivot: [-0.1932, 0.6915, 0] }, { name: 'footL', parent: 9, pivot: [-0.1932, 0.0753, 0] },
  { name: 'thighR', parent: 0, pivot: [0.1943, 1.2211, 0] }, { name: 'shinR', parent: 11, pivot: [0.1943, 0.6915, 0] }, { name: 'footR', parent: 12, pivot: [0.1943, 0.0753, 0] },
];

function fallback(): Model {
  const parts: THREE.BufferGeometry[] = [];
  const add = (bone: number, w: number, h: number, d: number, x: number, y: number, z: number, color: number) => {
    const g = new THREE.BoxGeometry(w, h, d).toNonIndexed();
    g.translate(x, y, z);
    const n = g.attributes.position.count, c = new THREE.Color(color);
    const col = new Float32Array(n * 3), si = new Uint16Array(n * 4), sw = new Float32Array(n * 4);
    for (let i = 0; i < n; i++) { col.set([c.r, c.g, c.b], i * 3); si[i * 4] = bone; sw[i * 4] = 1; }
    g.deleteAttribute('uv');
    g.setAttribute('color', new THREE.BufferAttribute(col, 3));
    g.setAttribute('skinIndex', new THREE.BufferAttribute(si, 4));
    g.setAttribute('skinWeight', new THREE.BufferAttribute(sw, 4));
    parts.push(g);
  };
  const GUN = 0x6c737a, PLATE = 0xa2a9ae, DARK = 0x363a3f;
  add(0, 0.5, 0.25, 0.3, 0, 1.2, 0, GUN);
  add(1, 0.9, 0.8, 0.45, 0, 1.9, 0, GUN);
  add(1, 0.36, 0.3, 0.3, 0, 2.2, -0.05, PLATE);
  for (const [s, a, f, h, t, sh, ft] of [[-1, 2, 3, 4, 8, 9, 10], [1, 5, 6, 7, 11, 12, 13]] as const) {
    add(a, 0.18, 0.62, 0.18, 0.47 * s, 1.7, 0, PLATE);
    add(f, 0.15, 0.48, 0.15, 0.47 * s, 1.15, 0, GUN);
    add(h, 0.14, 0.3, 0.14, 0.47 * s, 0.8, 0, DARK);
    add(t, 0.16, 0.53, 0.17, 0.2 * s, 0.96, 0, GUN);
    add(sh, 0.13, 0.62, 0.15, 0.2 * s, 0.38, 0, GUN);
    add(ft, 0.2, 0.08, 0.36, 0.2 * s, 0.04, -0.06, DARK);
  }
  let total = 0; for (const g of parts) total += g.attributes.position.count;
  const pos = new Float32Array(total * 3), nor = new Float32Array(total * 3), col = new Float32Array(total * 3), si = new Uint16Array(total * 4), sw = new Float32Array(total * 4);
  let o = 0;
  for (const g of parts) {
    g.computeVertexNormals();
    const n = g.attributes.position.count;
    pos.set(g.attributes.position.array as Float32Array, o * 3); nor.set(g.attributes.normal.array as Float32Array, o * 3); col.set(g.attributes.color.array as Float32Array, o * 3);
    si.set(g.attributes.skinIndex.array as Uint16Array, o * 4); sw.set(g.attributes.skinWeight.array as Float32Array, o * 4);
    o += n;
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  geo.setAttribute('normal', new THREE.BufferAttribute(nor, 3));
  geo.setAttribute('color', new THREE.BufferAttribute(col, 3));
  geo.setAttribute('skinIndex', new THREE.BufferAttribute(si, 4));
  geo.setAttribute('skinWeight', new THREE.BufferAttribute(sw, 4));
  geo.computeBoundingSphere();
  return { bones: FALLBACK_BONES, lods: [geo, geo], source: 'respaldo' };
}

// ---------- Crear un droide ----------
export function createB2(material: THREE.Material): { mesh: THREE.SkinnedMesh; bones: B2Bones } {
  if (!model) model = fallback();
  const list: THREE.Bone[] = model.bones.map((d) => {
    const b = new THREE.Bone();
    b.name = d.name;
    return b;
  });
  model.bones.forEach((d, i) => {
    const parent = d.parent < 0 ? null : model!.bones[d.parent];
    list[i].position.set(d.pivot[0] - (parent ? parent.pivot[0] : 0), d.pivot[1] - (parent ? parent.pivot[1] : 0), d.pivot[2] - (parent ? parent.pivot[2] : 0));
    if (parent) list[d.parent].add(list[i]);
  });
  if (model.map) {
    // El gris carbón de la textura se aclara un poco para que no se pierda con la luz cálida de Geonosis.
    const m = material as THREE.MeshLambertMaterial;
    m.map = model.map;
    m.color.setRGB(1.25 * 0.97, 1.25, 1.25 * 1.05);
    m.needsUpdate = true;
  }
  const mesh = new THREE.SkinnedMesh(model.lods[0], material);
  mesh.add(list[0]);
  mesh.updateMatrixWorld(true);
  mesh.bind(new THREE.Skeleton(list));
  mesh.frustumCulled = false;
  const byName = Object.fromEntries(list.map((b) => [b.name, b])) as Record<BoneName, THREE.Bone>;
  return { mesh, bones: { ...byName, hipY: model.bones[0].pivot[1], lods: model.lods } };
}

const THIGH = 0.53, SHIN = 0.616; // largo del muslo y de la pierna (m)

/**
 * `walk`: 0..1 cuánto anda; `phase`: fase del paso. Paso largo y pesado: se apoya y se balancea.
 * El antebrazo derecho apunta hacia delante (de ahí sale el disparo); el izquierdo lo acompaña más recogido y se balancea poco.
 */
export function poseB2(b: B2Bones, walk: number, phase: number) {
  const s = Math.sin(phase);
  // Piernas, con los pies planos en el suelo
  const tL = s * 0.42 * walk, tR = -s * 0.42 * walk;
  const sL = -Math.max(0, Math.sin(phase + 1.6)) * 0.7 * walk, sR = -Math.max(0, Math.sin(phase + 1.6 + Math.PI)) * 0.7 * walk;
  b.thighL.rotation.x = tL; b.shinL.rotation.x = sL; b.footL.rotation.x = -(tL + sL);
  b.thighR.rotation.x = tR; b.shinR.rotation.x = sR; b.footR.rotation.x = -(tR + sR);
  // La cadera baja lo que se doblan las piernas (se apoya la más estirada) y rebota un poco al andar
  const drop = (t: number, sh: number) => THIGH + SHIN - (THIGH * Math.cos(t) + SHIN * Math.cos(t + sh));
  b.root.position.y = b.hipY - Math.min(drop(tL, sL), drop(tR, sR)) + Math.abs(s) * 0.03 * walk;
  b.root.rotation.z = s * 0.035 * walk; // la cadera se ladea con cada paso
  b.spine.rotation.y = s * 0.08 * walk; // el torso gira un poco contra las piernas
  b.spine.rotation.z = -s * 0.04 * walk;
  b.spine.rotation.x = 0.05;
  // Brazos: el derecho (el que dispara) con el antebrazo extendido hacia delante; el izquierdo lo acompaña más recogido
  b.armR.rotation.set(0.35 + Math.abs(s) * 0.02 * walk, 0, -0.05);
  b.forearmR.rotation.set(1.1, 0, 0);
  b.handR.rotation.set(0, 0, 0);
  b.armL.rotation.set(0.25 - s * 0.2 * walk, 0, 0.05);
  b.forearmL.rotation.set(0.75 + s * 0.1 * walk, 0, 0);
  b.handL.rotation.set(0, 0, 0);
}
