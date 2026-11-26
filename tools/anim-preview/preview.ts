// Página de pruebas (no forma parte del juego): traduce las animaciones de Mixamo al clon comando y las enseña para hacer fotos.
// Con `npm run dev`: /tools/anim-preview/index.html  · window.api.show(nombre, segundo, vista, conEsqueleto) · window.api.bake() → JSON de cada una.
import * as THREE from 'three';
import { FBXLoader } from 'three/addons/loaders/FBXLoader.js';
import { loadCommandoModel, createCommandoRig } from '../../src/player/commandoModel';
import { loadBlasterModel, blasterModelData } from '../../src/weapons/ViewModel';
import { CommandoModel, RIFLE_HOLD } from '../../src/cinematic/actors';
import { retargetMixamo, clipDuration, type BakedClip } from '../../src/anim/mixamo';

export const CLIPS = ['Rifle_Run', 'Rifle_Run_To_Stop', 'Crouch_Rapid_Fire', 'Rifle_Kneel_To_Stand', 'Rifle_Idle', 'Rifle_Aiming_Idle'];
/** Las que corren «en el sitio» (el avance lo pone la cinemática): sin avance de la cadera. */
const IN_PLACE = new Set(['Rifle_Run', 'Crouch_Rapid_Fire', 'Rifle_Idle', 'Rifle_Aiming_Idle']);

const info = document.getElementById('info')!;
const renderer = new THREE.WebGLRenderer({ antialias: true });
renderer.setPixelRatio(window.devicePixelRatio);
renderer.setSize(innerWidth, innerHeight);
renderer.shadowMap.enabled = true;
document.body.appendChild(renderer.domElement);
const scene = new THREE.Scene();
scene.background = new THREE.Color(0xd9d4cc);
scene.add(new THREE.HemisphereLight(0xf4f2ee, 0x7a7068, 1.6));
const sun = new THREE.DirectionalLight(0xffffff, 2.2);
sun.position.set(-3, 6, -4);
sun.castShadow = true;
Object.assign(sun.shadow.camera, { left: -4, right: 4, top: 4, bottom: -4 });
sun.shadow.mapSize.set(2048, 2048);
scene.add(sun);
const ground = new THREE.Mesh(new THREE.PlaneGeometry(40, 40), new THREE.MeshLambertMaterial({ color: 0xb8afa3 }));
ground.rotation.x = -Math.PI / 2;
ground.receiveShadow = true;
scene.add(ground);
const grid = new THREE.GridHelper(40, 40, 0x8c8378, 0x8c8378);
grid.position.y = 0.002;
scene.add(grid);
const camera = new THREE.PerspectiveCamera(40, innerWidth / innerHeight, 0.05, 100);

await Promise.all([loadBlasterModel('/models/blaster.bin'), loadCommandoModel('/models/commando.glb')]);
// ?arma=0.5 → largo del arma en metros (el juego usa RIFLE_HOLD.largo)
const armaLargo = Number(new URLSearchParams(location.search).get('arma'));
if (armaLargo) RIFLE_HOLD.largo = armaLargo;
const commando = new CommandoModel(1.85);
scene.add(commando.group);

// esqueleto original de Mixamo al lado, para comparar (líneas)
const sources: Record<string, { obj: THREE.Object3D; clip: THREE.AnimationClip; mixer: THREE.AnimationMixer }> = {};
for (const n of CLIPS) {
  const obj = await new FBXLoader().loadAsync(`/assets/animaciones/mixamo/${n}.fbx`);
  sources[n] = { obj, clip: obj.animations[0], mixer: new THREE.AnimationMixer(obj) };
}
const baked: Record<string, BakedClip> = {};
const rig = createCommandoRig(1.85);
/** Imágenes por segundo al guardar: la de reposo es lenta y larga (8,6 s), con 15 basta y pesa la mitad. */
const FPS: Record<string, number> = { Rifle_Idle: 15, Rifle_Aiming_Idle: 15 };
for (const n of CLIPS) baked[n] = retargetMixamo(sources[n].obj, sources[n].clip, rig, n, FPS[n] ?? 30, !IN_PLACE.has(n));
commando.calibrateGrip(baked.Crouch_Rapid_Fire, 0); // agarre del arma: el de la postura de disparo agachado

const refHolder = new THREE.Group();
refHolder.rotation.y = Math.PI;
refHolder.position.x = 1.3;
refHolder.scale.setScalar(0.0102);
scene.add(refHolder);
let helper: THREE.SkeletonHelper | null = null;
let current = '';

const VIEWS: Record<string, { p: [number, number, number]; t: [number, number, number]; fov?: number }> = {
  frente: { p: [0.65, 1.25, -4.6], t: [0.65, 0.85, 0] },
  lado: { p: [3.6, 1.2, -0.3], t: [0, 0.8, -0.3] },
  tres4: { p: [2.2, 1.6, -2.6], t: [0, 0.85, 0] },
  cerca: { p: [1.1, 1.45, -1.3], t: [0, 1.1, 0], fov: 32 },
  detras: { p: [-1.6, 1.5, 2.6], t: [0, 0.9, -0.5] },
};

