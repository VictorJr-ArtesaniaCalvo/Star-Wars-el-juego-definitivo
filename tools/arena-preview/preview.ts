// Página de pruebas (no forma parte del juego): enseña la maqueta de la arena desde varias cámaras para hacer fotos.
import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { buildArenaGreybox } from '../../src/world/arena/greybox';
import { buildArena } from '../../src/world/arena/arena';
import { loadWorldTextures, setWorldBump, setWorldRich } from '../../src/world/materials';
import { buildSky } from '../../src/world/sky';
import { loadB1Model } from '../../src/enemies/B1Rig';
import { loadB2Model } from '../../src/enemies/B2Rig';
import { loadDekaModel } from '../../src/enemies/DroidekaRig';

// ?color → prueba de colores con las texturas del cañón; ?arena → versión con materiales, luz y profundidad; sin nada → maqueta gris
const ARENA_MODE = new URLSearchParams(location.search).has('arena');
const COLOR_MODE = ARENA_MODE || new URLSearchParams(location.search).has('color');
if (COLOR_MODE) { await loadWorldTextures('/'); setWorldRich(true); setWorldBump(true); }
// los restos de la batalla usan los modelos de los droides
if (ARENA_MODE) await Promise.all([loadB1Model('/models/b1.bin'), loadB2Model('/models/b2.bin'), loadDekaModel('/models/droideka.bin')]);
import { ARENA_SPAWN, DOORS } from '../../src/world/arena/layout';

const renderer = new THREE.WebGLRenderer({ antialias: true });
renderer.setPixelRatio(window.devicePixelRatio);
renderer.setSize(innerWidth, innerHeight);
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
document.body.appendChild(renderer.domElement);

const scene = new THREE.Scene();
// sol en diagonal desde arriba, por el suroeste (oeste = −x, sur = +z), a unos 52° de altura
const SUN = new THREE.Vector3(-0.707, 1.28, 0.707).normalize();
let sun: THREE.DirectionalLight;
let skyMesh: THREE.Mesh | null = null;
if (COLOR_MODE) {
  // la misma luz y el mismo cielo que el cañón (ambiente violáceo, relleno marrón, sol amarillo pálido); solo cambia de dónde viene el sol
  const sky = buildSky(scene);
  skyMesh = sky.sky;
  sky.material.uniforms.sunDir.value = SUN;
  sun = sky.sun;
  sky.fill.position.set(-SUN.x * 80, 18, -SUN.z * 80);
  (scene.fog as THREE.Fog).near = 45;
  (scene.fog as THREE.Fog).far = 230; // como la calidad Ultra
} else {
  scene.background = new THREE.Color(0xe9dfd0);
  scene.fog = new THREE.Fog(0xe9dfd0, 120, 420);
  scene.add(new THREE.HemisphereLight(0xf2f0ec, 0x8a8076, 1.25));
  sun = new THREE.DirectionalLight(0xffffff, 2.2);
  scene.add(sun);
}
sun.position.copy(SUN).multiplyScalar(150);
sun.castShadow = true;
sun.shadow.mapSize.set(4096, 4096);
Object.assign(sun.shadow.camera, { left: -110, right: 110, top: 110, bottom: -110, near: 10, far: 400 });
sun.shadow.bias = -0.0004;
sun.shadow.normalBias = 0.4;

// en la versión nueva las sombras van pintadas al cargar (como en el juego): sin mapa de sombras
const built = ARENA_MODE ? buildArena() : null;
const arena = built ? built.group : buildArenaGreybox(COLOR_MODE);
if (built) { sun.castShadow = false; console.log(`arena: ${Math.round(built.triangles)} triángulos, montada en ${Math.round(built.bakeMs)} ms`); }
scene.add(arena);

// Figuras para ver la escala: tú (clon, 1,85 m, azul) y droides B1 (1,91 m, ocres) saliendo de las puertas.
function figure(color: number, h: number, r: number, x: number, z: number) {
  const g = new THREE.CapsuleGeometry(r, h - 2 * r, 4, 10);
  const m = new THREE.Mesh(g, new THREE.MeshLambertMaterial({ color }));
  m.position.set(x, h / 2, z);
  m.castShadow = true;
  if (!COLOR_MODE) scene.add(m);
}
figure(0x2a6fdb, 1.85, 0.3, ARENA_SPAWN.x, ARENA_SPAWN.z);
for (const d of DOORS) for (const s of [-1.2, 1.2]) figure(0xb38a4a, 1.91, 0.22, d.x - d.out[0] * 3 + (d.out[1] !== 0 ? s : 0), d.z - d.out[1] * 3 + (d.out[0] !== 0 ? s : 0));

