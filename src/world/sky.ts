import * as THREE from 'three';

// Neblina y horizonte: ámbar dorado, como el aire polvoriento de Geonosis.
// Neblina y horizonte: ámbar pálido y apagado (lo lejano se vuelve pálido; lo cercano queda más intenso y oscuro)
export const FOG_COLOR = 0xdcbf8c;
// Sol a unos 27° sobre el horizonte y girado hacia el eje del cañón (detrás de ti al empezar, algo a la izquierda): una pared proyecta su sombra
// sobre una parte del suelo y la otra queda al sol (las sombras se calculan en `sunShadow.ts`)
export const SUN_DIR = new THREE.Vector3(-0.38, 0.45, 0.8).normalize();

// Cielo dorado con nubes pesadas y sol bajo, dibujado por código (ligero para el móvil).
export function buildSky(scene: THREE.Scene) {
  const mat = new THREE.ShaderMaterial({
    side: THREE.BackSide,
    depthWrite: false,
    fog: false,
    uniforms: {
      horizon: { value: new THREE.Color(FOG_COLOR) },
      mid: { value: new THREE.Color(0xdcb26a) },
      top: { value: new THREE.Color(0x6a4a46) },
      sunDir: { value: SUN_DIR },
      time: { value: 0 },
    },
    vertexShader: `
      varying vec3 vDir;
      void main() {
        vDir = position;
        gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
      }`,
    fragmentShader: `
      uniform vec3 horizon; uniform vec3 mid; uniform vec3 top; uniform vec3 sunDir; uniform float time;
      varying vec3 vDir;
      float hash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
      float noise(vec2 p) {
        vec2 i = floor(p), f = fract(p);
        f = f * f * (3.0 - 2.0 * f);
        return mix(mix(hash(i), hash(i + vec2(1.0, 0.0)), f.x), mix(hash(i + vec2(0.0, 1.0)), hash(i + vec2(1.0, 1.0)), f.x), f.y);
      }
      float fbm(vec2 p) {
        float v = 0.0, a = 0.5;
        for (int i = 0; i < 4; i++) { v += a * noise(p); p *= 2.03; a *= 0.5; }
        return v;
      }
      void main() {
        vec3 d = normalize(vDir);
        float h = max(d.y, 0.0);
        vec3 col = mix(horizon, mid, smoothstep(0.0, 0.22, h));
        col = mix(col, top, smoothstep(0.18, 0.95, h));

        // Nubes: más oscuras y densas arriba, claras cerca del sol.
        vec2 uv = d.xz / (d.y + 0.28) * 1.5 + vec2(time * 0.012, time * 0.004);
        float c = fbm(uv);
        float cover = smoothstep(0.40, 0.78, c) * smoothstep(0.02, 0.22, h);
        vec3 cloud = mix(vec3(0.98, 0.72, 0.36), vec3(0.38, 0.20, 0.07), smoothstep(0.38, 0.85, c));
        col = mix(col, cloud, cover * 0.8);

        // Sol y resplandor
        float s = max(dot(d, sunDir), 0.0);
        col += vec3(1.0, 0.78, 0.36) * (pow(s, 3.0) * 0.4 + pow(s, 28.0) * 0.55);
        col = mix(col, vec3(1.0, 0.95, 0.8), smoothstep(0.9987, 0.9994, s) * (1.0 - cover * 0.7));

        gl_FragColor = vec4(col, 1.0);
        #include <tonemapping_fragment>
        #include <colorspace_fragment>
      }`,
  });
  const sky = new THREE.Mesh(new THREE.SphereGeometry(380, 24, 12), mat);
  sky.frustumCulled = false;
  scene.add(sky);

  scene.fog = new THREE.Fog(FOG_COLOR, 26, 150);

  // luz ambiente fría y apagada (marrón violáceo): es el color de las sombras; el sol, amarillo pálido e intenso, pone el calor
  scene.add(new THREE.HemisphereLight(0xa8929e, 0x5c4048, 1.45));
  const sun = new THREE.DirectionalLight(0xffe9b0, 3.9);
  sun.shadow.mapSize.set(1024, 1024);
  const sc = sun.shadow.camera;
  sc.left = sc.bottom = -35;
  sc.right = sc.top = 35;
  sc.near = 1;
  sc.far = 160;
  sun.shadow.bias = -0.0015;
  scene.add(sun, sun.target);

  return { sky, sun, material: mat };
}