function show(name: string, t: number, view = 'tres4', ref = false) {
  const c = baked[name];
  commando.animate(c, t, false, 1);
  const s = sources[name];
  if (current !== name) {
    for (const o of [...refHolder.children]) refHolder.remove(o);
    if (helper) scene.remove(helper);
    refHolder.add(s.obj);
    helper = new THREE.SkeletonHelper(s.obj);
    (helper.material as THREE.LineBasicMaterial).linewidth = 2;
    scene.add(helper);
    s.mixer.stopAllAction();
    s.mixer.clipAction(s.clip).play();
    current = name;
  }
  s.mixer.setTime(t);
  refHolder.visible = ref;
  if (helper) helper.visible = ref;
  if (view === 'mano' || view === 'mano2') {
    // de cerca, desde el lado derecho del comando, mirando a su mano derecha
    const w = commando.debugBones.rightwrist.getWorldPosition(new THREE.Vector3());
    camera.fov = 28; camera.updateProjectionMatrix();
    camera.position.copy(w).add(view === 'mano' ? new THREE.Vector3(1.4, 0.25, 0.1) : new THREE.Vector3(0.8, -0.35, -1.1));
    camera.lookAt(w.x, w.y + 0.05, w.z - 0.1);
    renderer.render(scene, camera);
    info.textContent = `${name} · ${t.toFixed(2)} s · mano derecha`;
    return;
  }
  const v = VIEWS[view] ?? VIEWS.tres4;
  // la cámara sigue a la cadera por el suelo (en las animaciones que avanzan)
  const hips = new THREE.Vector3();
  commando.group.traverse((o) => { if ((o as THREE.Bone).isBone && /^Hips/.test(o.name)) o.getWorldPosition(hips); });
  const off = new THREE.Vector3(ref ? 0 : hips.x, 0, hips.z);
  camera.fov = v.fov ?? 40;
  camera.updateProjectionMatrix();
  camera.position.set(...v.p).add(off);
  camera.lookAt(new THREE.Vector3(...v.t).add(off));
  renderer.render(scene, camera);
  info.textContent = `${name} · ${t.toFixed(2)} s de ${clipDuration(c).toFixed(2)} s · vista ${view}`;
}

/** El arma sola, de lado, con los puntos de agarre (rojo = mano derecha, azul = izquierda), en metros. */
function gun() {
  const bm = blasterModelData()!;
  bm.geo.computeBoundingBox();
  const bb = bm.geo.boundingBox!, s = 0.85 / (bb.max.z - bb.min.z);
  const g = new THREE.Group();
  const m = new THREE.Mesh(bm.geo, new THREE.MeshLambertMaterial({ map: bm.map }));
  m.scale.setScalar(s);
  g.add(m);
  const dot = (x: number, y: number, z: number, c: number) => { const d = new THREE.Mesh(new THREE.SphereGeometry(0.015), new THREE.MeshBasicMaterial({ color: c, depthTest: false })); d.position.set(x * s, y * s, z * s); d.renderOrder = 9; g.add(d); };
  dot(0, -0.18 / s, 0.2 / s, 0x00cc00); dot(0.02, -0.2, 0.15, 0xff0000); dot(-0.02, -0.21, -0.32, 0x0044ff);
  for (let z = -0.4; z <= 0.41; z += 0.1) dot(0, 0.12, z, 0x222222);
  g.position.set(0, 3, 0);
  scene.add(g);
  camera.fov = 30; camera.updateProjectionMatrix();
  camera.position.set(1.6, 3, 0); camera.lookAt(0, 3, 0);
  renderer.render(scene, camera);
  scene.remove(g);
  info.textContent = `bb z ${bb.min.z.toFixed(2)}..${bb.max.z.toFixed(2)} y ${bb.min.y.toFixed(2)}..${bb.max.y.toFixed(2)} · escala ${s.toFixed(3)} · puntos negros cada 10 cm (z de −0,4 a 0,4)`;
}

/** Arma medio transparente (para ver la mano a través). */
function gunAlpha(a: number) {
  commando.group.traverse((o) => {
    const m = o as THREE.Mesh;
    if (m.isMesh && !(m as THREE.SkinnedMesh).isSkinnedMesh) { const mt = m.material as THREE.Material; mt.transparent = a < 1; mt.opacity = a; mt.depthWrite = a >= 1; }
  });
}

(window as unknown as { api: object }).api = {
  gun,
  gunAlpha,
  show,
  bake: () => Object.fromEntries(CLIPS.map((n) => [n, JSON.stringify(baked[n])])),
  durations: () => Object.fromEntries(CLIPS.map((n) => [n, clipDuration(baked[n])])),
};
// sin pruebas automáticas: reproduce la primera en bucle
let t0 = performance.now();
let auto = true;
window.addEventListener('keydown', (e) => {
  const i = Number(e.key) - 1;
  if (CLIPS[i]) { current = ''; showName = CLIPS[i]; t0 = performance.now(); }
});
let showName = CLIPS[0];
renderer.setAnimationLoop(() => {
  if (!auto) return;
  const d = clipDuration(baked[showName]);
  show(showName, ((performance.now() - t0) / 1000) % d, 'tres4', true);
});
(window as unknown as { stopAuto: () => void }).stopAuto = () => { auto = false; renderer.setAnimationLoop(null); };