let tris = 0;
arena.traverse((o) => { if ((o as THREE.Mesh).isMesh) tris += ((o as THREE.Mesh).geometry.index?.count ?? (o as THREE.Mesh).geometry.attributes.position.count) / 3; });
tris = Math.round(tris);

const camera = new THREE.PerspectiveCamera(60, innerWidth / innerHeight, 0.1, 1500);
const controls = new OrbitControls(camera, renderer.domElement);

const EYE = 1.7;
// Cámaras para las fotos: posición, punto al que mira y apertura.
const VIEWS: Record<string, { p: [number, number, number]; t: [number, number, number]; fov: number; name: string }> = {
  general: { p: [-46, 200, 92], t: [2, 0, -4], fov: 50, name: 'Vista general desde el suroeste' },
  arriba: { p: [0, 230, 0.01], t: [0, 0, 0], fov: 42, name: 'Desde arriba (norte arriba)' },
  inicio: { p: [ARENA_SPAWN.x, EYE, ARENA_SPAWN.z], t: [0, 4, -46], fov: 70, name: 'Tu vista al aparecer (mirando al norte)' },
  palco: { p: [ARENA_SPAWN.x, EYE, ARENA_SPAWN.z], t: [34, 9, 0], fov: 70, name: 'Mirando al este: palco y puerta este' },
  sur: { p: [ARENA_SPAWN.x, EYE, ARENA_SPAWN.z], t: [0, 5, 46], fov: 70, name: 'Mirando al sur: puerta sur' },
  oeste: { p: [ARENA_SPAWN.x, EYE, ARENA_SPAWN.z], t: [-34, 5, 0], fov: 70, name: 'Mirando al oeste: puerta oeste (lado en sombra)' },
  puerta: { p: [0, EYE, 35], t: [0, 2, 0], fov: 70, name: 'Desde la puerta sur hacia el centro (lo que ven los droides)' },
  pelicula2: { p: [-3, 25, 56], t: [5, 3, -17], fov: 60, name: 'Desde las gradas del sur (como la foto 2)' },
  restos: { p: [5.5, EYE, 10.5], t: [11.5, 0.3, 5.8], fov: 60, name: 'Montón de droides destruidos (cobertura)' },
  surco: { p: [-6, EYE, -4], t: [6, -0.5, -22], fov: 65, name: 'Surco de impacto al norte del centro' },
  pelicula1: { p: [-35, 42, -42], t: [34, 6, 4], fov: 60, name: 'Desde lo alto del noroeste hacia el palco (como la foto 1)' },
};

function setView(key: string) {
  const v = VIEWS[key] ?? VIEWS.general;
  camera.position.set(...v.p);
  controls.target.set(...v.t);
  camera.fov = v.fov;
  // las vistas desde muy arriba no son del juego: sin neblina, para ver la forma entera
  if (COLOR_MODE) { const f = scene.fog as THREE.Fog; const far = key === 'general' || key === 'arriba'; f.near = far ? 2000 : ARENA_MODE ? 18 : 45; f.far = far ? 3000 : ARENA_MODE ? 200 : 230; }
  camera.updateProjectionMatrix();
  controls.update();
  document.getElementById('info')!.textContent = `${v.name} · ${Math.round(tris / 1000)} mil triángulos`;
}
setView(location.hash.replace('#', '') || 'general');
addEventListener('hashchange', () => setView(location.hash.replace('#', '')));
addEventListener('resize', () => { camera.aspect = innerWidth / innerHeight; camera.updateProjectionMatrix(); renderer.setSize(innerWidth, innerHeight); });

(window as unknown as { __arena: unknown }).__arena = { arena, sun, bakeMs: built?.bakeMs, setView, views: Object.keys(VIEWS), tris: () => tris, info: (k: string) => VIEWS[k].name };
renderer.setAnimationLoop(() => { skyMesh?.position.copy(camera.position); renderer.render(scene, camera); });
